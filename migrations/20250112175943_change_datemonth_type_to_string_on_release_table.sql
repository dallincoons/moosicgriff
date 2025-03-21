-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ALTER COLUMN datemonth TYPE TEXT;
-- +goose StatementEnd

