import { db, schema } from "@/db";
import { INTEGRATIONS, getCredentials } from "@/server/integrations/registry";
import { PageHeader } from "@/components/ui";
import { IntegrationCard } from "./client";

export const metadata = { title: "Integrations" };

const GROUPS: Record<string, string> = { intelligence: "Intelligence", media: "Media generation", publishing: "Publishing platforms", communication: "Communication", crm: "CRM" };

export default async function IntegrationsPage() {
  const rows = await db.select().from(schema.integrations);
  const items = await Promise.all(
    INTEGRATIONS.map(async (def) => {
      const row = rows.find((r) => r.id === def.id);
      const { creds, source, enabled } = await getCredentials(def.id);
      const missing = def.fields.filter((f) => !f.optional && !creds[f.key]).map((f) => f.label);
      return {
        def: { id: def.id, name: def.name, category: def.category, description: def.description, permissions: def.permissions, usedBy: def.usedBy, docs: def.docs, fields: def.fields.map((f) => ({ key: f.key, label: f.label, env: f.env, secret: !!f.secret, optional: !!f.optional, placeholder: f.placeholder })) },
        // Never send secret values to the browser — only whether they are set, plus non-secret config values.
        set: Object.fromEntries(def.fields.map((f) => [f.key, !!creds[f.key]])),
        publicValues: Object.fromEntries(def.fields.filter((f) => !f.secret && creds[f.key]).map((f) => [f.key, creds[f.key]])),
        source,
        enabled,
        connected: enabled && missing.length === 0,
        missing,
        lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
      };
    }),
  );
  const connected = items.filter((i) => i.connected).length;

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle={`${connected} of ${items.length} connected. Credentials are stored encrypted (AES-256-GCM) on the server or read from environment variables — they never reach the browser. Disconnected services are shown as disconnected; agents are told so instead of pretending.`}
      />
      <div className="space-y-8">
        {Object.entries(GROUPS).map(([g, label]) => {
          const list = items.filter((i) => i.def.category === g);
          if (!list.length) return null;
          return (
            <section key={g}>
              <h2 className="mb-3 text-[13px] font-semibold text-muted">{label}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {list.map((i) => (
                  <IntegrationCard key={i.def.id} {...i} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
