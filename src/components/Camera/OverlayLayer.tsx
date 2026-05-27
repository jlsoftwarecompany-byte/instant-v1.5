/**
 * Camera-First overlay layer (Strategic Plan §4).
 * Sticker / text / draw overlays composed onto an off-screen canvas before
 * sending. AR filters are loaded lazily via lib/arFilters.ts.
 */
import React, { useRef, useState } from "react";

export interface Overlay {
  id: string;
  kind: "sticker" | "text";
  x: number; y: number; // 0..1 relative
  value: string;
}

interface Props {
  width: number;
  height: number;
  overlays: Overlay[];
  onChange: (next: Overlay[]) => void;
}

const STICKERS = ["🔥", "💖", "✨", "🥹", "🫶", "🌀", "💀", "🌈"];

export default function OverlayLayer({ width, height, overlays, onChange }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  function addSticker(s: string) {
    onChange([...overlays, {
      id: Math.random().toString(36).slice(2),
      kind: "sticker", value: s, x: 0.5, y: 0.5,
    }]);
  }

  function addText() {
    const text = window.prompt("Caption?");
    if (!text) return;
    onChange([...overlays, {
      id: Math.random().toString(36).slice(2),
      kind: "text", value: text, x: 0.5, y: 0.2,
    }]);
  }

  function onMove(e: React.PointerEvent) {
    if (!dragging || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    onChange(overlays.map(o => o.id === dragging ? { ...o, x, y } : o));
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        ref={ref}
        className="absolute inset-0 pointer-events-auto"
        style={{ width, height }}
        onPointerMove={onMove}
        onPointerUp={() => setDragging(null)}
      >
        {overlays.map(o => (
          <div
            key={o.id}
            onPointerDown={() => setDragging(o.id)}
            style={{
              position: "absolute",
              left: `${o.x * 100}%`, top: `${o.y * 100}%`,
              transform: "translate(-50%, -50%)",
              fontSize: o.kind === "sticker" ? 64 : 28,
              color: "white", textShadow: "0 2px 8px rgba(0,0,0,0.7)",
              touchAction: "none",
              fontWeight: o.kind === "text" ? 700 : 400,
            }}
          >{o.value}</div>
        ))}
      </div>
      <div className="absolute bottom-24 left-0 right-0 flex flex-wrap gap-2 justify-center pointer-events-auto px-4">
        {STICKERS.map(s => (
          <button key={s} onClick={() => addSticker(s)}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur text-xl">{s}</button>
        ))}
        <button onClick={addText}
          className="px-3 h-10 rounded-full bg-black/40 backdrop-blur text-white text-sm">Aa</button>
      </div>
    </div>
  );
}

/** Compose overlays onto a source canvas/image and return a PNG Blob. */
export async function flattenOverlays(source: HTMLCanvasElement | HTMLImageElement, overlays: Overlay[]): Promise<Blob> {
  const w = (source as HTMLCanvasElement).width || (source as HTMLImageElement).naturalWidth;
  const h = (source as HTMLCanvasElement).height || (source as HTMLImageElement).naturalHeight;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(source, 0, 0, w, h);
  for (const o of overlays) {
    ctx.save();
    ctx.translate(o.x * w, o.y * h);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 8;
    if (o.kind === "sticker") {
      ctx.font = `${Math.floor(w * 0.18)}px serif`;
    } else {
      ctx.font = `700 ${Math.floor(w * 0.07)}px system-ui, sans-serif`;
    }
    ctx.fillText(o.value, 0, 0);
    ctx.restore();
  }
  return await new Promise((resolve) => c.toBlob(b => resolve(b!), "image/png"));
}
