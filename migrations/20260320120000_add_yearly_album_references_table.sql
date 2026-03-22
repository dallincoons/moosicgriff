-- +goose Up
-- +goose StatementBegin
CREATE TABLE yearly_album_references (
    id SERIAL PRIMARY KEY,
    album_name TEXT NOT NULL,
    album_wikilink TEXT NOT NULL,
    wikipedia_page_id BIGINT,
    release_year INTEGER,
    release_month TEXT NOT NULL DEFAULT '',
    release_day INTEGER,
    source_list_wikilink TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX yearly_album_references_source_album_unique_idx
    ON yearly_album_references (source_list_wikilink, album_wikilink);

CREATE INDEX yearly_album_references_page_id_idx
    ON yearly_album_references (wikipedia_page_id);

CREATE INDEX yearly_album_references_release_year_idx
    ON yearly_album_references (release_year);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS yearly_album_references_release_year_idx;
DROP INDEX IF EXISTS yearly_album_references_page_id_idx;
DROP INDEX IF EXISTS yearly_album_references_source_album_unique_idx;
DROP TABLE IF EXISTS yearly_album_references;
-- +goose StatementEnd
