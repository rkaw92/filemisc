BEGIN;

CREATE TYPE entry_type AS ENUM ('file', 'directory', 'link', 'other');

CREATE TABLE imports (
  import_id BIGINT PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  entry_count BIGINT,
  new_count BIGINT,
  changed_count BIGINT,
  deleted_count BIGINT
);

CREATE TABLE entries (
  path TEXT NOT NULL,
  type entry_type NOT NULL,
  bytes BIGINT NOT NULL,
  mtime TIMESTAMP WITH TIME ZONE NOT NULL,
  first_discovery_at BIGINT NOT NULL REFERENCES imports (import_id),
  last_change_at BIGINT NOT NULL REFERENCES imports(import_id)
);

CREATE TABLE outbox (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMIT;
