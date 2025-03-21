-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ADD wikilink TEXT;
-- +goose StatementEnd
