-- +goose Up
-- +goose StatementBegin
CREATE TABLE yearly_album_source_sync_state (
    source_list_wikilink TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS yearly_album_source_sync_state;
-- +goose StatementEnd
