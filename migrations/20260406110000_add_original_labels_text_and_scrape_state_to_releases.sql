-- +goose Up
ALTER TABLE releases
    ADD COLUMN original_labels_text TEXT NULL;

ALTER TABLE releases
    ADD COLUMN labels_last_scraped_at TIMESTAMP NULL;

-- +goose Down
ALTER TABLE releases
    DROP COLUMN IF EXISTS labels_last_scraped_at;

ALTER TABLE releases
    DROP COLUMN IF EXISTS original_labels_text;
