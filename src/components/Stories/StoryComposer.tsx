/**
 * Quick story composer. Reuses the v1.4 camera photo blob, uploads via the
 * v1.5 media endpoint, then publishes the story bound to a circle.
 */
import { useState } from "react";
import { authedFetch } from "../../lib/jwt-client";
import { uploadMedia } from "../../lib/storage-client";
import { getAccessToken } from "../../lib/jwt-client";

interface Props {
  photo: Blob;
  circleId?: number;
  onPublished?: (id: number) => void;
  onCancel?: () => void;
}

export default function StoryComposer({ photo, circleId, onPublished, onCancel }: Props) {
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  async function publish() {
    const token = getAccessToken();
    if (!token) { onCancel?.(); return; }
    setBusy(true);
    try {
      const up = await uploadMedia({ blob: photo, ttlSeconds: 86400, accessToken: token });
      const res = await authedFetch("/api/v15/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId, mediaId: up?.mediaId, caption, ttlSeconds: 86400 }),
      });
      if (res.ok) {
        const json = await res.json();
        onPublished?.(json.id);
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4">
        <img src={URL.createObjectURL(photo)} alt="" className="max-h-full max-w-full rounded-2xl" />
      </div>
      <div className="p-4 space-y-3">
        <input
          autoFocus
          value={caption}
          onChange={e => setCaption(e.target.value)}
          placeholder="Add a caption…"
          className="w-full rounded-xl bg-zinc-900 text-white px-4 py-3 outline-none"
        />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-zinc-800 text-white">Cancel</button>
          <button onClick={publish} disabled={busy}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-pink-500 to-fuchsia-600 text-white font-semibold disabled:opacity-50">
            {busy ? "Publishing…" : "Share story"}
          </button>
        </div>
      </div>
    </div>
  );
}
