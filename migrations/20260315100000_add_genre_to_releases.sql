-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD genre TEXT NULL;
-- +goose StatementEnd
