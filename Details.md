# Build prompt: private couples app

**The pitch:** A private, just-for-two relationship app called [App Name]. Warm and cute, never childish. Think a beautifully designed, intimate space for a couple, not a toy. Built like it came from a senior product designer and a senior engineer, not a weekend hack.

**Design direction (keep it short, trust your taste on the rest):**
- Warm, restrained palette: blush, cream, warm neutrals. No default purple or blue gradients, no glassmorphism, no cookie-cutter shadcn-with-default-styling look.
- Real typography and whitespace decisions, not template defaults.
- Emoji are welcome in copy and small touches (hearts, sparkles), never as childish illustrations, mascots, or confetti bursts.
- Avoid the common AI-app tells: generic onboarding carousel, centered card with a big drop shadow, Inter font left untouched.
- Non-negiotable: the app must feel like a private, intimate space for a couple, not a toy. It should feel like it was designed by a senior product designer and built by a senior engineer, not a weekend hack. It should not look like a vibe coded app.

**Stack:** Idea is to build an app that works on iOS, Android, and web with a single codebase. Use the following stack:
- Expo + React Native, one codebase for iOS, Android, and web (Expo Router and React Native Web)
- Vercel for the API layer
- CockroachDB (Basic) as the database
- Ably for realtime sync

**Build these completely. Real data, real persistence, no stubs, no mock states, something that works like a real app:**
1. Sign up and log in: real auth, real sessions, real password hashing
2. Partner pairing via an invite code, linking two accounts into one private space
3. Memory log: photo plus note, saved as a timeline, persists on refresh
4. Love note wall, separate from the memory log: pinned notes, updates live via Ably
5. Milestone tracker: anniversary, birthday, and custom dates with a live countdown
6. "Thinking of you" nudge, sent live via Ably while the app is open
7. Settings: profile, notification toggle, log out, delete account

**Time box: 40 minutes, hard stop.** Prioritize a smaller set of screens that work end to end over a larger set that's half wired. A feature that fully works on one platform beats a feature that's broken everywhere. Instead if you feel time is tight, focus on the core flows: sign up, pairing, memory log, and love note wall, the things that can will take time can be built later, no worres.

**Two things to flag honestly instead of faking:**
- Real push notifications to a closed app need Apple and Google credentials that can't be provisioned in this window. Use Ably for realtime updates while the app is open, and leave a clean, real hook for push later.
- Real subscription billing needs App Store and Play Store developer accounts plus review. Skip building a working payment flow. A simple "free" state in settings is enough for now.

Make your own calls on the data model, navigation structure, and exact visual details. I trust your judgment there.