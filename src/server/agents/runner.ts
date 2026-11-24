import Anthropic from "@anthropic-ai/sdk";
import { db, schema } from "@/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Agent, Task } from "@/db/schema";
import { anthropicClient } from "@/server/integrations/providers";
import { IntegrationNotConfigured, markSync } from "@/server/integrations/registry";
import { toolDefinitions, runTool, type ToolContext } from "@/server/tools";
import { coreContext } from "@/server/memory";
import { emit } from "@/server/lib/events";
import { getSetting, appTimezone } from "@/server/lib/settings";
import { priceFor } from "./catalog";
import { releaseDependents, failDependents } from "@/server/tasks";
import { enqueueTask } from "@/server/queue";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;

class NonRetryable extends Error {}

async function log(taskId: string, message: string, opts: { level?: string; kind?: string; data?: unknown } = {}) {
  await db.insert(schema.taskLogs).values({
    taskId,
    message: message.slice(0, 4000),
    level: opts.level ?? "info",
    kind: opts.kind ?? "log",
    data: (opts.data ?? null) as never,
  });
}

function truncateJson(v: unknown, max = 12000) {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 1);
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}

async function buildSystemPrompt(agent: Agent): Promise<string> {
  const profile = await getSetting("businessProfile");
  const { docs, companyMem, agentMem } = await coreContext(agent.id);
  const docBlock = docs.length
    ? docs.map((d) => `### ${d.category.toUpperCase()} — ${d.title}\n${d.content.slice(0, 2500)}`).join("\n\n")
    : "(The knowledge base is empty. Do not invent business facts — state assumptions explicitly and recommend that the owner fills in the knowledge base.)";
  const memBlock = companyMem.length ? companyMem.map((m) => `- [${m.kind}] ${m.title}: ${m.content.slice(0, 400)}`).join("\n") : "(none yet)";
  const ownMem = agentMem.length ? agentMem.map((m) => `- ${m.title}: ${m.content.slice(0, 400)}`).join("\n") : "(none yet)";
  return `${agent.systemPrompt}

# Your contract
Input: ${agent.inputFormat}
Output: ${agent.outputFormat}

# Company
${profile.companyName ? `Company: ${profile.companyName}${profile.oneLiner ? ` — ${profile.oneLiner}` : ""}` : "Company name not configured yet."}
${profile.website ? `Website: ${profile.website}` : ""}
Owner: ${profile.ownerName || "the owner"}. Timezone: ${appTimezone()}.

## Core knowledge
${docBlock}

## Shared company memory (most important first)
${memBlock}

## Your own memory
${ownMem}

# Operating rules (apply to every agent)
- You are one of 36 agents in an autonomous company. Work only within your mandate; hand off with send_message or (if permitted) delegate_task.
- Ground every factual claim in tool results, the knowledge base or your memory. Never fabricate data, sources, metrics, quotes or results. If information is missing, say so.
- Tools that touch the outside world are real. When a tool reports that an integration is not connected or that approval was requested, report exactly that — never claim an action happened unless a tool confirmed it.
- Use search_knowledge for business facts not shown above.
- Be efficient: plan briefly, use tools purposefully, avoid redundant calls.
- Finish by calling submit_result exactly once with a factual one-sentence summary (real counts), the full markdown deliverable, and structured data.`;
}

async function buildUserMessage(task: Task): Promise<string> {
  const parts = [`# Task: ${task.title}`, `Task id: ${task.id}`, `Current time: ${new Date().toISOString()}`, "", task.instructions];
  const ctx = task.context ?? {};
  if (ctx.upstream && Array.isArray(ctx.upstream) && ctx.upstream.length) {
    parts.push("\n# Input from previous steps");
    for (const u of ctx.upstream as { agent: string; title: string; summary: string; output: string }[]) {
      parts.push(`\n## ${u.agent} — ${u.title}\nSummary: ${u.summary}\n\n${(u.output ?? "").slice(0, 12000)}`);
    }
  }
  if (task.dependsOn.length) {
    const deps = await db.select().from(schema.tasks).where(sql`${schema.tasks.id} = any(${task.dependsOn}::uuid[])`);
    if (deps.length) {
      parts.push("\n# Output of tasks this depends on");
      for (const d of deps) parts.push(`\n## ${d.title} (${d.agentId})\n${d.summary ?? ""}\n\n${(d.output ?? "").slice(0, 10000)}`);
    }
  }
  const unread = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.agentMessages)
    .where(and(eq(schema.agentMessages.toAgent, task.agentId), sql`${schema.agentMessages.readAt} is null`));
  if (Number(unread[0].c) > 0) parts.push(`\nYou have ${unread[0].c} unread message(s) from other agents — check read_inbox if relevant.`);
  return parts.join("\n");
}

async function monthSpend() {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const [r] = await db.select({ s: sql<number>`coalesce(sum(cost_usd),0)` }).from(schema.tasks).where(gte(schema.tasks.createdAt, start));
  return Number(r.s);
}

function isRetryable(e: unknown) {
  if (e instanceof NonRetryable || e instanceof IntegrationNotConfigured) return false;
  if (e instanceof Anthropic.APIError) {
    const s = e.status ?? 0;
    return s === 0 || s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return true; // network & unknown errors
}

/** Executes one task end-to-end. Safe to call concurrently: claiming is atomic. */
export async function runTask(taskId: string) {
  const [task] = await db
    .update(schema.tasks)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${schema.tasks.attempts} + 1`, error: null })
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.status, "queued")))
    .returning();
  if (!task) return; // already claimed, cancelled or blocked

  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, task.agentId) });
  if (!agent) throw new Error(`Agent ${task.agentId} missing`);
  if (!agent.enabled) {
    // Park the task until the agent is re-activated.
    await db.update(schema.tasks).set({ status: "queued", attempts: task.attempts - 1, startedAt: null }).where(eq(schema.tasks.id, task.id));
    await log(task.id, `${agent.name} is deactivated — task parked until it is re-activated.`, { level: "warn" });
    return;
  }

  await db.update(schema.agents).set({ status: "running", currentTaskId: task.id }).where(eq(schema.agents.id, agent.id));
  await emit("task.started", `${agent.name} started “${task.title}”`, { agentId: agent.id, taskId: task.id });
  const started = Date.now();
  const price = priceFor(agent.model);
  let inTok = 0,
    outTok = 0,
    cost = 0;
  const ctx: ToolContext = { agent, task, createdTaskIds: [] };

  try {
    const policy = await getSetting("approvalPolicy");
    if (policy.monthlyBudgetUsd > 0 && (await monthSpend()) >= policy.monthlyBudgetUsd)
      throw new NonRetryable(`Monthly AI budget of $${policy.monthlyBudgetUsd} reached. Raise it in Settings to continue.`);

    const client = await anthropicClient();
    const system = await buildSystemPrompt(agent);
    const tools = toolDefinitions(agent);
    const messages: Beta[] = [{ role: "user", content: await buildUserMessage(task) }];
    let result: { summary: string; output: string; data?: Record<string, unknown> } | null = null;
    let nudged = false;
    const useFallback = /^claude-(opus|sonnet|fable)/.test(agent.model);

    for (let iter = 0; iter < agent.maxIterations && !result; iter++) {
      const current = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, task.id), columns: { status: true } });
      if (current?.status === "cancelled") throw new NonRetryable("Cancelled by owner");

      const stream = client.beta.messages.stream({
        model: agent.model,
        max_tokens: 32000,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: agent.effort as "low" | "medium" | "high" | "xhigh" },
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const msg = await stream.finalMessage();

      const u = msg.usage;
      const cIn = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      inTok += cIn;
      outTok += u.output_tokens ?? 0;
      cost +=
        ((u.input_tokens ?? 0) * price.input + (u.cache_creation_input_tokens ?? 0) * price.input * 1.25 + (u.cache_read_input_tokens ?? 0) * price.input * 0.1 + (u.output_tokens ?? 0) * price.output) / 1e6 +
        ((u.server_tool_use?.web_search_requests ?? 0) * 10) / 1000;
      await log(task.id, `Model turn ${iter + 1}: ${msg.stop_reason} (${cIn} in / ${u.output_tokens} out)`, { kind: "model", level: "debug" });

      for (const b of msg.content) {
        if (b.type === "text" && b.text.trim()) await log(task.id, b.text, { kind: "model" });
        if (b.type === "server_tool_use") await log(task.id, `${b.name}: ${truncateJson(b.input, 400)}`, { kind: "tool_call", data: b.input });
      }

      if (msg.stop_reason === "refusal") throw new NonRetryable(`Model declined the request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.`);

      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });

      if (msg.stop_reason === "pause_turn") continue;

      const toolUses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) {
        if (msg.stop_reason === "max_tokens") {
          messages.push({ role: "user", content: "You hit the output limit. Continue, then call submit_result." });
          continue;
        }
        if (!nudged) {
          nudged = true;
          messages.push({ role: "user", content: "Call submit_result now with your summary, full output and data." });
          continue;
        }
        const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
        result = { summary: text.split("\n")[0].slice(0, 300), output: text };
        break;
      }

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === "submit_result") {
          const inp = tu.input as { summary?: string; output?: string; data?: Record<string, unknown> };
          result = { summary: String(inp.summary ?? "").slice(0, 500), output: String(inp.output ?? ""), data: inp.data ?? undefined };
          continue;
        }
        await log(task.id, `→ ${tu.name}(${truncateJson(tu.input, 600)})`, { kind: "tool_call", data: tu.input });
        try {
          const out = await runTool(tu.name, tu.input, ctx);
          const text = truncateJson(out);
          await log(task.id, `← ${tu.name}: ${text.slice(0, 1500)}`, { kind: "tool_result" });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: text });
        } catch (e) {
          const m = (e as Error).message;
          await log(task.id, `✗ ${tu.name}: ${m}`, { kind: "tool_result", level: "warn" });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: m, is_error: true });
        }
      }
      if (result) break;
      messages.push({ role: "user", content: results });
    }

    if (!result) throw new NonRetryable(`Did not finish within ${agent.maxIterations} steps.`);

    const durationMs = Date.now() - started;
    await db
      .update(schema.tasks)
      .set({
        status: "completed",
        summary: result.summary || "Completed",
        output: result.output,
        data: result.data ?? null,
        model: agent.model,
        inputTokens: task.inputTokens + inTok,
        outputTokens: task.outputTokens + outTok,
        costUsd: task.costUsd + cost,
        durationMs,
        completedAt: new Date(),
      })
      .where(eq(schema.tasks.id, task.id));
    await db.update(schema.agents).set({ status: "idle", currentTaskId: null }).where(eq(schema.agents.id, agent.id));
    await emit("task.completed", `${agent.name}: ${result.summary || `completed “${task.title}”`}`, {
      agentId: agent.id,
      taskId: task.id,
      data: { durationMs, costUsd: cost, delegated: ctx.createdTaskIds.length },
    });
    await markSync("anthropic");
    await releaseDependents(task.id);
    if (task.workflowRunId) {
      const { onTaskFinished } = await import("@/server/workflows/engine");
      await onTaskFinished(task.id);
    }
  } catch (e) {
    const message = (e as Error).message || String(e);
    const retry = isRetryable(e) && task.attempts < task.maxAttempts && !message.includes("Cancelled");
    const base = {
      model: agent.model,
      inputTokens: task.inputTokens + inTok,
      outputTokens: task.outputTokens + outTok,
      costUsd: task.costUsd + cost,
    };
    if (e instanceof Anthropic.APIError) await markSync("anthropic", message);
    if (retry) {
      const delay = 30_000 * 2 ** (task.attempts - 1);
      await db.update(schema.tasks).set({ ...base, status: "queued", error: message }).where(eq(schema.tasks.id, task.id));
      await log(task.id, `Attempt ${task.attempts} failed: ${message}. Retrying in ${Math.round(delay / 1000)}s.`, { level: "warn" });
      await db.update(schema.agents).set({ status: "idle", currentTaskId: null }).where(eq(schema.agents.id, agent.id));
      await enqueueTask(task.id, { priority: task.priority, startAfter: new Date(Date.now() + delay) });
      return;
    }
    const cancelled = message.includes("Cancelled");
    await db
      .update(schema.tasks)
      .set({ ...base, status: cancelled ? "cancelled" : "failed", error: message, durationMs: Date.now() - started, completedAt: new Date() })
      .where(eq(schema.tasks.id, task.id));
    await log(task.id, message, { level: "error" });
    await db
      .update(schema.agents)
      .set({ status: cancelled ? "idle" : "attention", currentTaskId: null })
      .where(eq(schema.agents.id, agent.id));
    await emit(cancelled ? "task.cancelled" : "task.failed", `${agent.name} ${cancelled ? "cancelled" : "failed"} “${task.title}”: ${message.slice(0, 200)}`, {
      agentId: agent.id,
      taskId: task.id,
    });
    await failDependents(task.id);
    if (task.workflowRunId) {
      const { onTaskFinished } = await import("@/server/workflows/engine");
      await onTaskFinished(task.id);
    }
  }
}
