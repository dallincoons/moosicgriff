-- +goose Up
-- +goose StatementBegin
ALTER TABLE artists
    ADD COLUMN has_missing_release_wikilinks BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE artists a
SET has_missing_release_wikilinks = EXISTS(
    SELECT 1
    FROM releases r
    WHERE lower(r.artist_wikilink) = lower(a.wikilink)
      AND (
        r.wikilink IS NULL
        OR length(trim(r.wikilink)) = 0
      )
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE artists
    DROP COLUMN IF EXISTS has_missing_release_wikilinks;
-- +goose StatementEnd
