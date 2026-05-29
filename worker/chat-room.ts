/**
 * ChatRoom Durable Object — replaces the in-process WebSocket hub in server.ts.
 *
 * A single global instance ("global") serves all concurrent connections.
 * In-memory Maps (clients, loginFailures, notified60sTimers) are valid because
 * the DO has a single-instance guarantee; they reset on hibernation but that is
 * acceptable (clients reconnect, rate-limit counters reset, 60-s re-notifications
 * are harmless duplicates).
 *
 * Timer monitoring previously done with setInterval(5000) is now driven by
 * Durable Object alarms, which survive across alarm invocations.
 */

import bcrypt from "bcryptjs";
import webpush from "web-push";
import {
  createHmac,
  randomUUID,
} from "node:crypto";

// ---------------------------------------------------------------------------
// JWT helpers (HS256, same algorithm as server/v15.ts)
// ---------------------------------------------------------------------------
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlJSON(obj: unknown): string {
  return b64url(JSON.stringify(obj));
}

function signJWT(
  payload: Record<string, unknown>,
  ttlSec: number,
  secret: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const head = b64urlJSON({ alg: "HS256", typ: "JWT" });
  const data = `${head}.${b64urlJSON(body)}`;
  const sig = createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

export function verifyJWT(
  token: string,
  secret: string
): Record<string, any> | null {
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const expected = b64url(
      createHmac("sha256", secret).update(`${h}.${p}`).digest()
    );
    if (expected !== s) return null;
    const payload = JSON.parse(
      Buffer.from(
        p.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString()
    );
    if (
      typeof payload.exp === "number" &&
      payload.exp < Math.floor(Date.now() / 1000)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30;

// ── Two-phase opener/normal economy (Prompt 1) ──────────────────────────────
// Opener timers and their fixed link reward on a successful response.
const OPENER_DURATIONS: Record<number, number> = {
  600000: 10,   // 10 minutes  → 10 links
  3600000: 5,   // 1 hour      →  5 links
  43200000: 1,  // 12 hours    →  1 link
};
const NORMAL_DURATIONS = new Set([10000, 60000, 300000]); // 10s / 60s / 5m

function openerReward(durationMs: number): number {
  return OPENER_DURATIONS[durationMs] ?? 1;
}

async function issueTokens(
  username: string,
  db: D1Database,
  secret: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = signJWT({ sub: username, kind: "access" }, ACCESS_TTL_SEC, secret);
  const refreshRaw = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  const { createHash } = await import("node:crypto");
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

// ---------------------------------------------------------------------------
// ChatRoom Durable Object
// ---------------------------------------------------------------------------
export class ChatRoom {
  private state: DurableObjectState;
  private env: CloudflareEnv;

  // In-memory connection registry — valid within a single DO lifetime
  private clients = new Map<string, WebSocket>();
  private notified60sTimers = new Set<string>();
  private loginFailures = new Map<
    string,
    { count: number; lockedUntil: number }
  >();
  private vapidReady = false;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    console.log("[ChatRoom] fetch() called, Upgrade:", request.headers.get("Upgrade"));

    // Alarm setup is non-fatal — if it fails, timer monitoring is disabled
    // but WebSocket connections still work normally.
    try {
      const alarm = await this.state.storage.getAlarm();
      if (alarm === null) {
        await this.state.storage.setAlarm(Date.now() + 5_000);
      }
    } catch (e) {
      console.error("[ChatRoom] alarm setup error (non-fatal):", e);
    }

    this.initVapid();

    if (request.headers.get("Upgrade") !== "websocket") {
      console.log("[ChatRoom] Non-WebSocket request — returning 426");
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    console.log("[ChatRoom] Creating WebSocketPair...");
    try {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      this.wire(server);
      console.log("[ChatRoom] WebSocket accepted, returning 101");
      return new Response(null, { status: 101, webSocket: client });
    } catch (e: any) {
      console.error("[ChatRoom] WebSocket setup error:", e);
      return new Response("WebSocket setup failed: " + e?.message, { status: 500 });
    }
  }

  // Replaces setInterval(checkTimers, 5000)
  async alarm(): Promise<void> {
    await this.checkTimers();
    await this.state.storage.setAlarm(Date.now() + 5_000);
  }

  // ---------------------------------------------------------------------------
  // VAPID initialisation (idempotent)
  // ---------------------------------------------------------------------------
  private initVapid(): void {
    if (this.vapidReady) return;
    const pub = this.env.VAPID_PUBLIC_KEY;
    const priv = this.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      try {
        webpush.setVapidDetails(
          "mailto:jl.software.company@gmail.com",
          pub,
          priv
        );
        this.vapidReady = true;
      } catch (e) {
        console.error("[ChatRoom] VAPID init error:", e);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket wiring
  // ---------------------------------------------------------------------------
  private wire(ws: WebSocket): void {
    let authedUser: string | null = null;

    ws.addEventListener("message", async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        await this.dispatch(ws, data, authedUser, (u) => {
          authedUser = u;
        });
      } catch (e) {
        console.error("[ChatRoom] dispatch error:", e);
      }
    });

    ws.addEventListener("close", () => {
      if (authedUser) this.clients.delete(authedUser);
    });
  }

  // ---------------------------------------------------------------------------
  // Message dispatcher — converts all sync SQLite ops to async D1 ops
  // ---------------------------------------------------------------------------
  private async dispatch(
    ws: WebSocket,
    data: any,
    authedUser: string | null,
    setUser: (u: string) => void
  ): Promise<void> {
    const { type } = data;
    const db = this.env.DB;

    switch (type) {
      // ── Registration (with password) ────────────────────────────────────
      case "AUTH_REGISTER": {
        const username = (data.username || "").toLowerCase().trim();
        const nickname = (data.nickname || "").trim();
        const password = data.password;

        if (!username || !nickname || !password) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username, Nickname, and Password are required" }));
          return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 20) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Invalid username format" }));
          return;
        }
        if (nickname.length < 1 || nickname.length > 30) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Nickname must be between 1 and 30 characters" }));
          return;
        }
        if (password.length < 8) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Password must be at least 8 characters long" }));
          return;
        }

        const exists = await db
          .prepare("SELECT id FROM users WHERE LOWER(username) = ?")
          .bind(username)
          .first();
        if (exists) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username already taken" }));
          return;
        }

        try {
          const passwordHash = await bcrypt.hash(password, 12);
          const sessionToken = randomUUID();
          const sessionExpiresAt = new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString();

          const result = await db
            .prepare(
              `INSERT INTO users (username, nickname, links, linker_avatar, linker_color, password_hash, session_token, session_expires_at)
               VALUES (?, ?, 0, '👾', 'pink', ?, ?, ?)`
            )
            .bind(username, nickname, passwordHash, sessionToken, sessionExpiresAt)
            .run();

          const user = {
            id: result.meta.last_row_id,
            username,
            nickname,
            links: 0,
            created_at: new Date().toISOString(),
            linker_avatar: "👾",
            linker_color: "pink",
            session_token: sessionToken,
            session_expires_at: sessionExpiresAt,
          };

          setUser(username);
          this.clients.set(username, ws);
          ws.send(JSON.stringify({ type: "AUTH_SUCCESS", user, sessionToken }));
          await this.syncUser(username);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: err.message || "Registration failed" }));
        }
        break;
      }

      // ── Login (with password) ────────────────────────────────────────────
      case "AUTH_LOGIN": {
        const username = (data.username || "").toLowerCase().trim();
        const password = data.password;

        if (!username || !password) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username and Password are required" }));
          return;
        }

        const nowMs = Date.now();
        const failure = this.loginFailures.get(username);
        if (failure && failure.count >= 5 && failure.lockedUntil > nowMs) {
          const secs = Math.ceil((failure.lockedUntil - nowMs) / 1000);
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: `Rate limited. Try again in ${secs}s` }));
          return;
        }

        const userRow = await db
          .prepare("SELECT * FROM users WHERE LOWER(username) = ?")
          .bind(username)
          .first<any>();

        const bumpFailure = () => {
          const rec =
            failure && failure.lockedUntil <= nowMs
              ? { count: 0, lockedUntil: 0 }
              : failure || { count: 0, lockedUntil: 0 };
          rec.count += 1;
          if (rec.count >= 5) rec.lockedUntil = nowMs + 30_000;
          this.loginFailures.set(username, rec);
        };

        if (!userRow) {
          bumpFailure();
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "@username not found" }));
          return;
        }
        if (!userRow.password_hash) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Incorrect password" }));
          return;
        }

        try {
          const match = await bcrypt.compare(password, userRow.password_hash);
          if (!match) {
            bumpFailure();
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Incorrect password" }));
            return;
          }

          this.loginFailures.delete(username);
          const sessionToken = randomUUID();
          const sessionExpiresAt = new Date(
            nowMs + 30 * 24 * 60 * 60 * 1000
          ).toISOString();

          await db
            .prepare(
              "UPDATE users SET session_token = ?, session_expires_at = ? WHERE LOWER(username) = ?"
            )
            .bind(sessionToken, sessionExpiresAt, username)
            .run();

          const authed = userRow.username.toLowerCase();
          setUser(authed);
          this.clients.set(authed, ws);
          ws.send(
            JSON.stringify({
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
            })
          );
          await this.syncUser(authed);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: err.message || "Login failed" }));
        }
        break;
      }

      // ── Logout ───────────────────────────────────────────────────────────
      case "AUTH_LOGOUT": {
        if (data.sessionToken) {
          await db
            .prepare(
              "UPDATE users SET session_token = NULL, session_expires_at = NULL WHERE session_token = ?"
            )
            .bind(data.sessionToken)
            .run();
        }
        ws.send(JSON.stringify({ type: "AUTH_LOGOUT_SUCCESS" }));
        break;
      }

      // ── Session verify (reconnect) ────────────────────────────────────────
      case "AUTH_VERIFY_SESSION": {
        const username = (data.username || "").toLowerCase().trim();
        const token = data.sessionToken;
        if (!username || !token) {
          ws.send(JSON.stringify({ type: "AUTH_SESSION_EXPIRED" }));
          return;
        }

        const row = await db
          .prepare(
            "SELECT * FROM users WHERE LOWER(username) = ? AND session_token = ?"
          )
          .bind(username, token)
          .first<any>();

        if (row && new Date(row.session_expires_at).getTime() > Date.now()) {
          const authed = row.username.toLowerCase();
          setUser(authed);
          this.clients.set(authed, ws);
          ws.send(
            JSON.stringify({
              type: "AUTH_SUCCESS",
              user: {
                id: row.id,
                username: row.username,
                nickname: row.nickname,
                links: row.links,
                created_at: row.created_at,
                linker_avatar: row.linker_avatar || "👾",
                linker_color: row.linker_color || "pink",
                session_token: row.session_token,
                session_expires_at: row.session_expires_at,
              },
              sessionToken: token,
            })
          );
          await this.syncUser(authed);
        } else {
          ws.send(JSON.stringify({ type: "AUTH_SESSION_EXPIRED" }));
        }
        break;
      }

      // ── Username availability check ───────────────────────────────────────
      case "CHECK_USERNAME": {
        const username = (data.username || "").toLowerCase().trim();
        const taken = await db
          .prepare("SELECT id FROM users WHERE LOWER(username) = ?")
          .bind(username)
          .first();
        ws.send(
          JSON.stringify({ type: "CHECK_USERNAME_RESPONSE", username, available: !taken })
        );
        break;
      }

      // ── Legacy passwordless registration ─────────────────────────────────
      case "REGISTER_USER": {
        const username = (data.username || "").toLowerCase().trim();
        const nickname = (data.nickname || "").trim();
        if (!username || !nickname) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Username and Nickname are required" }));
          return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username) || username.length > 20) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Invalid username format" }));
          return;
        }
        if (nickname.length < 1 || nickname.length > 30) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Nickname must be between 1 and 30 characters" }));
          return;
        }
        try {
          const result = await db
            .prepare(
              "INSERT INTO users (username, nickname, links, linker_avatar, linker_color) VALUES (?, ?, 0, '👾', 'pink')"
            )
            .bind(username, nickname)
            .run();
          const user = {
            id: result.meta.last_row_id,
            username,
            nickname,
            links: 0,
            created_at: new Date().toISOString(),
            linker_avatar: "👾",
            linker_color: "pink",
          };
          setUser(username);
          this.clients.set(username, ws);
          ws.send(JSON.stringify({ type: "REGISTER_SUCCESS", user }));
          await this.syncUser(username);
        } catch {
          ws.send(JSON.stringify({ type: "ERROR", message: "Username is already taken" }));
        }
        break;
      }

      // ── Legacy passwordless verify ────────────────────────────────────────
      case "VERIFY_USER": {
        const username = (data.username || "").toLowerCase().trim();
        const row = await db
          .prepare("SELECT * FROM users WHERE LOWER(username) = ?")
          .bind(username)
          .first<any>();
        if (row) {
          const authed = row.username.toLowerCase();
          setUser(authed);
          this.clients.set(authed, ws);
          ws.send(
            JSON.stringify({
              type: "VERIFY_USER_RESPONSE",
              success: true,
              user: {
                id: row.id,
                username: row.username,
                nickname: row.nickname,
                links: row.links,
                created_at: row.created_at,
                linker_avatar: row.linker_avatar || "👾",
                linker_color: row.linker_color || "pink",
              },
            })
          );
          await this.syncUser(authed);
        } else {
          ws.send(JSON.stringify({ type: "VERIFY_USER_RESPONSE", success: false }));
        }
        break;
      }

      // ── Linker avatar / colour update ─────────────────────────────────────
      case "LINKER_UPDATE": {
        if (!authedUser) return;
        const avatar = (data.avatar || "").trim();
        const color = (data.color || "").trim();
        const updates: D1PreparedStatement[] = [];
        if (avatar)
          updates.push(
            db
              .prepare("UPDATE users SET linker_avatar = ? WHERE LOWER(username) = ?")
              .bind(avatar, authedUser)
          );
        if (color)
          updates.push(
            db
              .prepare("UPDATE users SET linker_color = ? WHERE LOWER(username) = ?")
              .bind(color, authedUser)
          );
        if (updates.length) await db.batch(updates);
        await this.syncUser(authedUser);
        break;
      }

      // ── Nickname update ───────────────────────────────────────────────────
      case "NICKNAME_UPDATE": {
        if (!authedUser) return;
        const nick = (data.nickname || "").trim();
        if (nick.length >= 1 && nick.length <= 30) {
          await db
            .prepare("UPDATE users SET nickname = ? WHERE LOWER(username) = ?")
            .bind(nick, authedUser)
            .run();
          this.broadcastAll(
            JSON.stringify({ type: "NICKNAME_UPDATED", username: authedUser, nickname: nick })
          );
          await this.syncUser(authedUser);
        }
        break;
      }

      // ── Friend request ────────────────────────────────────────────────────
      case "FRIEND_REQUEST": {
        if (!authedUser) return;
        const target = (data.receiverUsername || "").toLowerCase().trim();
        if (target === authedUser) {
          ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "You cannot add yourself" }));
          return;
        }

        const targetRow = await db
          .prepare("SELECT username, nickname FROM users WHERE LOWER(username) = ?")
          .bind(target)
          .first<any>();
        if (!targetRow) {
          ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "@username not found" }));
          return;
        }

        const existing = await db
          .prepare(
            `SELECT * FROM friendships
             WHERE (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)
                OR (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)`
          )
          .bind(authedUser, target, target, authedUser)
          .first<any>();

        if (existing) {
          ws.send(
            JSON.stringify({
              type: "FRIEND_REQUEST_RESPONSE",
              success: false,
              error: existing.status === "accepted" ? "Already friends" : "Request already sent",
            })
          );
          return;
        }

        await db
          .prepare("INSERT INTO friendships (requester_username, receiver_username, status) VALUES (?, ?, 'pending')")
          .bind(authedUser, target)
          .run();

        ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: true }));

        const targetWs = this.clients.get(target);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: "FRIEND_REQUEST_NOTIFICATION", from: authedUser }));
        } else {
          const senderRow = await db
            .prepare("SELECT nickname FROM users WHERE LOWER(username) = ?")
            .bind(authedUser)
            .first<any>();
          await this.push(
            target,
            "New Friend Request",
            `@${authedUser} (${senderRow?.nickname || authedUser}) sent you a friend request.`
          );
        }

        await Promise.all([this.syncUser(authedUser), this.syncUser(target)]);
        break;
      }

      // ── Accept friend request ─────────────────────────────────────────────
      case "FRIEND_ACCEPT": {
        if (!authedUser) return;
        const requester = (data.requesterUsername || "").toLowerCase().trim();
        await db
          .prepare(
            "UPDATE friendships SET status = 'accepted' WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?"
          )
          .bind(requester, authedUser)
          .run();

        const convExists = await db
          .prepare(
            `SELECT id FROM conversations
             WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
                OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)`
          )
          .bind(requester, authedUser, authedUser, requester)
          .first();

        if (!convExists) {
          await db
            .prepare(
              "INSERT INTO conversations (participant_1, participant_2, started_at, conversation_started, saved) VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0)"
            )
            .bind(requester, authedUser)
            .run();
        }

        await Promise.all([this.syncUser(authedUser), this.syncUser(requester)]);
        break;
      }

      // ── Decline friend request ────────────────────────────────────────────
      case "FRIEND_DECLINE": {
        if (!authedUser) return;
        const requester = (data.requesterUsername || "").toLowerCase().trim();
        await db
          .prepare(
            "DELETE FROM friendships WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?"
          )
          .bind(requester, authedUser)
          .run();
        await Promise.all([this.syncUser(authedUser), this.syncUser(requester)]);
        break;
      }

      // ── Open conversation (awards link) ───────────────────────────────────
      case "READ_CONVERSATION": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;

        const conv = await db
          .prepare("SELECT * FROM conversations WHERE id = ?")
          .bind(convId)
          .first<any>();

        if (conv && conv.conversation_started === 0 && conv.participant_2.toLowerCase() === authedUser) {
          const p1 = conv.participant_1.toLowerCase();
          const p2 = conv.participant_2.toLowerCase();

          await db.batch([
            db.prepare("UPDATE conversations SET conversation_started = 1 WHERE id = ?").bind(convId),
            db.prepare("UPDATE users SET links = links + 1 WHERE LOWER(username) = ?").bind(p1),
            db.prepare("UPDATE users SET links = links + 1 WHERE LOWER(username) = ?").bind(p2),
          ]);

          const [u1, u2] = await Promise.all([
            db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(p1).first<any>(),
            db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(p2).first<any>(),
          ]);

          const started = JSON.stringify({ type: "CONVERSATION_STARTED", conversationId: convId });
          const ws1 = this.clients.get(p1);
          const ws2 = this.clients.get(p2);
          if (ws1?.readyState === WebSocket.OPEN) {
            ws1.send(JSON.stringify({ type: "LINKS_EARNED", amount: 1, reason: "Conversation opened", links: u1?.links }));
            ws1.send(started);
          }
          if (ws2?.readyState === WebSocket.OPEN) {
            ws2.send(JSON.stringify({ type: "LINKS_EARNED", amount: 1, reason: "Conversation opened", links: u2?.links }));
            ws2.send(started);
          }

          await Promise.all([this.syncUser(p1), this.syncUser(p2)]);
        }
        break;
      }

      // ── Chat message ──────────────────────────────────────────────────────
      case "CHAT_MESSAGE": {
        if (!authedUser) return;
        const { to, content, sentAt, timerDuration, isPhoto } = data;
        const target = (to || "").toLowerCase().trim();

        const conv = await db
          .prepare(
            `SELECT * FROM conversations
             WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
                OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)`
          )
          .bind(authedUser, target, target, authedUser)
          .first<any>();

        if (!conv) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Conversation not found" }));
          return;
        }

        const convId = conv.id;
        const phase: string = conv.phase || "awaiting_response";
        const initiator: string | null = conv.opener_initiator ? conv.opener_initiator.toLowerCase() : null;

        // Decide the message kind from the current phase (see server.ts for the
        // full state machine).
        let messageType: "opener" | "normal" = "normal";
        let isOpenerResponse = false;

        if (phase === "awaiting_response") {
          if (!initiator) {
            messageType = "opener";
          } else if (initiator === authedUser) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Wait for a response before sending another opener." }));
            return;
          } else {
            isOpenerResponse = true;
          }
        }

        const duration = messageType === "opener"
          ? (OPENER_DURATIONS[timerDuration] ? timerDuration : 600000)
          : (NORMAL_DURATIONS.has(timerDuration) ? timerDuration : 60000);

        const msgResult = await db
          .prepare(
            `INSERT INTO messages (conversation_id, sender, receiver, content, sent_at, timer_duration, expired, is_photo, message_type, is_responded_to)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`
          )
          .bind(convId, authedUser, target, content || "", sentAt, duration, isPhoto ? 1 : 0, messageType)
          .run();

        const savedMsg = {
          id: msgResult.meta.last_row_id,
          conversation_id: convId,
          sender: authedUser,
          receiver: target,
          content: content || "",
          sent_at: sentAt,
          timer_duration: duration,
          expired: 0,
          is_photo: isPhoto ? 1 : 0,
          seen: false,
          message_type: messageType,
          is_responded_to: 0,
        };

        let earnedLinks = 0;
        let newPhase = phase;
        let newInitiator = initiator;
        let newTimerChoice: number | null = conv.opener_timer_choice ?? null;

        const ops: D1PreparedStatement[] = [
          db.prepare("DELETE FROM timers WHERE conversation_id = ?").bind(convId),
          // Always increment the combined message count for the 10-message reward cap
          db.prepare("UPDATE conversations SET message_count = message_count + 1 WHERE id = ?").bind(convId),
        ];

        if (messageType === "opener") {
          ops.push(
            db
              .prepare("UPDATE conversations SET phase = 'awaiting_response', opener_initiator = ?, opener_timer_choice = ? WHERE id = ?")
              .bind(authedUser, duration, convId),
            db
              .prepare("INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'opener', ?, ?)")
              .bind(convId, new Date(sentAt).toISOString(), duration)
          );
          newPhase = "awaiting_response";
          newInitiator = authedUser;
          newTimerChoice = duration;
        } else if (isOpenerResponse) {
          // Links are awarded AFTER the batch, gated on the 10-message cap.
          ops.push(
            db.prepare("UPDATE messages SET is_responded_to = 1 WHERE conversation_id = ? AND message_type = 'opener' AND is_responded_to = 0").bind(convId),
            db.prepare("UPDATE conversations SET phase = 'active' WHERE id = ?").bind(convId),
            db
              .prepare("INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'normal', ?, ?)")
              .bind(convId, new Date(sentAt).toISOString(), duration)
          );
          newPhase = "active";
        } else {
          // Normal message in an active chat → HOT POTATO. The new message
          // REPLACES the running timer with a fresh one of its own duration, so
          // only the latest message's timer counts down. Miss it and the chat dies.
          ops.push(
            db
              .prepare("INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'normal', ?, ?)")
              .bind(convId, new Date(sentAt).toISOString(), duration)
          );
        }

        await db.batch(ops);

        // Read fresh message_count AFTER the batch to apply the 10-message reward cap.
        const convAfter = await db
          .prepare("SELECT message_count FROM conversations WHERE id = ?")
          .bind(convId)
          .first<{ message_count: number }>();
        const currentMessageCount = convAfter?.message_count ?? 0;

        // Award links only on a successful opener response AND only while the
        // combined message count is ≤ 10. From the 11th message on, nobody earns.
        if (isOpenerResponse && currentMessageCount <= 10) {
          earnedLinks = openerReward(conv.opener_timer_choice ?? 0);
          await db.batch([
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(earnedLinks, authedUser),
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(earnedLinks, target),
          ]);
        }

        const [senderUser, targetUser] = await Promise.all([
          db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(authedUser).first<any>(),
          db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(target).first<any>(),
        ]);

        const broadcast = JSON.stringify({
          type: "CHAT_MESSAGE_BROADCAST",
          message: savedMsg,
          phase: newPhase,
          openerInitiator: newInitiator,
          openerTimerChoice: newTimerChoice,
        });
        const targetWs = this.clients.get(target);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(broadcast);
          if (earnedLinks > 0)
            ws.send(JSON.stringify({ type: "LINKS_EARNED", amount: earnedLinks, reason: "Successful opener response", links: senderUser?.links || 0 }));
        }
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(broadcast);
          if (earnedLinks > 0)
            targetWs.send(JSON.stringify({ type: "LINKS_EARNED", amount: earnedLinks, reason: "Successful opener response", links: targetUser?.links || 0 }));
        } else {
          const senderInfo = await db
            .prepare("SELECT nickname FROM users WHERE LOWER(username) = ?")
            .bind(authedUser)
            .first<any>();
          await this.push(
            target,
            `New message from ${senderInfo?.nickname || authedUser}`,
            isPhoto ? "📷 Sent you a photo message" : (content || "").substring(0, 80),
            { conversationId: convId }
          );
        }

        await Promise.all([this.syncUser(authedUser), this.syncUser(target)]);
        break;
      }

      // ── Chat history ──────────────────────────────────────────────────────
      case "GET_HISTORY": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;
        const { results: msgs } = await db
          .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC")
          .bind(convId)
          .all<any>();
        const histConv = await db
          .prepare("SELECT phase, opener_initiator, opener_timer_choice FROM conversations WHERE id = ?")
          .bind(convId)
          .first<any>();
        ws.send(
          JSON.stringify({
            type: "HISTORY_SYNC",
            conversationId: convId,
            phase: histConv?.phase || "awaiting_response",
            openerInitiator: histConv?.opener_initiator ? histConv.opener_initiator.toLowerCase() : null,
            openerTimerChoice: histConv?.opener_timer_choice ?? null,
            messages: msgs.map((m) => ({
              id: m.id,
              conversation_id: m.conversation_id,
              sender: m.sender,
              receiver: m.receiver,
              content: m.content,
              sent_at: m.sent_at,
              timer_duration: m.timer_duration,
              expired: m.expired,
              is_photo: m.is_photo,
              seen: !!m.seen,
              message_type: m.message_type || "normal",
              is_responded_to: m.is_responded_to || 0,
            })),
          })
        );
        break;
      }

      // ── Mark message as seen (read receipts) ──────────────────────────────
      case "MESSAGE_SEEN": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        const messageId = parseInt(data.messageId, 10);
        if (isNaN(convId) || isNaN(messageId)) return;

        const msgRow = await db
          .prepare("SELECT sender, receiver FROM messages WHERE id = ? AND conversation_id = ?")
          .bind(messageId, convId)
          .first<any>();
        if (!msgRow || msgRow.receiver.toLowerCase() !== authedUser) return;

        await db.prepare("UPDATE messages SET seen = 1 WHERE id = ?").bind(messageId).run();

        const seenPayload = JSON.stringify({
          type: "MESSAGE_SEEN_BROADCAST",
          conversationId: convId,
          messageId,
          seenBy: authedUser,
          seenAt: data.seenAt || Date.now(),
        });

        const senderWs = this.clients.get(msgRow.sender.toLowerCase());
        if (senderWs?.readyState === WebSocket.OPEN) senderWs.send(seenPayload);
        if (ws.readyState === WebSocket.OPEN) ws.send(seenPayload);
        break;
      }

      // ── Normal message expired unanswered → wipe the whole chat ────────────
      case "CHAT_EXPIRED_DELETE": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;

        const convRow = await db
          .prepare("SELECT * FROM conversations WHERE id = ?")
          .bind(convId)
          .first<any>();
        if (!convRow) return;

        const isParticipant =
          convRow.participant_1.toLowerCase() === authedUser ||
          convRow.participant_2.toLowerCase() === authedUser;
        if (!isParticipant || convRow.saved === 1 || convRow.phase !== "active") return;

        await this.archiveChat(convId);
        break;
      }

      // ── Revive an archived conversation (costs 3 links) ───────────────────
      case "REVIVE_CONVERSATION": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;

        const convRow = await db.prepare("SELECT * FROM conversations WHERE id = ?").bind(convId).first<any>();
        if (!convRow) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Conversation not found" })); return; }

        const isParticipant =
          convRow.participant_1.toLowerCase() === authedUser ||
          convRow.participant_2.toLowerCase() === authedUser;
        if (!isParticipant) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Unauthorized" })); return; }
        if (!convRow.archived) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Conversation is not archived" })); return; }

        const REVIVE_COST = 3;
        const userRow = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(authedUser).first<any>();
        if (!userRow || userRow.links < REVIVE_COST) {
          ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: `Not enough links — need ${REVIVE_COST}` }));
          return;
        }

        await db.batch([
          db.prepare("UPDATE users SET links = links - ? WHERE LOWER(username) = ?").bind(REVIVE_COST, authedUser),
          // Keep archived_at — it marks the snapshot boundary (messages before it are the previous round)
          db.prepare(
            "UPDATE conversations SET archived = 0, phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?"
          ).bind(convId),
        ]);

        const updatedUser = await db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(authedUser).first<any>();
        ws.send(JSON.stringify({ type: "REVIVE_SUCCESS", conversationId: convId, links: updatedUser?.links ?? 0 }));
        await Promise.all([
          this.syncUser(convRow.participant_1),
          this.syncUser(convRow.participant_2),
        ]);
        break;
      }

      // ── Request to end (save) chat ────────────────────────────────────────
      case "END_CHAT_REQUEST": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;

        const conv = await db
          .prepare("SELECT * FROM conversations WHERE id = ?")
          .bind(convId)
          .first<any>();
        if (!conv) return;

        const partner =
          conv.participant_1.toLowerCase() === authedUser
            ? conv.participant_2.toLowerCase()
            : conv.participant_1.toLowerCase();

        const partnerWs = this.clients.get(partner);
        if (partnerWs?.readyState === WebSocket.OPEN) {
          partnerWs.send(JSON.stringify({ type: "END_CHAT_REQUEST_BROADCAST", conversationId: convId, from: authedUser }));
        } else {
          const userRow = await db
            .prepare("SELECT nickname FROM users WHERE LOWER(username) = ?")
            .bind(authedUser)
            .first<any>();
          await this.push(
            partner,
            `${userRow?.nickname || authedUser} wants to save your conversation`,
            "Tap to review and save before the timer runs out.",
            { conversationId: convId, requestSave: true }
          );
        }
        break;
      }

      // ── Confirm end (save) chat ───────────────────────────────────────────
      case "END_CHAT_CONFIRM": {
        if (!authedUser) return;
        const convId = parseInt(data.conversationId, 10);
        if (isNaN(convId)) return;

        const conv = await db
          .prepare("SELECT * FROM conversations WHERE id = ?")
          .bind(convId)
          .first<any>();
        if (!conv) return;

        const countRow = await db
          .prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?")
          .bind(convId)
          .first<any>();
        const finalCount = countRow?.count || 0;
        const finalReward = Math.max(1, Math.ceil(Math.log(finalCount || 1) / Math.log(1.2)));

        const p1 = conv.participant_1.toLowerCase();
        const p2 = conv.participant_2.toLowerCase();

        await db.batch([
          db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(finalReward, p1),
          db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").bind(finalReward, p2),
          db.prepare("UPDATE conversations SET saved = 1 WHERE id = ?").bind(convId),
          db.prepare("DELETE FROM timers WHERE conversation_id = ?").bind(convId),
        ]);

        const [u1, u2] = await Promise.all([
          db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(p1).first<any>(),
          db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").bind(p2).first<any>(),
        ]);

        const savePayload = JSON.stringify({ type: "CONVERSATION_SAVED_SUCCESS", conversationId: convId, finalReward });
        [[this.clients.get(p1), u1], [this.clients.get(p2), u2]].forEach(([sock, u]) => {
          const s = sock as WebSocket | undefined;
          if (s?.readyState === WebSocket.OPEN) {
            s.send(savePayload);
            s.send(JSON.stringify({ type: "LINKS_EARNED", amount: finalReward, reason: "Conversation saved successfully", links: (u as any)?.links }));
          }
        });

        await Promise.all([this.syncUser(p1), this.syncUser(p2)]);
        break;
      }

      // ── Presence broadcast ────────────────────────────────────────────────
      case "PRESENCE_UPDATE": {
        const payload = JSON.stringify({
          type: "PRESENCE_BROADCAST",
          username: data.username || null,
          status: data.status,
        });
        this.broadcastAll(payload);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private broadcastAll(payload: string): void {
    for (const [, sock] of this.clients) {
      if (sock.readyState === WebSocket.OPEN) sock.send(payload);
    }
  }

  private async syncUser(username: string): Promise<void> {
    const uLower = username.toLowerCase();
    const db = this.env.DB;

    const { results: friendships } = await db
      .prepare(
        "SELECT * FROM friendships WHERE LOWER(requester_username) = ? OR LOWER(receiver_username) = ?"
      )
      .bind(uLower, uLower)
      .all<any>();

    const contactNames = new Set<string>();
    friendships.forEach((f) => {
      contactNames.add(f.requester_username.toLowerCase());
      contactNames.add(f.receiver_username.toLowerCase());
    });

    let usersMap: Record<string, any> = {};
    if (contactNames.size > 0) {
      const placeholders = Array.from(contactNames).map(() => "?").join(",");
      const { results: list } = await db
        .prepare(
          `SELECT username, nickname, links, linker_avatar, linker_color FROM users WHERE LOWER(username) IN (${placeholders})`
        )
        .bind(...Array.from(contactNames))
        .all<any>();
      list.forEach((u) => {
        usersMap[u.username.toLowerCase()] = {
          nickname: u.nickname,
          links: u.links,
          linker_avatar: u.linker_avatar || "👾",
          linker_color: u.linker_color || "pink",
        };
      });
    }

    const { results: allUsers } = await db
      .prepare(
        "SELECT username, nickname, links, linker_avatar, linker_color FROM users WHERE LOWER(username) != ? ORDER BY links DESC"
      )
      .bind(uLower)
      .all<any>();

    const discoverUsers = allUsers
      .filter((u) => {
        return !friendships.some(
          (f) =>
            (f.requester_username.toLowerCase() === uLower && f.receiver_username.toLowerCase() === u.username.toLowerCase()) ||
            (f.receiver_username.toLowerCase() === uLower && f.requester_username.toLowerCase() === u.username.toLowerCase())
        );
      })
      .slice(0, 15);

    const { results: conversations } = await db
      .prepare("SELECT * FROM conversations WHERE LOWER(participant_1) = ? OR LOWER(participant_2) = ?")
      .bind(uLower, uLower)
      .all<any>();

    const { results: timers } = await db
      .prepare(
        `SELECT t.* FROM timers t
         JOIN conversations c ON t.conversation_id = c.id
         WHERE LOWER(c.participant_1) = ? OR LOWER(c.participant_2) = ?`
      )
      .bind(uLower, uLower)
      .all<any>();

    const sock = this.clients.get(uLower);
    if (sock?.readyState === WebSocket.OPEN) {
      sock.send(
        JSON.stringify({
          type: "FRIEND_UPDATE",
          friendships,
          users: usersMap,
          conversations,
          discoverUsers,
          timers: timers.map((t) => ({
            conversation_id: t.conversation_id,
            timer_type: t.timer_type,
            started_at:
              typeof t.started_at === "number"
                ? t.started_at
                : new Date(t.started_at).getTime(),
            duration_ms: t.duration_ms,
          })),
        })
      );
    }
  }

  private async push(
    username: string,
    title: string,
    body: string,
    extraData: any = {}
  ): Promise<void> {
    if (!this.vapidReady) return;
    try {
      const row = await this.env.DB.prepare(
        "SELECT push_subscription FROM users WHERE LOWER(username) = ?"
      )
        .bind(username.toLowerCase())
        .first<any>();
      if (row?.push_subscription) {
        const sub = JSON.parse(row.push_subscription);
        await webpush.sendNotification(sub, JSON.stringify({ title, body, data: extraData }));
      }
    } catch (e) {
      console.error(`[ChatRoom] push error for ${username}:`, e);
    }
  }

  // Archive a chat on explosion: wipe messages + timers, mark archived=1 so it can be revived.
  // Broadcasts CHAT_DELETED (triggers explosion animation on clients). Idempotent.
  private async archiveChat(convId: number): Promise<void> {
    const db = this.env.DB;
    const convRow = await db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .bind(convId)
      .first<any>();
    if (!convRow) return;

    const now = Date.now();
    await db.batch([
      // Keep messages as archive snapshots (mark expired but do NOT delete)
      db.prepare("UPDATE messages SET expired = 1 WHERE conversation_id = ?").bind(convId),
      db.prepare("DELETE FROM timers WHERE conversation_id = ?").bind(convId),
      db
        .prepare("UPDATE conversations SET archived = 1, archived_at = ?, phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?")
        .bind(now, convId),
    ]);

    const payload = JSON.stringify({ type: "CHAT_DELETED", conversationId: convId });
    for (const username of [convRow.participant_1, convRow.participant_2]) {
      const sock = this.clients.get(username.toLowerCase());
      if (sock?.readyState === WebSocket.OPEN) sock.send(payload);
    }
    await Promise.all([
      this.syncUser(convRow.participant_1),
      this.syncUser(convRow.participant_2),
    ]);
  }

  // Replaces setInterval(checkTimers, 5000) — invoked via Durable Object alarm
  private async checkTimers(): Promise<void> {
    const db = this.env.DB;
    const { results: activeTimers } = await db
      .prepare("SELECT * FROM timers")
      .all<any>();
    const now = Date.now();

    for (const timer of activeTimers) {
      const startMs = new Date(timer.started_at).getTime();
      const remainingMs = timer.duration_ms - (now - startMs);
      const convId = timer.conversation_id;

      const conv = await db
        .prepare("SELECT * FROM conversations WHERE id = ?")
        .bind(convId)
        .first<any>();
      if (!conv) continue;

      if (remainingMs <= 0) {
        if (timer.timer_type === "normal") {
          // A normal message went unanswered → the entire chat is permanently deleted.
          await this.archiveChat(convId);
        } else {
          // An opener went unanswered → expire it and reset to the opener phase so
          // either participant may try a fresh opener. The chat is NOT deleted.
          await db.batch([
            db.prepare("UPDATE messages SET expired = 1 WHERE conversation_id = ? AND expired = 0").bind(convId),
            db.prepare("DELETE FROM timers WHERE id = ?").bind(timer.id),
            db
              .prepare("UPDATE conversations SET phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?")
              .bind(convId),
          ]);
          await Promise.all([
            this.syncUser(conv.participant_1),
            this.syncUser(conv.participant_2),
          ]);
        }
        continue;
      }

      if (remainingMs <= 60_000) {
        const timerKey = `${timer.id}_60s`;
        if (!this.notified60sTimers.has(timerKey)) {
          this.notified60sTimers.add(timerKey);
          const lastMsg = await db
            .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC LIMIT 1")
            .bind(convId)
            .first<any>();
          if (lastMsg) {
            const receiver = lastMsg.receiver.toLowerCase();
            const recvWs = this.clients.get(receiver);
            if (!recvWs || recvWs.readyState !== WebSocket.OPEN) {
              await this.push(
                receiver,
                "Your conversation is expiring soon",
                "You have 60 seconds to save your conversation before it's gone.",
                { conversationId: convId, warning60s: true }
              );
            } else {
              recvWs.send(JSON.stringify({ type: "SAVE_TIMER_WARNING", conversationId: convId }));
            }
          }
        }
      }
    }
  }
}
