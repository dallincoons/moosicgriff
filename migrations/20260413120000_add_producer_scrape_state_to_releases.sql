-- +goose Up
ALTER TABLE releases
    ADD COLUMN producer_last_scraped_at TIMESTAMP NULL;

-- +goose Down
ALTER TABLE releases
    DROP COLUMN IF EXISTS producer_last_scraped_at;
