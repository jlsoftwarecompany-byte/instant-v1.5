// HTTP API handlers for the Cloudflare Worker.
// Mirrors the Express routes from server.ts and server/v15.ts.

export async function handleApiRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ─── GET /api/vapid-public-key ────────────────────────────────────────────
  if (method === "GET" && path === "/api/vapid-public-key") {
    return json({ publicKey: env.VAPID_PUBLIC_KEY || "" });
  }

  // ─── POST /api/save-subscription ─────────────────────────────────────────
  if (method === "POST" && path === "/api/save-subscription") {
    const body = await request.json<any>();
    const { username, subscription } = body || {};
    if (!username) return json({ error: "Username required" }, 400);
    const subJSON = subscription ? JSON.stringify(subscription) : null;
    await env.DB.prepare("UPDATE users SET push_subscription = ? WHERE LOWER(username) = ?")
      .bind(subJSON, username.toLowerCase()).run();
    return json({ success: true });
  }

  // ─── POST /api/v15/media/upload ───────────────────────────────────────────
  if (method === "POST" && path === "/api/v15/media/upload") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "missing bearer" }, 401);

    const body = await request.json<any>();
    const { mime, dataBase64, ttlSeconds } = body || {};
    if (!mime || !dataBase64) return json({ error: "mime + dataBase64 required" }, 400);

    const bytes = base64ToUint8Array(dataBase64);
    const key = `${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });

    const expiresAt = ttlSeconds ? Date.now() + Number(ttlSeconds) * 1000 : null;
    const result = await env.DB.prepare(
      "INSERT INTO media (owner_username, storage_key, mime, bytes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(auth, key, mime, bytes.length, expiresAt, Date.now()).run();

    const url = await signedMediaUrl(key, env);
    return json({ mediaId: result.meta.last_row_id, url });
  }

  // ─── GET /api/v15/media/:key ──────────────────────────────────────────────
  if (method === "GET" && path.startsWith("/api/v15/media/")) {
    const key = decodeURIComponent(path.slice("/api/v15/media/".length));
    const exp = url.searchParams.get("exp") || "";
    const sig = url.searchParams.get("sig") || "";

    if (!(await verifyMediaSig(key, exp, sig, env))) return new Response(null, { status: 403 });

    const obj = await env.MEDIA.get(key);
    if (!obj) return new Response(null, { status: 404 });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    return new Response(obj.body, { headers });
  }

  // ─── POST /api/v15/auth/token ─────────────────────────────────────────────
  if (method === "POST" && path === "/api/v15/auth/token") {
    const body = await request.json<any>();
    const { username, password } = body || {};
    if (!username || !password) return json({ error: "username + password required" }, 400);

    const row = await env.DB.prepare("SELECT username, password_hash FROM users WHERE LOWER(username) = ?")
      .bind(String(username).toLowerCase()).first<any>();
    if (!row) return json({ error: "invalid credentials" }, 401);

    const match = await verifyPassword(password, row.password_hash);
    if (!match) return json({ error: "invalid credentials" }, 401);

    const tokens = await issueTokens(row.username, env.DB, getJwtSecret(env));
    return json(tokens);
  }

  // ─── POST /api/v15/auth/refresh ───────────────────────────────────────────
  if (method === "POST" && path === "/api/v15/auth/refresh") {
    const body = await request.json<any>();
    const { refreshToken } = body || {};
    if (!refreshToken) return json({ error: "refreshToken required" }, 400);

    const hash = await sha256Hex(refreshToken);
    const row = await env.DB.prepare(
      "SELECT username, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?"
    ).bind(hash).first<any>();
    if (!row || row.revoked || row.expires_at < Date.now()) {
      return json({ error: "invalid refresh token" }, 401);
    }
    await env.DB.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?").bind(hash).run();
    return json(await issueTokens(row.username, env.DB, getJwtSecret(env)));
  }

  // ─── POST /api/v15/auth/logout ────────────────────────────────────────────
  if (method === "POST" && path === "/api/v15/auth/logout") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "missing bearer" }, 401);
    await env.DB.prepare("UPDATE refresh_tokens SET revoked = 1 WHERE username = ?").bind(auth).run();
    return json({ ok: true });
  }

  // ─── POST /api/v15/conversations/:id/privacy ──────────────────────────────
  const privacyMatch = path.match(/^\/api\/v15\/conversations\/(\d+)\/privacy$/);
  if (method === "POST" && privacyMatch) {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "missing bearer" }, 401);
    const id = Number(privacyMatch[1]);
    const body = await request.json<any>();
    const { privacyMode, disappearAfterSeconds, anonymousMode } = body || {};
    const allowed = ["standard", "ephemeral", "anonymous", "incognito"];
    if (!allowed.includes(privacyMode)) return json({ error: "invalid privacyMode" }, 400);
    await env.DB.prepare(
      "UPDATE conversations SET privacy_mode = ?, disappear_after_seconds = ?, anonymous_mode = ? WHERE id = ?"
    ).bind(privacyMode, disappearAfterSeconds ?? null, anonymousMode ? 1 : 0, id).run();
    return json({ ok: true });
  }

  // ─── POST /api/v15/conversations/:id/screenshot ───────────────────────────
  const screenshotMatch = path.match(/^\/api\/v15\/conversations\/(\d+)\/screenshot$/);
  if (method === "POST" && screenshotMatch) {
    await requireAuth(request, env);
    return json({ ok: true });
  }

  // ─── POST /api/v15/circles ────────────────────────────────────────────────
  if (method === "POST" && path === "/api/v15/circles") {
    const auth = await requireAuth(request, env);
    if (!auth) return json({ error: "missing bearer" }, 401);
    const body = await request.json<any>();
    const { name, emoji } = body || {};
    if (!name) return json({ error: "name required" }, 400);
    const result = await env.DB.prepare(
      "INSERT INTO circles (owner_username, name, emoji, created_at) VALUES (?, ?, ?, ?)"
    ).bind(auth, name, emoji || "✨", Date.now()).run();
    return json({ id: result.meta.last_row_id });
  }

  return json({ error: "Not found" }, 404);
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getJwtSecret(env: Env): string {
  return env.JWT_SECRET || "ephemeral-secret-set-JWT_SECRET-in-cloudflare-secrets";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function jwtSign(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const header = btoa('{"alg":"HS256","typ":"JWT"}').replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = `${header}.${btoa(JSON.stringify(body)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${data}.${sigB64}`;
}

async function jwtVerify(token: string, secret: string): Promise<Record<string, any> | null> {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${h}.${p}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function requireAuth(request: Request, env: Env): Promise<string | null> {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) return null;
  const payload = await jwtVerify(m[1], getJwtSecret(env));
  if (!payload || payload.kind !== "access" || !payload.sub) return null;
  return String(payload.sub).toLowerCase();
}

async function issueTokens(username: string, db: D1Database, secret: string) {
  const accessToken = await jwtSign({ sub: username, kind: "access" }, secret, 3600);
  const refreshTokenRaw = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const hash = await sha256Hex(refreshTokenRaw);
  const now = Date.now();
  await db.prepare(
    "INSERT INTO refresh_tokens (username, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(username.toLowerCase(), hash, now, now + 30 * 24 * 60 * 60 * 1000).run();
  return { accessToken, refreshToken: refreshTokenRaw, expiresIn: 3600 };
}

async function signedMediaUrl(key: string, env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const secret = getJwtSecret(env);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${key}.${exp}`));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return `/api/v15/media/${encodeURIComponent(key)}?exp=${exp}&sig=${sigHex}`;
}

async function verifyMediaSig(key: string, exp: string, sig: string, env: Env): Promise<boolean> {
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const secret = getJwtSecret(env);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const expected = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${key}.${exp}`));
  const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return expectedHex === sig;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith("pbkdf2:")) return false;
  const combined = Uint8Array.from(atob(stored.slice(7)), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const storedHash = combined.slice(16);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const newHash = new Uint8Array(bits);
  if (newHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < newHash.length; i++) diff |= newHash[i] ^ storedHash[i];
  return diff === 0;
}
