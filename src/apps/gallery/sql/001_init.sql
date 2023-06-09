CREATE SCHEMA IF NOT EXISTS gallery;

BEGIN;

-- Images: gallery-eligible files.
CREATE TABLE gallery.images (
    image_id BIGINT NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    tree_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    ver BIGINT NOT NULL,
    sha256 BYTEA NOT NULL,
    w INTEGER NOT NULL,
    h INTEGER NOT NULL,
    taken_at TIMESTAMP WITH TIME ZONE NOT NULL,
    exif JSONB,
    UNIQUE (tree_id, path)
);
CREATE INDEX idx_images_sha256 ON gallery.images (sha256);

CREATE TABLE gallery.galleries (
    gallery_id BIGINT NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    root_path TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (root_path)
);

CREATE TABLE gallery.accounts (
    login TEXT NOT NULL PRIMARY KEY,
    password_hash TEXT NOT NULL
);

CREATE TABLE gallery.access (
    gallery_id BIGINT NOT NULL,
    account TEXT NOT NULL,
    PRIMARY KEY (account, gallery_id),
    FOREIGN KEY (gallery_id) REFERENCES gallery.galleries (gallery_id) ON DELETE CASCADE
);

CREATE TABLE gallery.items (
    gallery_id BIGINT NOT NULL,
    seq INTEGER NOT NULL,
    image_id BIGINT NOT NULL,
    PRIMARY KEY (gallery_id, seq),
    FOREIGN KEY (gallery_id) REFERENCES gallery.galleries (gallery_id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES gallery.images (image_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE gallery.thumbnails (
    orig_sha256 BYTEA NOT NULL,
    variant SMALLINT NOT NULL,
    thumb_path TEXT NOT NULL,
    thumb_w INTEGER NOT NULL,
    thumb_h INTEGER NOT NULL,
    PRIMARY KEY (orig_sha256, variant)
);

COMMIT;
