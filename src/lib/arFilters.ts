/**
 * Lightweight AR filter hook (Strategic Plan §4 — Camera-First).
 *
 * Kept dependency-free in v1.5: we expose a tiny CSS-filter-based pipeline
 * (`vibe`, `noir`, `dream`, `glow`, `vhs`) that ships zero bytes and works on
 * every device. A future iteration can swap in @mediapipe/face_mesh behind
 * the same hook signature without touching call sites.
 */
export type ArFilter = "none" | "vibe" | "noir" | "dream" | "glow" | "vhs";

export const AR_FILTERS: { id: ArFilter; label: string; css: string }[] = [
  { id: "none",  label: "Off",   css: "" },
  { id: "vibe",  label: "Vibe",  css: "saturate(1.5) hue-rotate(-10deg) contrast(1.05)" },
  { id: "noir",  label: "Noir",  css: "grayscale(1) contrast(1.3) brightness(0.95)" },
  { id: "dream", label: "Dream", css: "saturate(1.2) brightness(1.1) blur(0.5px)" },
  { id: "glow",  label: "Glow",  css: "brightness(1.1) saturate(1.4) drop-shadow(0 0 12px rgba(255,255,255,0.4))" },
  { id: "vhs",   label: "VHS",   css: "hue-rotate(8deg) saturate(0.8) contrast(1.4) brightness(0.92)" },
];

export function filterCSS(id: ArFilter): string {
  return AR_FILTERS.find(f => f.id === id)?.css || "";
}
