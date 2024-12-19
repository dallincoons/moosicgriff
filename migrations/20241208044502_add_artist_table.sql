-- +goose Up
CREATE TABLE artists (
    ID SERIAL PRIMARY KEY,
    artistname TEXT NOT NULL,
    wikilink TEXT unique NOT NULL,
    foundpeers BOOLEAN DEFAULT FALSE
);
