# Ours ♥

A private, just-for-two relationship app. One Expo codebase for iOS, Android, and web; Vercel serverless API; CockroachDB for persistence; Ably for realtime.

## What's inside

- **Landing page** explaining the app, then real auth: email + password (scrypt hashing), JWT sessions
- **Optional pairing**: every account starts with its own space; share a 6-letter code whenever you're ready, and joining migrates everything you added
- **Home dashboard**: days-together count, a resurfaced memory (one year or one month ago today), upcoming milestones, and a shared bucket list
- **Memory calendar + timeline**: tap any day to keep a photo and note for it; days with memories show a heart; the timeline below scrolls your photos, with heart reactions
- **Love note wall** with pinning, emoji, and live delivery via Ably
- **Milestones** with second-level countdowns; anniversaries and birthdays recur yearly
- **Notifications**: every nudge, memory, note and milestone is stored and surfaces under the bell, live
- **"Thinking of you" nudge**, settings, notification toggle, delete account

## Setup

1. **Environment** — copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — CockroachDB connection string (Cloud console → Connect)
   - `ABLY_API_KEY` — from your Ably app's API keys
   - `JWT_SECRET` — any long random string
   - `EXPO_PUBLIC_API_URL` — `http://localhost:3000` for local dev (use your machine's LAN IP when testing on a phone via Expo Go)

2. **Database** — apply the schema (idempotent):
   ```sh
   npm install
   npm run migrate
   ```

3. **Run locally** — two terminals:
   ```sh
   npx vercel dev          # API on :3000
   npx expo start          # app — press w for web, or scan with Expo Go
   ```

## Deploying to Vercel

Import the repo into Vercel — `vercel.json` already builds the Expo web export and serves `api/` as serverless functions. Set these environment variables in the project settings:

- `DATABASE_URL`, `ABLY_API_KEY`, `JWT_SECRET`
- `EXPO_PUBLIC_API_URL` — leave **empty/unset**: the deployed web app and API share an origin

Then run `npm run migrate` once locally (with the production `DATABASE_URL` in `.env`) to create the tables.

## Honest limitations

- **Push notifications to a closed app** need APNs/FCM credentials tied to Apple/Google developer accounts. The real hook is in place — `users.push_token`, a registration path, and `sendPush()` in [api/_lib/push.ts](api/_lib/push.ts) — wire credentials into that one function and it lights up. While the app is open, delivery is already real via Ably.
- **Billing** — real subscriptions need store developer accounts + review, so Settings shows a simple free state instead of a fake checkout.

## Architecture notes

- `app/` — Expo Router screens; `(auth)` group → `pair` gate → `(tabs)`
- `src/lib` — API client, auth context, Ably realtime context
- `api/` — a **single** serverless function (`api/index.ts`, reached via the `/api/:path*` rewrite in `vercel.json`) routes to handler modules in `api/_routes/`, staying well under Vercel Hobby's 12-function cap with room to grow; every couple-scoped query filters by the authenticated user's `couple_id`, so privacy is enforced server-side
- Ably clients authenticate with tokens scoped to their own couple's channel only (`/api/ably-token`); the API key never leaves the server
