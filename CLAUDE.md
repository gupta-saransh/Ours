# CLAUDE.md — Ours (private couples app)

Context for anyone (human or model) picking up this codebase.

## What this is

**Ours** — a private, just-for-two relationship app. One Expo codebase runs on iOS, Android, and web. Built from the brief in `Details.md`: real auth, partner pairing via invite code, photo+note memory timeline, live love-note wall, milestone countdowns, live "thinking of you" nudges, settings. **No stubs, no mock states** — every feature is wired end to end against real services.

## Stack

| Layer | Tech |
|---|---|
| App | Expo SDK 53 + React Native 0.79 + Expo Router 5 (`react-native-web` for web) |
| API | Vercel serverless functions (Node, TypeScript) in `api/` |
| Database | CockroachDB (Postgres wire protocol, `pg` driver) |
| Realtime | Ably (server publishes via REST, clients subscribe via token auth) |
| Auth | Email+password, `node:crypto` scrypt hashing, `jsonwebtoken` JWTs (30-day) |

Single `package.json` for both app and API — simplest thing that deploys to Vercel.

## Commands

```sh
npm install
npm run migrate        # applies db/schema.sql (idempotent), needs DATABASE_URL in .env
npm run typecheck      # tsc --noEmit over app/ src/ api/ scripts/
npm run build:web      # expo export --platform web → dist/
npx vercel dev         # API on :3000 (local dev)
npx expo start         # app; press w for web, Expo Go for device
```

Verification standard: `npm run typecheck` clean + `npm run build:web` succeeds. Full e2e needs real credentials in `.env` (see below).

## Environment (.env, template in .env.example)

- `DATABASE_URL` — CockroachDB connection string
- `ABLY_API_KEY` — server-side only, never shipped to clients
- `JWT_SECRET` — signs session tokens
- `EXPO_PUBLIC_API_URL` — `http://localhost:3000` locally (LAN IP for Expo Go on a phone); **empty on Vercel** (web app + API share an origin; client falls back to relative URLs)

**Status note:** as of the initial build there were no credentials — code is fully real but has never run against a live DB/Ably. If e2e hasn't been done yet, that's the first thing to verify once keys exist.

## Layout

```
app/                    Expo Router screens
  _layout.tsx           fonts (Fraunces), AuthProvider, RealtimeProvider
  (auth)/               welcome / sign-in / sign-up — redirects away if signed in
  pair.tsx              pairing gate: create space (shows code, polls /me) or join
  (tabs)/               guarded: signed out → /welcome, unpaired → /pair
    index.tsx           Memories timeline + composer modal (photo picker)
    notes.tsx           Love note wall (live), pin/unpin/remove, docked composer
    milestones.tsx      countdowns (1s ticker) + composer modal
    settings.tsx        profile, notifications toggle, plan row, log out, delete
    _layout.tsx         tab bar, header NudgeButton (♥), NudgeToast overlay
src/
  theme.ts              ALL design tokens — colors, fonts, type scale, space(), radius
  components/ui.tsx     Button, Field, Card, EmptyState, FormError
  components/NudgeToast.tsx
  lib/api.ts            fetch client; module-level auth token via setAuthToken()
  lib/auth.tsx          AuthContext: status/user/couple/partner + all auth actions
  lib/realtime.tsx      one Ably connection, one channel; useCoupleEvent(name, cb)
  lib/storage.ts        token: SecureStore native / localStorage web
  lib/format.ts         formatDay, formatTime, nextOccurrence, countdownTo
api/
  index.ts              THE ONLY deployed serverless function — a router.
                        Vercel Hobby caps deployments at 12 functions, so
                        vercel.json rewrites /api/* to this one function and
                        it dispatches on req.url. New endpoint = new module
                        in _routes/ + one entry in this file's routes table.
                        ':id' second segments bind to req.query.id.
                        (A [...path].ts catch-all was tried first and 404'd in
                        production with this static-build setup — keep the
                        index.ts + rewrite pattern.)
  _lib/db.ts            pg Pool (max 2, serverless), q() / one() helpers
  _lib/auth.ts          scrypt + JWT, requireUser / requirePairedUser
  _lib/ably.ts          publish(coupleId, event, data) — never throws into the request
  _lib/push.ts          REAL push hook, intentionally not delivering (see below)
  _lib/respond.ts       route() wrapper: CORS, method guard, HttpError → JSON
  _routes/              handler modules (underscore dirs are never deployed):
                        auth-{signup,login,me,account,profile}.ts
                        couple-{create,join,get}.ts
                        memories.ts · notes.ts · note-item.ts
                        milestones.ts · milestone-item.ts · nudge.ts · ably-token.ts
db/schema.sql           CREATE TABLE IF NOT EXISTS — safe to re-run
scripts/migrate.ts      runs schema.sql via tsx
vercel.json             expo web export = static build; /((?!api/).*) → index.html
```

## Data model

`couples` (id, invite_code 6-char unique) ← `users` (couple_id nullable, notifications_enabled, push_token) ← `memories` / `love_notes` / `milestones` (all keyed by couple_id + author_id). Photos are **base64 data-URLs stored in `memories.photo_data`** — compressed client-side to ~1200px JPEG q0.7 before upload (Vercel body cap is 4.5MB; API rejects >3.5MB).

## Security / privacy invariants (do not weaken)

1. **Every couple-scoped query filters by the authenticated user's `couple_id`** — privacy lives in the API, never the client.
2. `requireUser` re-reads the user row per request (JWT carries only `sub`) so `couple_id` is never stale after pairing.
3. Ably clients get **tokens scoped to `couple:{id}` subscribe-only** via `/api/ably-token`; the API key stays server-side. All publishes go through the API so data and events can't diverge.
4. A couple is closed at 2 members (`couple/join.ts` checks the count).
5. Users can only delete their own notes; milestone deletes are couple-scoped.

## Realtime events (channel `couple:{coupleId}`)

`note.created`, `note.pinned`, `note.deleted`, `memory.created` (metadata only — `photo_data` stripped; clients refetch), `nudge` ({fromId, fromName}), `partner.joined`. Clients ignore events where `fromId`/`author_id` is themselves.

## Design system (from Details.md — non-negotiable)

Warm, restrained, intimate — **never childish, never generic AI-app**. No purple/blue gradients, no glassmorphism, no drop-shadow hero cards, no onboarding carousel, no confetti/mascots. Emoji only as micro-touches (♥ nudge, ✦ pins).

- Tokens live **only** in `src/theme.ts`: cream `#FAF6F0` ground, ink `#3B2E2A`, blush `#EAC8C4`, rose `#B4574E` (primary action), sage `#7C8F80` accent, hairline `#EADFD5`.
- Headings: Fraunces (serif, `@expo-google-fonts/fraunces`); body: system sans. Memory/note bodies render in Fraunces serif.
- Surfaces use 1px hairline borders, not shadows. Pressed states darken (`rosePressed`), never scale-bounce.
- Content columns max out at 560px (`maxWidth` + `alignSelf: 'center'`) so web looks intentional.
- Copy voice: warm second person ("your person", "a moment worth keeping").

## Honest limitations (flagged in the brief — don't fake these)

- **Push to closed apps**: needs APNs/FCM credentials. The real integration point is `api/_lib/push.ts` (`sendPush()` + `users.push_token` + registration via `PATCH /api/auth/profile`). Wire credentials into `sendPush` and it lights up; today it checks the recipient's preference and returns `delivered: false` with a reason. Live-while-open delivery via Ably is real.
- **Billing**: no payment flow by design; Settings shows "Free · everything included".

## Gotchas learned during the build

- **Never add a non-underscore file directly under `api/`** — each one becomes another serverless function and Vercel Hobby allows 12 per deployment. `api/index.ts` must stay the only one; put handlers in `api/_routes/` and register them in its routes table. The `/api/:path*` rewrite in `vercel.json` is what routes requests to it — don't remove it.
- **`jsonwebtoken` not `jose`** — jose is ESM-only and this package is CJS (adding `"type": "module"` risks breaking Metro/Expo tooling).
- **`expo-asset` must stay installed** — expo-font's web loader imports it; web export fails without it.
- **Component `style` props are `StyleProp<ViewStyle>`**, not `ViewStyle` — callers pass style arrays.
- Alerts/confirms are **inline two-step UI** (see delete-account in settings.tsx) because `Alert.alert` doesn't work on web.
- Date input on milestones is a validated `YYYY-MM-DD` text field — no native date-picker dependency, works on all three platforms.
- `route()` in `_lib/respond.ts` sets permissive CORS because local dev runs Expo (:8081) and the API (:3000) on different origins.
- Invite codes use alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I — they get read aloud).
- Windows machine; user's shell is PowerShell (`&&` unsupported in PS 5.1 — use the Bash tool for chained commands).

## Hard constraints from the user

- **Never touch git** — the user commits/pushes/deploys themselves. `.gitignore` is set up (excludes `node_modules`, `dist`, `.expo`, `.env`).
- Deployment target is Vercel via GitHub import; `vercel.json` already handles build + rewrites. Env vars must be set in the Vercel project, then `npm run migrate` run once against the production `DATABASE_URL`.
