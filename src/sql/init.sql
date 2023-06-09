CREATE TYPE entry_type AS ENUM ('file', 'directory', 'link', 'other');

CREATE SCHEMA IF NOT EXISTS core;

BEGIN;

CREATE TABLE core.imports (
  import_id BIGINT PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
  tree_id INTEGER NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  entry_count BIGINT,
  new_count BIGINT,
  changed_count BIGINT,
  deleted_count BIGINT
);

CREATE TABLE core.entries (
  tree_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  ext1 TEXT,
  type entry_type NOT NULL,
  bytes BIGINT NOT NULL,
  mtime TIMESTAMP WITH TIME ZONE NOT NULL,
  first_discovery_at BIGINT NOT NULL REFERENCES core.imports (import_id),
  last_change_at BIGINT NOT NULL REFERENCES core.imports(import_id),
  PRIMARY KEY (tree_id, path)
) PARTITION BY LIST (tree_id);

CREATE INDEX ON core.entries (tree_id, last_change_at, ext1);

CREATE TABLE core.removed (
  tree_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  ext1 TEXT,
  removed_at BIGINT NOT NULL REFERENCES core.imports(import_id),
  PRIMARY KEY (tree_id, path, removed_at)
) PARTITION BY LIST (tree_id);

CREATE INDEX ON core.removed (tree_id, removed_at, ext1);

CREATE TABLE outbox (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  payload JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMIT;
