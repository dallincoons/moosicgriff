-- +goose Up
ALTER TABLE releases
    ADD COLUMN reviews_parse_version INTEGER NOT NULL DEFAULT 1;

-- +goose Down
ALTER TABLE releases
    DROP COLUMN IF EXISTS reviews_parse_version;
