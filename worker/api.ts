/**
 * HTTP API handlers for /api/v15/* and /api/*  — replaces the Express routes
 * in server/v15.ts and server.ts.
 *
 * Media storage migrated from LocalDriver (./media-store) to R2.
 * Signed media URLs still work; the signature is verified in the GET handler.
 */

import { createHmac, createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { verifyJWT } from "./chat-room";

// ---------------------------------------------------------------------------
// JWT helpers (mirrors server/v15.ts)
// ---------------------------------------------------------------------------
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJWT(
  payload: Record<string, unknown>,
  ttlSec: number,
  secret: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

async function issueTokens(
  username: string,
  db: D1Database,
  secret: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = signJWT({ sub: username, kind: "access" }, ACCESS_TTL_SEC, secret);
  const refreshRaw = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const refreshHash = createHash("sha256").update(refreshRaw).digest("hex");
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO refresh_tokens (username, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .bind(username.toLowerCase(), refreshHash, now, now + REFRESH_TTL_SEC * 1000)
    .run();
  return { accessToken, refreshToken: refreshRaw, expiresIn: ACCESS_TTL_SEC };
}

// Replaces requireAuth middleware
function getAuthUser(request: Request, secret: string): string | null {
  const header = request.headers.get("Authorization") || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return null;
  const payload = verifyJWT(match[1], secret);
  if (!payload || payload.kind !== "access" || !payload.sub) return null;
  return String(payload.sub).toLowerCase();
}

// ---------------------------------------------------------------------------
// Media signed-URL helpers (same algorithm as LocalDriver in server/v15.ts)
// ---------------------------------------------------------------------------
function makeMediaSig(key: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${key}.${exp}`).digest("hex").slice(0, 24);
}

function verifyMediaSig(key: string, exp: string, sig: string, secret: string): boolean {
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return makeMediaSig(key, Number(exp), secret) === sig;
}

// ---------------------------------------------------------------------------
// Analytics helper
// ---------------------------------------------------------------------------
async function track(
  db: D1Database,
  event: string,
  props: Record<string, unknown> = {},
  username: string | null = null
): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO analytics_events (username, event, props, created_at) VALUES (?, ?, ?, ?)")
      .bind(username, event, JSON.stringify(props), Date.now())
      .run();
  } catch (e) {
    console.error("[analytics] failed:", e);
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------
export async function handleApi(
  request: Request,
  env: CloudflareEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const secret = env.JWT_SECRET || "ephemeral";

  // ── VAPID public key ────────────────────────────────────────────────────
  if (path === "/api/vapid-public-key" && method === "GET") {
    return Response.json({ publicKey: env.VAPID_PUBLIC_KEY || "" });
  }

  // ── Save push subscription ───────────────────────────────────────────────
  if (path === "/api/save-subscription" && method === "POST") {
    const body = (await request.json()) as { username?: string; subscription?: unknown };
    if (!body.username)
      return Response.json({ error: "Username required" }, { status: 400 });
    await env.DB.prepare(
      "UPDATE users SET push_subscription = ? WHERE LOWER(username) = ?"
    )
      .bind(
        body.subscription ? JSON.stringify(body.subscription) : null,
        body.username.toLowerCase()
      )
      .run();
    return Response.json({ success: true });
  }

  // ── v15 routes ────────────────────────────────────────────────────────────
  if (!path.startsWith("/api/v15/")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const v15path = path.slice("/api/v15".length); // e.g. "/auth/token"

  // POST /api/v15/auth/token — issue JWT access + refresh tokens
  if (v15path === "/auth/token" && method === "POST") {
    const { username, password } = (await request.json()) as { username?: string; password?: string };
    if (!username || !password)
      return Response.json({ error: "username + password required" }, { status: 400 });
    const row = await env.DB.prepare(
      "SELECT username, password_hash FROM users WHERE LOWER(username) = ?"
    )
      .bind(username.toLowerCase())
      .first<any>();
    if (!row)
      return Response.json({ error: "invalid credentials" }, { status: 401 });
    const ok = await bcrypt.compare(password, row.password_hash || "");
    if (!ok)
      return Response.json({ error: "invalid credentials" }, { status: 401 });
    const tokens = await issueTokens(row.username, env.DB, secret);
    await track(env.DB, "auth.login", { method: "jwt" }, row.username);
    return Response.json(tokens);
  }

  // POST /api/v15/auth/refresh
  if (v15path === "/auth/refresh" && method === "POST") {
    const { refreshToken } = (await request.json()) as { refreshToken?: string };
    if (!refreshToken)
      return Response.json({ error: "refreshToken required" }, { status: 400 });
    const hash = createHash("sha256").update(refreshToken).digest("hex");
    const row = await env.DB.prepare(
      "SELECT username, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?"
    )
      .bind(hash)
      .first<any>();
    if (!row || row.revoked || row.expires_at < Date.now())
      return Response.json({ error: "invalid refresh token" }, { status: 401 });
    await env.DB.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?")
      .bind(hash)
      .run();
    return Response.json(await issueTokens(row.username, env.DB, secret));
  }

  // POST /api/v15/auth/logout (requires auth)
  if (v15path === "/auth/logout" && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    await env.DB.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE username = ?")
      .bind(authUser)
      .run();
    return Response.json({ ok: true });
  }

  // POST /api/v15/conversations/:id/privacy
  const privacyMatch = v15path.match(/^\/conversations\/(\d+)\/privacy$/);
  if (privacyMatch && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const id = Number(privacyMatch[1]);
    const { privacyMode, disappearAfterSeconds, anonymousMode } =
      (await request.json()) as any;
    const allowed = ["standard", "ephemeral", "anonymous", "incognito"];
    if (!allowed.includes(privacyMode))
      return Response.json({ error: "invalid privacyMode" }, { status: 400 });
    await env.DB.prepare(
      "UPDATE conversations SET privacy_mode = ?, disappear_after_seconds = ?, anonymous_mode = ? WHERE id = ?"
    )
      .bind(privacyMode, disappearAfterSeconds ?? null, anonymousMode ? 1 : 0, id)
      .run();
    await track(env.DB, "privacy.update", { id, privacyMode }, authUser);
    return Response.json({ ok: true });
  }

  // POST /api/v15/conversations/:id/screenshot
  const screenshotMatch = v15path.match(/^\/conversations\/(\d+)\/screenshot$/);
  if (screenshotMatch && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    await track(env.DB, "privacy.screenshot", { id: Number(screenshotMatch[1]) }, authUser);
    return Response.json({ ok: true });
  }

  // POST /api/v15/media/upload — replaces LocalDriver with R2
  if (v15path === "/media/upload" && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });

    const { mime, dataBase64, ttlSeconds } = (await request.json()) as any;
    if (!mime || !dataBase64)
      return Response.json({ error: "mime + dataBase64 required" }, { status: 400 });

    const buf = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
    const key = `${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: mime } });

    const expiresAt = ttlSeconds ? Date.now() + Number(ttlSeconds) * 1000 : null;
    const result = await env.DB.prepare(
      "INSERT INTO media (owner_username, storage_key, mime, bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(authUser, key, mime, buf.byteLength, expiresAt, Date.now())
      .run();

    const exp = Math.floor(Date.now() / 1000) + 3600;
    const sig = makeMediaSig(key, exp, secret);
    const mediaUrl = `/api/v15/media/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;

    return Response.json({ mediaId: result.meta.last_row_id, url: mediaUrl });
  }

  // GET /api/v15/media/:key — serves from R2
  const mediaGetMatch = v15path.match(/^\/media\/([^?]+)$/);
  if (mediaGetMatch && method === "GET") {
    const key = decodeURIComponent(mediaGetMatch[1]);
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";
    if (!verifyMediaSig(key, exp, sig, secret)) {
      return new Response("Forbidden", { status: 403 });
    }
    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    return new Response(obj.body, { headers });
  }

  // POST /api/v15/circles
  if (v15path === "/circles" && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const { name, emoji } = (await request.json()) as any;
    if (!name) return Response.json({ error: "name required" }, { status: 400 });
    const result = await env.DB.prepare(
      "INSERT INTO circles (owner_username, name, emoji, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(authUser, String(name).slice(0, 64), emoji || "✨", Date.now())
      .run();
    return Response.json({ id: result.meta.last_row_id });
  }

  // GET /api/v15/circles
  if (v15path === "/circles" && method === "GET") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const { results } = await env.DB.prepare(
      "SELECT * FROM circles WHERE owner_username = ? ORDER BY created_at DESC"
    )
      .bind(authUser)
      .all();
    return Response.json({ circles: results });
  }

  // POST /api/v15/circles/:id/members
  const circleMemMatch = v15path.match(/^\/circles\/(\d+)\/members$/);
  if (circleMemMatch && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const id = Number(circleMemMatch[1]);
    const { username } = (await request.json()) as any;
    if (!username) return Response.json({ error: "username required" }, { status: 400 });
    try {
      await env.DB.prepare(
        "INSERT INTO circle_members (circle_id, member_username, added_at) VALUES (?, ?, ?)"
      )
        .bind(id, String(username).toLowerCase(), Date.now())
        .run();
    } catch {
      // UNIQUE constraint — already a member, ignore
    }
    return Response.json({ ok: true });
  }

  // POST /api/v15/stories
  if (v15path === "/stories" && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const { circleId, mediaId, caption, ttlSeconds } = (await request.json()) as any;
    const ttl = Number(ttlSeconds) || 60 * 60 * 24;
    const result = await env.DB.prepare(
      "INSERT INTO stories (author_username, circle_id, media_id, caption, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(authUser, circleId ?? null, mediaId ?? null, caption ?? null, Date.now(), Date.now() + ttl * 1000)
      .run();
    await track(env.DB, "story.create", { circleId, ttl }, authUser);
    return Response.json({ id: result.meta.last_row_id });
  }

  // GET /api/v15/stories/feed
  if (v15path === "/stories/feed" && method === "GET") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const { results } = await env.DB.prepare(
      `SELECT s.*, c.name AS circle_name
       FROM stories s
       LEFT JOIN circles c ON c.id = s.circle_id
       WHERE s.expires_at > ? AND (
         s.author_username = ?
         OR s.circle_id IN (SELECT circle_id FROM circle_members WHERE member_username = ?)
       )
       ORDER BY s.created_at DESC`
    )
      .bind(Date.now(), authUser, authUser)
      .all();
    return Response.json({ stories: results });
  }

  // POST /api/v15/stories/:id/view
  const storyViewMatch = v15path.match(/^\/stories\/(\d+)\/view$/);
  if (storyViewMatch && method === "POST") {
    const authUser = getAuthUser(request, secret);
    if (!authUser) return Response.json({ error: "missing bearer" }, { status: 401 });
    const id = Number(storyViewMatch[1]);
    try {
      await env.DB.prepare(
        "INSERT INTO story_views (story_id, viewer_username, viewed_at) VALUES (?, ?, ?)"
      )
        .bind(id, authUser, Date.now())
        .run();
    } catch {
      // UNIQUE — already viewed
    }
    await track(env.DB, "story.view", { id }, authUser);
    return Response.json({ ok: true });
  }

  // POST /api/v15/analytics
  if (v15path === "/analytics" && method === "POST") {
    const { event, props, username } = (await request.json()) as any;
    if (!event) return Response.json({ error: "event required" }, { status: 400 });
    await track(env.DB, String(event), props || {}, username || null);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
