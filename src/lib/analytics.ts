/**
 * Client-side analytics shim (Strategic Plan §5.6).
 * Posts events to /api/v15/analytics. Failures are swallowed.
 */
import { getAccessToken, refreshJWT } from "./jwt-client";

export type AnalyticsProps = Record<string, unknown>;

const queue: Array<{ event: string; props: AnalyticsProps }> = [];
let flushing = false;

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const item = queue.shift()!;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getAccessToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      let res = await fetch("/api/v15/analytics", {
        method: "POST",
        headers,
        body: JSON.stringify(item),
        keepalive: true,
      });
      if (res.status === 401 && await refreshJWT()) {
        const newToken = getAccessToken();
        if (newToken) headers["Authorization"] = `Bearer ${newToken}`;
        await fetch("/api/v15/analytics", {
          method: "POST",
          headers,
          body: JSON.stringify(item),
          keepalive: true,
        });
      }
    } catch { /* offline / blocked — drop */ }
  }
  flushing = false;
}

export function track(event: string, props: AnalyticsProps = {}) {
  queue.push({ event, props });
  void flush();
}
