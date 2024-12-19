-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
ADD last_updated_at DATE NOT NULL DEFAULT current_date
-- +goose StatementEnd
