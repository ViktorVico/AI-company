/**
 * Official-API clients for every integration. Every function either performs the
 * real call or throws — nothing here ever fakes a success.
 */
import Anthropic from "@anthropic-ai/sdk";
import { requireCredentials, getCredentials, tracked, IntegrationNotConfigured } from "./registry";
import { saveFile, readStoredFile } from "@/server/lib/storage";

async function http(url: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body, signal: init.signal ?? AbortSignal.timeout(120_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 500)}`);
  }
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = async <T = any>(url: string, init: RequestInit & { json?: unknown } = {}) => (await http(url, init)).json() as Promise<T>;

/* ───────────── Anthropic ───────────── */

export async function anthropicClient(): Promise<Anthropic> {
  const { apiKey } = await requireCredentials("anthropic");
  return new Anthropic({
    apiKey,
    // Explicit base URL so ambient ANTHROPIC_BASE_URL variables from other tools are never picked up.
    baseURL: process.env.AI_COMPANY_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
    maxRetries: 3,
    timeout: 10 * 60 * 1000,
  });
}

/* ───────────── Media ───────────── */

export async function generateImage(prompt: string, size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1024") {
  const { apiKey } = await requireCredentials("openai_images");
  return tracked("openai_images", async () => {
    const r = await j<{ data: { b64_json: string }[] }>("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      json: { model: "gpt-image-1", prompt, size, n: 1 },
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image data");
    return saveFile(Buffer.from(b64, "base64"), "png");
  });
}

export async function generateSpeech(text: string, voiceId?: string) {
  const creds = await requireCredentials("elevenlabs");
  const voice = voiceId || creds.voiceId || "21m00Tcm4TlvDq8ikWAM";
  return tracked("elevenlabs", async () => {
    const res = await http(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": creds.apiKey, accept: "audio/mpeg" },
      json: { text, model_id: "eleven_multilingual_v2" },
    });
    return saveFile(Buffer.from(await res.arrayBuffer()), "mp3");
  });
}

/* ───────────── Communication ───────────── */

export async function sendEmail(p: { to: string; subject: string; text: string; html?: string }) {
  const c = await requireCredentials("resend");
  if (!c.from) throw new IntegrationNotConfigured("resend");
  return tracked("resend", async () => {
    const r = await j<{ id: string }>("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${c.apiKey}` },
      json: { from: c.from, to: [p.to], subject: p.subject, text: p.text, html: p.html },
    });
    return { id: r.id };
  });
}

export async function sendNewsletterBroadcast(p: { subject: string; html: string; text: string }) {
  const c = await requireCredentials("resend");
  if (!c.audienceId || !c.from) throw new Error("Resend newsletter needs a From address and an audience id.");
  return tracked("resend", async () => {
    const b = await j<{ id: string }>("https://api.resend.com/broadcasts", {
      method: "POST",
      headers: { authorization: `Bearer ${c.apiKey}` },
      json: { audience_id: c.audienceId, from: c.from, subject: p.subject, html: p.html, text: p.text, name: p.subject },
    });
    await j(`https://api.resend.com/broadcasts/${b.id}/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.apiKey}` },
      json: {},
    });
    return { id: b.id, url: null as string | null };
  });
}

export async function sendSlack(text: string, opts: { silentIfMissing?: boolean } = {}) {
  const { creds, enabled } = await getCredentials("slack");
  if (!creds.webhookUrl || !enabled) {
    if (opts.silentIfMissing) return false;
    throw new IntegrationNotConfigured("slack");
  }
  await tracked("slack", () => http(creds.webhookUrl, { method: "POST", json: { text } }));
  return true;
}

/* ───────────── CRM ───────────── */

export async function hubspotUpsertContact(lead: {
  crmId?: string | null;
  name: string;
  email?: string | null;
  company?: string | null;
  title?: string | null;
  website?: string | null;
}) {
  const { accessToken } = await requireCredentials("hubspot");
  const [firstname, ...rest] = lead.name.split(" ");
  const properties: Record<string, string> = { firstname, lastname: rest.join(" ") };
  if (lead.email) properties.email = lead.email;
  if (lead.company) properties.company = lead.company;
  if (lead.title) properties.jobtitle = lead.title;
  if (lead.website) properties.website = lead.website;
  return tracked("hubspot", async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    if (lead.crmId) {
      await j(`https://api.hubapi.com/crm/v3/objects/contacts/${lead.crmId}`, { method: "PATCH", headers, json: { properties } });
      return { id: lead.crmId };
    }
    const r = await j<{ id: string }>("https://api.hubapi.com/crm/v3/objects/contacts", { method: "POST", headers, json: { properties } });
    return { id: r.id };
  });
}

/* ───────────── Publishing ───────────── */

export type PublishInput = {
  platform: string;
  format: string;
  title: string;
  caption?: string | null;
  body?: string | null;
  hashtags: string[];
  assets: { kind: string; url: string }[];
};
export type PublishResult = { externalId: string; url: string | null };

function absoluteUrl(u: string) {
  if (/^https?:\/\//.test(u)) return u;
  const base = process.env.APP_URL;
  if (!base) throw new Error("APP_URL must be set to a public URL so platforms can fetch media.");
  return new URL(u, base).toString();
}

function captionOf(p: PublishInput, limit: number) {
  const tags = p.hashtags.length ? "\n\n" + p.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ") : "";
  const base = (p.caption || p.body || p.title || "").trim();
  return (base + tags).slice(0, limit);
}

async function publishX(p: PublishInput): Promise<PublishResult> {
  const { accessToken } = await requireCredentials("x");
  const parts = (p.body || p.caption || p.title)
    .split(/\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.some((s) => s.length > 280)) throw new Error("A post exceeds 280 characters.");
  return tracked("x", async () => {
    let firstId = "";
    let prev: string | undefined;
    for (const text of parts) {
      const r = await j<{ data: { id: string } }>("https://api.x.com/2/tweets", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        json: prev ? { text, reply: { in_reply_to_tweet_id: prev } } : { text },
      });
      prev = r.data.id;
      firstId ||= r.data.id;
    }
    return { externalId: firstId, url: `https://x.com/i/web/status/${firstId}` };
  });
}

async function publishLinkedIn(p: PublishInput): Promise<PublishResult> {
  const { accessToken, authorUrn } = await requireCredentials("linkedin");
  return tracked("linkedin", async () => {
    const res = await http("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": "202501",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      json: {
        author: authorUrn,
        commentary: captionOf(p, 3000),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      },
    });
    const id = res.headers.get("x-restli-id") || "";
    return { externalId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
  });
}

const IG = "https://graph.facebook.com/v21.0";

async function igWaitReady(containerId: string, token: string) {
  for (let i = 0; i < 60; i++) {
    const s = await j<{ status_code: string }>(`${IG}/${containerId}?fields=status_code&access_token=${token}`);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram media container ${s.status_code}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Instagram media processing timed out");
}

async function publishInstagram(p: PublishInput): Promise<PublishResult> {
  const { accessToken: token, userId } = await requireCredentials("instagram");
  const caption = captionOf(p, 2200);
  const images = p.assets.filter((a) => a.kind === "image").map((a) => absoluteUrl(a.url));
  const video = p.assets.find((a) => a.kind === "video");
  return tracked("instagram", async () => {
    let creationId: string;
    if (video && (p.format === "reel" || p.format === "video" || !images.length)) {
      const c = await j<{ id: string }>(`${IG}/${userId}/media`, {
        method: "POST",
        json: { media_type: "REELS", video_url: absoluteUrl(video.url), caption, access_token: token },
      });
      creationId = c.id;
    } else if (images.length > 1) {
      const children: string[] = [];
      for (const image_url of images.slice(0, 10)) {
        const c = await j<{ id: string }>(`${IG}/${userId}/media`, {
          method: "POST",
          json: { image_url, is_carousel_item: true, access_token: token },
        });
        children.push(c.id);
      }
      const c = await j<{ id: string }>(`${IG}/${userId}/media`, {
        method: "POST",
        json: { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token },
      });
      creationId = c.id;
    } else if (images.length === 1) {
      const c = await j<{ id: string }>(`${IG}/${userId}/media`, {
        method: "POST",
        json: { image_url: images[0], caption, access_token: token },
      });
      creationId = c.id;
    } else {
      throw new Error("Instagram requires at least one image or video asset.");
    }
    await igWaitReady(creationId, token);
    const pub = await j<{ id: string }>(`${IG}/${userId}/media_publish`, {
      method: "POST",
      json: { creation_id: creationId, access_token: token },
    });
    const meta = await j<{ permalink?: string }>(`${IG}/${pub.id}?fields=permalink&access_token=${token}`).catch(() => ({}) as { permalink?: string });
    return { externalId: pub.id, url: meta.permalink ?? null };
  });
}

async function publishTikTok(p: PublishInput): Promise<PublishResult> {
  const { accessToken, privacyLevel } = await requireCredentials("tiktok");
  const video = p.assets.find((a) => a.kind === "video");
  if (!video) throw new Error("TikTok requires a video asset.");
  return tracked("tiktok", async () => {
    const init = await j<{ data: { publish_id: string } }>("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      json: {
        post_info: { title: captionOf(p, 2200), privacy_level: privacyLevel || "SELF_ONLY" },
        source_info: { source: "PULL_FROM_URL", video_url: absoluteUrl(video.url) },
      },
    });
    const publishId = init.data.publish_id;
    for (let i = 0; i < 60; i++) {
      const s = await j<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: string[] } }>(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, json: { publish_id: publishId } },
      );
      if (s.data.status === "PUBLISH_COMPLETE") {
        const postId = s.data.publicaly_available_post_id?.[0];
        return { externalId: postId || publishId, url: null };
      }
      if (s.data.status === "FAILED") throw new Error(`TikTok publish failed: ${s.data.fail_reason}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error(`TikTok publish ${publishId} still processing — check TikTok.`);
  });
}

async function publishYouTube(p: PublishInput): Promise<PublishResult> {
  const { accessToken } = await requireCredentials("youtube");
  const video = p.assets.find((a) => a.kind === "video");
  if (!video) throw new Error("YouTube requires a video asset.");
  return tracked("youtube", async () => {
    const bytes = video.url.startsWith("/media/")
      ? await readStoredFile(video.url)
      : Buffer.from(await (await http(video.url)).arrayBuffer());
    const init = await http(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "X-Upload-Content-Type": "video/*",
          "X-Upload-Content-Length": String(bytes.length),
        },
        json: {
          snippet: { title: p.title.slice(0, 100), description: captionOf(p, 5000), tags: p.hashtags.map((h) => h.replace(/^#/, "")) },
          status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
        },
      },
    );
    const location = init.headers.get("location");
    if (!location) throw new Error("YouTube did not return an upload URL");
    const up = await j<{ id: string }>(location, {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "video/*" },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    return { externalId: up.id, url: `https://www.youtube.com/watch?v=${up.id}` };
  });
}

async function publishNewsletter(p: PublishInput): Promise<PublishResult> {
  const md = p.body || p.caption || "";
  const html = md
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  const r = await sendNewsletterBroadcast({ subject: p.title, html, text: md });
  return { externalId: r.id, url: r.url };
}

export const PLATFORM_INTEGRATION: Record<string, string> = {
  x: "x",
  linkedin: "linkedin",
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
  newsletter: "resend",
};

export async function publishToPlatform(p: PublishInput): Promise<PublishResult> {
  switch (p.platform) {
    case "x":
      return publishX(p);
    case "linkedin":
      return publishLinkedIn(p);
    case "instagram":
      return publishInstagram(p);
    case "tiktok":
      return publishTikTok(p);
    case "youtube":
      return publishYouTube(p);
    case "newsletter":
      return publishNewsletter(p);
    default:
      throw new Error(`No publisher for platform "${p.platform}"`);
  }
}

/* ───────────── Engagement metrics ───────────── */

export async function fetchMetrics(platform: string, externalId: string): Promise<Record<string, number>> {
  switch (platform) {
    case "x": {
      const { accessToken } = await requireCredentials("x");
      const r = await tracked("x", () =>
        j<{ data: { public_metrics: Record<string, number> } }>(`https://api.x.com/2/tweets/${externalId}?tweet.fields=public_metrics`, {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      );
      return r.data.public_metrics;
    }
    case "instagram": {
      const { accessToken } = await requireCredentials("instagram");
      const r = await tracked("instagram", () =>
        j<{ like_count?: number; comments_count?: number }>(`${IG}/${externalId}?fields=like_count,comments_count&access_token=${accessToken}`),
      );
      const out: Record<string, number> = { likes: r.like_count ?? 0, comments: r.comments_count ?? 0 };
      try {
        const ins = await j<{ data: { name: string; values: { value: number }[] }[] }>(
          `${IG}/${externalId}/insights?metric=reach,saved,shares&access_token=${accessToken}`,
        );
        for (const m of ins.data) out[m.name] = m.values?.[0]?.value ?? 0;
      } catch {
        /* insights unavailable for some media types */
      }
      return out;
    }
    case "youtube": {
      const { accessToken } = await requireCredentials("youtube");
      const r = await tracked("youtube", () =>
        j<{ items: { statistics: Record<string, string> }[] }>(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${externalId}`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        ),
      );
      const s = r.items?.[0]?.statistics ?? {};
      return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
    }
    default:
      throw new Error(`Engagement metrics are not available for ${platform} through its API.`);
  }
}

/* ───────────── Comments / mentions ───────────── */

export type FetchedComment = { platform: string; externalId: string; author: string; text: string; kind: "comment" | "mention"; parentExternalId?: string };

export async function fetchComments(platform: string, publishedIds: string[]): Promise<FetchedComment[]> {
  switch (platform) {
    case "x": {
      const { accessToken } = await requireCredentials("x");
      return tracked("x", async () => {
        const me = await j<{ data: { id: string } }>("https://api.x.com/2/users/me", { headers: { authorization: `Bearer ${accessToken}` } });
        const r = await j<{ data?: { id: string; text: string; author_id: string }[]; includes?: { users: { id: string; username: string }[] } }>(
          `https://api.x.com/2/users/${me.data.id}/mentions?max_results=50&expansions=author_id`,
          { headers: { authorization: `Bearer ${accessToken}` } },
        );
        const users = new Map((r.includes?.users ?? []).map((u) => [u.id, u.username]));
        return (r.data ?? []).map((t) => ({ platform: "x", externalId: t.id, author: "@" + (users.get(t.author_id) ?? t.author_id), text: t.text, kind: "mention" as const }));
      });
    }
    case "instagram": {
      const { accessToken } = await requireCredentials("instagram");
      return tracked("instagram", async () => {
        const out: FetchedComment[] = [];
        for (const id of publishedIds.slice(0, 25)) {
          const r = await j<{ data: { id: string; text: string; username: string }[] }>(
            `${IG}/${id}/comments?fields=id,text,username&access_token=${accessToken}`,
          );
          out.push(...r.data.map((c) => ({ platform: "instagram", externalId: c.id, author: "@" + c.username, text: c.text, kind: "comment" as const, parentExternalId: id })));
        }
        return out;
      });
    }
    case "youtube": {
      const { accessToken } = await requireCredentials("youtube");
      return tracked("youtube", async () => {
        const out: FetchedComment[] = [];
        for (const id of publishedIds.slice(0, 25)) {
          const r = await j<{ items: { id: string; snippet: { topLevelComment: { snippet: { authorDisplayName: string; textOriginal: string } } } }[] }>(
            `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=50&videoId=${id}`,
            { headers: { authorization: `Bearer ${accessToken}` } },
          );
          out.push(
            ...r.items.map((c) => ({
              platform: "youtube",
              externalId: c.id,
              author: c.snippet.topLevelComment.snippet.authorDisplayName,
              text: c.snippet.topLevelComment.snippet.textOriginal,
              kind: "comment" as const,
              parentExternalId: id,
            })),
          );
        }
        return out;
      });
    }
    default:
      throw new Error(`Reading comments is not supported for ${platform}.`);
  }
}

export async function replyToConversation(platform: string, externalId: string, text: string): Promise<{ id: string }> {
  switch (platform) {
    case "x": {
      const { accessToken } = await requireCredentials("x");
      const r = await tracked("x", () =>
        j<{ data: { id: string } }>("https://api.x.com/2/tweets", {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          json: { text, reply: { in_reply_to_tweet_id: externalId } },
        }),
      );
      return { id: r.data.id };
    }
    case "instagram": {
      const { accessToken } = await requireCredentials("instagram");
      const r = await tracked("instagram", () =>
        j<{ id: string }>(`${IG}/${externalId}/replies`, { method: "POST", json: { message: text, access_token: accessToken } }),
      );
      return { id: r.id };
    }
    case "youtube": {
      const { accessToken } = await requireCredentials("youtube");
      const r = await tracked("youtube", () =>
        j<{ id: string }>("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
          method: "POST",
          headers: { authorization: `Bearer ${accessToken}` },
          json: { snippet: { parentId: externalId, textOriginal: text } },
        }),
      );
      return { id: r.id };
    }
    default:
      throw new Error(`Replying is not supported for ${platform} via API. Reply manually.`);
  }
}

/* ───────────── Connection tests ───────────── */

export async function testIntegration(id: string): Promise<string> {
  const c = await requireCredentials(id);
  return tracked(id, async () => {
    switch (id) {
      case "anthropic": {
        const client = await anthropicClient();
        const m = await client.models.retrieve("claude-opus-5-5");
        return `Connected — ${m.display_name} available`;
      }
      case "openai_images":
        await http("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${c.apiKey}` } });
        return "Connected";
      case "elevenlabs": {
        await http("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": c.apiKey } });
        return "Connected";
      }
      case "x": {
        const r = await j<{ data: { username: string } }>("https://api.x.com/2/users/me", { headers: { authorization: `Bearer ${c.accessToken}` } });
        return `Connected as @${r.data.username}`;
      }
      case "instagram": {
        const r = await j<{ username: string }>(`${IG}/${c.userId}?fields=username&access_token=${c.accessToken}`);
        return `Connected as @${r.username}`;
      }
      case "linkedin": {
        const r = await j<{ name?: string }>("https://api.linkedin.com/v2/userinfo", { headers: { authorization: `Bearer ${c.accessToken}` } });
        return `Connected${r.name ? ` as ${r.name}` : ""}`;
      }
      case "tiktok": {
        const r = await j<{ data: { creator_username?: string } }>("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
          method: "POST",
          headers: { authorization: `Bearer ${c.accessToken}` },
          json: {},
        });
        return `Connected${r.data.creator_username ? ` as @${r.data.creator_username}` : ""}`;
      }
      case "youtube": {
        const r = await j<{ items: { snippet: { title: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { authorization: `Bearer ${c.accessToken}` },
        });
        return `Connected to ${r.items?.[0]?.snippet.title ?? "channel"}`;
      }
      case "resend":
        await http("https://api.resend.com/domains", { headers: { authorization: `Bearer ${c.apiKey}` } });
        return "Connected";
      case "slack":
        await http(c.webhookUrl, { method: "POST", json: { text: "✅ AI Company connected to this channel." } });
        return "Test message posted";
      case "hubspot":
        await http("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", { headers: { authorization: `Bearer ${c.accessToken}` } });
        return "Connected";
      default:
        throw new Error("No test available");
    }
  });
}
