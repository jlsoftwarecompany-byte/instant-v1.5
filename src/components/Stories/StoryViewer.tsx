/**
 * Full-screen story viewer. Auto-advances; records a view event on mount.
 */
import { useEffect } from "react";
import { authedFetch } from "../../lib/jwt-client";
import type { StoryItem } from "./StoriesTray";

interface Props { story: StoryItem; onClose: () => void }

export default function StoryViewer({ story, onClose }: Props) {
  useEffect(() => {
    authedFetch(`/api/v15/stories/${story.id}/view`, { method: "POST" }).catch(() => {});
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [story.id, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute top-3 left-3 right-3 h-1 bg-white/20 rounded-full overflow-hidden">
        <div className="h-full bg-white animate-[storyBar_5s_linear_forwards]" />
      </div>
      <div className="text-white text-center px-6">
        <div className="text-7xl mb-4">{story.circle_name ? "✨" : "👤"}</div>
        <div className="text-lg font-medium">{story.author_username}</div>
        {story.caption && <p className="mt-2 text-zinc-300">{story.caption}</p>}
      </div>
      <style>{`@keyframes storyBar { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  );
}
