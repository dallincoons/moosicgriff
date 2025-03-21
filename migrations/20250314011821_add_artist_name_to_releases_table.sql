-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD artist_name TEXT
-- +goose StatementEnd
