/**
 * Client-side analytics shim (Strategic Plan §5.6).
 * Posts events to /api/v15/analytics. Failures are swallowed.
 */
export type AnalyticsProps = Record<string, unknown>;

const queue: Array<{ event: string; props: AnalyticsProps; username?: string }> = [];
let flushing = false;

async function flush() {
  if (flushing) return;
  flushing = true;
  while (queue.length) {
    const item = queue.shift()!;
    try {
      await fetch("/api/v15/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
        keepalive: true,
      });
    } catch { /* offline / blocked — drop */ }
  }
  flushing = false;
}

export function track(event: string, props: AnalyticsProps = {}, username?: string) {
  queue.push({ event, props, username });
  void flush();
}
