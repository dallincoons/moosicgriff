-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ADD COLUMN scrape_version INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN last_scraped_at TIMESTAMP NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE releases
    DROP COLUMN IF EXISTS last_scraped_at,
    DROP COLUMN IF EXISTS scrape_version;
-- +goose StatementEnd
