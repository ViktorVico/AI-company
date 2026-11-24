/** Public base URL of the web app. Falls back to the host Render injects (APP_HOST / RENDER_EXTERNAL_URL). */
export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  if (process.env.APP_HOST) return `https://${process.env.APP_HOST}`;
  return "";
}
