/**
 * Adaptive Privacy bar (Strategic Plan §4).
 *
 * Drop into <Chat /> above the input row:
 *     <PrivacyBar conversationId={conv.id} onChange={setPrivacy} />
 *
 * Doesn't manage server state itself — it just emits the new privacy config
 * and posts to /api/v15/conversations/:id/privacy. Existing chats default to
 * `standard` (zero behavior change vs v1.4).
 */
import { useState } from "react";
import { authedFetch } from "../lib/jwt-client";
import { track } from "../lib/analytics";

export type PrivacyMode = "standard" | "ephemeral" | "anonymous" | "incognito";
export interface PrivacyConfig {
  privacyMode: PrivacyMode;
  disappearAfterSeconds?: number;
  anonymousMode?: boolean;
}

const PRESETS: { label: string; seconds?: number }[] = [
  { label: "Off" },
  { label: "10s", seconds: 10 },
  { label: "1h", seconds: 3600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 604800 },
];

interface Props {
  conversationId: number;
  initial?: PrivacyConfig;
  onChange?: (cfg: PrivacyConfig) => void;
}

export default function PrivacyBar({ conversationId, initial, onChange }: Props) {
  const [cfg, setCfg] = useState<PrivacyConfig>(
    initial ?? { privacyMode: "standard" }
  );

  async function update(next: PrivacyConfig) {
    setCfg(next);
    onChange?.(next);
    track("privacy.update", { conversationId, ...next });
    try {
      await authedFetch(`/api/v15/conversations/${conversationId}/privacy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch { /* offline tolerant */ }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs bg-zinc-900/70 backdrop-blur border-b border-zinc-800">
      <span className="text-zinc-400">⏳ Disappear</span>
      {PRESETS.map(p => {
        const active = (cfg.disappearAfterSeconds ?? 0) === (p.seconds ?? 0);
        return (
          <button
            key={p.label}
            onClick={() => update({
              ...cfg,
              privacyMode: p.seconds ? "ephemeral" : "standard",
              disappearAfterSeconds: p.seconds,
            })}
            className={`px-2 py-0.5 rounded-full ${active ? "bg-pink-500 text-white" : "bg-zinc-800 text-zinc-300"}`}
          >{p.label}</button>
        );
      })}
      <span className="mx-2 text-zinc-700">·</span>
      <label className="inline-flex items-center gap-1 text-zinc-300">
        <input
          type="checkbox"
          checked={!!cfg.anonymousMode}
          onChange={e => update({ ...cfg, anonymousMode: e.target.checked,
            privacyMode: e.target.checked ? "anonymous" : cfg.privacyMode })}
        />
        Anonymous
      </label>
    </div>
  );
}

/** Heuristic screenshot detection (best-effort on mobile Safari/Android). */
export function useScreenshotAlerts(conversationId: number) {
  if (typeof window === "undefined") return;
  const notify = () => {
    track("privacy.screenshot.local", { conversationId });
    authedFetch(`/api/v15/conversations/${conversationId}/screenshot`, { method: "POST" })
      .catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") notify();
  });
}
