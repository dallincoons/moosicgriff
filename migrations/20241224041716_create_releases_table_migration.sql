-- +goose Up
-- +goose StatementBegin
CREATE TABLE releases (
    ID SERIAL PRIMARY KEY,
    artist_id INTEGER REFERENCES artists (ID),
    releasename TEXT NOT NULL,
    releaseyear integer NOT NULL,
    releasetype TEXT,
    releaselabel TEXT,
    producer TEXT
)
-- +goose StatementEnd
