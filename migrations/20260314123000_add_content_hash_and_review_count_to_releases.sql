-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD content_hash TEXT NULL;

ALTER TABLE releases
ADD number_of_reviews INTEGER NOT NULL DEFAULT 0;
-- +goose StatementEnd
