/**
 * Client-side helper for the v1.5 media pipeline.
 * Sends base64 over JSON to keep parity with the existing photo flow; the
 * server-side LocalDriver writes to ./media-store and returns a signed URL.
 */
export async function uploadMedia(opts: {
  blob: Blob;
  ttlSeconds?: number;
  accessToken: string;
}): Promise<{ mediaId: number; url: string } | null> {
  const buf = await opts.blob.arrayBuffer();
  const dataBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  try {
    const res = await fetch("/api/v15/media/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({
        mime: opts.blob.type || "application/octet-stream",
        dataBase64,
        ttlSeconds: opts.ttlSeconds,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
