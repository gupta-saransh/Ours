# CLAUDE.md — Ours (private couples app)

Context for anyone (human or model) picking up this codebase.

## What this is

**Ours** is a private, just-for-two relationship app. One Expo codebase runs on iOS, Android, and web. Original brief in `Details.md`; it has since grown: a public landing page, a post-login home dashboard, a notification service, a calendar-based memory log, heart reactions, a shared bucket list, and optional pairing. **No stubs, no mock states.**

## Stack

| Layer | Tech |
|---|---|
| App | Expo SDK 53 + React Native 0.79 + Expo Router 5 (`react-native-web` for web) |
| API | ONE Vercel serverless function (`api/index.ts`) routing to modules in `api/_routes/` |
| Database | CockroachDB (Postgres wire protocol, `pg` driver) |
| Realtime | Ably (server publishes via REST, clients subscribe via scoped tokens) |
| Auth | Email+password, `node:crypto` scrypt, `jsonwebtoken` JWTs (30-day) |

## Commands

```sh
npm install
npm run migrate        # applies db/schema.sql (idempotent); RE-RUN after schema changes
npm run typecheck      # tsc --noEmit over app/ src/ api/ scripts/
npm run build:web      # expo export --platform web -> dist/
npx vercel dev         # API on :3000 (local)
npx expo start         # app; press w for web
```

Environment: `.env` from `.env.example` (`DATABASE_URL`, `ABLY_API_KEY`, `JWT_SECRET`, `EXPO_PUBLIC_API_URL`; the last one stays EMPTY on Vercel). Deployed via GitHub import into Vercel; env vars live in Vercel project settings.

## Product structure

- **Landing** `app/(auth)/welcome.tsx`: public marketing page (hero, three feature cards, CTA). Signed-out users at `/` land here.
- **Auth** sign-up/sign-in. **Signup auto-creates a solo space** (couple row); pairing is optional.
- **Pairing** `app/pair.tsx`: NOT a gate. Share your code or join theirs; joining migrates everything you authored into their space (see `api/_routes/couple-join.ts`).
- **Home** `app/(tabs)/index.tsx`: days-together count (basis: earliest anniversary milestone, else couple created_at), invite banner when solo, resurfaced memory (1 year ago today > 1 month ago today > random older), next two milestones, bucket list (add/complete inline), latest pinned note. Powered by ONE aggregate call: `GET /api/home`.
- **Memories** `app/(tabs)/memories.tsx`: two parts. (1) Month calendar; days that hold a memory render a ♥ instead of the number; tapping a (non-future) day opens the composer pinned to that date (`memory_date` column). (2) Photo timeline with heart reactions and a full-photo viewer.
- **Notes** live wall + pin/unpin/remove + emoji quick-row in the composer.
- **Milestones** yearly recurrence for anniversary/birthday, second-level countdowns.
- **Notifications** `app/(tabs)/notifications.tsx` (hidden tab, reached via bell): every nudge/memory/note/milestone/bucket action by your partner, stored in the `notifications` table AND pushed live over Ably. Unread dot state lives in `src/lib/notifications.tsx`; `users.notifications_seen_at` tracks read state.
- **Navigation**: web >= 900px wide gets a top navbar (`src/components/TopNav.tsx`), native/narrow gets bottom tabs + header actions (`src/components/HeaderActions.tsx` has NudgeButton + BellButton).

## Performance contract (why the app is fast; do not regress)

1. **List endpoints NEVER return full-resolution photos.** `GET /api/memories` carries only ~15 KB thumbnails (`thumb_data`, client-generated at 360px/q0.55). The full photo (1200px/q0.7) is stored in `photo_data` and fetched only by `GET /api/memories/:id` when the viewer opens.
2. **Home is one request** (`/api/home`), all queries in `Promise.all`.
3. Ably events carry ids/metadata, never image payloads.
4. Remaining latency is Vercel cold start + DB round trip: keep the Vercel function region next to the CockroachDB region (project Settings -> Functions).

## API surface (all via api/index.ts router; add endpoint = module in _routes/ + one table entry)

auth/signup (creates solo space) · auth/login · auth/me · auth/profile · auth/account · couple (GET) · couple/create · couple/join (migrates content) · memories (GET list/POST) · memories/:id (GET full photo / PATCH heart / DELETE own) · notes (GET/POST) · notes/:id (PATCH pin / DELETE own) · milestones (GET/POST) · milestones/:id (DELETE) · notifications (GET list+unseen / POST mark seen) · bucket (GET/POST) · bucket/:id (PATCH done / DELETE) · home (GET aggregate) · nudge (POST) · ably-token (GET)

`_lib/`: db (pg pool), auth (scrypt/JWT, `requirePairedUser` lazily creates a space for legacy accounts), ably, notify (insert notification + publish), invite (code + space creation), push (real hook, delivery needs APNs/FCM), respond (route wrapper: CORS/methods/errors).

## Data model

`couples` · `users` (couple_id, notifications_enabled, notifications_seen_at, push_token) · `memories` (photo_data full, thumb_data small, memory_date DATE, note) · `love_notes` (pinned) · `milestones` (kind: anniversary|birthday|custom) · `notifications` (couple_id, actor_id, kind, text) · `memory_hearts` (memory_id+user_id PK) · `bucket_items` (title, done). Schema is idempotent (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`); always safe to re-run migrate.

## Realtime events (channel `couple:{coupleId}`)

`note.created` `note.pinned` `note.deleted` `memory.created` (id only, clients refetch) `memory.deleted` `memory.hearted` `nudge` `partner.joined` `notification` (feeds the bell dot). Clients ignore their own events by actor/author id.

## Security invariants (do not weaken)

1. Every couple-scoped query filters by the authenticated user's `couple_id`; privacy lives in the API.
2. JWT carries only `sub`; `requireUser` re-reads the user row per request so couple_id is never stale.
3. Ably tokens are subscribe-only, scoped to the user's own couple channel (`/api/ably-token`); the API key never leaves the server.
4. Spaces cap at 2 members; joining a full space is rejected; own-content-only deletes.

## Design system (non-negotiable)

Direction: **aged love letters**. Parchment `#F4ECDD` ground, espresso ink `#33241C`, oxblood `#7E382C` primary (wax seal), ochre gold `#B8862F` flourishes, dry olive `#77743F` secondary. Deliberately NOT the blush/rose default of AI-generated apps. All tokens in `src/theme.ts` only, including `onRose` for text on oxblood; never hardcode hex in screens.

- Fraunces serif for display/headings and memory/note bodies; system sans elsewhere.
- 1px hairline borders, no shadows; pressed states darken, never bounce.
- Content columns max ~560-680px, centered.
- Emoji as micro-touches only (♥ nudge, ✦ pins, calendar hearts); no mascots, no confetti.
- **Copy rules: warm second person, and NEVER use em dashes (—) in user-facing copy.** Use commas or periods.

## Honest limitations (do not fake)

- Push to closed apps needs APNs/FCM credentials; the real hook is `api/_lib/push.ts` + `users.push_token`. In-app realtime via Ably is real.
- Billing: Settings shows a free state; no payment flow by design.

## Gotchas

- **Never add a non-underscore file directly under `api/`**; Vercel Hobby caps deployments at 12 functions. `api/index.ts` must remain the only one; the `/api/:path*` rewrite in `vercel.json` routes to it (a `[...path].ts` catch-all was tried and 404'd in production; keep the rewrite pattern). Rewrite order matters: the api rewrite must precede the SPA fallback.
- `jsonwebtoken` not `jose` (jose is ESM-only; this package is CJS).
- `expo-asset` must stay installed (expo-font's web loader needs it).
- Component `style` props are `StyleProp<ViewStyle>`, not `ViewStyle`.
- Confirms are inline two-step UI (Alert.alert does not work on web).
- Milestone dates are validated `YYYY-MM-DD` text fields (no native picker dependency).
- Invite codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I).
- Windows machine; PowerShell 5.1 has no `&&`; use the Bash tool for chained commands.

## Hard constraints from the user

- **Never touch git.** The user commits/pushes/deploys themselves.
- After schema changes, remind the user to run `npm run migrate` against the production `DATABASE_URL`.
