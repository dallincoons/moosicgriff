-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
    RENAME COLUMN foundpeers TO found_peers
-- +goose StatementEnd
