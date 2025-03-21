-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    DROP COLUMN artist_id;

ALTER TABLE releases
    ADD artist_wikilink TEXT NOT NULL;

-- +goose StatementEnd
