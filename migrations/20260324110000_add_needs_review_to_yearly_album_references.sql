-- +goose Up
-- +goose StatementBegin
ALTER TABLE yearly_album_references
    ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE yearly_album_references
    DROP COLUMN IF EXISTS needs_review;
-- +goose StatementEnd
