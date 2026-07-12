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
UPDATE memories SET memory_date = created_at::DATE WHERE memory_date IS NULL;

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
