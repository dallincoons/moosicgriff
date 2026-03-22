-- +goose Up
-- +goose StatementBegin
ALTER TABLE yearly_album_references
    ADD COLUMN genre TEXT NOT NULL DEFAULT '',
    ADD COLUMN record_label TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE yearly_album_references
    DROP COLUMN IF EXISTS genre,
    DROP COLUMN IF EXISTS record_label;
-- +goose StatementEnd
