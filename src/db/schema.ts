import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  serial,
  index,
  uuid,
  customType,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const now = (name: string) => ts(name).defaultNow().notNull();

/* ───────────────────────── Agents ───────────────────────── */

export const agents = pgTable("agents", {
  id: text("id").primaryKey(), // slug, e.g. "trend-scout"
  department: text("department").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  inputFormat: text("input_format").notNull(),
  outputFormat: text("output_format").notNull(),
  model: text("model").notNull(),
  effort: text("effort").notNull().default("medium"),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("idle"), // idle | running | attention | disabled
  currentTaskId: uuid("current_task_id"),
  maxIterations: integer("max_iterations").notNull().default(12),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: now("updated_at"),
});

/* ───────────────────────── Tasks ───────────────────────── */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    title: text("title").notNull(),
    instructions: text("instructions").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    // queued | blocked | running | completed | failed | cancelled
    priority: integer("priority").notNull().default(5), // 1 highest .. 9 lowest
    createdBy: text("created_by").notNull().default("owner"), // owner | agent:<id> | workflow:<id> | system
    parentTaskId: uuid("parent_task_id"),
    dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
    workflowRunId: uuid("workflow_run_id"),
    workflowNodeId: text("workflow_node_id"),
    summary: text("summary"),
    output: text("output"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms"),
    qualityScore: integer("quality_score"),
    createdAt: now("created_at"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("tasks_agent_idx").on(t.agentId, t.createdAt),
    index("tasks_status_idx").on(t.status),
    index("tasks_run_idx").on(t.workflowRunId),
  ],
);

export const taskLogs = pgTable(
  "task_logs",
  {
    id: serial("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    level: text("level").notNull().default("info"), // debug | info | warn | error
    kind: text("kind").notNull().default("log"), // log | tool_call | tool_result | model
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: now("created_at"),
  },
  (t) => [index("task_logs_task_idx").on(t.taskId, t.id)],
);

/* ───────────────────────── Activity feed ───────────────────────── */

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // task.started, task.completed, approval.requested ...
    agentId: text("agent_id"),
    taskId: uuid("task_id"),
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: now("created_at"),
  },
  (t) => [index("events_created_idx").on(t.createdAt)],
);

/* ───────────────────────── Agent communication ───────────────────────── */

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: serial("id").primaryKey(),
    fromAgent: text("from_agent").notNull(),
    toAgent: text("to_agent").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    taskId: uuid("task_id"),
    readAt: ts("read_at"),
    createdAt: now("created_at"),
  },
  (t) => [index("agent_messages_to_idx").on(t.toAgent, t.readAt)],
);

/* ───────────────────────── Memory & knowledge ───────────────────────── */

export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(), // company | agent
    agentId: text("agent_id"),
    kind: text("kind").notNull().default("note"), // note | decision | insight | preference | fact
    title: text("title").notNull(),
    content: text("content").notNull(),
    importance: integer("importance").notNull().default(3), // 1..5
    source: text("source"), // task id / owner
    createdAt: now("created_at"),
  },
  (t) => [index("memories_scope_idx").on(t.scope, t.agentId)],
);

export const knowledgeDocs = pgTable("knowledge_docs", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  // objectives | brand | audience | products | pricing | tone | competitors | strategy | campaigns | performance | other
  title: text("title").notNull(),
  content: text("content").notNull(),
  fileName: text("file_name"),
  updatedAt: now("updated_at"),
  createdAt: now("created_at"),
});

/* ───────────────────────── Human control ───────────────────────── */

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(),
    // external_communication | publishing | financial | settings_change | irreversible | workflow_gate | content_review
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    action: jsonb("action").$type<{ type: string; params: Record<string, unknown> } | null>(),
    risk: text("risk").notNull().default("medium"), // low | medium | high
    status: text("status").notNull().default("pending"), // pending | approved | rejected | executed | failed
    requestedBy: text("requested_by"),
    taskId: uuid("task_id"),
    workflowRunId: uuid("workflow_run_id"),
    workflowNodeId: text("workflow_node_id"),
    decisionNote: text("decision_note"),
    result: jsonb("result"),
    decidedAt: ts("decided_at"),
    createdAt: now("created_at"),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

/* ───────────────────────── Workflows ───────────────────────── */

export type WorkflowNode = {
  id: string;
  type: "trigger" | "agent" | "condition" | "approval" | "delay";
  position: { x: number; y: number };
  data: {
    label?: string;
    agentId?: string;
    instructions?: string;
    // condition
    mode?: "contains" | "not_contains" | "data_gte" | "data_lte" | "status";
    field?: string;
    value?: string;
    // approval
    title?: string;
    // delay
    minutes?: number;
  };
};
export type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: string | null };

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(true),
  triggerType: text("trigger_type").notNull().default("manual"), // manual | schedule | event
  schedule: text("schedule"), // cron expression in APP_TIMEZONE
  eventType: text("event_type"), // e.g. content.published
  nodes: jsonb("nodes").$type<WorkflowNode[]>().notNull().default([]),
  edges: jsonb("edges").$type<WorkflowEdge[]>().notNull().default([]),
  system: boolean("system").notNull().default(false),
  lastRunAt: ts("last_run_at"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
});

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id").notNull(),
    status: text("status").notNull().default("running"), // running | waiting | completed | failed | cancelled
    trigger: text("trigger").notNull().default("manual"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: now("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("workflow_runs_wf_idx").on(t.workflowId, t.startedAt)],
);

export const workflowStepRuns = pgTable(
  "workflow_step_runs",
  {
    id: serial("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    status: text("status").notNull().default("pending"),
    // pending | running | waiting | completed | skipped | failed
    taskId: uuid("task_id"),
    approvalId: uuid("approval_id"),
    output: text("output"),
    branch: text("branch"), // for conditions: "true" | "false"
    error: text("error"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("wsr_run_idx").on(t.runId)],
);

/* ───────────────────────── Integrations ───────────────────────── */

export const integrations = pgTable("integrations", {
  id: text("id").primaryKey(), // provider key
  credentials: text("credentials"), // AES-256-GCM encrypted JSON
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncAt: ts("last_sync_at"),
  lastError: text("last_error"),
  lastErrorAt: ts("last_error_at"),
  updatedAt: now("updated_at"),
});

/* ───────────────────────── Business objects ───────────────────────── */

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(), // instagram | tiktok | youtube | x | linkedin | newsletter
    format: text("format").notNull(), // post | reel | short | video | carousel | thread | newsletter
    title: text("title").notNull(),
    hook: text("hook"),
    caption: text("caption"),
    script: text("script"),
    body: text("body"),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    assets: jsonb("assets")
      .$type<{ kind: string; url: string; label?: string; prompt?: string }[]>()
      .notNull()
      .default([]),
    productionNotes: text("production_notes"),
    status: text("status").notNull().default("draft"),
    // draft | in_review | approved | scheduled | publishing | published | failed | rejected
    brandCheck: jsonb("brand_check").$type<{ passed: boolean; notes: string; score?: number } | null>(),
    scheduledFor: ts("scheduled_for"),
    publishedAt: ts("published_at"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    publishError: text("publish_error"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    metricsUpdatedAt: ts("metrics_updated_at"),
    createdByAgent: text("created_by_agent"),
    taskId: uuid("task_id"),
    createdAt: now("created_at"),
    updatedAt: now("updated_at"),
  },
  (t) => [index("content_status_idx").on(t.status)],
);

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  company: text("company"),
  title: text("title"),
  email: text("email"),
  website: text("website"),
  linkedin: text("linkedin"),
  source: text("source"),
  score: integer("score"),
  scoreReason: text("score_reason"),
  stage: text("stage").notNull().default("new"),
  // new | qualified | contacted | replied | meeting | won | lost
  notes: text("notes"),
  draftOutreach: text("draft_outreach"),
  lastContactAt: ts("last_contact_at"),
  nextFollowUpAt: ts("next_follow_up_at"),
  crmId: text("crm_id"),
  createdByAgent: text("created_by_agent"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),
  kind: text("kind").notNull().default("comment"), // comment | dm | mention
  author: text("author").notNull(),
  text: text("text").notNull(),
  externalId: text("external_id"),
  contentItemId: uuid("content_item_id"),
  sentiment: text("sentiment"), // positive | neutral | negative
  priority: text("priority"), // low | normal | high | escalate
  isLeadSignal: boolean("is_lead_signal").notNull().default(false),
  draftReply: text("draft_reply"),
  status: text("status").notNull().default("open"), // open | drafted | replied | escalated | closed
  createdAt: now("created_at"),
});

export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  forDate: text("for_date").notNull(), // YYYY-MM-DD
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  narrative: text("narrative"),
  deliveredVia: jsonb("delivered_via").$type<string[]>().notNull().default([]),
  createdAt: now("created_at"),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  readAt: ts("read_at"),
  createdAt: now("created_at"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: now("updated_at"),
});

/* ───────────────────────── Audit trail ───────────────────────── */

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  actor: text("actor").notNull(), // owner | agent:<id> | system
  action: text("action").notNull(),
  target: text("target"),
  details: jsonb("details"),
  createdAt: now("created_at"),
});

export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Event = typeof events.$inferSelect;

/* ───────────────────────── Media (generated images / audio) ───────────────────────── */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Stored in Postgres so the web app and the worker (separate servers in production) share media. */
export const media = pgTable("media", {
  name: text("name").primaryKey(), // <32 hex>.<ext>
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: now("created_at"),
});
