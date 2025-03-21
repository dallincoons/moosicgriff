-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD last_updated_at DATE NOT NULL DEFAULT current_date
-- +goose StatementEnd
