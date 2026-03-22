-- +goose Up
-- +goose StatementBegin
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY wikipedia_page_id ORDER BY id) AS rn
    FROM releases
    WHERE wikipedia_page_id IS NOT NULL
)
DELETE FROM releases r
USING ranked d
WHERE r.id = d.id
  AND d.rn > 1;

WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY artist_wikilink, wikilink ORDER BY id) AS rn
    FROM releases
    WHERE wikipedia_page_id IS NULL
      AND wikilink IS NOT NULL
      AND length(wikilink) > 0
)
DELETE FROM releases r
USING ranked d
WHERE r.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX releases_wikipedia_page_id_unique_idx
    ON releases (wikipedia_page_id)
    WHERE wikipedia_page_id IS NOT NULL;

CREATE UNIQUE INDEX releases_artist_wikilink_wikilink_unique_idx
    ON releases (artist_wikilink, wikilink)
    WHERE wikipedia_page_id IS NULL
      AND wikilink IS NOT NULL
      AND length(wikilink) > 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS releases_artist_wikilink_wikilink_unique_idx;
DROP INDEX IF EXISTS releases_wikipedia_page_id_unique_idx;
-- +goose StatementEnd
