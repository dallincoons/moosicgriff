-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
ADD original_releasetype TEXT NULL;

UPDATE releases
SET original_releasetype = releasetype
WHERE original_releasetype IS NULL;
-- +goose StatementEnd
