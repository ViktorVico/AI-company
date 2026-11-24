import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export type ApprovalMode = "require" | "auto";
export type ApprovalPolicy = {
  external_communication: ApprovalMode;
  publishing: ApprovalMode;
  financial: ApprovalMode;
  settings_change: ApprovalMode;
  irreversible: ApprovalMode;
  /** Monthly LLM spend cap in USD; tasks are refused once reached (0 = no cap). */
  monthlyBudgetUsd: number;
};

export type BusinessProfile = {
  companyName: string;
  ownerName: string;
  oneLiner: string;
  website: string;
  timezone: string;
};

export type BriefingSettings = {
  enabled: boolean;
  time: string; // HH:MM in timezone
  channels: ("in_app" | "email" | "slack")[];
  narrative: boolean; // let the CEO Agent write the narrative
};

export const DEFAULTS = {
  approvalPolicy: {
    external_communication: "require",
    publishing: "require",
    financial: "require",
    settings_change: "require",
    irreversible: "require",
    monthlyBudgetUsd: 100,
  } as ApprovalPolicy,
  businessProfile: {
    companyName: "",
    ownerName: "",
    oneLiner: "",
    website: "",
    timezone: process.env.APP_TIMEZONE || "UTC",
  } as BusinessProfile,
  briefing: { enabled: true, time: "08:00", channels: ["in_app"], narrative: true } as BriefingSettings,
};

type Key = keyof typeof DEFAULTS;

export async function getSetting<K extends Key>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as (typeof DEFAULTS)[K];
}

export async function setSetting<K extends Key>(key: K, value: (typeof DEFAULTS)[K]) {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
}

export function appTimezone() {
  return process.env.APP_TIMEZONE || "UTC";
}
