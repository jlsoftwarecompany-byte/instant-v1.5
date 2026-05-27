# Session Resume & Handover — Instant v1.6 → Cloudflare Workers Migration

**Date:** 2026-05-27  
**Project directory:** `C:\Users\User\Documents\Instant v1.6`  
**Git branch:** `main`

---

## 1. Current State Summary

### Overarching Goal
Migrate the **Instant v1.6** application from Render (Docker/Node.js hosting) to **Cloudflare Workers** for global edge deployment.

### What Instant Actually Is
Despite the original migration guide describing it as a Next.js app, **it is not**. Instant is:
- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS (SPA — no SSR)
- **Backend:** Express.js + `ws` (WebSocket) + `better-sqlite3` (SQLite embedded DB)
- **Auth:** Session tokens + HS256 JWT (implemented in `server/v15.ts`)
- **Storage:** Local `./media-store` filesystem (Backblaze B2 was planned but not implemented)
- **Push notifications:** `web-push` with VAPID keys
- **AI:** `@google/genai` (Gemini API key)

Because it is not Next.js, the OpenNext adapter mentioned in the original migration guide **does not apply**. A full custom Workers migration was built instead.

### What Has Been Accomplished
| # | Task | Status |
|---|---|---|
| 1 | Analyzed full codebase (`server.ts`, `server/v15.ts`, `src/`, `package.json`) | ✅ Done |
| 2 | Created `wrangler.jsonc` (D1, R2, Durable Object, ASSETS bindings) | ✅ Done |
| 3 | Created `cloudflare-env.d.ts` (TypeScript types for Worker env) | ✅ Done |
| 4 | Created `worker/index.ts` (main Worker entry point, request router) | ✅ Done |
| 5 | Created `worker/chat-room.ts` (ChatRoom Durable Object — full WS hub rewrite) | ✅ Done |
| 6 | Created `worker/api.ts` (all HTTP API handlers, R2 media upload/serve) | ✅ Done |
| 7 | Created `worker/migrations/0001_init.sql` (D1 schema — all tables) | ✅ Done |
| 8 | Created `migrations/0001_init.sql` (copy at root — wrangler default path) | ✅ Done |
| 9 | Created `worker/tsconfig.json` (scoped TS config using `@cloudflare/workers-types`) | ✅ Done |
| 10 | Updated `package.json` (added `cf:build`, `cf:deploy`, `cf:preview`, `db:migrate:*` scripts) | ✅ Done (not yet pushed) |
| 11 | Updated `.gitignore` (added `.wrangler/`, `.dev.vars`, `instant.db`, `media-store/`) | ✅ Done (not yet pushed) |
| 12 | Installed `wrangler@4.95.0` and `@cloudflare/workers-types@4.20260527.1` | ✅ Done |
| 13 | Ran `npx wrangler login` (authenticated CLI) | ✅ Done |
| 14 | Created D1 database `instant-db` on Cloudflare dashboard | ✅ Done |
| 15 | Pasted D1 `database_id` into `wrangler.jsonc` | ✅ Done |
| 16 | Applied D1 schema via `npm run db:migrate:remote` | ✅ Done |
| 17 | Created R2 bucket `instant-media` on Cloudflare dashboard | ✅ Done |
| 18 | Fixed Durable Object migration type (`new_sqlite_classes` — required for free plan) | ✅ Done |
| 19 | Attempted first deploy (`npm run cf:deploy` from terminal) | ✅ Done (uploaded 4 assets, hit DO migration error — fixed) |
| 20 | Set VAPID secrets in Cloudflare dashboard | ⚠️ Partially done (see issues below) |
| 21 | Set up Workers Builds CI/CD from GitHub | ⚠️ In progress — build failed |
| 22 | Committed and pushed all changes to GitHub | ❌ Not done yet |

---

## 2. In Progress

### Workers Builds CI/CD Setup (Step 8)
The user is on the Cloudflare dashboard at:  
**Workers & Pages → instant → Builds → Create and deploy**

Current dashboard build configuration:
- **Build command:** `npm run cf:build` ← this fails (see issue below)
- **Deploy command:** `npx wrangler deploy`
- **Path:** `/`

The build failed because `npm run cf:build` exists in the local `package.json` but **those changes were never committed and pushed to GitHub**. The CI/CD runner pulls from GitHub, which still has the old `package.json`.

---

## 3. Unresolved Issues / Bugs

### Issue 1 — Local changes not pushed to GitHub (BLOCKER)
**Error seen:** `npm error Missing script: "cf:build"`  
**Root cause:** `package.json`, `wrangler.jsonc`, `worker/`, `migrations/`, and other new files only exist locally. They have never been committed or pushed to the GitHub repository.  
**Fix:** Run the git commit + push (see Next Steps).

### Issue 2 — Secrets may be incorrectly configured
**Observed:** The dashboard showed one secret with the name `BHXn68XgyN3194ya0U7zx...` — this looks like the VAPID public key **value** was typed into the Name field by mistake.  
**Required secrets (3 total):**
| Name | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | VAPID public key (starts with `BH...`) |
| `VAPID_PRIVATE_KEY` | VAPID private key |
| `JWT_SECRET` | Long random hex string for HS256 signing |

**Fix:** Delete the incorrectly named secret in the dashboard. Add all 3 with the exact names above.  
**Location:** Cloudflare dashboard → Workers & Pages → instant → Settings → Variables and Secrets

### Issue 3 — Pre-existing TypeScript error in frontend (non-blocking)
**File:** `src/components/Camera/OverlayLayer.tsx:44`  
**Error:** `Cannot find namespace 'React'`  
**Impact:** Does not block the build (Vite doesn't use `tsc` for frontend bundling). Not introduced by this session. A separate task chip was created for this fix.

### Issue 4 — `.dev.vars` is empty (local dev only)
The file `.dev.vars` (used for `npm run cf:preview` local testing) was created but not filled in.  
**Fix:** Copy VAPID keys and JWT_SECRET values into `.dev.vars` for local development. This file is gitignored — never commit it.

---

## 4. Next Steps (in order)

### Step 1 — Commit and push all changes to GitHub
Run in the terminal from `C:\Users\User\Documents\Instant v1.6`:

```bash
git add package.json wrangler.jsonc worker/ migrations/ cloudflare-env.d.ts .gitignore tsconfig.json .dev.vars
git commit -m "Add Cloudflare Workers migration (D1, R2, Durable Objects)"
git push
```

### Step 2 — Fix the secrets in the Cloudflare dashboard
1. Go to: Workers & Pages → **instant** → Settings → Variables and Secrets
2. Delete the incorrectly named secret
3. Add these 3 secrets with exact names: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `JWT_SECRET`
4. To generate a JWT secret if you don't have one:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

### Step 3 — Retry the Workers Builds CI/CD deploy
After the git push in Step 1, Cloudflare will auto-trigger a new build. If it doesn't:
1. Go to: Workers & Pages → instant → Builds tab
2. Click **Retry build**

The build should now find `npm run cf:build` and succeed.

### Step 4 — Verify the live deployment
Once deployed, open the `*.workers.dev` URL shown in the deploy output and verify:
- [ ] The login/register screen loads
- [ ] You can create an account and log in
- [ ] WebSocket connection establishes (check browser DevTools → Network → WS)
- [ ] Sending a message works
- [ ] Push notifications work (requires VAPID secrets to be correctly set)

### Step 5 — (Optional) Add a custom domain
1. Workers & Pages → instant → Settings → Domains & Routes → Add Custom Domain
2. Enter your domain (e.g. `app.yourdomain.com`)
3. SSL certificate will auto-provision within 2–5 minutes

### Step 6 — Decommission Render
Only after verifying the Cloudflare deployment works end-to-end:
1. Keep Render running 24–48 hours as fallback
2. Update DNS to point to Cloudflare
3. Delete the Render service

---

## 5. System / Codebase Context

### Architecture Migration Map
| Old (Render / Node.js) | New (Cloudflare Workers) |
|---|---|
| Express.js HTTP server | Workers `fetch()` handler in `worker/index.ts` |
| `ws` WebSocket hub + in-memory `Map<username, WebSocket>` | `ChatRoom` Durable Object (single global instance `"global"`) |
| `better-sqlite3` (synchronous SQLite) | **D1** (async — all queries use `.bind().first()/.all()/.run()`) |
| `setInterval(checkTimers, 5000)` | Durable Object **alarm** (re-schedules itself every 5 s) |
| `./media-store` local filesystem | **R2** bucket `instant-media` |
| `server/v15.ts` Express routes | `worker/api.ts` fetch handler routes |
| `node dist/server.cjs` | `wrangler deploy` |
| Dockerfile / Cloud Run | Cloudflare Workers (no container) |

### Key Files Changed or Created
```
Instant v1.6/
├── wrangler.jsonc                   ← NEW: Cloudflare Worker config
├── cloudflare-env.d.ts              ← NEW: TypeScript env interface
├── .dev.vars                        ← NEW: Local secrets (gitignored, fill in manually)
├── migrations/
│   └── 0001_init.sql                ← NEW: D1 schema (wrangler default path)
├── worker/
│   ├── index.ts                     ← NEW: Worker entry point
│   ├── chat-room.ts                 ← NEW: ChatRoom Durable Object
│   ├── api.ts                       ← NEW: HTTP API handlers
│   ├── tsconfig.json                ← NEW: Worker-scoped TS config
│   └── migrations/
│       └── 0001_init.sql            ← NEW: D1 schema (canonical copy)
├── package.json                     ← MODIFIED: added cf:build, cf:deploy, db:migrate:* scripts
├── tsconfig.json                    ← MODIFIED: added exclude: ["worker"] to avoid type conflicts
└── .gitignore                       ← MODIFIED: added .wrangler/, .dev.vars, instant.db, media-store/
```

### Critical wrangler.jsonc Values
- **D1 database_id:** `2d07c23b-aaf8-42f2-bd8b-86d1a0e17e30` (already set)
- **R2 bucket name:** `instant-media` (already created)
- **Durable Object migration type:** `new_sqlite_classes` (required for free plan — already fixed)
- **Worker name:** `instant`

### Important Architectural Decisions Made This Session

1. **Single global Durable Object** — All WebSocket connections route to one `ChatRoom` DO instance named `"global"`. This preserves the original in-memory broadcast behavior. If scale requires it later, this can be sharded per conversation.

2. **D1 async conversion** — Every synchronous `db.prepare().get()` / `.all()` / `.run()` call from `server.ts` was converted to async D1 equivalents: `.bind(...).first<T>()` / `.all<T>()` / `.run()`. The `meta.last_row_id` field replaces `info.lastInsertRowid`.

3. **R2 media with same signed-URL scheme** — The `LocalDriver` from `server/v15.ts` was replaced with R2 puts/gets in `worker/api.ts`. The HMAC-based signed URL scheme is preserved identically so existing client code (`src/lib/storage-client.ts`) works without changes.

4. **DO alarm replaces setInterval** — The 5-second timer monitoring loop (`timerMonitorInterval` in `server.ts`) is now driven by `state.storage.setAlarm()` in the ChatRoom DO. The alarm reschedules itself on every invocation. This survives DO hibernation.

5. **Frontend unchanged** — The entire `src/` directory is untouched. Vite builds it to `dist/`, which is served via the Workers ASSETS binding. The WebSocket client (`src/lib/ws.ts`) connects to `wss://same-host` which routes to the ChatRoom DO.

6. **Two tsconfig files** — `tsconfig.json` (root) covers `src/` and server files with DOM types. `worker/tsconfig.json` covers `worker/` only with `@cloudflare/workers-types` (no DOM). The root tsconfig explicitly `exclude`s the `worker/` directory to prevent type conflicts.

### npm Scripts Reference
| Script | What it does |
|---|---|
| `npm run dev` | Local Express dev server (unchanged, still works) |
| `npm run cf:build` | Vite build only → outputs to `dist/` |
| `npm run cf:preview` | Vite build + `wrangler dev` (local CF Workers emulation) |
| `npm run cf:deploy` | Vite build + `wrangler deploy` (push to production) |
| `npm run db:migrate:local` | Apply D1 schema to local wrangler dev environment |
| `npm run db:migrate:remote` | Apply D1 schema to production D1 database |
