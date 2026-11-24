/** Applies pending SQL migrations from ./drizzle (used at production start-up). */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  console.log("✓ database migrated");
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
