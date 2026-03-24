-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
    ADD COLUMN peers_scraped_at TIMESTAMP NULL;

ALTER TABLE artists
    ADD COLUMN discography_scraped_at TIMESTAMP NULL;

UPDATE artists
SET peers_scraped_at = CURRENT_TIMESTAMP
WHERE found_peers = true
  AND peers_scraped_at IS NULL;

UPDATE artists
SET discography_scraped_at = CURRENT_TIMESTAMP
WHERE found_discography = true
  AND discography_scraped_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE artists
    DROP COLUMN IF EXISTS discography_scraped_at;

ALTER TABLE artists
    DROP COLUMN IF EXISTS peers_scraped_at;
-- +goose StatementEnd
