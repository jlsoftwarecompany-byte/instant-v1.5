interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  JWT_SECRET?: string;
}
