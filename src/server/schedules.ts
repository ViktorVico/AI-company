import { getBoss, QUEUES } from "@/server/queue";
import { getSetting, appTimezone } from "@/server/lib/settings";

/** Briefing time, publishing sweep and metrics refresh. Re-run when settings change. */
export async function syncSystemSchedules() {
  const boss = await getBoss();
  const tz = appTimezone();
  const b = await getSetting("briefing");
  if (b.enabled) {
    const [h, m] = b.time.split(":").map(Number);
    await boss.schedule(QUEUES.briefing, `${m || 0} ${h || 8} * * *`, {}, { tz, key: "daily" });
  } else {
    await boss.unschedule(QUEUES.briefing, "daily").catch(() => {});
  }
  await boss.schedule(QUEUES.publishDue, "*/5 * * * *", {}, { tz, key: "sweep" });
  await boss.schedule(QUEUES.metricsRefresh, "17 * * * *", {}, { tz, key: "hourly" });
}
