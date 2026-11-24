const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-readable description for common cron shapes; falls back to the raw expression. */
export function describeCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return cron || "—";
  const [min, hour, dom, mon, dow] = p;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : null;
  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (/^\d+$/.test(min) && hour.startsWith("*/") && dom === "*" && dow === "*") return `Every ${hour.slice(2)} hours`;
  if (/^\d+$/.test(min) && hour === "*") return `Hourly at :${min.padStart(2, "0")}`;
  if (time && dom === "*" && mon === "*") {
    if (dow === "*") return `Daily at ${time}`;
    if (dow === "1-5") return `Weekdays at ${time}`;
    if (/^\d$/.test(dow)) return `${DAYS[Number(dow)]}s at ${time}`;
    if (/^[\d,]+$/.test(dow)) return `${dow.split(",").map((d) => DAYS[Number(d)]).join(", ")} at ${time}`;
  }
  if (time && /^\d+$/.test(dom) && mon === "*") return `Monthly on day ${dom} at ${time}`;
  return cron;
}

export const CRON_PRESETS = [
  { label: "Every morning 06:00", value: "0 6 * * *" },
  { label: "Weekdays 09:00", value: "0 9 * * 1-5" },
  { label: "Every 3 hours", value: "0 */3 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Nightly 22:30", value: "30 22 * * *" },
  { label: "Mondays 07:00", value: "0 7 * * 1" },
];
