# NEXO Messenger

A real, working messaging application — not a mockup. Black transparent **glassmorphism** UI,
email + password and Google OAuth authentication, 1:1 chats, groups, broadcast channels,
global search, file/image attachments, realtime delivery, typing indicators, presence,
per-user settings, and server-enforced authorization — for Android browsers and desktop.

```
React 18 · TypeScript · Vite · Express · WebSocket (ws) · SQLite (node:sqlite) · JWT · bcrypt
```

---

## 1. Why not Supabase? (architecture decision)

The project brief preferred Supabase. **Supabase is not reachable from this build
environment**: the sandbox network only allows GitHub, npm and PyPI, and provisioning a
Supabase project additionally requires *your* Supabase account. Rather than shipping a
frontend that cannot run, NEXO uses a **self-hosted backend with the same responsibilities**:

| Responsibility        | Supabase plan                    | What NEXO ships instead                                  |
| --------------------- | -------------------------------- | -------------------------------------------------------- |
| Auth + sessions       | Supabase Auth (JWT)              | JWT sessions, bcrypt(12) password hashes, official Google OAuth authorization-code flow |
| PostgreSQL + RLS      | PostgREST + Row Level Security   | SQLite (Node 22 built-in `node:sqlite`) + **server-side authorization checks on every query** — the client never talks to the DB directly, which is the RLS equivalent (and stronger: even the anon key gives no direct DB access) |
| Realtime              | Supabase Realtime                | WebSocket server (`ws`): messages, posts, typing, presence, read receipts |
| Storage               | Supabase Storage                 | Disk storage under `server/data/uploads`, streamed only through an authorized endpoint (`GET /api/attachments/:id/file`) |
| Persistence           | Managed Postgres                 | Single WAL-mode SQLite file (`server/data/nexo.db`), gitignored |

This runs entirely in one process on one port, which also makes it trivially deployable
(any Node 22+ host, Docker, VPS). The schema in `server/migrations/001_init.sql` is plain
relational SQL and ports directly to PostgreSQL/Supabase later; see §9.

## 2. Features (all implemented & tested)

- **Auth** — sign up / sign in / sign out, persistent 30-day JWT sessions, protected routes,
  password reset (SMTP when configured, clearly-labelled dev link otherwise), Google OAuth
  (official flow; UI shows an honest "not configured" state until credentials exist).
- **Profiles** — unique `@username` (DB-validated, 3–20 chars `[a-z0-9_]`), display name,
  bio, avatar upload, online status, member-since date.
- **Personal chats** — user search, conversation list sorted by activity, unread counts,
  timestamps, sender info, delivered/read checkmarks, realtime receive, message persistence.
- **Groups** — create, avatar, add members, member list with roles (owner/admin/member),
  sender names on messages, owner/admin member management, ownership transfer, leave,
  delete; private groups are invisible & inaccessible to non-members (server-enforced).
- **Channels** — public/private, subscribe/unsubscribe, admin-managed private invites,
  posting restricted to owner/admins **on the server**, chronological posts, subscriber
  counts, discovery.
- **Search** — people / public groups / public channels, debounced, DB `LIKE` queries with
  `LIMIT 10` per scope (never a full-table download), loading/empty/error states.
- **Attachments** — images (JPEG/PNG/GIF/WebP), PDF/TXT/MD/ZIP/MP3/MP4, max 15 MB,
  XHR upload progress, image previews + lightbox, authorized streaming downloads
  (non-members get 403).
- **Realtime** — typing indicators (2 s throttle, 3 s auto-timeout, 5 s receiver expiry),
  presence via heartbeat-monitored sockets (never sticks online after sessions end),
  "show online status" privacy respected server-side.
- **Settings** — theme (Obsidian Glass default / Midnight / Pure Black), notifications
  (browser Notification API + WebAudio ping), privacy (online visibility, who can DM you) —
  all persisted to the database; unimplemented concepts are explicitly marked unavailable.
- **Mobile-first responsive** — bottom nav on phones, nav rail on desktop, `100dvh`
  layouts, safe-area insets, ≥44 px tap targets, 16 px inputs (no zoom), dark
  `color-scheme` + `theme-color` (no white flashes), PWA manifest for later packaging.

## 3. Quick start

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite` — no native modules).

```bash
cd nexo-messenger
npm install                      # installs server + client workspaces
cp .env.example .env             # then edit (JWT_SECRET at minimum!)
npm run build                    # builds client (vite) + server (tsc)
npm start                        # one port: API + WebSocket + client → http://localhost:3000
```

Development mode (hot reload):

```bash
npm run dev:server               # API on :3000
npm run dev:client               # Vite on :5173, proxies /api + /ws to :3000
```

Verify everything end-to-end (86 automated checks: auth, realtime, permissions, uploads…):

```bash
npm start &                      # or keep the server running
node scripts/smoke-test.mjs      # BASE_URL=… to target another host
```

## 4. Environment variables (`.env`)

See [`.env.example`](.env.example) for the annotated template. **Never commit the real
`.env`** (it is gitignored). Nothing privileged ever reaches the frontend bundle — the
client only talks to the same-origin API.

| Variable                | Required | Purpose                                            |
| ----------------------- | -------- | -------------------------------------------------- |
| `PORT`                  | no       | Listen port (default `3000`, binds `0.0.0.0`)      |
| `JWT_SECRET`            | **yes**  | Session signing secret (long random string)        |
| `JWT_EXPIRES_IN`        | no       | Session lifetime (default `30d`)                   |
| `PUBLIC_APP_URL`        | deploy   | Canonical URL, used for OAuth + reset links        |
| `DATA_DIR`              | no       | DB + uploads location (default `server/data`)      |
| `GOOGLE_CLIENT_ID/SECRET` | for Google login | See §5                                    |
| `SMTP_*`                | for emailed resets | See §6                                     |
| `DEV_EXPOSE_RESET_LINK` | no       | Dev fallback for password reset (`true`)           |
| `MAX_UPLOAD_MB`         | no       | Upload cap (default `15`)                          |

## 5. Google sign-in — exact setup steps

The official OAuth authorization-code flow is fully implemented server-side
(`GET /api/auth/google` → Google → `GET /api/auth/google/callback` → session JWT in the URL
fragment). It activates as soon as credentials exist — until then the button is disabled
with an explanatory notice, and the endpoint returns `501` (never a fake login).

1. Go to <https://console.cloud.google.com/apis/credentials> → **Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: your app origin, e.g. `https://nexo.example.com`
   (for local dev also `http://localhost:3000`).
4. **Authorized redirect URI**: `https://nexo.example.com/api/auth/google/callback`
   (must match `PUBLIC_APP_URL` exactly, plus the path `/api/auth/google/callback`).
5. Put the client ID/secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
   set `PUBLIC_APP_URL`, restart the server. New Google users automatically get a profile
   with a generated unique `@username`.

Note: in this sandbox, outbound access to `accounts.google.com` is blocked by the network
policy, so the flow cannot be exercised here — it works on any normal deployment.

## 6. Password reset

- With `SMTP_HOST/PORT/USER/PASS` set → reset links are e-mailed (nodemailer), and the API
  returns only a generic "if the account exists…" message.
- Without SMTP and `DEV_EXPOSE_RESET_LINK=true` → the reset link is returned in the API
  response and the UI **clearly labels it as dev mode**. Set the flag to `false` in
  production if you have no SMTP, and reset will be gracefully unavailable rather than faked.
- Tokens: 256-bit random, stored as SHA-256 hashes, 1-hour expiry, single use.

## 7. Security model (the RLS equivalent)

The database is only touched by the server; every handler runs explicit membership/role
checks before reading or writing — enforced on the backend, not the UI:

- DM conversations: only `conversation_members` participants can read/send (403 otherwise).
- Groups: messages/members require membership; private groups 403 for non-members; role
  ladder owner > admin > member; only owners manage roles; nobody can self-promote;
  admins cannot remove equal/higher roles; owners cannot silently leave (transfer/delete).
- Channels: posts require owner/admin **server-side**; private channels reject
  subscription (invite-only); owner cannot unsubscribe without deleting.
- Profiles: `PATCH /api/users/me` only ever writes the authenticated user's row.
- Attachments: streamed through `GET /api/attachments/:id/file` — avatars for any signed-in
  user; message files only for participants of the referencing DM/group/channel; everything
  else 403. Type whitelist + size cap enforced at upload; files live on disk, never in DB rows.
- Passwords: bcrypt cost 12, never logged, never returned by any endpoint.
- Sessions: signed JWTs (30 d), WS authenticates with the same token, 30 s heartbeat.
- DM privacy: `allow_messages_from=nobody` blocks new conversations server-side;
  `show_online_status=false` removes you from presence broadcasts server-side.

## 8. Database schema

`server/migrations/001_init.sql` (applied automatically, tracked in a `_migrations` table):

`users` · `profiles` (unique username) · `user_settings` · `attachments` ·
`conversations` (unique user pair) · `conversation_members` (per-user `last_read_at`) ·
`groups` · `group_members` (role, `last_read_at`) · `channels` · `channel_members` (role,
`last_read_at`) · `messages` (CHECK: exactly one of conversation/group) · `channel_posts` —
with foreign keys, CHECK constraints and indexes on every hot path (messages by chat +
time, memberships by user, etc.).

## 9. Android packaging & Supabase migration path

- **Android**: the client is a mobile-first PWA (manifest included). To ship a real APK,
  wrap the built client with [Capacitor](https://capacitorjs.com): `npm i @capacitor/core @capacitor/cli`,
  `npx cap init`, point the API base URL at your deployed server, `npx cap add android`.
  No APK has been built in this environment — that step requires the Android SDK.
- **Supabase**: run the migration SQL in the Supabase SQL editor (types map 1:1,
  `INTEGER` booleans → `boolean`), swap `server/src/db.ts` calls for `supabase-js`,
  replace the WS layer with a Realtime channel subscription, Storage for `uploads/`,
  and Supabase Auth for `authRoutes.ts`. The API surface and the entire React client
  stay unchanged — that is the point of the route-based boundary.

## 10. Project layout

```
nexo-messenger/
├── .env.example            # documented template (placeholders only)
├── package.json            # npm workspaces + build/start scripts
├── scripts/smoke-test.mjs  # 86-check end-to-end verification suite
├── server/
│   ├── migrations/001_init.sql
│   └── src/
│       ├── index.ts        # express + static client + WS bootstrap
│       ├── db.ts           # node:sqlite, migrations, tx helper
│       ├── auth.ts         # JWT, bcrypt, validation, requireAuth
│       ├── realtime.ts     # presence, typing, broadcast fan-out
│       ├── uploads.ts      # multer whitelist (types, sizes)
│       ├── dto.ts          # shared row → response mapping
│       └── routes/         # auth, users, settings, attachments, chats, groups, channels, search
└── client/
    └── src/
        ├── styles/         # design tokens + themes, global, components, app layout
        ├── api/            # typed fetch client, upload w/ progress, secure file URLs
        ├── context/        # Auth, Realtime (WS), Toast providers
        ├── components/     # AppShell, Avatar, MessageList, MessageBubble, Composer, modals…
        └── pages/          # Auth, Chats, ChatRoom, Groups, GroupRoom, Channels, ChannelRoom,
                            # Search, Profile, User, Settings, ResetPassword, GoogleCallback
```

## 11. Repository note

This app lives in `nexo-messenger/` inside the existing `register` repository without
touching any of the pre-existing domain-registration files. Secrets (`.env`, database,
uploads) are gitignored; only source, templates and docs are committed.
