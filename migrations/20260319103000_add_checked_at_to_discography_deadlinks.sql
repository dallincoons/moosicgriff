-- +goose Up
ALTER TABLE discography_deadlinks
    ADD COLUMN checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- +goose Down
ALTER TABLE discography_deadlinks
    DROP COLUMN IF EXISTS checked_at;
