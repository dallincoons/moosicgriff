-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
    ALTER COLUMN last_updated_at TYPE TIMESTAMPTZ
    USING last_updated_at::timestamptz,
    ALTER COLUMN last_updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE releases
    ALTER COLUMN last_updated_at TYPE TIMESTAMPTZ
    USING last_updated_at::timestamptz,
    ALTER COLUMN last_updated_at SET DEFAULT CURRENT_TIMESTAMP;
-- +goose StatementEnd
