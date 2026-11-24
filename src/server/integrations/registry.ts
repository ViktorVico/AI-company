import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/server/lib/crypto";

export type FieldDef = { key: string; label: string; env: string; secret?: boolean; placeholder?: string; optional?: boolean };

export type IntegrationDef = {
  id: string;
  name: string;
  category: "intelligence" | "media" | "publishing" | "communication" | "crm";
  description: string;
  permissions: string[]; // what the integration lets the system do
  usedBy: string[]; // agent ids
  fields: FieldDef[];
  docs: string;
};

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    category: "intelligence",
    description: "Primary intelligence for all 36 agents, including web search and web fetch tools.",
    permissions: ["Run agent reasoning", "Server-side web search & fetch"],
    usedBy: ["*"],
    fields: [{ key: "apiKey", label: "API key", env: "ANTHROPIC_API_KEY", secret: true, placeholder: "sk-ant-…" }],
    docs: "https://platform.claude.com/settings/keys",
  },
  {
    id: "openai_images",
    name: "OpenAI Images",
    category: "media",
    description: "Image generation (gpt-image-1) for Visual Designer and Carousel Builder.",
    permissions: ["Generate images"],
    usedBy: ["visual-designer", "carousel-builder"],
    fields: [{ key: "apiKey", label: "API key", env: "OPENAI_API_KEY", secret: true, placeholder: "sk-…" }],
    docs: "https://platform.openai.com/api-keys",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "media",
    description: "Text-to-speech voiceovers for Reels, TikTok and Shorts.",
    permissions: ["Generate speech audio"],
    usedBy: ["voiceover-producer"],
    fields: [
      { key: "apiKey", label: "API key", env: "ELEVENLABS_API_KEY", secret: true },
      { key: "voiceId", label: "Default voice id", env: "ELEVENLABS_VOICE_ID", optional: true, placeholder: "21m00Tcm4TlvDq8ikWAM" },
    ],
    docs: "https://elevenlabs.io/app/settings/api-keys",
  },
  {
    id: "x",
    name: "X (Twitter)",
    category: "publishing",
    description: "Publish posts & threads, read mentions and engagement via X API v2.",
    permissions: ["tweet.write", "tweet.read", "users.read"],
    usedBy: ["x-publisher", "comment-monitor", "response-writer"],
    fields: [{ key: "accessToken", label: "OAuth 2.0 user access token", env: "X_ACCESS_TOKEN", secret: true }],
    docs: "https://developer.x.com/en/portal/dashboard",
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "publishing",
    description: "Publish posts, carousels and Reels; read comments and insights via the Instagram Graph API.",
    permissions: ["instagram_content_publish", "instagram_manage_comments", "instagram_manage_insights"],
    usedBy: ["instagram-publisher", "comment-monitor", "response-writer"],
    fields: [
      { key: "accessToken", label: "Long-lived access token", env: "INSTAGRAM_ACCESS_TOKEN", secret: true },
      { key: "userId", label: "Instagram business user id", env: "INSTAGRAM_USER_ID" },
    ],
    docs: "https://developers.facebook.com/docs/instagram-platform",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    category: "publishing",
    description: "Publish LinkedIn posts via the Posts API.",
    permissions: ["w_member_social"],
    usedBy: ["x-publisher"],
    fields: [
      { key: "accessToken", label: "Access token", env: "LINKEDIN_ACCESS_TOKEN", secret: true },
      { key: "authorUrn", label: "Author URN", env: "LINKEDIN_AUTHOR_URN", placeholder: "urn:li:person:…" },
    ],
    docs: "https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api",
  },
  {
    id: "tiktok",
    name: "TikTok",
    category: "publishing",
    description: "Publish videos through the TikTok Content Posting API (PULL_FROM_URL).",
    permissions: ["video.publish"],
    usedBy: ["tiktok-publisher"],
    fields: [
      { key: "accessToken", label: "User access token", env: "TIKTOK_ACCESS_TOKEN", secret: true },
      { key: "privacyLevel", label: "Privacy level", env: "TIKTOK_PRIVACY_LEVEL", optional: true, placeholder: "SELF_ONLY (unaudited apps)" },
    ],
    docs: "https://developers.tiktok.com/doc/content-posting-api-get-started",
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "publishing",
    description: "Upload Shorts and videos, read statistics and comments via the YouTube Data API v3.",
    permissions: ["youtube.upload", "youtube.readonly", "youtube.force-ssl"],
    usedBy: ["youtube-publisher", "comment-monitor"],
    fields: [{ key: "accessToken", label: "OAuth access token", env: "YOUTUBE_ACCESS_TOKEN", secret: true }],
    docs: "https://developers.google.com/youtube/v3/guides/uploading_a_video",
  },
  {
    id: "resend",
    name: "Resend (email & newsletter)",
    category: "communication",
    description: "Outbound email (always owner-approved), newsletter broadcasts and briefing delivery.",
    permissions: ["Send email", "Create & send broadcasts"],
    usedBy: ["outreach-writer", "follow-up-assistant", "newsletter-publisher"],
    fields: [
      { key: "apiKey", label: "API key", env: "RESEND_API_KEY", secret: true, placeholder: "re_…" },
      { key: "from", label: "From address", env: "RESEND_FROM", placeholder: "Company <hello@domain.com>" },
      { key: "audienceId", label: "Newsletter audience id", env: "RESEND_AUDIENCE_ID", optional: true },
      { key: "briefingTo", label: "Briefing recipient", env: "BRIEFING_EMAIL_TO", optional: true },
    ],
    docs: "https://resend.com/api-keys",
  },
  {
    id: "slack",
    name: "Slack notifications",
    category: "communication",
    description: "Push approvals, escalations and the morning briefing to a Slack channel.",
    permissions: ["Post to one channel (incoming webhook)"],
    usedBy: ["*"],
    fields: [{ key: "webhookUrl", label: "Incoming webhook URL", env: "SLACK_WEBHOOK_URL", secret: true }],
    docs: "https://api.slack.com/messaging/webhooks",
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    category: "crm",
    description: "Sync leads to HubSpot contacts.",
    permissions: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    usedBy: ["crm-manager"],
    fields: [{ key: "accessToken", label: "Private app access token", env: "HUBSPOT_ACCESS_TOKEN", secret: true }],
    docs: "https://developers.hubspot.com/docs/api/private-apps",
  },
];

export class IntegrationNotConfigured extends Error {
  constructor(public integrationId: string) {
    const def = INTEGRATIONS.find((i) => i.id === integrationId);
    super(`${def?.name ?? integrationId} is not connected. Configure it on the Integrations page.`);
  }
}

type Creds = Record<string, string>;

/** Server-only. Merges credentials saved in the DB (encrypted) with environment variables. */
export async function getCredentials(id: string): Promise<{ creds: Creds; source: "db" | "env" | "none"; enabled: boolean }> {
  const def = INTEGRATIONS.find((i) => i.id === id);
  if (!def) throw new Error(`Unknown integration ${id}`);
  const row = await db.query.integrations.findFirst({ where: eq(schema.integrations.id, id) });
  let stored: Creds = {};
  if (row?.credentials) {
    try {
      stored = JSON.parse(decrypt(row.credentials));
    } catch {
      stored = {};
    }
  }
  const creds: Creds = {};
  let source: "db" | "env" | "none" = "none";
  for (const f of def.fields) {
    const v = stored[f.key] || process.env[f.env] || "";
    if (v) creds[f.key] = v;
    if (stored[f.key]) source = "db";
    else if (process.env[f.env] && source === "none") source = "env";
  }
  return { creds, source, enabled: row?.enabled ?? true };
}

export async function requireCredentials(id: string): Promise<Creds> {
  const def = INTEGRATIONS.find((i) => i.id === id)!;
  const { creds, enabled } = await getCredentials(id);
  const missing = def.fields.filter((f) => !f.optional && !creds[f.key]);
  if (!enabled || missing.length) throw new IntegrationNotConfigured(id);
  return creds;
}

export async function isConfigured(id: string) {
  try {
    await requireCredentials(id);
    return true;
  } catch {
    return false;
  }
}

export async function saveCredentials(id: string, values: Creds) {
  const { creds: existing } = await getCredentials(id);
  const row = await db.query.integrations.findFirst({ where: eq(schema.integrations.id, id) });
  let stored: Creds = {};
  if (row?.credentials) {
    try {
      stored = JSON.parse(decrypt(row.credentials));
    } catch {}
  }
  // Empty values keep the existing stored secret; "-" clears it.
  for (const [k, v] of Object.entries(values)) {
    if (v === "-") delete stored[k];
    else if (v) stored[k] = v.trim();
  }
  void existing;
  const enc = Object.keys(stored).length ? encrypt(JSON.stringify(stored)) : null;
  await db
    .insert(schema.integrations)
    .values({ id, credentials: enc })
    .onConflictDoUpdate({ target: schema.integrations.id, set: { credentials: enc, updatedAt: new Date(), lastError: null } });
}

export async function markSync(id: string, error?: string | null) {
  const values = error
    ? { lastError: error.slice(0, 1000), lastErrorAt: new Date() }
    : { lastSyncAt: new Date(), lastError: null };
  await db
    .insert(schema.integrations)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: schema.integrations.id, set: { ...values, updatedAt: new Date() } });
}

/** Wraps a provider call so every integration records last success / last error. */
export async function tracked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    await markSync(id);
    return r;
  } catch (e) {
    if (!(e instanceof IntegrationNotConfigured)) await markSync(id, (e as Error).message);
    throw e;
  }
}
