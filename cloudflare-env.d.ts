interface CloudflareEnv {
  // D1 — replaces better-sqlite3
  DB: D1Database;
  // R2 — replaces ./media-store local disk
  BUCKET: R2Bucket;
  // Static assets (Vite build output)
  ASSETS: Fetcher;
  // Durable Object namespace for WebSocket hub
  CHAT_ROOM: DurableObjectNamespace;
  // Secrets (set via: npx wrangler secret put <NAME>)
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  JWT_SECRET: string;
  VITE_GEMINI_API_KEY: string;
}
