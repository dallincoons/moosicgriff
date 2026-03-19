-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD recorded TEXT NULL;

ALTER TABLE releases
ADD studio TEXT NULL;
-- +goose StatementEnd
