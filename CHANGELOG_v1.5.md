# Instant v1.5 — Strategic Upgrade Changelog

This release implements the Strategic Upgrade Plan as an **additive layer** on
top of v1.4. The legacy session-token auth, REST endpoints, and WebSocket
frame shapes are completely preserved — every new capability lives under
`/api/v15/*` or new components — so existing chats, friendships, timers, and
push notifications behave exactly as before.

## §3 — Infrastructure (staged abstractions)
- **`server/v15.ts`** — Single-file install layer mounted from `server.ts`.
  Contains all new schema migrations, JWT helpers, REST routes, and the
  background TTL sweeper.
- **`src/lib/storage-client.ts`** — Client uploader for the new media
  pipeline.
- **`server/v15.ts → LocalDriver`** — Default storage driver writing to
  `./media-store`. A B2 driver can be dropped in behind the same interface
  without touching call sites (env vars reserved in `.env.example`).

## §4 — Feature Layer

### Adaptive Privacy Modes
- **`src/components/PrivacyBar.tsx`** — Disappearing-timer presets
  (off / 10s / 1h / 24h / 7d), anonymous toggle, screenshot heuristic.
- **Server**: `conversations.privacy_mode`, `conversations.disappear_after_seconds`,
  `conversations.anonymous_mode`, `messages.expires_at` columns.
- **Server**: `POST /api/v15/conversations/:id/privacy` and
  `POST /api/v15/conversations/:id/screenshot`.
- **TTL sweeper** runs every 60s, deleting expired messages/stories/media.

### AI Messaging Layer (uses existing `@google/genai`)
- **`src/lib/ai.ts`** — `suggestReplies()`, `rewriteTone()`, `translate()`,
  `transcribeVoice()` (stub). Lazy import so the bundle stays slim and the app
  works without an API key.

### Username-First Identity
- **`src/components/QRAdd.tsx`** — Self-contained QR generator (no `qrcode`
  dependency added) producing an `instant://add/<username>` payload.

### Private Circle Stories
- **`src/components/Stories/StoriesTray.tsx`** — Horizontal feed tray.
- **`src/components/Stories/StoryViewer.tsx`** — 5s auto-advancing viewer,
  posts a view event.
- **`src/components/Stories/StoryComposer.tsx`** — Uses the existing camera
  blob, uploads via media pipeline, publishes story bound to a circle.
- **Server tables**: `circles`, `circle_members`, `stories`, `story_views`.
- **Server endpoints**: `POST/GET /api/v15/circles`,
  `POST /api/v15/circles/:id/members`, `POST /api/v15/stories`,
  `GET /api/v15/stories/feed`, `POST /api/v15/stories/:id/view`.

### Camera-First Messaging
- **`src/components/Camera/OverlayLayer.tsx`** — Sticker + text overlays,
  draggable, flattened to PNG via `flattenOverlays()` before send.
- **`src/lib/arFilters.ts`** — Lightweight CSS-filter pipeline (`vibe`,
  `noir`, `dream`, `glow`, `vhs`). Zero new dependencies; same hook shape so a
  future `@mediapipe/face_mesh` swap is invisible to callers.

### Live Presence
- **`src/lib/presence.ts`** — `publishPresence()` / `subscribePresence()`
  helpers over the existing WebSocket bus.
- **Server**: `PRESENCE_UPDATE` frames are rebroadcast as `PRESENCE_BROADCAST`
  to all connected clients (`server.ts` patch, ~25 LOC).

## §5 — Immediate Codebase Priorities
1. **`server/v15.ts`** isolates new logic from the v1.4 monolith. Auth,
   messaging-privacy, media, circles, stories, and analytics live as discrete
   sections inside one file; splitting into separate `services/*.ts` is a
   mechanical follow-up.
2. **JWT (HS256)** issued by `POST /api/v15/auth/token`, refreshed by
   `POST /api/v15/auth/refresh`, revoked by `POST /api/v15/auth/logout`.
   Implemented without adding `jsonwebtoken` to keep the dependency tree
   identical to v1.4 — swap-in compatible.
3. **Media table** + expiring signed URLs (`POST /api/v15/media/upload`,
   `GET /api/v15/media/:key?exp=…&sig=…`).
4. **Conversation privacy** columns added via idempotent `ALTER TABLE`.
5. **`media` table** decouples binary payloads from `messages`.
6. **`analytics_events` table** + client `src/lib/analytics.ts` posting to
   `POST /api/v15/analytics`.
7. **`circles` / `circle_members`** introduce the social graph.

## §6 — Monetization
Roadmap only — no UI shipped in v1.5.

## Files
**New**
- `server/v15.ts`
- `src/lib/ai.ts`
- `src/lib/analytics.ts`
- `src/lib/presence.ts`
- `src/lib/storage-client.ts`
- `src/lib/jwt-client.ts`
- `src/lib/arFilters.ts`
- `src/components/PrivacyBar.tsx`
- `src/components/QRAdd.tsx`
- `src/components/Stories/StoriesTray.tsx`
- `src/components/Stories/StoryViewer.tsx`
- `src/components/Stories/StoryComposer.tsx`
- `src/components/Camera/OverlayLayer.tsx`

**Modified**
- `server.ts` — added `installV15(...)` call + presence rebroadcast (~30 LOC).
- `src/types.ts` — added `Circle`, `Story`, `MediaRecord`, privacy fields.
- `.env.example` — added `JWT_SECRET`, `VITE_GEMINI_API_KEY`, B2 vars.

## Wiring follow-ups (intentionally left as small one-line imports)
The new UI components are self-contained and ready to drop in. To activate:
- `Chat.tsx`: `import PrivacyBar from "./PrivacyBar";` and render above the
  composer; pass `conversation.id`.
- `Inbox.tsx`: `import StoriesTray from "./Stories/StoriesTray";` render at
  the top of the list.
- `CameraView.tsx`: `import OverlayLayer, { flattenOverlays } from "./Camera/OverlayLayer";`
  and `import { filterCSS, AR_FILTERS } from "../lib/arFilters";` — apply
  `style={{ filter: filterCSS(active) }}` to the `<video>` and overlay the
  layer above it.
- `Profile.tsx`: `import QRAdd from "./QRAdd";` and render with
  `<QRAdd username={me.username} />` in the settings sheet.

These follow-ups were kept as imports rather than invasive rewrites so that
the v1.4 chat/camera/inbox flows have **zero behavioral regression** the
moment you unzip — your team can wire them in incrementally.

## Verification
- All new files are TypeScript-strict compatible with the existing
  `tsconfig.json`.
- New REST endpoints are namespaced under `/api/v15/*`, isolated from v1.4
  routes.
- Background TTL sweeper uses `setInterval(...).unref()` so it never blocks
  shutdown.
