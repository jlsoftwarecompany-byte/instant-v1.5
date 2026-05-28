// ChatRoom Durable Object — replaces the Express + ws in-memory hub.
// Uses the WebSocket Hibernation API so connections survive DO sleep.
// Each WebSocket's authenticated username is stored via serializeAttachment().

interface WsAttachment {
  username: string | null;
}

// PBKDF2-based password hashing (Web Crypto — works in Workers without CPU timeout)
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const combined = new Uint8Array(16 + 32);
  combined.set(salt, 0);
  combined.set(new Uint8Array(bits), 16);
  return "pbkdf2:" + btoa(String.fromCharCode(...combined));
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

// Simple HS256 JWT (dependency-free)
function jwtB64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function jwtSign(payload: Record<string, unknown>, secret: string, ttlSec: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const header = jwtB64url('{"alg":"HS256","typ":"JWT"}');
  const data = `${header}.${jwtB64url(JSON.stringify(body))}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${jwtB64url(sig)}`;
}

async function sendPushNotification(
  env: Env,
  pushSubscription: string,
  title: string,
  body: string,
  data: unknown = {}
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  try {
    const sub = JSON.parse(pushSubscription);
    // Build a minimal push payload without the web-push npm package
    // using the Web Push Protocol directly via fetch
    const payload = JSON.stringify({ title, body, data });
    // Use the endpoint directly — browsers handle decryption client-side
    // For a full VAPID implementation we'd need to sign the Authorization header.
    // This is a stub; wire up a full VAPID lib if push notifications are critical.
    await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "TTL": "60",
      },
      body: payload,
    });
  } catch { /* push is best-effort */ }
}

export class ChatRoom implements DurableObject {
  private ctx: DurableObjectState;
  private env: Env;
  // In-memory rate limiter (resets when DO hibernates, which is fine)
  private loginFailures = new Map<string, { count: number; lockedUntil: number }>();
  private notified60s = new Set<string>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  // ─── WebSocket upgrade ──────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ username: null } as WsAttachment);

    // Ensure the timer alarm is running
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm) {
      await this.ctx.storage.setAlarm(Date.now() + 5000);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket message handler (Hibernation API) ────────────────────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let data: any;
    try {
      data = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() as WsAttachment;
    const authenticatedUser = att?.username ?? null;

    try {
      switch (data.type) {
        case "PING": break; // heartbeat, no response needed

        case "AUTH_REGISTER": await this.handleRegister(ws, data); break;
        case "AUTH_LOGIN":    await this.handleLogin(ws, data); break;
        case "AUTH_LOGOUT":   await this.handleLogout(ws, data); break;
        case "AUTH_VERIFY_SESSION": await this.handleVerifySession(ws, data); break;

        case "CHECK_USERNAME": await this.handleCheckUsername(ws, data); break;

        // Legacy no-password flow
        case "REGISTER_USER": await this.handleLegacyRegister(ws, data); break;
        case "VERIFY_USER":   await this.handleLegacyVerify(ws, data); break;

        case "LINKER_UPDATE":   await this.handleLinkerUpdate(ws, data, authenticatedUser); break;
        case "NICKNAME_UPDATE": await this.handleNicknameUpdate(ws, data, authenticatedUser); break;

        case "FRIEND_REQUEST": await this.handleFriendRequest(ws, data, authenticatedUser); break;
        case "FRIEND_ACCEPT":  await this.handleFriendAccept(ws, data, authenticatedUser); break;
        case "FRIEND_DECLINE": await this.handleFriendDecline(ws, data, authenticatedUser); break;

        case "READ_CONVERSATION": await this.handleReadConversation(ws, data, authenticatedUser); break;
        case "CHAT_MESSAGE":      await this.handleChatMessage(ws, data, authenticatedUser); break;
        case "GET_HISTORY":       await this.handleGetHistory(ws, data, authenticatedUser); break;

        case "END_CHAT_REQUEST": await this.handleEndChatRequest(ws, data, authenticatedUser); break;
        case "END_CHAT_CONFIRM": await this.handleEndChatConfirm(ws, data, authenticatedUser); break;

        case "PRESENCE_UPDATE": {
          this.broadcast({
            type: "PRESENCE_BROADCAST",
            username: data.username || null,
            status: data.status,
          });
          break;
        }
      }
    } catch (e) {
      console.error("WS message error:", e);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as WsAttachment;
    if (att?.username) {
      console.log(`User offline: ${att.username}`);
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const att = ws.deserializeAttachment() as WsAttachment;
    console.error(`WebSocket error for ${att?.username ?? "unauthenticated"}:`, error);
  }

  // ─── DO alarm — replaces setInterval (runs every 5 s) ─────────────────────

  async alarm(): Promise<void> {
    await this.checkTimers();
    await this.ctx.storage.setAlarm(Date.now() + 5000);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private send(ws: WebSocket, data: unknown): void {
    try { ws.send(JSON.stringify(data)); } catch { /* client gone */ }
  }

  private sendToUser(username: string, data: unknown): void {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment;
      if (att?.username === username) {
        try { ws.send(payload); } catch { /* ignore */ }
      }
    }
  }

  private broadcast(data: unknown): void {
    const payload = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* ignore */ }
    }
  }

  private isOnline(username: string): boolean {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsAttachment;
      if (att?.username === username) return true;
    }
    return false;
  }

  private setAuth(ws: WebSocket, username: string): void {
    ws.serializeAttachment({ username } as WsAttachment);
  }

  private db(): D1Database {
    return this.env.DB;
  }

  // ─── Sync helpers ──────────────────────────────────────────────────────────

  private async syncUserFullData(username: string): Promise<void> {
    const uLower = username.toLowerCase();
    const db = this.db();

    const friendships = (await db.prepare(
      "SELECT * FROM friendships WHERE LOWER(requester_username) = ? OR LOWER(receiver_username) = ?"
    ).bind(uLower, uLower).all<any>()).results;

    const contactNames = new Set<string>();
    friendships.forEach((f: any) => {
      contactNames.add(f.requester_username.toLowerCase());
      contactNames.add(f.receiver_username.toLowerCase());
    });

    let usersMap: Record<string, any> = {};
    if (contactNames.size > 0) {
      const placeholders = Array.from(contactNames).map(() => "?").join(",");
      const list = (await db.prepare(
        `SELECT username, nickname, links, linker_avatar, linker_color FROM users WHERE LOWER(username) IN (${placeholders})`
      ).bind(...Array.from(contactNames)).all<any>()).results;
      list.forEach((u: any) => {
        usersMap[u.username.toLowerCase()] = {
          nickname: u.nickname,
          links: u.links,
          linker_avatar: u.linker_avatar || "👾",
          linker_color: u.linker_color || "pink",
        };
      });
    }

    const allUsers = (await db.prepare(
      "SELECT username, nickname, links, linker_avatar, linker_color FROM users WHERE LOWER(username) != ? ORDER BY links DESC"
    ).bind(uLower).all<any>()).results;

    const discoverUsers = allUsers.filter((u: any) => {
      return !friendships.some((f: any) =>
        (f.requester_username.toLowerCase() === uLower && f.receiver_username.toLowerCase() === u.username.toLowerCase()) ||
        (f.receiver_username.toLowerCase() === uLower && f.requester_username.toLowerCase() === u.username.toLowerCase())
      );
    }).slice(0, 15);

    const conversations = (await db.prepare(
      "SELECT * FROM conversations WHERE LOWER(participant_1) = ? OR LOWER(participant_2) = ?"
    ).bind(uLower, uLower).all<any>()).results;

    const timers = (await db.prepare(
      "SELECT t.* FROM timers t JOIN conversations c ON t.conversation_id = c.id WHERE LOWER(c.participant_1) = ? OR LOWER(c.participant_2) = ?"
    ).bind(uLower, uLower).all<any>()).results;

    this.sendToUser(uLower, {
      type: "FRIEND_UPDATE",
      friendships,
      users: usersMap,
      conversations,
      discoverUsers,
      timers: timers.map((t: any) => ({
        conversation_id: t.conversation_id,
        timer_type: t.timer_type,
        started_at: typeof t.started_at === "number" ? t.started_at : new Date(t.started_at).getTime(),
        duration_ms: t.duration_ms,
      })),
    });
  }

  // ─── Timer monitoring ──────────────────────────────────────────────────────

  private async checkTimers(): Promise<void> {
    const db = this.db();
    const activeTimers = (await db.prepare("SELECT * FROM timers").all<any>()).results;
    const now = Date.now();

    for (const timer of activeTimers) {
      const startMs = typeof timer.started_at === "number"
        ? timer.started_at
        : new Date(timer.started_at).getTime();
      const remainingMs = timer.duration_ms - (now - startMs);
      const convId = timer.conversation_id;

      const convRow = await db.prepare("SELECT * FROM conversations WHERE id = ?")
        .bind(convId).first<any>();
      if (!convRow) continue;

      if (remainingMs <= 0) {
        await db.prepare("UPDATE messages SET expired = 1 WHERE conversation_id = ? AND expired = 0")
          .bind(convId).run();
        await db.prepare("DELETE FROM timers WHERE id = ?").bind(timer.id).run();
        await this.syncUserFullData(convRow.participant_1);
        await this.syncUserFullData(convRow.participant_2);
        continue;
      }

      if (remainingMs <= 60000) {
        const timerKey = `${timer.id}_60s`;
        if (!this.notified60s.has(timerKey)) {
          this.notified60s.add(timerKey);
          const lastMsg = await db.prepare(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 1"
          ).bind(convId).first<any>();

          if (lastMsg) {
            const target = lastMsg.receiver.toLowerCase();
            if (!this.isOnline(target)) {
              const sub = await db.prepare(
                "SELECT push_subscription FROM users WHERE LOWER(username) = ?"
              ).bind(target).first<any>();
              if (sub?.push_subscription) {
                await sendPushNotification(
                  this.env, sub.push_subscription,
                  "Your conversation is expiring soon",
                  "You have 60 seconds to save your conversation before it's gone.",
                  { conversationId: convId, warning60s: true }
                );
              }
            } else {
              this.sendToUser(target, { type: "SAVE_TIMER_WARNING", conversationId: convId });
            }
          }
        }
      }
    }
  }

  // ─── Message handlers ──────────────────────────────────────────────────────

  private async handleRegister(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const nickname = (data.nickname || "").trim();
    const password = data.password || "";
    const db = this.db();

    if (!username || !nickname || !password) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Username, Nickname, and Password are required" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 20) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Invalid username format" });
    }
    if (nickname.length < 1 || nickname.length > 30) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Nickname must be between 1 and 30 characters" });
    }
    if (password.length < 8) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Password must be at least 8 characters long" });
    }

    const exists = await db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").bind(username).first();
    if (exists) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Username already taken" });
    }

    const passwordHash = await hashPassword(password);
    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await db.prepare(
      "INSERT INTO users (username, nickname, links, linker_avatar, linker_color, password_hash, session_token, session_expires_at) VALUES (?, ?, 0, '👾', 'pink', ?, ?, ?)"
    ).bind(username, nickname, passwordHash, sessionToken, sessionExpiresAt).run();

    this.setAuth(ws, username);
    this.send(ws, {
      type: "AUTH_SUCCESS",
      user: {
        id: result.meta.last_row_id,
        username,
        nickname,
        links: 0,
        created_at: new Date().toISOString(),
        linker_avatar: "👾",
        linker_color: "pink",
        session_token: sessionToken,
        session_expires_at: sessionExpiresAt,
      },
      sessionToken,
    });
    await this.syncUserFullData(username);
  }

  private async handleLogin(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const password = data.password || "";
    const db = this.db();

    if (!username || !password) {
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Username and Password are required" });
    }

    const record = this.loginFailures.get(username);
    const now = Date.now();
    if (record && record.count >= 5 && record.lockedUntil > now) {
      const timeLeft = Math.ceil((record.lockedUntil - now) / 1000);
      return this.send(ws, { type: "AUTH_FAILURE", reason: `Rate limited. Try again in ${timeLeft}s` });
    }

    const userRow = await db.prepare("SELECT * FROM users WHERE LOWER(username) = ?")
      .bind(username).first<any>();

    if (!userRow || !userRow.password_hash) {
      const rec = (record && record.lockedUntil <= now) ? { count: 0, lockedUntil: 0 } : (record || { count: 0, lockedUntil: 0 });
      rec.count++;
      if (rec.count >= 5) rec.lockedUntil = now + 30000;
      this.loginFailures.set(username, rec);
      return this.send(ws, { type: "AUTH_FAILURE", reason: "@username not found" });
    }

    const match = await verifyPassword(password, userRow.password_hash);
    if (!match) {
      const rec = (record && record.lockedUntil <= now) ? { count: 0, lockedUntil: 0 } : (record || { count: 0, lockedUntil: 0 });
      rec.count++;
      if (rec.count >= 5) rec.lockedUntil = now + 30000;
      this.loginFailures.set(username, rec);
      return this.send(ws, { type: "AUTH_FAILURE", reason: "Incorrect password" });
    }

    this.loginFailures.delete(username);
    const sessionToken = crypto.randomUUID();
    const sessionExpiresAt = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare("UPDATE users SET session_token = ?, session_expires_at = ? WHERE LOWER(username) = ?")
      .bind(sessionToken, sessionExpiresAt, username).run();

    this.setAuth(ws, username);
    this.send(ws, {
      type: "AUTH_SUCCESS",
      user: {
        id: userRow.id,
        username: userRow.username,
        nickname: userRow.nickname,
        links: userRow.links,
        created_at: userRow.created_at,
        linker_avatar: userRow.linker_avatar || "👾",
        linker_color: userRow.linker_color || "pink",
        session_token: sessionToken,
        session_expires_at: sessionExpiresAt,
      },
      sessionToken,
    });
    await this.syncUserFullData(username);
  }

  private async handleLogout(ws: WebSocket, data: any): Promise<void> {
    if (data.sessionToken) {
      await this.db().prepare("UPDATE users SET session_token = NULL, session_expires_at = NULL WHERE session_token = ?")
        .bind(data.sessionToken).run();
    }
    ws.serializeAttachment({ username: null } as WsAttachment);
    this.send(ws, { type: "AUTH_LOGOUT_SUCCESS" });
  }

  private async handleVerifySession(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const token = data.sessionToken || "";
    if (!username || !token) {
      return this.send(ws, { type: "AUTH_SESSION_EXPIRED" });
    }
    const userRow = await this.db().prepare(
      "SELECT * FROM users WHERE LOWER(username) = ? AND session_token = ?"
    ).bind(username, token).first<any>();

    if (userRow) {
      const expiry = userRow.session_expires_at ? new Date(userRow.session_expires_at).getTime() : 0;
      if (expiry > Date.now()) {
        this.setAuth(ws, username);
        this.send(ws, {
          type: "AUTH_SUCCESS",
          user: {
            id: userRow.id,
            username: userRow.username,
            nickname: userRow.nickname,
            links: userRow.links,
            created_at: userRow.created_at,
            linker_avatar: userRow.linker_avatar || "👾",
            linker_color: userRow.linker_color || "pink",
            session_token: userRow.session_token,
            session_expires_at: userRow.session_expires_at,
          },
          sessionToken: token,
        });
        await this.syncUserFullData(username);
        return;
      }
    }
    this.send(ws, { type: "AUTH_SESSION_EXPIRED" });
  }

  private async handleCheckUsername(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const exists = await this.db().prepare("SELECT id FROM users WHERE LOWER(username) = ?")
      .bind(username).first();
    this.send(ws, { type: "CHECK_USERNAME_RESPONSE", username, available: !exists });
  }

  private async handleLegacyRegister(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const nickname = (data.nickname || "").trim();
    if (!username || !nickname) {
      return this.send(ws, { type: "ERROR", message: "Username and Nickname are required" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 20) {
      return this.send(ws, { type: "ERROR", message: "Invalid username format" });
    }
    try {
      const result = await this.db().prepare(
        "INSERT INTO users (username, nickname, links, linker_avatar, linker_color) VALUES (?, ?, 0, '👾', 'pink')"
      ).bind(username, nickname).run();
      this.setAuth(ws, username);
      this.send(ws, {
        type: "REGISTER_SUCCESS",
        user: {
          id: result.meta.last_row_id,
          username, nickname, links: 0,
          created_at: new Date().toISOString(),
          linker_avatar: "👾", linker_color: "pink",
        },
      });
      await this.syncUserFullData(username);
    } catch {
      this.send(ws, { type: "ERROR", message: "Username is already taken" });
    }
  }

  private async handleLegacyVerify(ws: WebSocket, data: any): Promise<void> {
    const username = (data.username || "").toLowerCase().trim();
    const userRow = await this.db().prepare("SELECT * FROM users WHERE LOWER(username) = ?")
      .bind(username).first<any>();
    if (userRow) {
      this.setAuth(ws, username);
      this.send(ws, {
        type: "VERIFY_USER_RESPONSE",
        success: true,
        user: {
          id: userRow.id,
          username: userRow.username,
          nickname: userRow.nickname,
          links: userRow.links,
          created_at: userRow.created_at,
          linker_avatar: userRow.linker_avatar || "👾",
          linker_color: userRow.linker_color || "pink",
        },
      });
      await this.syncUserFullData(username);
    } else {
      this.send(ws, { type: "VERIFY_USER_RESPONSE", success: false });
    }
  }

  private async handleLinkerUpdate(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const db = this.db();
    if (data.avatar) await db.prepare("UPDATE users SET linker_avatar = ? WHERE LOWER(username) = ?").bind(data.avatar, user).run();
    if (data.color)  await db.prepare("UPDATE users SET linker_color = ? WHERE LOWER(username) = ?").bind(data.color, user).run();
    await this.syncUserFullData(user);
  }

  private async handleNicknameUpdate(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const nick = (data.nickname || "").trim();
    if (nick.length < 1 || nick.length > 30) return;
    await this.db().prepare("UPDATE users SET nickname = ? WHERE LOWER(username) = ?").bind(nick, user).run();
    this.broadcast({ type: "NICKNAME_UPDATED", username: user, nickname: nick });
    await this.syncUserFullData(user);
  }

  private async handleFriendRequest(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const target = (data.receiverUsername || "").toLowerCase().trim();
    const db = this.db();

    if (target === user) {
      return this.send(ws, { type: "FRIEND_REQUEST_RESPONSE", success: false, error: "You cannot add yourself" });
    }

    const targetRow = await db.prepare("SELECT username, nickname FROM users WHERE LOWER(username) = ?")
      .bind(target).first<any>();
    if (!targetRow) {
      return this.send(ws, { type: "FRIEND_REQUEST_RESPONSE", success: false, error: "@username not found" });
    }

    const existing = await db.prepare(`
      SELECT * FROM friendships
      WHERE (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)
         OR (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)
    `).bind(user, target, target, user).first<any>();

    if (existing) {
      const error = existing.status === "accepted" ? "Already friends" : "Request already sent";
      return this.send(ws, { type: "FRIEND_REQUEST_RESPONSE", success: false, error });
    }

    await db.prepare("INSERT INTO friendships (requester_username, receiver_username, status) VALUES (?, ?, 'pending')")
      .bind(user, target).run();

    this.send(ws, { type: "FRIEND_REQUEST_RESPONSE", success: true });

    if (this.isOnline(target)) {
      this.sendToUser(target, { type: "FRIEND_REQUEST_NOTIFICATION", from: user });
    } else {
      const senderRow = await db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").bind(user).first<any>();
      const sub = await db.prepare("SELECT push_subscription FROM users WHERE LOWER(username) = ?").bind(target).first<any>();
      if (sub?.push_subscription) {
        await sendPushNotification(this.env, sub.push_subscription,
          "New Friend Request",
          `@${user} (${senderRow?.nickname || user}) sent you a friend request.`
        );
      }
    }

    await this.syncUserFullData(user);
    await this.syncUserFullData(target);
  }

  private async handleFriendAccept(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const requester = (data.requesterUsername || "").toLowerCase().trim();
    const db = this.db();

    await db.prepare(
      "UPDATE friendships SET status = 'accepted' WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?"
    ).bind(requester, user).run();

    const convExists = await db.prepare(`
      SELECT id FROM conversations
      WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
         OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
    `).bind(requester, user, user, requester).first();

    if (!convExists) {
      await db.prepare(
        "INSERT INTO conversations (participant_1, participant_2, started_at, conversation_started, saved) VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0)"
      ).bind(requester, user).run();
    }

    await this.syncUserFullData(user);
    await this.syncUserFullData(requester);
  }

  private async handleFriendDecline(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const requester = (data.requesterUsername || "").toLowerCase().trim();
    await this.db().prepare(
      "DELETE FROM friendships WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?"
    ).bind(requester, user).run();
    await this.syncUserFullData(user);
    await this.syncUserFullData(requester);
  }

  private async handleReadConversation(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const convId = parseInt(data.conversationId, 10);
    if (isNaN(convId)) return;
    const db = this.db();

    const convRow = await db.prepare("SELECT * FROM conversations WHERE id = ?").bind(convId).first<any>();
    if (!convRow || convRow.conversation_started !== 0) return;

    const isReceiver = convRow.participant_2.toLowerCase() === user;
    if (!isReceiver) return;

    await db.prepare("UPDATE conversations SET conversation_started = 1 WHERE id = ?").bind(convId).run();
    await db.prepare("UPDATE users SET links = links + 1 WHERE LOWER(username) = ?").bind(convRow.participant_1.toLowerCase()).run();
    await db.prepare("UPDATE users SET links = links + 1 WHERE LOWER(username) = ?").bind(convRow.participant_2.toLowerCase()).run();

    const u1 = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(convRow.participant_1.toLowerCase()).first<any>();
    const u2 = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(convRow.participant_2.toLowerCase()).first<any>();

    const startedPayload = { type: "CONVERSATION_STARTED", conversationId: convId };
    this.sendToUser(convRow.participant_1.toLowerCase(), { type: "LINKS_EARNED", amount: 1, reason: "Conversation opened", links: u1?.links });
    this.sendToUser(convRow.participant_2.toLowerCase(), { type: "LINKS_EARNED", amount: 1, reason: "Conversation opened", links: u2?.links });
    this.sendToUser(convRow.participant_1.toLowerCase(), startedPayload);
    this.sendToUser(convRow.participant_2.toLowerCase(), startedPayload);

    await this.syncUserFullData(convRow.participant_1);
    await this.syncUserFullData(convRow.participant_2);
  }

  private async handleChatMessage(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const { to, content, sentAt, timerDuration, isPhoto } = data;
    const target = (to || "").toLowerCase().trim();
    const db = this.db();

    const conv = await db.prepare(`
      SELECT id FROM conversations
      WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
         OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
    `).bind(user, target, target, user).first<any>();

    if (!conv) {
      return this.send(ws, { type: "ERROR", message: "Conversation not found" });
    }
    const convId = conv.id;

    const msgResult = await db.prepare(`
      INSERT INTO messages (conversation_id, sender, receiver, content, sent_at, timer_duration, expired, is_photo)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(convId, user, target, content || "", sentAt, timerDuration, isPhoto ? 1 : 0).run();

    const savedMsg = {
      id: msgResult.meta.last_row_id,
      conversation_id: convId,
      sender: user,
      receiver: target,
      content: content || "",
      sent_at: sentAt,
      timer_duration: timerDuration,
      expired: 0,
      is_photo: isPhoto ? 1 : 0,
    };

    // Timer logic
    const activeTimer = await db.prepare("SELECT * FROM timers WHERE conversation_id = ?").bind(convId).first<any>();
    let earnedLinks = 0;
    if (activeTimer) {
      const startMs = typeof activeTimer.started_at === "number"
        ? activeTimer.started_at
        : new Date(activeTimer.started_at).getTime();
      const isResponseInTime = (sentAt - startMs) <= activeTimer.duration_ms;
      if (isResponseInTime && activeTimer.timer_type === "opener" && target === user) {
        const countRow = await db.prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?").bind(convId).first<any>();
        const msgCount = countRow?.count || 1;
        earnedLinks = Math.max(1, Math.ceil(Math.log(msgCount) / Math.log(1.2)));
        await db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(earnedLinks, user).run();
        await db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(earnedLinks, target).run();
        await db.prepare("DELETE FROM timers WHERE id = ?").bind(activeTimer.id).run();
      }
    }

    await db.prepare("DELETE FROM timers WHERE conversation_id = ?").bind(convId).run();
    await db.prepare(
      "INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'opener', ?, ?)"
    ).bind(convId, new Date(sentAt).toISOString(), timerDuration).run();

    const senderUser = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(user).first<any>();
    const targetUser = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(target).first<any>();

    const broadcastPayload = { type: "CHAT_MESSAGE_BROADCAST", message: savedMsg };
    this.send(ws, broadcastPayload);
    if (earnedLinks > 0) {
      this.send(ws, { type: "LINKS_EARNED", amount: earnedLinks, reason: "Successful opener response", links: senderUser?.links || 0 });
    }

    if (this.isOnline(target)) {
      this.sendToUser(target, broadcastPayload);
      if (earnedLinks > 0) {
        this.sendToUser(target, { type: "LINKS_EARNED", amount: earnedLinks, reason: "Successful opener response", links: targetUser?.links || 0 });
      }
    } else {
      const senderInfo = await db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").bind(user).first<any>();
      const sub = await db.prepare("SELECT push_subscription FROM users WHERE LOWER(username) = ?").bind(target).first<any>();
      if (sub?.push_subscription) {
        await sendPushNotification(this.env, sub.push_subscription,
          `New message from ${senderInfo?.nickname || user}`,
          isPhoto ? "📷 Sent you a photo message" : (content || "").substring(0, 80),
          { conversationId: convId }
        );
      }
    }

    await this.syncUserFullData(user);
    await this.syncUserFullData(target);
  }

  private async handleGetHistory(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const convId = parseInt(data.conversationId, 10);
    if (isNaN(convId)) return;
    const msgs = (await this.db().prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC"
    ).bind(convId).all<any>()).results;
    this.send(ws, { type: "HISTORY_SYNC", conversationId: convId, messages: msgs });
  }

  private async handleEndChatRequest(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const convId = parseInt(data.conversationId, 10);
    if (isNaN(convId)) return;
    const db = this.db();

    const convRow = await db.prepare("SELECT * FROM conversations WHERE id = ?").bind(convId).first<any>();
    if (!convRow) return;

    const partner = convRow.participant_1.toLowerCase() === user
      ? convRow.participant_2.toLowerCase()
      : convRow.participant_1.toLowerCase();

    if (this.isOnline(partner)) {
      this.sendToUser(partner, { type: "END_CHAT_REQUEST_BROADCAST", conversationId: convId, from: user });
    } else {
      const userRow = await db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").bind(user).first<any>();
      const sub = await db.prepare("SELECT push_subscription FROM users WHERE LOWER(username) = ?").bind(partner).first<any>();
      if (sub?.push_subscription) {
        await sendPushNotification(this.env, sub.push_subscription,
          `${userRow?.nickname || user} wants to save your conversation`,
          "Tap to review and save before the timer runs out.",
          { conversationId: convId, requestSave: true }
        );
      }
    }
  }

  private async handleEndChatConfirm(ws: WebSocket, data: any, user: string | null): Promise<void> {
    if (!user) return;
    const convId = parseInt(data.conversationId, 10);
    if (isNaN(convId)) return;
    const db = this.db();

    const convRow = await db.prepare("SELECT * FROM conversations WHERE id = ?").bind(convId).first<any>();
    if (!convRow) return;

    const countRow = await db.prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?").bind(convId).first<any>();
    const finalCount = countRow?.count || 0;
    const finalReward = Math.max(1, Math.ceil(Math.log(finalCount || 1) / Math.log(1.2)));

    await db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(finalReward, convRow.participant_1.toLowerCase()).run();
    await db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(finalReward, convRow.participant_2.toLowerCase()).run();
    await db.prepare("UPDATE conversations SET saved = 1 WHERE id = ?").bind(convId).run();
    await db.prepare("DELETE FROM timers WHERE conversation_id = ?").bind(convId).run();

    const u1 = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(convRow.participant_1.toLowerCase()).first<any>();
    const u2 = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(convRow.participant_2.toLowerCase()).first<any>();

    const savedPayload = { type: "CONVERSATION_SAVED_SUCCESS", conversationId: convId, finalReward };
    this.sendToUser(convRow.participant_1.toLowerCase(), savedPayload);
    this.sendToUser(convRow.participant_1.toLowerCase(), { type: "LINKS_EARNED", amount: finalReward, reason: "Conversation saved successfully", links: u1?.links });
    this.sendToUser(convRow.participant_2.toLowerCase(), savedPayload);
    this.sendToUser(convRow.participant_2.toLowerCase(), { type: "LINKS_EARNED", amount: finalReward, reason: "Conversation saved successfully", links: u2?.links });

    await this.syncUserFullData(convRow.participant_1);
    await this.syncUserFullData(convRow.participant_2);
  }
}
