-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ALTER COLUMN dateyear TYPE INTEGER;
-- +goose StatementEnd
