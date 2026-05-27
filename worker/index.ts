/**
 * Cloudflare Worker entry point — replaces server.ts + Express.
 *
 * Request routing:
 *   wss:// upgrade      → ChatRoom Durable Object (single global instance)
 *   /api/*              → handleApi() (REST handlers in api.ts)
 *   everything else     → ASSETS binding (Vite build output in ./dist)
 *
 * Local dev (Express):   npm run dev
 * CF preview (Workers):  npm run preview
 * Deploy to CF:          npm run deploy
 */

import { ChatRoom } from "./chat-room";
import { handleApi } from "./api";

export { ChatRoom };

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade → global ChatRoom Durable Object
    if (request.headers.get("Upgrade") === "websocket") {
      const id = env.CHAT_ROOM.idFromName("global");
      const room = env.CHAT_ROOM.get(id);
      return room.fetch(request);
    }

    // REST API routes
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }

    // Static assets (Vite build output in ./dist, served via ASSETS binding)
    return env.ASSETS.fetch(request);
  },
};
