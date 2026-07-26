CREATE TABLE IF NOT EXISTS couples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code STRING UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email STRING UNIQUE NOT NULL,
  password_hash STRING NOT NULL,
  display_name STRING NOT NULL,
  couple_id UUID REFERENCES couples(id),
  notifications_enabled BOOL NOT NULL DEFAULT true,
  push_token STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  photo_data STRING,
  note STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS love_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  body STRING NOT NULL,
  pinned BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  title STRING NOT NULL,
  date DATE NOT NULL,
  kind STRING NOT NULL DEFAULT 'custom',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_by_couple ON memories (couple_id, created_at DESC);
CREATE INDEX IF NOT EXISTS love_notes_by_couple ON love_notes (couple_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS milestones_by_couple ON milestones (couple_id, date ASC);

-- v2: calendar memories, thumbnails, notifications, hearts, bucket list
ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_date DATE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS thumb_data STRING;
-- NOTE: Commented out to prevent CockroachDB async backfill error (42P10)
-- UPDATE memories SET memory_date = created_at::DATE WHERE memory_date IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  kind STRING NOT NULL, -- nudge | memory | note | milestone | partner | bucket
  text STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_by_couple ON notifications (couple_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_hearts (
  memory_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, user_id)
);

CREATE TABLE IF NOT EXISTS bucket_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  title STRING NOT NULL,
  done BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bucket_by_couple ON bucket_items (couple_id, done, created_at DESC);

-- v3: daily prompts, time capsules, date planner, wishlist, weekly reflections
CREATE TABLE IF NOT EXISTS daily_prompts (
  prompt_date DATE PRIMARY KEY,
  text STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_prompt_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  user_id UUID NOT NULL,
  prompt_date DATE NOT NULL,
  text STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (couple_id, user_id, prompt_date)
);
CREATE INDEX IF NOT EXISTS prompt_answers_by_couple ON daily_prompt_answers (couple_id, prompt_date DESC);

ALTER TABLE love_notes ADD COLUMN IF NOT EXISTS sealed_until DATE;
ALTER TABLE love_notes ADD COLUMN IF NOT EXISTS capsule_opened_at TIMESTAMPTZ;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS sealed_until DATE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS capsule_opened_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS date_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  proposer_id UUID NOT NULL,
  title STRING NOT NULL,
  location STRING,
  proposed_for DATE,
  status STRING NOT NULL DEFAULT 'open', -- open | accepted | declined | countered
  counter_of UUID,
  milestone_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dates_by_couple ON date_proposals (couple_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  added_by UUID NOT NULL,
  title STRING NOT NULL,
  url STRING,
  notes STRING,
  secret BOOL NOT NULL DEFAULT false,
  gotten BOOL NOT NULL DEFAULT false,
  gotten_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wishlist_by_couple ON wishlist_items (couple_id, owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weekly_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  week_start DATE NOT NULL,
  counts JSONB NOT NULL,
  highlight_memory_id UUID,
  saved_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (couple_id, week_start)
);

-- v4: envelope encryption at rest. Each couple gets a random 256-bit data
-- encryption key (DEK), wrapped with the master key (MASTER_ENCRYPTION_KEY env)
-- and stored here. Sensitive free-text fields get a BYTEA ciphertext column
-- (iv||ciphertext||tag) beside the original plaintext column. When encryption
-- is enabled the plaintext column is written empty and reads come from the _ct
-- column; when it is disabled everything falls back to plaintext, so the app
-- keeps working with or without the key. Old plaintext columns are NOT dropped
-- this session (additive only); a future session backfills then drops reads.
ALTER TABLE couples ADD COLUMN IF NOT EXISTS wrapped_dek BYTEA;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS note_ct BYTEA;
ALTER TABLE love_notes ADD COLUMN IF NOT EXISTS body_ct BYTEA;
ALTER TABLE daily_prompt_answers ADD COLUMN IF NOT EXISTS text_ct BYTEA;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS title_ct BYTEA;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS url_ct BYTEA;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS notes_ct BYTEA;
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS title_ct BYTEA;
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS location_ct BYTEA;

-- v5: comments on memories (body encrypted at rest like every other free text)
CREATE TABLE IF NOT EXISTS memory_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  body STRING NOT NULL DEFAULT '',
  body_ct BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comments_by_memory ON memory_comments (memory_id, created_at ASC);

-- v6: prompt streak. A day counts when BOTH partners answered and the reveal
-- fired. Tracked on the couple; grace_used_week holds the Monday of the week a
-- grace (single allowed skip) was last spent.
ALTER TABLE couples ADD COLUMN IF NOT EXISTS current_streak_days INT NOT NULL DEFAULT 0;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS longest_streak_days INT NOT NULL DEFAULT 0;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS last_streak_date DATE;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS grace_used_week DATE;

-- v7: appearance, first cut (per user). Superseded by v8; column kept per the
-- additive-only rule but no longer read or written.
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preset STRING;

-- v8: appearance is shared. One look per couple; when either partner picks a
-- preset it applies to both (the other syncs on their next app load).
ALTER TABLE couples ADD COLUMN IF NOT EXISTS theme_preset STRING;

-- v9: avatars ("marks") + heart reactions on love notes. avatar holds one of
-- the curated mark ids validated in api/_routes/auth-profile.ts; note_hearts
-- mirrors memory_hearts (per-user rows, the JWT user only, never trusted from
-- the body).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar STRING;

CREATE TABLE IF NOT EXISTS note_hearts (
  note_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

-- v10: partner chat. Direct messages inside a couple; body is encrypted at rest
-- like every other free text (body_ct beside a plaintext fallback). chat_seen_at
-- is the per-user read cursor for the chat unread badge (mirrors
-- notifications_seen_at). Chat deliberately does NOT write notification rows (it
-- would flood the bell); the away partner gets a Web Push instead.
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  body STRING NOT NULL DEFAULT '',
  body_ct BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_by_couple ON messages (couple_id, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- v11: partner nicknames. partner_nickname is "the name THIS user calls their
-- partner" (a pet name). It lives on the viewer's own row, so each partner sets
-- their own independently, and is resolved into the partner's shown name at
-- /api/auth/me. If null, the partner's real display_name is used. Plaintext by
-- design (a term of endearment, not private free text).
ALTER TABLE users ADD COLUMN IF NOT EXISTS partner_nickname STRING;

-- v12: the "Wishes" tab. The shared bucket list ("Ours") and the two wishlists
-- ("Mine"/"Theirs") now live under one tab. Bucket items gain a category
-- (experience|item) and keep a completed_at stamp so a finished item stays on
-- the list, dated, instead of vanishing. Wishlist items gain the same category
-- so the whole tab can read in Experiences vs Things. category is plaintext
-- (a coarse tag, not private free text).
ALTER TABLE bucket_items ADD COLUMN IF NOT EXISTS category STRING NOT NULL DEFAULT 'experience';
ALTER TABLE bucket_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- NOTE: Commented out to prevent CockroachDB async backfill error (42P10)
-- UPDATE bucket_items SET completed_at = created_at WHERE done = true AND completed_at IS NULL;
ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS category STRING NOT NULL DEFAULT 'item';

-- v13: the full date flow. A proposal gains an optional time (so the 24h/6h/1h
-- reminders have something to count down to), a post-date rating + reflection
-- (encrypted like other free text) + a linked timeline memory, a completed_at
-- stamp, and one boolean per reminder threshold so each fires at most once.
-- date_ideas is the couple's rotating pool of date ideas saved from dates they
-- loved; the "surprise them" suggestion draws from it plus a built-in list.
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS proposed_time STRING;      -- 'HH:MM', optional
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS rating INT;                -- 1..5, after it happens
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS reflection STRING;         -- post-date note (plaintext fallback)
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS reflection_ct BYTEA;       -- encrypted post-date note
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS memory_id UUID;            -- timeline photo/memory of the date
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;  -- marked done / rated
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS reminded_24 BOOL NOT NULL DEFAULT false;
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS reminded_6 BOOL NOT NULL DEFAULT false;
ALTER TABLE date_proposals ADD COLUMN IF NOT EXISTS reminded_1 BOOL NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS date_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  title STRING NOT NULL DEFAULT '',
  title_ct BYTEA,
  location STRING,
  location_ct BYTEA,
  created_by UUID NOT NULL,
  times_used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS date_ideas_by_couple ON date_ideas (couple_id, created_at DESC);

-- v14: week-in-review keepsakes. The saved weekly reflection now freezes a
-- little snapshot of that week (a few photo thumbnails + note excerpts) into a
-- JSONB blob, so the saved card stays a cute keepsake even if the underlying
-- memories change later. Decrypted at compute time; the thumbnails are the same
-- ~15KB list-size images used everywhere else (no full photos).
ALTER TABLE weekly_reflections ADD COLUMN IF NOT EXISTS snapshot JSONB;

-- v15: chat media + read receipts. A message can carry an image: a thumbnail
-- (image_thumb, ~480px, shown inline and in the list) and the full image
-- (image_data, fetched only when tapped, like memories). Images are plaintext
-- base64 like memory photos (photos are not among the encrypted fields). The
-- per-user chat_seen_at cursor (v10) already exists; the partner's is now
-- surfaced so the sender can see a "Seen" receipt.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_thumb STRING;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS image_data STRING;
-- v16: engagement pass. Four additive pieces:
--   comment_hearts     like a comment under a memory (mirrors note_hearts).
--   messages.reply_to_id  a chat message can quote an earlier one.
--   users.referral_code/referred_by  the friend-referral link in Settings.
--   daily_game_answers  the This-or-That daily game: each partner picks one of
--     two options AND guesses their partner's pick; answers stay private until
--     both are in (same mutual-reveal shape as daily prompts). pick/guess are
--     'a' | 'b'; the option text itself is a static pool keyed by date, never
--     stored. Correct guesses feed the relationship points.
-- (Reminder: never UPDATE a column added above in this same file; migrate runs
-- the whole file as one query and CockroachDB rejects mid-backfill writes.)
CREATE TABLE IF NOT EXISTS comment_hearts (
  comment_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID;

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code STRING;
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code ON users (referral_code) WHERE referral_code IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID;

CREATE TABLE IF NOT EXISTS daily_game_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  user_id UUID NOT NULL,
  game_date DATE NOT NULL,
  pick STRING NOT NULL,
  guess STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (couple_id, user_id, game_date)
);
CREATE INDEX IF NOT EXISTS game_answers_by_couple ON daily_game_answers (couple_id, game_date DESC);

-- v17: guided onboarding + whose birthday.
--   users.needs_onboarding  gates the first-run flow to NEW signups only.
--     Defaults to FALSE so every existing account is already "done" without a
--     backfill UPDATE (which CockroachDB would reject in this same file, see
--     the v12 note above). auth-signup.ts is the only place that sets it true;
--     finishing or skipping to the end of onboarding sets it back to false.
--   milestones.person_id  whose birthday a row is about. Nullable: older rows
--     and shared milestones (anniversaries) leave it null, and readers fall
--     back to author_id then the title text.
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_onboarding BOOL NOT NULL DEFAULT false;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS person_id UUID;

-- v18: a SECOND This-or-That each day. The pair for round two is deterministic
-- from the date like round one, and it opens 12 hours after BOTH partners have
-- answered round one (so it is a reward for playing, not a second chore).
--
-- Deliberately stored as extra columns on the same row rather than a new row
-- per round: daily_game_answers already carries UNIQUE (couple_id, user_id,
-- game_date), and a second row per day would need that constraint dropped and
-- rebuilt. Columns are additive and cost nothing. round1's "both answered at"
-- is derived from the two rows' created_at, so it needs no column of its own.
ALTER TABLE daily_game_answers ADD COLUMN IF NOT EXISTS pick2 STRING;
ALTER TABLE daily_game_answers ADD COLUMN IF NOT EXISTS guess2 STRING;
ALTER TABLE daily_game_answers ADD COLUMN IF NOT EXISTS round2_at TIMESTAMPTZ;

-- v19: the shared to-do list. One list per couple, visible to both, so the two
-- of you can hold each other accountable: either partner adds, either ticks,
-- and completing one notifies the other.
--
--   assignee_id  who it is for. NULL means "both of us" (the default), so an
--     item needs no decision to be added. Mirrors milestones.person_id: a
--     nullable member reference rather than an enum, validated server-side
--     against the couple's own members.
--   due_date  every to-do belongs to a DAY, because the screen is one day at a
--     time. NOT NULL, defaulted to today by the route when the client omits it.
--     An unfinished item deliberately STAYS on its day (moving it forward is an
--     explicit choice the user makes), so this column is also what the pending
--     count reads.
--   title_ct  a to-do says real things about someone's life ("submit the
--     assignment"), so the title is encrypted at rest like note and memory
--     bodies. The plaintext `title` column stays for the encryption-off path.
CREATE TABLE IF NOT EXISTS todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  author_id UUID NOT NULL,
  assignee_id UUID,
  title STRING NOT NULL DEFAULT '',
  title_ct BYTEA,
  due_date DATE NOT NULL,
  done BOOL NOT NULL DEFAULT false,
  done_by UUID,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS todos_by_couple_day ON todos (couple_id, due_date);

-- v20: milestone countdown reminders. Every milestone (including ones added
-- before this migration) gets a 7-day countdown window by default, per the
-- user's explicit choice ("7 days by default" over an opt-in-per-milestone
-- start); 0 means the countdown/reminders are off for that milestone.
--   notify_days_before  how many days before the next occurrence the Home
--     countdown banner starts showing and the daily reminder cron starts
--     firing. 0 = disabled. DEFAULT 7 applies to existing rows as part of this
--     single ADD COLUMN statement, not a follow-up UPDATE (which CockroachDB
--     would reject in this same schema.sql, see the v12 note above).
--   last_reminded_date  the UTC day the countdown push last went out, so the
--     daily cron (which may run more than once, or be retried) never double
--     sends for the same day.
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS notify_days_before INT NOT NULL DEFAULT 7;
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS last_reminded_date DATE;

-- v21: chat reactions + deletion, turning the chat into a proper WhatsApp/
-- Telegram-style thread. One reaction per user per message (tapping a second
-- emoji replaces your first, matching every mainstream chat app); the row is
-- simply deleted when a reaction is removed. No FK/cascade in this schema (see
-- every other table), so message deletion clears this table for that message
-- id explicitly in the route rather than relying on the database to do it.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL,
  user_id UUID NOT NULL,
  emoji STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- v22: password reset + a couple of new couple-level reminders.
--
--   password_reset_codes  a signed-out "forgot password" flow. A short-lived
--     6-digit code is emailed (via Resend); we store only a KEYED HASH of it
--     (HMAC-SHA256 under JWT_SECRET), never the code itself, so a database leak
--     does not hand out working reset codes. expires_at bounds it (10 minutes),
--     used_at marks it spent so a code works exactly once, and the created_at
--     index backs both the per-email rate limit and the newest-code lookup.
--     No FK/cascade, like every other table here; rows age out on use/expiry.
--   users.password_changed_at  stamped whenever the password changes (Settings
--     change, or a reset). requireUser rejects any JWT issued before it, which
--     is the ONLY thing that makes a reset actually revoke a stolen 30-day
--     token. NULLABLE with NO default on purpose: existing rows stay NULL so
--     every currently-valid session survives the deploy (a NULL never revokes),
--     and only a real password change starts enforcing it.
CREATE TABLE IF NOT EXISTS password_reset_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  code_hash STRING NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reset_codes_by_user ON password_reset_codes (user_id, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Two couple-level reminders, both fired by the once-a-day milestone cron
-- (kind=milestone) and deduped by a stamp on the couple so a re-run never
-- double-sends. Unlike the milestone COUNTDOWN reminders these DO write a bell
-- row (via a system-sentinel actor, see api/_lib/notify.ts), so both partners
-- see them in the notifications pane as well as a push.
--   last_monthly_anniversary_sent  the day the "N months together" push last
--     went out; at most one a month.
--   last_fifty_day_notified  the highest 50-day-tenure multiple already sent
--     (0 = none yet). Storing the multiple, not a date, is what lets a missed
--     cron run send only the newest threshold instead of backfilling every one.
ALTER TABLE couples ADD COLUMN IF NOT EXISTS last_monthly_anniversary_sent DATE;
ALTER TABLE couples ADD COLUMN IF NOT EXISTS last_fifty_day_notified INT NOT NULL DEFAULT 0;

-- v23: voice notes in chat. Follows the exact same shape as chat photos
-- (v15): a message can carry one audio clip, stored as plaintext base64 like
-- image_data (voice audio is not among the encrypted fields, matching photos).
-- Unlike a photo there is no smaller "thumb" that is itself playable, so the
-- list-weight payload is the WAVEFORM + duration (a few dozen small numbers),
-- not a scaled-down copy of the audio; the full clip is fetched on tap, same
-- as a photo's full resolution is.
--   audio_data          the full clip, base64 data URI. NULL when no audio.
--   audio_mime           what it actually is: 'audio/mp4' for every native
--     recording (iOS and Android both produce AAC-in-.m4a via expo-audio's
--     HIGH_QUALITY preset) or whatever MediaRecorder.isTypeSupported() picked
--     on web (prefers audio/mp4 so a Safari-recorded clip plays natively
--     everywhere; falls back to audio/webm on Chrome/Firefox, which cannot
--     encode mp4). Needed at playback time to hint the player correctly.
--   audio_duration_ms    clip length, measured client-side with a plain
--     Date.now() timer rather than trusted from any player/recorder status
--     object (expo-audio's own web duration tracking resets to 0 inside its
--     'stop' event handler, which can race the very stop() call that reads it).
--   audio_waveform        ~40 normalized amplitude bars (0..1, JSONB array),
--     sampled for real during recording (native: expo-audio's metering; web:
--     a small Web Audio AnalyserNode run alongside the recorder, since
--     expo-audio does not implement metering on web at all) and downsampled
--     to a fixed bar count. Never fabricated: a message with no readable
--     level data gets an empty array and the bubble renders flat, honest
--     bars rather than a fake shape.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_data STRING;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_mime STRING;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_duration_ms INT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_waveform JSONB;

-- v24: Thumb Kiss, a synchronized press-and-hold mini-moment (both partners
-- open the screen and hold a touch target at the same time). The moment
-- itself is never stored, only a running total. api/_routes/thumb-kiss.ts
-- atomically increments this on a match so it can say "your Nth thumb kiss";
-- exactly one partner reports each match (the one with the lexicographically
-- smaller user id, the same ordered-pair tie-break agreementStatsFor uses in
-- game.ts) so a match is never double-counted by both clients firing at once.
ALTER TABLE couples ADD COLUMN IF NOT EXISTS thumb_kiss_count INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- v25: Picture Night, the shared movie riddle.
--
-- TWO new tables, deliberately kept OFF daily_game_answers: This-or-That's row
-- is one per person per day carrying two letters, and overloading it with an
-- unrelated game's columns would tangle two schedules (that table's per-day
-- UNIQUE is what forced round two onto extra columns in v18; this game must not
-- inherit that constraint).
--
-- `movies` is reference data, NOT couple content: it is the same public film
-- facts for everybody, so it carries no couple_id, is never encrypted, and is
-- loaded by scripts/load-movies.ts from the IMDB CSV rather than typed by hand.
-- `eligible` marks the films allowed to BE the mystery; every row stays valid
-- as a GUESS regardless, so autocomplete always covers the whole catalogue.
CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imdb_id STRING NOT NULL UNIQUE,
  title STRING NOT NULL,
  year INT NOT NULL,
  -- JSONB arrays rather than STRING[]: comparison happens in JS (see
  -- api/_lib/picture-night.ts) and this matches messages.audio_waveform's
  -- existing precedent for a small list on a row.
  genres JSONB NOT NULL,
  director JSONB NOT NULL,
  cast_members JSONB NOT NULL,
  eligible BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movies_eligible ON movies (eligible, imdb_id);
-- Autocomplete searches by title prefix; year disambiguates the 37 duplicate
-- titles in the source data (Don appears three times, Devdas twice).
CREATE INDEX IF NOT EXISTS movies_by_title ON movies (title);

-- One row per GUESS, from either partner, on one couple's shared board.
-- Everything the board shows (solved, attempts left, hints unlocked) is derived
-- from these rows on every read by boardStateFor(), never stored: the same
-- reasoning that rewrote the streak after an incremental counter drifted.
-- No couple-authored free text lands here, only a movie id, so nothing to encrypt.
CREATE TABLE IF NOT EXISTS picture_night_guesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL,
  user_id UUID NOT NULL,
  puzzle_date DATE NOT NULL,
  round INT NOT NULL,
  movie_id UUID NOT NULL,
  correct BOOL NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS picture_night_board
  ON picture_night_guesses (couple_id, puzzle_date, round, created_at);
