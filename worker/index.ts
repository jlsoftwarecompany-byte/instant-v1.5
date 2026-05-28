import { ChatRoom } from "./chat-room";
import { handleApiRequest } from "./api";

export { ChatRoom };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade → route to the single global ChatRoom Durable Object
    if (request.headers.get("Upgrade") === "websocket") {
      const id = env.CHAT_ROOM.idFromName("global");
      const room = env.CHAT_ROOM.get(id);
      return room.fetch(request);
    }

    // API routes
    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, ctx);
    }

    // Static assets (Vite-built frontend)
    return env.ASSETS.fetch(request);
  },
};
