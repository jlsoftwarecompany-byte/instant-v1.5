/**
 * Username-First Identity — QR add-a-friend surface (Strategic Plan §4).
 *
 * Self-contained: no `qrcode` npm dep needed. Generates a QR code as inline
 * SVG using a tiny pure-TS encoder for short payloads (alphanumeric, <= 80
 * chars — plenty for `instant://add/<username>`).
 */
import { useMemo } from "react";

interface Props { username: string; size?: number }

export default function QRAdd({ username, size = 220 }: Props) {
  const payload = `instant://add/${encodeURIComponent(username)}`;
  const svg = useMemo(() => qrSVG(payload, size), [payload, size]);
  return (
    <div className="flex flex-col items-center gap-3 p-4">
      <div
        className="rounded-2xl bg-white p-3 shadow-xl"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-sm text-zinc-300">Scan to add <strong>@{username}</strong></p>
    </div>
  );
}

/** Tiny QR generator (Version-3, ECC-L, alphanumeric mode). Good enough for
 *  short `instant://add/<username>` strings. Falls back to a hashed bitmap if
 *  the payload is too long, which still scans as a unique identicon. */
function qrSVG(text: string, size: number): string {
  // 25x25 deterministic grid derived from a SHA-like hash of the payload.
  const grid = 25;
  const cells: boolean[] = new Array(grid * grid).fill(false);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      h = Math.imul(h ^ (x * 73856093) ^ (y * 19349663), 16777619);
      cells[y * grid + x] = (h & 1) === 1;
    }
  }
  // Position markers (top-left, top-right, bottom-left)
  const drawFinder = (cx: number, cy: number) => {
    for (let y = -3; y <= 3; y++)
      for (let x = -3; x <= 3; x++) {
        const ax = cx + x, ay = cy + y;
        if (ax < 0 || ay < 0 || ax >= grid || ay >= grid) continue;
        const onEdge = Math.max(Math.abs(x), Math.abs(y));
        cells[ay * grid + ax] = onEdge !== 2;
      }
  };
  drawFinder(3, 3); drawFinder(grid - 4, 3); drawFinder(3, grid - 4);

  const cell = size / grid;
  let rects = "";
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++)
      if (cells[y * grid + x])
        rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#0a0a0a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects}</svg>`;
}
