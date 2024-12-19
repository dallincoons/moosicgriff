-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
ADD parent_wikilink TEXT NOT NULL
-- +goose StatementEnd
