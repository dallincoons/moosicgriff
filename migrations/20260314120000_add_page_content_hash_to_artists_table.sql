-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
ADD page_content_hash TEXT NULL
-- +goose StatementEnd
