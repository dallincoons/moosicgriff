-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD original_genre TEXT NULL;

UPDATE releases
SET original_genre = genre
WHERE original_genre IS NULL;
-- +goose StatementEnd
