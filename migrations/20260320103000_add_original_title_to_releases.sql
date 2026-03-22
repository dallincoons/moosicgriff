-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ADD COLUMN original_title TEXT NULL;

UPDATE releases
SET original_title = title
WHERE original_title IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE releases
    DROP COLUMN IF EXISTS original_title;
-- +goose StatementEnd
