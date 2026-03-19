-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD artist_display_name TEXT NULL;

UPDATE releases
SET artist_display_name = artist_name
WHERE artist_display_name IS NULL;
-- +goose StatementEnd
