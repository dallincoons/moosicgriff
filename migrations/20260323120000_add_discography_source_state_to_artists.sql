-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
    ADD COLUMN discography_wikilink TEXT NULL;

ALTER TABLE artists
    ADD COLUMN discography_content_hash TEXT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE artists
    DROP COLUMN IF EXISTS discography_content_hash;

ALTER TABLE artists
    DROP COLUMN IF EXISTS discography_wikilink;
-- +goose StatementEnd
