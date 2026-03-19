-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD review_links TEXT NULL;
-- +goose StatementEnd
