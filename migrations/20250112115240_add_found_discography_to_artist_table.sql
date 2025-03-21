-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
ADD found_discography BOOLEAN NOT NULL DEFAULT false
-- +goose StatementEnd
