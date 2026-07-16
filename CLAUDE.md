# CLAUDE.md — Ours (private couples app)

Context for anyone (human or model) picking up this codebase.

## What this is

**Ours** is a private, just-for-two relationship app. One Expo codebase runs on iOS, Android, and web. Original brief in `Details.md`; it has since grown: a public landing page, a post-login home dashboard, a notification service, a calendar-based memory log, heart reactions, a shared bucket list, optional pairing, and (phase 2) a daily prompt with mutual reveal, time capsules, a date planner, per-partner wishlists with secret gift plans, and Sunday weekly reflections. **No stubs, no mock states.**

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

Environment: `.env` from `.env.example` (`DATABASE_URL`, `ABLY_API_KEY`, `JWT_SECRET`, `EXPO_PUBLIC_API_URL` (stays EMPTY on Vercel), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` for Web Push (generated once via `npx tsx scripts/generate-vapid.ts`), and `MASTER_ENCRYPTION_KEY` for envelope encryption at rest (256-bit, base64; generated once via `npx tsx scripts/generate-master-key.ts`; if unset the app runs with encryption OFF so nothing breaks)). Deployed via GitHub import into Vercel; env vars live in Vercel project settings.

`npm test` runs vitest over `api/**/*.test.ts` (server route unit tests; `memory-item.test.ts` guards the per-user hearts rule).

## Product structure

- **Landing** `app/(auth)/welcome.tsx`: public marketing page (hero, three feature cards, CTA). Signed-out users at `/` land here.
- **Auth** sign-up/sign-in. **Signup auto-creates a solo space** (couple row); pairing is optional.
- **Pairing** `app/pair.tsx`: NOT a gate. Share your code or join theirs; joining migrates everything you authored into their space (see `api/_routes/couple-join.ts`).
- **Home** `app/(tabs)/index.tsx`: days-together count (basis: earliest anniversary milestone, else couple created_at), hero marks (both partners' avatars with a ♥ between; falls back to the initials monogram), invite banner when solo, story chapter card, resurfaced memory (1 year ago today > 1 month ago today > random older), next two milestones, bucket list (add/complete inline), latest pinned note. Powered by ONE aggregate call: `GET /api/home`.
- **Memories** `app/(tabs)/memories.tsx`: two parts. (1) Month calendar; days that hold a memory render a ♥ instead of the number; tapping a (non-future) day opens the composer pinned to that date (`memory_date` column). (2) Photo timeline with heart reactions and a full-photo viewer. Tapping the photo or note opens the viewer; the MessageCircle button (always visible) expands the comment thread INLINE under the card, Facebook-style (`MemoryComments` with `variant="light"`; the dark variant stays in the viewer). On web >= 900px calendar and timeline sit side by side. `MemoryImage` falls back to fetching the full photo for rows created before thumbnails existed (thumb_data null but has_photo true); do not remove that fallback.
- **Notes** `app/(tabs)/notes.tsx`, the letter wall (redesigned): composer card at TOP (serif input whose placeholder is a rotating "spark" starter; ✦ Sparkles button deals another, Smile toggles the emoji palette, Lock seals a capsule, wax-seal ♥ disc sends; no helper copy under it, just the LockBadge). Wall cards carry a tiny deterministic tilt (`tiltFor(id)`, pinned cards sit straight on blush), and ONE footer row: avatar + name + relative time on the left, icon tools on the right (Pin icon, gold + filled when pinned; Trash2 on your own; then the heart). Hearts: you can heart only your partner's notes; your own shows a bare "♥ Loved" once they do (`note_hearts` v9, PATCH /api/notes/:id { hearted }, settles on the server response). Kept deliberately word-light per user feedback: icons over labels, no explanatory text.
- **Avatars ("marks")** `src/components/Avatar.tsx`: curated set of 12 lucide icons on tinted discs (ids must match `AVATAR_IDS` in `api/_routes/auth-profile.ts`); no upload, no emoji. Picked in Settings → Profile ("Your mark"), stored on `users.avatar` (v9), carried ONLY by `/api/auth/me` (self + partner) — list routes never join it because every author in a couple is one of the two `useAuth()` people. Fallback = serif initial disc. Shown on the Home hero, note cards, comment threads, and the Settings partner row.
- **Milestones** yearly recurrence for anniversary/birthday, second-level countdowns.
- **Daily prompt** (`api/_routes/prompts.ts`, home card + `app/(tabs)/prompts.tsx` history): one static-pool question per day, deterministic by date; answers are private until BOTH partners submit, then reveal. One submission per person per day.
- **Streak** (in `prompts.ts`): a day counts when both partners answered (advance runs at the reveal, race-safe via the UPDATE's `last_streak_date` guard). UTC days, one grace day per Monday-to-Sunday UTC week (`couples.current_streak_days/longest_streak_days/last_streak_date/grace_used_week`, v6). `streakStateFor` is the read view (lapsed streaks display 0 without writing). Surfaced from DAY ONE (a >= 2 gate made it look unbuilt): hero chip on Home ("Day 1 of your streak" then "N days in a row"), quiet lines on the prompt card ("Day one. Come back tomorrow to make it two. ♥"), a header line on the prompts history screen, and a "Grace day used. Streak continues." toast. No confetti, no leaderboards.
- **Story chapters** (in `home.ts`): the second retention hook. Everything durable the couple keeps writes "pages" (memories x5, dates x5 but ONLY once the date has happened (`dates_done`: accepted AND proposed_for null-or-past), prompt answers x3, bucket done x3, notes x2, milestones x2, comments x1); `CHAPTERS` thresholds name the chapter (First Glance -> Ever After, 10 of them). Computed on read from count(*) subqueries in the home aggregate (raw `counts` ride along in the response), no counter column, cannot drift. Home renders a quiet card with a chevron: TAP expands the page-source breakdown inline, "All chapters" opens the chapter-map Sheet. Crossing a threshold shows a one-time sealed "A new chapter" ceremony sheet with a top-3 summary (`chapterSummary`); last celebrated chapter sits in `localStorage['ours.story-chapter']` (web; native skips). CHAPTERS + PAGE_SOURCES are duplicated client-side in `app/(tabs)/index.tsx`; keep both in sync with home.ts. No points UI language anywhere: pages and chapters only.
- **Hearts shower** `src/components/HeartsRain.tsx` (mounted once in the tabs layout next to NudgeToast): a ~2.5s rain of ♥ glyphs (oxblood/gold/blush, staggered falls, pointerEvents none). Fires live on the `nudge` Ably event (not your own), and on app open via `showHearts()` when `/api/home` returns `nudged: true` (an unseen nudge from the last 48h, computed with a FILTER clause on the unseen-notifications query); Home guards it to once per open. The user explicitly asked for this; it is the ONE sanctioned shower, do not add confetti elsewhere.
- **Time capsules**: notes and memories accept `sealedUntil`. Partner-authored sealed rows come back with content stripped server-side (never client-side). After the reveal date they show as "ready to open"; first open is recorded in `capsule_opened_at` and notifies the author. Memory opens happen via GET /api/memories/:id; note opens via PATCH /api/notes/:id { open: true }.
- **Date planner** `app/(tabs)/dates.tsx`: propose title/location/date; the OTHER partner accepts, declines, or counters (all via PATCH /api/dates/:id { action }); accepting a dated proposal creates a custom milestone in the same transaction. EVERY row opens a status-aware detail sheet (`ProposalDetail`): partner's open proposal = accept/counter/decline, own open = "they decide" note, accepted = countdown + milestone note, declined/countered = a "Propose something new" nudge.
- **Wishlist** `app/(tabs)/wishlist.tsx`: each partner owns a list, the other reads it. `secret` rows are gift plans added to the PARTNER's list, hidden from the owner forever (server-side filter, do not weaken). Partner toggles `gotten`; owner never sees who got it.
- **Weekly reflection** (`api/_routes/reflection.ts`): Monday-to-Sunday UTC counts computed on read, home card on Sundays only, savable snapshots browsable at `app/(tabs)/reflections.tsx`.
- **Notifications** `app/(tabs)/notifications.tsx` (hidden tab, reached via bell): every partner action (kinds: nudge, memory, note, milestone, partner, bucket, prompt, capsule, date, wishlist), stored in `notifications` AND pushed live over Ably. Unread dot in `src/lib/notifications.tsx`; `users.notifications_seen_at` tracks read state.
- **Navigation**: 5 tabs (Home, Memories, Notes, Dates, Wishlist); Milestones, Settings, Notifications, Prompts, Reflections are hidden tabs (`href: null`) reached from home/bell/TopNav. Web >= 900px gets `src/components/TopNav.tsx`; native/narrow gets bottom tabs + `src/components/HeaderActions.tsx`. Home has no header; its hero row carries Nudge/Bell/Settings.

## Design system implementation (phase 2 foundation)

- `src/theme.ts` owns everything: `sp` spacing scale (4..56, only those values), `radius` (sm 6 photos/inputs, md 10 cards, lg 16 sheets, pill), `text` presets (display/title/subtitle/section/body/bodySerif/caption/micro; Fraunces = couple-authored content, system sans = chrome), `motion` (press 0.98/120ms, fade 180ms, sheet spring 220/26), semantic colors (`surface`, `surfaceRaised`, `surfaceSealed` oxblood, `onSealed`, `ink/inkMuted/inkFaint`, `hairline`, `accent` gold, `positive` olive). Legacy aliases (cream/rose/blush...) remain for stragglers; prefer semantic names.
- **Theme presets (P1.5, shipped web-only)**: 5 palettes (`parchment` default, `dusk`, `meadow`, `tide`, `petal`) built by `makeColors(seed)` in `src/theme.ts`; spacing/radius/type/motion never vary. Because every screen bakes `colors` into module-scope StyleSheets, the preset id is read SYNCHRONOUSLY from `localStorage['ours.theme']` at bundle evaluation; switching (Settings → Appearance, web-gated) = `persistThemePreset(id)` + `updateProfile({ themePreset })` + one `location.reload()`. The look is SHARED per couple: `couples.theme_preset` (v8; the v7 `users.theme_preset` is abandoned, kept additive-only), either partner sets it, and the other partner picks it up on their next app load via `refresh()` in `src/lib/auth.tsx` (reloads once when the couple's preset differs from the evaluated one). An inline script in `app/+html.tsx` paints `localStorage['ours.theme-bg']` before the bundle loads so non-parchment themes don't flash. Native has no sync storage at module scope, so it always runs parchment and hides the picker; a live ThemeProvider refactor is the eventual native path. New preset = add to `PALETTES` + `THEME_PRESETS` in theme.ts AND `THEME_PRESET_IDS` in `api/_routes/auth-profile.ts`.
- `src/components/kit.tsx` is the component library: Screen, Section, Card (+ `sealed` variant), PressableCard, AppPressable (shared press scale), PrimaryButton/SecondaryButton/IconButton, TextField (bottom-hairline style, gold focus), Pill, ListRow, Empty (✦ + serif line), Skeleton (olive 8%, 400ms delay), ErrorState, FormError, FadeIn. `src/components/Sheet.tsx` = bottom sheet native / right panel on web >= 900. Old `src/components/ui.tsx` was deleted; do not recreate it.
- Icons: `lucide-react-native` everywhere (works on web via react-native-svg), stroke 1.75. No emoji as chrome; ♥ ✦ stay as content marks.
- Haptics via `src/lib/haptics.ts` (`tapHaptic` on tab/segment changes, `successHaptic` on submit/heart/accept/unseal), web no-op.
- No shadows anywhere; depth = hairline border + surfaceRaised.

## Performance contract (why the app is fast; do not regress)

1. **List endpoints NEVER return full-resolution photos.** `GET /api/memories` carries only ~15 KB thumbnails (`thumb_data`, client-generated at 360px/q0.55). The full photo (1200px/q0.7) is stored in `photo_data` and fetched only by `GET /api/memories/:id` when the viewer opens.
2. **Home is one request** (`/api/home`), all queries in `Promise.all`.
3. Ably events carry ids/metadata, never image payloads.
4. Remaining latency is Vercel cold start + DB round trip: keep the Vercel function region next to the CockroachDB region (project Settings -> Functions).

## API surface (all via api/index.ts router; add endpoint = module in _routes/ + one table entry)

auth/signup (creates solo space) · auth/login · auth/me · auth/profile (name/notifications/pushToken/themePreset/avatar) · auth/account · couple (GET) · couple/create · couple/join (migrates content) · memories (GET list/POST) · memories/:id (GET full photo / PATCH heart / DELETE any couple memory) · notes (GET/POST, list carries hearts + hearted_by_me) · notes/:id (PATCH pin or heart or open / DELETE own) · milestones (GET/POST) · milestones/:id (DELETE) · notifications (GET list+unseen / POST mark seen) · bucket (GET/POST) · bucket/:id (PATCH done / DELETE) · home (GET aggregate) · push/subscribe (POST, store Web Push subscription in push_token) · push/vapid-public-key (GET, no auth) · nudge (POST) · ably-token (GET)

`_lib/`: db (pg pool), auth (scrypt/JWT, `requirePairedUser` lazily creates a space for legacy accounts), ably, notify (insert notification + publish + best-effort Web Push to the partner), notification-routes (kind -> deep-link path), invite (code + space creation, wraps a fresh DEK), push (real Web Push via `web-push` + VAPID; native APNs/FCM still needs store creds), **envelope** (encryption at rest, see below), respond (route wrapper: CORS/methods/errors).

### Envelope encryption at rest (`api/_lib/envelope.ts`)

The single encrypt/decrypt boundary (a future move to E2E is a swap of this module + a client layer, not a route rewrite). Two key layers: a **master key** (256-bit, base64 in `MASTER_ENCRYPTION_KEY`, never in the DB) wraps a per-couple **DEK** (256-bit random, stored AES-256-GCM-wrapped on `couples.wrapped_dek`); field values are encrypted with the couple's DEK. Ciphertext layout per value: `iv(12) || ciphertext || authTag(16)` as one `BYTEA`.

- API: `encryptionEnabled()`, `freshWrappedDek()` (used by `invite.createCoupleForUser`), `encryptField(coupleId, plaintext) -> Buffer|null`, `decryptField(coupleId, blob) -> string|null`, `readField(coupleId, ct, plaintext)` (prefer decrypted ct, else the plaintext column).
- **Graceful degradation**: with no master key set, every helper returns null and callers read/write plaintext exactly as before, so the deployed app keeps working until the key is provisioned. Legacy couples get a DEK minted lazily on first use.
- **Storage pattern**: each encrypted column has a `<field>_ct BYTEA` beside the original. When encryption is ON, writes store the plaintext column empty (`''`/NULL) and the ciphertext in `_ct`; reads use `readField` (decrypt `_ct`, fall back to plaintext for old/never-backfilled rows). Old plaintext columns are NOT dropped (additive only). `scripts/backfill-encryption.ts` encrypts pre-existing rows (idempotent; blanks plaintext after).
- **Encrypted fields**: `memories.note`, `love_notes.body` (covers note/memory time-capsule content), `daily_prompt_answers.text`, `wishlist_items.title/url/notes`, `date_proposals.title/location`. NOT encrypted (by design): milestone titles (list-view), bucket titles, reflection counts, timestamps, FKs, wishlist `secret` flag. `notify()` text must never embed an encrypted value (it would leak into the plaintext `notifications` table) — wishlist/date notifications are deliberately generic.
- **Pairing migration**: `couple-join.ts` re-wraps the migrated encrypted fields (`memories.note_ct`, `love_notes.body_ct`) from the joining user's DEK to the target couple's DEK inside the merge transaction (`recryptBlob`), so content stays readable under the new key. Any encrypted field that becomes migratable later must be added to that route's `MIGRATED_CT` list.
- **Ably** carries plaintext for these fields (server already holds it; the channel is TLS + subscribe-only scoped tokens). "Encryption at rest" is about the database, not the realtime hop.
- **`/api/auth/me`** returns `encryption: boolean` plus `encryptionCode` (the "seal code": `keyFingerprint()` = SHA-256 of the couple's DEK with a fixed context string, mapped to 8 chars of the invite alphabet as `XXXX-XXXX`; one-way, identical for both partners, shown in Settings → Privacy so the couple can compare phones). The client threads both through `useAuth()`; `LockBadge` on composers and the Privacy copy never overclaim when the key is absent.
- **Key rotation (not automated)**: to rotate `MASTER_ENCRYPTION_KEY`, for every couple: unwrap `wrapped_dek` with the OLD master key, re-wrap with the NEW one, write it back (one pass, DEKs and field ciphertext are untouched). Rotating a couple's DEK instead means decrypting every field with the old DEK and re-encrypting with the new one. Never change the master key without re-wrapping, or all data becomes unreadable.

## Data model

`couples` (+ `wrapped_dek BYTEA` for envelope encryption, streak counters v6, `theme_preset` v8 shared look) · `users` (couple_id, notifications_enabled, notifications_seen_at, push_token, `avatar` v9 mark id) · `memories` (photo_data full, thumb_data small, memory_date DATE, note, `note_ct`) · `love_notes` (pinned, `body_ct`) · `milestones` (kind: anniversary|birthday|custom) · `notifications` (couple_id, actor_id, kind, text) · `memory_hearts` (memory_id+user_id PK) · `note_hearts` (note_id+user_id PK, v9) · `bucket_items` (title, done) · `daily_prompt_answers` (`text_ct`) · `wishlist_items` (`title_ct`/`url_ct`/`notes_ct`) · `date_proposals` (`title_ct`/`location_ct`). The `_ct` columns are v4 envelope-encryption ciphertext (see envelope section); plaintext columns remain for fallback and are not dropped. Schema is idempotent (`CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`); always safe to re-run migrate.

## Realtime events (channel `couple:{coupleId}`)

`note.created` `note.pinned` `note.deleted` `note.hearted` (id + count + by) `memory.created` (id only, clients refetch) `memory.deleted` `memory.hearted` `nudge` `partner.joined` `notification` (feeds the bell dot). Clients ignore their own events by actor/author id.

## Security invariants (do not weaken)

1. Every couple-scoped query filters by the authenticated user's `couple_id`; privacy lives in the API.
2. JWT carries only `sub`; `requireUser` re-reads the user row per request so couple_id is never stale.
3. Ably tokens are subscribe-only, scoped to the user's own couple channel (`/api/ably-token`); the API key never leaves the server.
4. Spaces cap at 2 members; joining a full space is rejected. Deletes are own-content-only EXCEPT memories, which either partner may delete (couple_id still enforced; intentional, confirmed by the user).

## Design system (non-negotiable)

Direction: **aged love letters**. Parchment `#F4ECDD` ground, espresso ink `#33241C`, oxblood `#7E382C` primary (wax seal), ochre gold `#B8862F` flourishes, dry olive `#77743F` secondary. Deliberately NOT the blush/rose default of AI-generated apps. All tokens in `src/theme.ts` only, including `onRose` for text on oxblood; never hardcode hex in screens.

- Fraunces serif for display/headings and memory/note bodies; system sans elsewhere.
- 1px hairline borders, no shadows; pressed states darken, never bounce.
- Content columns max ~560-680px, centered.
- Emoji as micro-touches only (♥ nudge, ✦ pins, calendar hearts); no mascots, no confetti.
- **Copy rules: warm second person, and NEVER use em dashes (—) in user-facing copy.** Use commas or periods.

## Honest limitations (do not fake)

- Web Push (browser / installed PWA) is REAL: VAPID keys + `web-push` in `api/_lib/push.ts`, subscription JSON stored in `users.push_token`, delivered on every `notify()`. Needs the three `VAPID_*` env vars set on Vercel. Closed-app push to a real NATIVE iOS/Android binary still needs APNs/FCM store credentials; those are not provisioned. In-app realtime via Ably is real.
- Billing: Settings shows a free state; no payment flow by design.

## Gotchas

- **Never add a non-underscore file directly under `api/`**; Vercel Hobby caps deployments at 12 functions. `api/index.ts` must remain the only one; the `/api/:path*` rewrite in `vercel.json` routes to it (a `[...path].ts` catch-all was tried and 404'd in production; keep the rewrite pattern). Rewrite order matters: the api rewrite must precede the SPA fallback.
- **PWA / iOS standalone**: web output is `"static"` (app.json) so Expo Router honors `app/+html.tsx`, where the manifest link + `apple-mobile-web-app-*` meta tags live. Static assets in `public/` (manifest.json, sw.js, favicon.png, icons/) copy to `dist/` root verbatim and are served before the SPA rewrite (proven: `_expo/` JS loads fine). Icons are real PNGs generated dependency-free by `scripts/generate-icons.ts` (no sharp/canvas). `vercel.json` `headers` set the manifest content-type + sw.js no-cache. The service worker is registered client-side from `src/lib/push-web.ts` (web only, no auto-prompt); permission is requested only from the Settings toggle.
- `jsonwebtoken` not `jose` (jose is ESM-only; this package is CJS).
- `expo-asset` must stay installed (expo-font's web loader needs it).
- Component `style` props are `StyleProp<ViewStyle>`, not `ViewStyle`.
- Confirms are inline two-step UI (Alert.alert does not work on web).
- Milestone dates are validated `YYYY-MM-DD` text fields (no native picker dependency).
- Invite codes use `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I).
- Windows machine; PowerShell 5.1 has no `&&`; use the Bash tool for chained commands.
- iOS Safari auto-inflates small text ("text size adjust"), which blew the 11px tab labels past the fixed-height tab bar and clipped them. `app/+html.tsx` sets `html { -webkit-text-size-adjust: 100% }`; the tab bar also pins `lineHeight: 14` + `tabBarAllowFontScaling: false`. Keep all three.

## Hard constraints from the user

- **Never touch git.** The user commits/pushes/deploys themselves.
- After schema changes, remind the user to run `npm run migrate` against the production `DATABASE_URL`. Symptoms of a missed migration: home stuck on its error state, uploads failing, 500s in Vercel function logs mentioning missing columns or relations. Data is never lost by this; the API just errors until the migration runs.

## Universal add button (`src/components/AddMenu.tsx`)

Wax-seal FAB anchored bottom-right (offset above the tab bar + safe-area bottom), rendered once in `app/(tabs)/_layout.tsx`. Tapping raises a VERTICAL column of four labelled actions (Add memory, Add note, Add wishlist item, Propose a date; labels to the LEFT of each disc so nothing can overlap — the original quarter-arc collided its own labels and was replaced). Milestone adds live on the Home/Milestones screens. Staggered fade+rise, no bounce; dismiss on tap-outside or swipe-down (scrim `PanResponder`). Visible only on the 5 main tab routes (`usePathname` gate); composers/viewers are RN `Modal`s that portal above it. Each action `router.navigate`s with a fresh `compose` nonce; the target screen opens its composer via `useComposeParam` (`src/lib/useComposeParam.ts`) — wishlist always opens on the user's own list.

## Safe-area bottom (`src/lib/safeArea.ts`)

`useSafeBottom()` is the ONLY correct way to read the bottom inset. react-native-safe-area-context's web provider proved unreliable in the iOS home-screen PWA (insets stayed 0, tab bar sat under the home indicator), so the hook takes `Math.max` of the context value and a direct DOM measurement of `env(safe-area-inset-bottom)`, with a 34px fallback for home-indicator iPhones in standalone when env() itself reports 0. Used by the tab bar (`app/(tabs)/_layout.tsx`), `AddMenu`, and the toast. It tolerates a missing SafeAreaProvider (the root toast overlay has none).

## Session log

Newest first. Each entry is one shipped (or explicitly deferred) item.

- **P3.1 delight pass — SHIPPED**: (1) story card is now interactive: tap = inline page-source breakdown, "All chapters" = chapter-map sheet, threshold crossing = one-time sealed ceremony sheet with summary (user could not tell what the card did or that anything was behind it). (2) Date pages score only when the date actually happened (`dates_done`), not on acceptance. (3) `HeartsRain`: hearts shower on nudge, live and on-open (`home.nudged`, 48h window). (4) Notes wall de-worded: icon tools (Pin/Trash2/heart) in one footer row, "♥ Loved", composer helper caption removed. No schema change, no migrate needed.
- **P3 engagement pass — SHIPPED** (one session, six items): (1) streak surfaced from day 1 (the >= 2 gates made a working feature invisible; the user read it as unbuilt). (2) Story chapters retention hook in `/api/home` + Home card (pages/chapters, see Product structure). (3) Facebook-style INLINE comment threads under memory cards (`MemoryComments` grew a `variant` prop: 'light' inline / 'dark' viewer; comment button always visible and toggles the thread, photo/note tap still opens the viewer). (4) Avatars/"marks" (v9 `users.avatar`, curated lucide set in `src/components/Avatar.tsx`; carried only by auth/me since any author is one of the two `useAuth()` people, and auth/me's avatar selects are `.catch(() => null)`-guarded so a pre-migration deploy degrades instead of clearing sessions). (5) Notes redesigned as the letter wall (top composer with rotating spark placeholders, tilted cards, avatar attribution, `note_hearts` v9 reactions with "{name} loved this" payoff on your own notes). (6) Date rows of every status open a `ProposalDetail` sheet (accepted shows countdown + milestone note; previously accepted/declined rows were dead and own-open rows wrongly offered Accept). Needs `npm run migrate` (v9).
- **P2.7 streak system — SHIPPED** — see the Streak bullet under Product structure. Columns were pre-added as v6; logic + UI landed together (no timezone column: streak days are UTC, matching the prompt's own day boundary and the reflection weeks).
- **P1.5 theme presets — SHIPPED (web-only)** — see the Theme presets bullet under Design system implementation. The blocker (colors baked into module-scope StyleSheets) was solved by choosing the palette synchronously at bundle evaluation from localStorage + one reload on switch, instead of the ~30-file ThemeProvider refactor; that refactor is still the path to native support.
- **Encryption seal code — SHIPPED** — `keyFingerprint()` in `envelope.ts`, `encryptionCode` on `/api/auth/me`, "Your seal code" row in Settings → Privacy. Purely reassurance UX; reveals nothing about the key.
- **Tab labels clipped on iOS (the real fix)** — iOS Safari's text-size-adjust auto-inflated the 11px tab labels ~2x past the fixed-height bar; height/inset fixes could never touch it. `+html.tsx` sets `-webkit-text-size-adjust: 100%`, the tab bar pins label `lineHeight: 14` + `tabBarAllowFontScaling: false`, content height 58.
- **Bugfix pass (post-deploy report)** — (1) Notes 500: `notes.ts` GET passed `[couple_id, user.id]` to a query with only `$1` (CockroachDB rejects arg-count mismatches outright; the Vercel log said `wrong number of format codes specified: 2 for 1 arguments`); the sealed-stripping had moved to JS but the arg stayed. When editing a shared COLUMNS constant, recheck every call site's params. (2) Tab bar under the iPhone home indicator despite `useSafeAreaInsets`: replaced with `useSafeBottom()` (see Safe-area section). (3) Memory viewer backdrop was rgba 0.92, so the parchment timeline bled through and made the comment thread unreadable; now opaque `#1C120C`, comment palette brightened (secondary alpha 0.72, filled input). (4) FAB arc labels overlapped each other; replaced with a 4-action vertical column. (5) Heart toggle now settles on the PATCH response (`hearts`, `hearted_by_me`) instead of trusting the optimistic guess. (6) Bottom toast restyled ink-on-cream → cream-on-ink chip, positioned above the tab bar. (7) Notifications GET hides read items older than 2 days (unread never expire) and lazily deletes rows older than 30 days. (8) Copy: "exactly two people" → "For you and your favorite person" / "a little home for the two of you"; subtle encrypted-at-rest lines on the landing hero and Home footer (gated on the `encryption` flag); Settings privacy no longer mentions "working toward end to end".
- **Memory comment counts** — `GET /api/memories` now carries a `comments` count per row (subquery on `memory_comments`; NEEDS the v5 migration or the whole list 500s); card footers show a MessageCircle + count that opens the viewer; `memory.commented` Ably events carry `created`/`deleted` flags so list counts update without a refetch (own events included, deliberately not filtered by actor).
- **P1.6 comments on memories — SHIPPED** — `memory_comments` table (v5), `comments`/`comments/:id` routes (author-only edit/delete mirroring the hearts rule, body encrypted via envelope, generic notification text), `MemoryComments` thread inside the memory viewer, id-only realtime with refetch.
- **P0.1 tab-bar safe area** — bottom tab bar now sizes from `useSafeAreaInsets().bottom` (`app/(tabs)/_layout.tsx`), so icons/labels clear the iPhone PWA home indicator; background still fills behind it.
- **P0.2 per-user memory hearts** — server already scoped heart insert/delete to the JWT user; added vitest + `api/_routes/memory-item.test.ts` proving Partner B can never delete Partner A's like (or smuggle a user id via the body). `npm test` added.
- **P1.3 universal add button** — see the AddMenu section above. Five screens wired to `useComposeParam`.
- **P1.4 envelope encryption at rest** — full infrastructure (envelope module, per-couple wrapped DEK, v4 `_ct` columns, graceful degradation), wired end-to-end for memories, notes, prompts, wishlist, dates + the home aggregate; `scripts/backfill-encryption.ts` + `scripts/generate-master-key.ts`; Settings → Privacy section + composer `LockBadge`; `/api/auth/me` exposes the `encryption` flag. Requires `MASTER_ENCRYPTION_KEY` in Vercel + `npm run migrate`; optional backfill for existing rows.
