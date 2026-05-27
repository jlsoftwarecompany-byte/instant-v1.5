/**
 * Private Circle Stories — horizontal tray (Strategic Plan §4).
 * Plug above Inbox: <StoriesTray onOpen={openViewer} />
 */
import { useEffect, useState } from "react";
import { authedFetch } from "../../lib/jwt-client";

export interface StoryItem {
  id: number;
  author_username: string;
  circle_id: number | null;
  circle_name?: string | null;
  caption: string | null;
  created_at: number;
  expires_at: number;
  media_id: number | null;
}

interface Props { onOpen?: (story: StoryItem) => void }

export default function StoriesTray({ onOpen }: Props) {
  const [stories, setStories] = useState<StoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch("/api/v15/stories/feed");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setStories(json.stories || []);
      } catch { /* offline */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stories.length) return null;

  return (
    <div className="flex gap-3 overflow-x-auto px-3 py-3 border-b border-zinc-800">
      {stories.map(s => (
        <button
          key={s.id}
          onClick={() => onOpen?.(s)}
          className="flex flex-col items-center min-w-[72px] focus:outline-none"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-500 via-fuchsia-500 to-purple-600 p-[2px]">
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center text-2xl">
              {s.circle_name ? "✨" : "👤"}
            </div>
          </div>
          <span className="mt-1 text-[11px] text-zinc-300 truncate max-w-[72px]">
            {s.circle_name || s.author_username}
          </span>
        </button>
      ))}
    </div>
  );
}
