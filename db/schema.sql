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