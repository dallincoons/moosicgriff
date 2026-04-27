-- +goose Up
ALTER TABLE releases
    ADD COLUMN artist_id INTEGER NULL REFERENCES artists (id);

CREATE INDEX releases_artist_id_idx
    ON releases (artist_id);

-- +goose Down
DROP INDEX IF EXISTS releases_artist_id_idx;

ALTER TABLE releases
    DROP COLUMN IF EXISTS artist_id;
