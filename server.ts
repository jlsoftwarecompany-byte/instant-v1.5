import express from "express";
import path from "path";
import fs from "fs";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import Database from "better-sqlite3";
import webpush from "web-push";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import crypto from "crypto";

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const app = express();
app.use(express.json());

// Initialize SQLite database
const db = new Database("instant.db");

// Set WAL mode for better concurrency
db.pragma("journal_mode = WAL");

// Database initialization conforming exactly to requirements
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    push_subscription TEXT,
    links INTEGER DEFAULT 0,
    linker_avatar TEXT DEFAULT '👾',
    linker_color TEXT DEFAULT 'pink',
    password_hash TEXT,
    session_token TEXT,
    session_expires_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_username TEXT NOT NULL,
    receiver_username TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_1 TEXT NOT NULL,
    participant_2 TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    conversation_started BOOLEAN DEFAULT 0,
    saved BOOLEAN DEFAULT 0,
    phase TEXT DEFAULT 'awaiting_response',
    opener_initiator TEXT,
    opener_timer_choice INTEGER
  );

  CREATE TABLE IF NOT EXISTS timers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    timer_type TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    duration_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    content TEXT NOT NULL,
    sent_at INTEGER NOT NULL,
    timer_duration INTEGER NOT NULL,
    expired BOOLEAN DEFAULT 0,
    is_photo BOOLEAN DEFAULT 0,
    message_type TEXT DEFAULT 'normal',
    is_responded_to INTEGER DEFAULT 0
  );
`);

// Safe ALTER TABLE for future compatibility
try {
  db.exec("ALTER TABLE users ADD COLUMN push_subscription TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN linker_avatar TEXT DEFAULT '👾'");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN linker_color TEXT DEFAULT 'pink'");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN session_token TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE users ADD COLUMN session_expires_at DATETIME");
} catch (e) {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN seen BOOLEAN DEFAULT 0");
} catch (e) {}
// Two-phase opener/normal economy (Prompt 1)
try {
  db.exec("ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'normal'");
} catch (e) {}
try {
  db.exec("ALTER TABLE messages ADD COLUMN is_responded_to INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE conversations ADD COLUMN phase TEXT DEFAULT 'awaiting_response'");
} catch (e) {}
try {
  db.exec("ALTER TABLE conversations ADD COLUMN opener_initiator TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE conversations ADD COLUMN opener_timer_choice INTEGER");
} catch (e) {}
// v1.7 — Archive & Revival
try {
  db.exec("ALTER TABLE conversations ADD COLUMN archived INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE conversations ADD COLUMN archived_at INTEGER");
} catch (e) {}
// v1.8 — Link reward message cap (combined messages per conversation)
try {
  db.exec("ALTER TABLE conversations ADD COLUMN message_count INTEGER DEFAULT 0");
} catch (e) {}

// Web Push setup
let vapidPublic = process.env.VAPID_PUBLIC_KEY || "";
let vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";

if (!vapidPublic || !vapidPrivate) {
  try {
    const keys = webpush.generateVAPIDKeys();
    vapidPublic = keys.publicKey;
    vapidPrivate = keys.privateKey;
    console.log("Dynamically generated VAPID keys for this session.");
  } catch (err) {
    console.error("VAPID Key generation error:", err);
  }
}

if (vapidPublic && vapidPrivate) {
  try {
    webpush.setVapidDetails(
      "mailto:jl.software.company@gmail.com",
      vapidPublic,
      vapidPrivate
    );
  } catch (err) {
    console.error("Set VAPID details error:", err);
  }
}

// Track active WebSocket connections: username -> WebSocket client instance
const clients = new Map<string, WebSocket>();

// In-memory set of notified 60s expirations to avoid multiple push triggers
const notified60sTimers = new Set<string>();

// Rate limiting track failed login attempts per username: { count: number, lockedUntil: number }
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

// Endpoint to fetch public VAPID key
app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: vapidPublic });
});

// Endpoint to save subscription via POST
app.post("/api/save-subscription", (req, res) => {
  const { username, subscription } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username required" });
  }
  try {
    const subJSON = subscription ? JSON.stringify(subscription) : null;
    const stmt = db.prepare("UPDATE users SET push_subscription = ? WHERE LOWER(username) = ?");
    stmt.run(subJSON, username.toLowerCase());
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Create HTTP server
const httpServer = createServer(app);

// Integrate WebSocket server
const wss = new WebSocketServer({ server: httpServer, maxPayload: 5 * 1024 * 1024 });

// ─── v1.5 Strategic Upgrade Layer ──────────────────────────────────────────
// JWT auth, conversation privacy modes, media w/ signed URLs, circles,
// stories, analytics. Additive: legacy v1.4 endpoints and WS frames are
// completely untouched.
import { installV15 } from "./server/v15";
installV15(app, wss, db);

// Presence rebroadcast for Live Presence (Strategic Plan §4)
wss.on("connection", (socket: any) => {
  socket.on("message", (raw: any) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data?.type === "PRESENCE_UPDATE") {
        const payload = JSON.stringify({
          type: "PRESENCE_BROADCAST",
          username: data.username || null,
          status: data.status,
        });
        for (const [, client] of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(payload);
        }
      }
    } catch { /* ignore non-JSON frames */ }
  });
});


// Send web push helper
async function sendPushNotification(username: string, title: string, body: string, data: any = {}) {
  try {
    const row = db.prepare("SELECT push_subscription FROM users WHERE LOWER(username) = ?").get(username.toLowerCase()) as { push_subscription?: string | null } | undefined;
    if (row && row.push_subscription) {
      const sub = JSON.parse(row.push_subscription);
      await webpush.sendNotification(
        sub,
        JSON.stringify({ title, body, data })
      );
      console.log(`Push notification sent to ${username}`);
    }
  } catch (err) {
    console.error(`Failed to send push notification to ${username}:`, err);
  }
}

// Broadcast nickname update to all
function broadcastNicknameUpdate(username: string, nickname: string) {
  const payload = JSON.stringify({
    type: "NICKNAME_UPDATED",
    username: username.toLowerCase(),
    nickname
  });
  for (const [_, client] of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Helper to push state changes to friends
function broadcastFriendUpdateForUser(username: string) {
  const uLower = username.toLowerCase();
  
  // Find friendships
  const friendships = db.prepare(`
    SELECT * FROM friendships 
    WHERE LOWER(requester_username) = ? OR LOWER(receiver_username) = ?
  `).all(uLower, uLower) as any[];

  // Gather usernames we interact with
  const contactNames = new Set<string>();
  friendships.forEach(f => {
    contactNames.add(f.requester_username.toLowerCase());
    contactNames.add(f.receiver_username.toLowerCase());
  });

  // Fetch nickname / status mapping
  const usersMap: Record<string, { nickname: string, links: number, linker_avatar?: string, linker_color?: string }> = {};
  if (contactNames.size > 0) {
    const placeholders = Array.from(contactNames).map(() => "?").join(",");
    const list = db.prepare(`SELECT username, nickname, links, linker_avatar, linker_color FROM users WHERE LOWER(username) IN (${placeholders})`).all(...Array.from(contactNames)) as any[];
    list.forEach(u => {
      usersMap[u.username.toLowerCase()] = { 
        nickname: u.nickname, 
        links: u.links,
        linker_avatar: u.linker_avatar || '👾',
        linker_color: u.linker_color || 'pink'
      };
    });
  }

  // Fetch discoverable users (other users on the app who aren't currently friends or waiting on requests)
  const allFilteredUsers = db.prepare(`
    SELECT username, nickname, links, linker_avatar, linker_color FROM users
    WHERE LOWER(username) != ?
    ORDER BY links DESC
  `).all(uLower) as any[];

  const discoverUsers = allFilteredUsers.filter(u => {
    const isFriend = friendships.some(f => 
      (f.requester_username.toLowerCase() === uLower && f.receiver_username.toLowerCase() === u.username.toLowerCase()) ||
      (f.receiver_username.toLowerCase() === uLower && f.requester_username.toLowerCase() === u.username.toLowerCase())
    );
    return !isFriend;
  }).slice(0, 15);

  // Find active conversations
  const conversations = db.prepare(`
    SELECT * FROM conversations 
    WHERE (LOWER(participant_1) = ? OR LOWER(participant_2) = ?)
  `).all(uLower, uLower) as any[];

  // Find all active timers
  const timers = db.prepare(`
    SELECT t.* FROM timers t
    JOIN conversations c ON t.conversation_id = c.id
    WHERE LOWER(c.participant_1) = ? OR LOWER(c.participant_2) = ?
  `).all(uLower, uLower) as any[];

  // Send update directly to this user if online
  const socket = clients.get(uLower);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "FRIEND_UPDATE",
      friendships,
      users: usersMap,
      conversations,
      discoverUsers,
      timers: timers.map(t => ({
        conversation_id: t.conversation_id,
        timer_type: t.timer_type,
        started_at: typeof t.started_at === "number" ? t.started_at : new Date(t.started_at).getTime(),
        duration_ms: t.duration_ms
      }))
    }));
  }
}

function syncUserFullData(username: string) {
  broadcastFriendUpdateForUser(username);
}

// ─── Two-phase opener/normal economy (Prompt 1) ─────────────────────────────
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

// Archive a chat on explosion: wipe messages + timers, mark archived=1 so it can be revived.
// Broadcasts CHAT_DELETED (triggers explosion animation on clients). Idempotent.
function archiveChat(convId: number) {
  const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
  if (!convRow) return;

  const now = Date.now();
  // Keep messages as archive snapshots (mark expired but do NOT delete)
  db.prepare("UPDATE messages SET expired = 1 WHERE conversation_id = ?").run(convId);
  db.prepare("DELETE FROM timers WHERE conversation_id = ?").run(convId);
  db.prepare(
    "UPDATE conversations SET archived = 1, archived_at = ?, phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?"
  ).run(now, convId);

  const payload = JSON.stringify({ type: "CHAT_DELETED", conversationId: convId });
  for (const username of [convRow.participant_1, convRow.participant_2]) {
    const sock = clients.get(username.toLowerCase());
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(payload);
  }
  syncUserFullData(convRow.participant_1);
  syncUserFullData(convRow.participant_2);
}

// WS Connection main routing
wss.on("connection", (ws) => {
  let authenticatedUser: string | null = null;

  // Track connection heartbeats
  let isAlive = true;
  ws.on("pong", () => {
    isAlive = true;
  });

  ws.on("message", async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      const { type } = data;

      switch (type) {
        case "AUTH_REGISTER": {
          const regUsername = (data.username || "").toLowerCase().trim();
          const regNickname = (data.nickname || "").trim();
          const regPassword = data.password;

          if (!regUsername || !regNickname || !regPassword) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username, Nickname, and Password are required" }));
            return;
          }

          const usernameRegex = /^[a-zA-Z0-9_]+$/;
          if (regUsername.length > 20 || !usernameRegex.test(regUsername)) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Invalid username format" }));
            return;
          }

          if (regNickname.length < 1 || regNickname.length > 30) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Nickname must be between 1 and 30 characters" }));
            return;
          }

          if (regPassword.length < 8) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Password must be at least 8 characters long" }));
            return;
          }

          const exists = db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").get(regUsername);
          if (exists) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username already taken" }));
            return;
          }

          try {
            const passwordHash = await bcrypt.hash(regPassword, 12);
            const sessionToken = crypto.randomUUID();
            const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            const insert = db.prepare(`
              INSERT INTO users (username, nickname, links, linker_avatar, linker_color, password_hash, session_token, session_expires_at) 
              VALUES (?, ?, 0, '👾', 'pink', ?, ?, ?)
            `);
            const info = insert.run(regUsername, regNickname, passwordHash, sessionToken, sessionExpiresAt);
            
            const user = {
              id: info.lastInsertRowid as number,
              username: regUsername,
              nickname: regNickname,
              links: 0,
              created_at: new Date().toISOString(),
              linker_avatar: '👾',
              linker_color: 'pink',
              session_token: sessionToken,
              session_expires_at: sessionExpiresAt
            };

            authenticatedUser = regUsername;
            clients.set(regUsername, ws);

            ws.send(JSON.stringify({
              type: "AUTH_SUCCESS",
              user,
              sessionToken
            }));

            syncUserFullData(regUsername);
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: err.message || "Registration failed" }));
          }
          break;
        }

        case "AUTH_LOGIN": {
          const loginUsername = (data.username || "").toLowerCase().trim();
          const loginPassword = data.password;

          if (!loginUsername || !loginPassword) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Username and Password are required" }));
            return;
          }

          const failureRecord = loginFailures.get(loginUsername);
          const nowMs = Date.now();
          if (failureRecord && failureRecord.count >= 5 && failureRecord.lockedUntil > nowMs) {
            const timeLeft = Math.ceil((failureRecord.lockedUntil - nowMs) / 1000);
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: `Rate limited. Try again in ${timeLeft}s` }));
            return;
          }

          const userRow = db.prepare("SELECT * FROM users WHERE LOWER(username) = ?").get(loginUsername) as any;
          if (!userRow) {
            const record = failureRecord && failureRecord.lockedUntil <= nowMs ? { count: 0, lockedUntil: 0 } : (failureRecord || { count: 0, lockedUntil: 0 });
            record.count += 1;
            if (record.count >= 5) {
              record.lockedUntil = nowMs + 30 * 1000;
            }
            loginFailures.set(loginUsername, record);

            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "@username not found" }));
            return;
          }

          if (!userRow.password_hash) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Incorrect password" }));
            return;
          }

          try {
            const match = await bcrypt.compare(loginPassword, userRow.password_hash);
            if (!match) {
              const record = failureRecord && failureRecord.lockedUntil <= nowMs ? { count: 0, lockedUntil: 0 } : (failureRecord || { count: 0, lockedUntil: 0 });
              record.count += 1;
              if (record.count >= 5) {
                record.lockedUntil = nowMs + 30 * 1000;
              }
              loginFailures.set(loginUsername, record);

              ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: "Incorrect password" }));
              return;
            }

            loginFailures.delete(loginUsername);

            const sessionToken = crypto.randomUUID();
            const sessionExpiresAt = new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString();

            db.prepare("UPDATE users SET session_token = ?, session_expires_at = ? WHERE LOWER(username) = ?")
              .run(sessionToken, sessionExpiresAt, loginUsername);

            const user = {
              id: userRow.id,
              username: userRow.username,
              nickname: userRow.nickname,
              links: userRow.links,
              created_at: userRow.created_at,
              linker_avatar: userRow.linker_avatar || '👾',
              linker_color: userRow.linker_color || 'pink',
              session_token: sessionToken,
              session_expires_at: sessionExpiresAt
            };

            authenticatedUser = userRow.username.toLowerCase();
            clients.set(authenticatedUser, ws);

            ws.send(JSON.stringify({
              type: "AUTH_SUCCESS",
              user,
              sessionToken
            }));

            syncUserFullData(authenticatedUser);
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "AUTH_FAILURE", reason: err.message || "Login failed" }));
          }
          break;
        }

        case "AUTH_LOGOUT": {
          const sessionToken = data.sessionToken;
          if (sessionToken) {
            db.prepare("UPDATE users SET session_token = NULL, session_expires_at = NULL WHERE session_token = ?")
              .run(sessionToken);
          }
          ws.send(JSON.stringify({ type: "AUTH_LOGOUT_SUCCESS" }));
          break;
        }

        case "AUTH_VERIFY_SESSION": {
          const verifyUsername = (data.username || "").toLowerCase().trim();
          const verifyToken = data.sessionToken;

          if (!verifyUsername || !verifyToken) {
            ws.send(JSON.stringify({ type: "AUTH_SESSION_EXPIRED" }));
            return;
          }

          const userRow = db.prepare("SELECT * FROM users WHERE LOWER(username) = ? AND session_token = ?").get(verifyUsername, verifyToken) as any;
          if (userRow) {
            const expiry = userRow.session_expires_at ? new Date(userRow.session_expires_at).getTime() : 0;
            if (expiry > Date.now()) {
              authenticatedUser = userRow.username.toLowerCase();
              clients.set(authenticatedUser, ws);

              ws.send(JSON.stringify({
                type: "AUTH_SUCCESS",
                user: {
                  id: userRow.id,
                  username: userRow.username,
                  nickname: userRow.nickname,
                  links: userRow.links,
                  created_at: userRow.created_at,
                  linker_avatar: userRow.linker_avatar || '👾',
                  linker_color: userRow.linker_color || 'pink',
                  session_token: userRow.session_token,
                  session_expires_at: userRow.session_expires_at
                },
                sessionToken: verifyToken
              }));

              syncUserFullData(authenticatedUser);
              break;
            }
          }

          ws.send(JSON.stringify({ type: "AUTH_SESSION_EXPIRED" }));
          break;
        }

        case "CHECK_USERNAME": {
          const checkUsername = (data.username || "").toLowerCase().trim();
          const exists = db.prepare("SELECT id FROM users WHERE LOWER(username) = ?").get(checkUsername);
          ws.send(JSON.stringify({
            type: "CHECK_USERNAME_RESPONSE",
            username: checkUsername,
            available: !exists
          }));
          break;
        }

        case "REGISTER_USER": {
          const regUsername = (data.username || "").toLowerCase().trim();
          const regNickname = (data.nickname || "").trim();

          if (!regUsername || !regNickname) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Username and Nickname are required" }));
            return;
          }

          // Validate constraints
          const usernameRegex = /^[a-zA-Z0-9_]+$/;
          if (regUsername.length > 20 || !usernameRegex.test(regUsername)) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Invalid username format" }));
            return;
          }

          if (regNickname.length < 1 || regNickname.length > 30) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Nickname must be between 1 and 30 characters" }));
            return;
          }

          try {
            const insert = db.prepare("INSERT INTO users (username, nickname, links, linker_avatar, linker_color) VALUES (?, ?, 0, '👾', 'pink')");
            const info = insert.run(regUsername, regNickname);
            const user = {
              id: info.lastInsertRowid as number,
              username: regUsername,
              nickname: regNickname,
              links: 0,
              created_at: new Date().toISOString(),
              linker_avatar: '👾',
              linker_color: 'pink'
            };

            // Authenticate of course
            authenticatedUser = regUsername;
            clients.set(regUsername, ws);

            ws.send(JSON.stringify({
              type: "REGISTER_SUCCESS",
              user
            }));

            // Sync user details
            syncUserFullData(regUsername);
          } catch (err: any) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Username is already taken" }));
          }
          break;
        }

        case "VERIFY_USER": {
          const authUser = (data.username || "").toLowerCase().trim();
          const userRow = db.prepare("SELECT * FROM users WHERE LOWER(username) = ?").get(authUser) as any;
          if (userRow) {
            authenticatedUser = userRow.username.toLowerCase();
            clients.set(authenticatedUser, ws);
            ws.send(JSON.stringify({
              type: "VERIFY_USER_RESPONSE",
              success: true,
              user: {
                id: userRow.id,
                username: userRow.username,
                nickname: userRow.nickname,
                links: userRow.links,
                created_at: userRow.created_at,
                linker_avatar: userRow.linker_avatar || '👾',
                linker_color: userRow.linker_color || 'pink'
              }
            }));

            // Push fresh updates
            syncUserFullData(authenticatedUser);
          } else {
            ws.send(JSON.stringify({
              type: "VERIFY_USER_RESPONSE",
              success: false
            }));
          }
          break;
        }

        case "LINKER_UPDATE": {
          if (!authenticatedUser) return;
          const avatar = (data.avatar || "").trim();
          const color = (data.color || "").trim();
          if (avatar) {
            db.prepare("UPDATE users SET linker_avatar = ? WHERE LOWER(username) = ?").run(avatar, authenticatedUser);
          }
          if (color) {
            db.prepare("UPDATE users SET linker_color = ? WHERE LOWER(username) = ?").run(color, authenticatedUser);
          }
          // Refresh of course
          syncUserFullData(authenticatedUser);
          break;
        }

        case "NICKNAME_UPDATE": {
          if (!authenticatedUser) return;
          const newNick = (data.nickname || "").trim();
          if (newNick.length >= 1 && newNick.length <= 30) {
            db.prepare("UPDATE users SET nickname = ? WHERE LOWER(username) = ?").run(newNick, authenticatedUser);
            broadcastNicknameUpdate(authenticatedUser, newNick);
            // Refresh
            syncUserFullData(authenticatedUser);
          }
          break;
        }

        case "FRIEND_REQUEST": {
          if (!authenticatedUser) return;
          const target = (data.receiverUsername || "").toLowerCase().trim();

          if (target === authenticatedUser) {
            ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "You cannot add yourself" }));
            return;
          }

          // Validate target exists
          const targetRow = db.prepare("SELECT username, nickname FROM users WHERE LOWER(username) = ?").get(target) as any;
          if (!targetRow) {
            ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "@username not found" }));
            return;
          }

          // See if friendship already exists
          const existing = db.prepare(`
            SELECT * FROM friendships 
            WHERE (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)
               OR (LOWER(requester_username) = ? AND LOWER(receiver_username) = ?)
          `).get(authenticatedUser, target, target, authenticatedUser) as any;

          if (existing) {
            if (existing.status === "accepted") {
              ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "Already friends" }));
            } else {
              ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: false, error: "Request already sent" }));
            }
            return;
          }

          // Create friendship row
          db.prepare("INSERT INTO friendships (requester_username, receiver_username, status) VALUES (?, ?, 'pending')").run(authenticatedUser, target);

          ws.send(JSON.stringify({ type: "FRIEND_REQUEST_RESPONSE", success: true }));

          // Real-time notification if target is online
          const targetSocket = clients.get(target);
          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({
              type: "FRIEND_REQUEST_NOTIFICATION",
              from: authenticatedUser
            }));
          } else {
            // Send push notification to offline user
            const senderRow = db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any;
            await sendPushNotification(
              target,
              "New Friend Request",
              `@${authenticatedUser} (${senderRow?.nickname || authenticatedUser}) sent you a friend request.`
            );
          }

          // Sync database state to clients
          syncUserFullData(authenticatedUser);
          syncUserFullData(target);
          break;
        }

        case "FRIEND_ACCEPT": {
          if (!authenticatedUser) return;
          const reqUser = (data.requesterUsername || "").toLowerCase().trim();

          db.prepare(`
            UPDATE friendships 
            SET status = 'accepted' 
            WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?
          `).run(reqUser, authenticatedUser);

          // Connect them up in conversations if not exists
          const convExists = db.prepare(`
            SELECT id FROM conversations 
            WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
               OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
          `).get(reqUser, authenticatedUser, authenticatedUser, reqUser);

          if (!convExists) {
            db.prepare(`
              INSERT INTO conversations (participant_1, participant_2, started_at, conversation_started, saved)
              VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0)
            `).run(reqUser, authenticatedUser);
          }

          syncUserFullData(authenticatedUser);
          syncUserFullData(reqUser);
          break;
        }

        case "FRIEND_DECLINE": {
          if (!authenticatedUser) return;
          const reqUser = (data.requesterUsername || "").toLowerCase().trim();

          db.prepare(`
            DELETE FROM friendships 
            WHERE LOWER(requester_username) = ? AND LOWER(receiver_username) = ?
          `).run(reqUser, authenticatedUser);

          syncUserFullData(authenticatedUser);
          syncUserFullData(reqUser);
          break;
        }

        case "READ_CONVERSATION": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
          if (convRow && convRow.conversation_started === 0) {
            // Check if user is receiver
            const isReceiver = convRow.participant_2.toLowerCase() === authenticatedUser;
            if (isReceiver) {
              db.prepare("UPDATE conversations SET conversation_started = 1 WHERE id = ?").run(convId);
              
              // Trigger 1 Reward: max(1, ceil(log_1.2(1))) = 1 link
              const grantStmt = db.prepare("UPDATE users SET links = links + 1 WHERE LOWER(username) = ?");
              grantStmt.run(convRow.participant_1.toLowerCase());
              grantStmt.run(convRow.participant_2.toLowerCase());

              // Get fresh links
              const u1Row = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(convRow.participant_1.toLowerCase()) as any;
              const u2Row = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(convRow.participant_2.toLowerCase()) as any;

              // Emit update events
              const socket1 = clients.get(convRow.participant_1.toLowerCase());
              const socket2 = clients.get(convRow.participant_2.toLowerCase());

              const payload1 = JSON.stringify({
                type: "LINKS_EARNED",
                amount: 1,
                reason: "Conversation opened",
                links: u1Row.links
              });
              const payload2 = JSON.stringify({
                type: "LINKS_EARNED",
                amount: 1,
                reason: "Conversation opened",
                links: u2Row.links
              });

              if (socket1 && socket1.readyState === WebSocket.OPEN) socket1.send(payload1);
              if (socket2 && socket2.readyState === WebSocket.OPEN) socket2.send(payload2);

              // Broadcast STARTED
              const startedPayload = JSON.stringify({ type: "CONVERSATION_STARTED", conversationId: convId });
              if (socket1 && socket1.readyState === WebSocket.OPEN) socket1.send(startedPayload);
              if (socket2 && socket2.readyState === WebSocket.OPEN) socket2.send(startedPayload);

              syncUserFullData(convRow.participant_1);
              syncUserFullData(convRow.participant_2);
            }
          }
          break;
        }

        case "CHAT_MESSAGE": {
          if (!authenticatedUser) return;
          const { to, content, sentAt, timerDuration, isPhoto } = data;
          const target = (to || "").toLowerCase().trim();

          const conv = db.prepare(`
            SELECT * FROM conversations
            WHERE (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
               OR (LOWER(participant_1) = ? AND LOWER(participant_2) = ?)
          `).get(authenticatedUser, target, target, authenticatedUser) as any;

          if (!conv) {
            ws.send(JSON.stringify({ type: "ERROR", message: "Conversation not found" }));
            return;
          }

          const convId = conv.id;
          const phase: string = conv.phase || "awaiting_response";
          const initiator: string | null = conv.opener_initiator ? conv.opener_initiator.toLowerCase() : null;

          // Decide what kind of message this is from the current phase.
          // - awaiting_response + no outstanding opener  → this is the OPENER
          // - awaiting_response + I am the initiator       → blocked (no 2nd opener)
          // - awaiting_response + I am the responder       → opener RESPONSE (→ active)
          // - active                                       → NORMAL message
          let messageType: "opener" | "normal" = "normal";
          let isOpenerResponse = false;

          if (phase === "awaiting_response") {
            if (!initiator) {
              messageType = "opener";
            } else if (initiator === authenticatedUser) {
              ws.send(JSON.stringify({ type: "ERROR", message: "Wait for a response before sending another opener." }));
              return;
            } else {
              isOpenerResponse = true;
            }
          }

          // Validate the chosen timer for the message kind.
          const duration = messageType === "opener"
            ? (OPENER_DURATIONS[timerDuration] ? timerDuration : 600000)
            : (NORMAL_DURATIONS.has(timerDuration) ? timerDuration : 60000);

          // Save the message.
          const msgInfo = db.prepare(`
            INSERT INTO messages (conversation_id, sender, receiver, content, sent_at, timer_duration, expired, is_photo, message_type, is_responded_to)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
          `).run(convId, authenticatedUser, target, content || "", sentAt, duration, isPhoto ? 1 : 0, messageType);

          const savedMsg = {
            id: msgInfo.lastInsertRowid as number,
            conversation_id: convId,
            sender: authenticatedUser,
            receiver: target,
            content: content || "",
            sent_at: sentAt,
            timer_duration: duration,
            expired: 0,
            is_photo: isPhoto ? 1 : 0,
            seen: false,
            message_type: messageType,
            is_responded_to: 0
          };

          let earnedLinks = 0;
          let newPhase = phase;
          let newInitiator = initiator;
          let newTimerChoice: number | null = conv.opener_timer_choice ?? null;

          db.prepare("DELETE FROM timers WHERE conversation_id = ?").run(convId);

          // Always increment the combined message count for the 10-message reward cap.
          db.prepare("UPDATE conversations SET message_count = message_count + 1 WHERE id = ?").run(convId);

          if (messageType === "opener") {
            // Register the opener and start its (long) timer.
            db.prepare(
              "UPDATE conversations SET phase = 'awaiting_response', opener_initiator = ?, opener_timer_choice = ? WHERE id = ?"
            ).run(authenticatedUser, duration, convId);
            db.prepare(
              "INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'opener', ?, ?)"
            ).run(convId, new Date(sentAt).toISOString(), duration);
            newPhase = "awaiting_response";
            newInitiator = authenticatedUser;
            newTimerChoice = duration;
          } else if (isOpenerResponse) {
            // Successful opener response → flip to active. Links are awarded below,
            // gated on the 10-message cap.
            db.prepare(
              "UPDATE messages SET is_responded_to = 1 WHERE conversation_id = ? AND message_type = 'opener' AND is_responded_to = 0"
            ).run(convId);
            db.prepare("UPDATE conversations SET phase = 'active' WHERE id = ?").run(convId);
            db.prepare(
              "INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'normal', ?, ?)"
            ).run(convId, new Date(sentAt).toISOString(), duration);
            newPhase = "active";
          } else {
            // Normal message in an active chat → HOT POTATO. The new message
            // REPLACES the running timer with a fresh one of its own duration.
            // Only the latest message's timer counts down; respond before it
            // expires or the whole chat is deleted.
            db.prepare(
              "INSERT INTO timers (conversation_id, timer_type, started_at, duration_ms) VALUES (?, 'normal', ?, ?)"
            ).run(convId, new Date(sentAt).toISOString(), duration);
          }

          // Read fresh message_count to apply the 10-message reward cap.
          const convAfter = db.prepare("SELECT message_count FROM conversations WHERE id = ?").get(convId) as any;
          const currentMessageCount = convAfter?.message_count ?? 0;

          // Award links only on a successful opener response AND only while the
          // combined message count is ≤ 10. From the 11th message on, nobody earns.
          if (isOpenerResponse && currentMessageCount <= 10) {
            earnedLinks = openerReward(conv.opener_timer_choice ?? 0);
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").run(earnedLinks, authenticatedUser);
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").run(earnedLinks, target);
          }

          const senderUser = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any;
          const targetUser = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(target) as any;

          const targetSocket = clients.get(target);
          const senderSocket = ws;

          const broadcastPayload = JSON.stringify({
            type: "CHAT_MESSAGE_BROADCAST",
            message: savedMsg,
            phase: newPhase,
            openerInitiator: newInitiator,
            openerTimerChoice: newTimerChoice
          });

          if (senderSocket && senderSocket.readyState === WebSocket.OPEN) {
            senderSocket.send(broadcastPayload);
            if (earnedLinks > 0) {
              senderSocket.send(JSON.stringify({
                type: "LINKS_EARNED",
                amount: earnedLinks,
                reason: "Successful opener response",
                links: senderUser?.links || 0
              }));
            }
          }

          if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(broadcastPayload);
            if (earnedLinks > 0) {
              targetSocket.send(JSON.stringify({
                type: "LINKS_EARNED",
                amount: earnedLinks,
                reason: "Successful opener response",
                links: targetUser?.links || 0
              }));
            }
          } else {
            const senderInfo = db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any;
            await sendPushNotification(
              target,
              `New message from ${senderInfo?.nickname || authenticatedUser}`,
              isPhoto ? "📷 Sent you a photo message" : (content || "").substring(0, 80),
              { conversationId: convId }
            );
          }

          syncUserFullData(authenticatedUser);
          syncUserFullData(target);
          break;
        }

        case "GET_HISTORY": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          // Retrieve messages
          const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY sent_at ASC").all(convId) as any[];
          const histConv = db.prepare("SELECT phase, opener_initiator, opener_timer_choice FROM conversations WHERE id = ?").get(convId) as any;
          ws.send(JSON.stringify({
            type: "HISTORY_SYNC",
            conversationId: convId,
            phase: histConv?.phase || "awaiting_response",
            openerInitiator: histConv?.opener_initiator ? histConv.opener_initiator.toLowerCase() : null,
            openerTimerChoice: histConv?.opener_timer_choice ?? null,
            messages: msgs.map(m => ({
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
              is_responded_to: m.is_responded_to || 0
            }))
          }));
          break;
        }

        case "MESSAGE_SEEN": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          const messageId = parseInt(data.messageId, 10);
          if (isNaN(convId) || isNaN(messageId)) return;

          // Only the receiver of a message may mark it seen
          const msgRow = db.prepare(
            "SELECT sender, receiver FROM messages WHERE id = ? AND conversation_id = ?"
          ).get(messageId, convId) as any;
          if (!msgRow || msgRow.receiver.toLowerCase() !== authenticatedUser) return;

          db.prepare("UPDATE messages SET seen = 1 WHERE id = ?").run(messageId);

          const seenPayload = JSON.stringify({
            type: "MESSAGE_SEEN_BROADCAST",
            conversationId: convId,
            messageId,
            seenBy: authenticatedUser,
            seenAt: data.seenAt || Date.now()
          });

          // Notify both participants so the sender's checkmark updates in real time
          const senderSocket = clients.get(msgRow.sender.toLowerCase());
          if (senderSocket && senderSocket.readyState === WebSocket.OPEN) senderSocket.send(seenPayload);
          if (ws.readyState === WebSocket.OPEN) ws.send(seenPayload);
          break;
        }

        case "CHAT_EXPIRED_DELETE": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
          // Only a participant of an active (un-saved) chat may trigger deletion.
          if (!convRow) return;
          const isParticipant =
            convRow.participant_1.toLowerCase() === authenticatedUser ||
            convRow.participant_2.toLowerCase() === authenticatedUser;
          if (!isParticipant || convRow.saved === 1 || convRow.phase !== "active") return;

          archiveChat(convId);
          break;
        }

        case "REVIVE_CONVERSATION": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
          if (!convRow) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Conversation not found" })); return; }

          const isParticipant =
            convRow.participant_1.toLowerCase() === authenticatedUser ||
            convRow.participant_2.toLowerCase() === authenticatedUser;
          if (!isParticipant) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Unauthorized" })); return; }
          if (!convRow.archived) { ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: "Conversation is not archived" })); return; }

          const REVIVE_COST = 3;
          const userRow = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any;
          if (!userRow || userRow.links < REVIVE_COST) {
            ws.send(JSON.stringify({ type: "REVIVE_FAILED", reason: `Not enough links — need ${REVIVE_COST}` }));
            return;
          }

          db.prepare("UPDATE users SET links = links - ? WHERE LOWER(username) = ?").run(REVIVE_COST, authenticatedUser);
          // Keep archived_at — it marks the snapshot boundary (messages before it are the previous round)
          db.prepare(
            "UPDATE conversations SET archived = 0, phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?"
          ).run(convId);

          const newLinks = (db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any).links;
          ws.send(JSON.stringify({ type: "REVIVE_SUCCESS", conversationId: convId, links: newLinks }));
          syncUserFullData(convRow.participant_1);
          syncUserFullData(convRow.participant_2);
          break;
        }

        case "END_CHAT_REQUEST": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
          if (convRow) {
            const partner = convRow.participant_1.toLowerCase() === authenticatedUser 
              ? convRow.participant_2.toLowerCase() 
              : convRow.participant_1.toLowerCase();

            // Real-time broadcast or Push Notification
            const partnerSocket = clients.get(partner);
            if (partnerSocket && partnerSocket.readyState === WebSocket.OPEN) {
              partnerSocket.send(JSON.stringify({
                type: "END_CHAT_REQUEST_BROADCAST",
                conversationId: convId,
                from: authenticatedUser
              }));
            } else {
              // Send scenario B Web Push
              const userRow = db.prepare("SELECT nickname FROM users WHERE LOWER(username) = ?").get(authenticatedUser) as any;
              await sendPushNotification(
                partner,
                `${userRow?.nickname || authenticatedUser} wants to save your conversation`,
                "Tap to review and save before the timer runs out.",
                { conversationId: convId, requestSave: true }
              );
            }
          }
          break;
        }

        case "END_CHAT_CONFIRM": {
          if (!authenticatedUser) return;
          const convId = parseInt(data.conversationId, 10);
          if (isNaN(convId)) return;

          const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
          if (convRow) {
            // Calculate ending reward using log_1.2(x)
            const countRow = db.prepare("SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?").get(convId) as any;
            const finalCount = countRow ? countRow.count : 0;
            const finalReward = Math.max(1, Math.ceil(Math.log(finalCount || 1) / Math.log(1.2)));

            // Apply reward to both
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").run(finalReward, convRow.participant_1.toLowerCase());
            db.prepare("UPDATE users SET links = links + ? WHERE LOWER(username) = ?").run(finalReward, convRow.participant_2.toLowerCase());

            // Mark saved and delete timers
            db.prepare("UPDATE conversations SET saved = 1 WHERE id = ?").run(convId);
            db.prepare("DELETE FROM timers WHERE conversation_id = ?").run(convId);

            // Fetch fresh balances
            const u1 = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(convRow.participant_1.toLowerCase()) as any;
            const u2 = db.prepare("SELECT links FROM users WHERE LOWER(username) = ?").get(convRow.participant_2.toLowerCase()) as any;

            // Broadcast success
            const sockets = [
              clients.get(convRow.participant_1.toLowerCase()),
              clients.get(convRow.participant_2.toLowerCase())
            ];

            const responsePayload = JSON.stringify({
              type: "CONVERSATION_SAVED_SUCCESS",
              conversationId: convId,
              finalReward
            });

            sockets.forEach((s, idx) => {
              if (s && s.readyState === WebSocket.OPEN) {
                s.send(responsePayload);
                s.send(JSON.stringify({
                  type: "LINKS_EARNED",
                  amount: finalReward,
                  reason: "Conversation saved successfully",
                  links: idx === 0 ? u1.links : u2.links
                }));
              }
            });

            syncUserFullData(convRow.participant_1);
            syncUserFullData(convRow.participant_2);
          }
          break;
        }
      }
    } catch (e) {
      console.error("Payload error:", e);
    }
  });

  ws.on("close", () => {
    if (authenticatedUser) {
      clients.delete(authenticatedUser);
      console.log(`User offline: ${authenticatedUser}`);
    }
  });
});

// Periodic heartbeat: 30 seconds
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Timer monitoring background loop: checks every 5 seconds
// Detects Scenario A (Timer hits exactly or below 60 seconds remaining)
// Also handles message expiration in SQLite and delivers state to connected clients
const timerMonitorInterval = setInterval(() => {
  const activeTimers = db.prepare("SELECT * FROM timers").all() as any[];
  const now = Date.now();

  for (const timer of activeTimers) {
    const startMs = new Date(timer.started_at).getTime();
    const remainingMs = timer.duration_ms - (now - startMs);

    const convId = timer.conversation_id;
    const convRow = db.prepare("SELECT * FROM conversations WHERE id = ?").get(convId) as any;
    if (!convRow) continue;

    // 1. Check for expiration
    if (remainingMs <= 0) {
      if (timer.timer_type === "normal") {
        // A normal message went unanswered → the entire chat is permanently deleted.
        archiveChat(convId);
      } else {
        // An opener went unanswered → expire it and reset to the opener phase so
        // either participant may try a fresh opener. The chat is NOT deleted.
        db.prepare("UPDATE messages SET expired = 1 WHERE conversation_id = ? AND expired = 0").run(convId);
        db.prepare("DELETE FROM timers WHERE id = ?").run(timer.id);
        db.prepare(
          "UPDATE conversations SET phase = 'awaiting_response', opener_initiator = NULL, opener_timer_choice = NULL WHERE id = ?"
        ).run(convId);
        syncUserFullData(convRow.participant_1);
        syncUserFullData(convRow.participant_2);
      }
      continue;
    }

    // 2. Check for Scenario A: Timer hits exactly or crosses 60 seconds remaining
    // If remaining is <= 60 seconds (but of course > 0)
    if (remainingMs <= 60000 && remainingMs > 0) {
      const timerKey = `${timer.id}_60s`;
      if (!notified60sTimers.has(timerKey)) {
        notified60sTimers.add(timerKey);

        // Figure out user(s) to push notification to if offline
        // Typically the recipient of the active message is the one who needs to action it!
        // Let's find latest message in conversation
        const lastMsg = db.prepare(`
          SELECT * FROM messages 
          WHERE conversation_id = ? 
          ORDER BY sent_at DESC LIMIT 1
        `).get(convId) as any;

        if (lastMsg) {
          const targetOfflineUser = lastMsg.receiver.toLowerCase();
          const targetSocket = clients.get(targetOfflineUser);
          
          if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
            // Recipient is offline -> send web push scenario A
            sendPushNotification(
              targetOfflineUser,
              "Your conversation is expiring soon",
              "You have 60 seconds to save your conversation before it's gone.",
              { conversationId: convId, warning60s: true }
            );
          } else {
            // Trigger SAVE_TIMER_WARNING to online client
            targetSocket.send(JSON.stringify({
              type: "SAVE_TIMER_WARNING",
              conversationId: convId
            }));
          }
        }
      }
    }
  }
}, 5000);

wss.on("close", () => {
  clearInterval(heartbeatInterval);
  clearInterval(timerMonitorInterval);
});

// Serve frontend assets
async function startWeb() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    
    app.use(vite.middlewares);

    app.get("*", async (req, res, next) => {
      // Exclude API paths
      if (req.originalUrl.startsWith("/api")) {
        return next();
      }

      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startWeb();
