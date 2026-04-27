-- +goose Up
ALTER TABLE releases
    ADD COLUMN original_categories_text TEXT NULL;

ALTER TABLE releases
    ADD COLUMN categories_last_scraped_at TIMESTAMP NULL;

-- +goose Down
ALTER TABLE releases
    DROP COLUMN IF EXISTS categories_last_scraped_at;

ALTER TABLE releases
    DROP COLUMN IF EXISTS original_categories_text;
