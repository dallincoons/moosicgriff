-- +goose Up
ALTER TABLE artists
ADD COLUMN years_active_scraped BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE artists
DROP COLUMN IF EXISTS years_active_scraped;
