-- +goose Up
ALTER TABLE artists
    ADD COLUMN wikipedia_page_id BIGINT;

CREATE INDEX artists_wikipedia_page_id_idx
    ON artists (wikipedia_page_id);

-- +goose Down
DROP INDEX IF EXISTS artists_wikipedia_page_id_idx;

ALTER TABLE artists
    DROP COLUMN IF EXISTS wikipedia_page_id;
