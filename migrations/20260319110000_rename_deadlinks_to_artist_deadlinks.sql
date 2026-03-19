-- +goose Up
ALTER TABLE deadlinks
    RENAME TO artist_deadlinks;

-- +goose Down
ALTER TABLE artist_deadlinks
    RENAME TO deadlinks;
