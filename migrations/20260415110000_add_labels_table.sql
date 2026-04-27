-- +goose Up
CREATE TABLE labels (
    id SERIAL PRIMARY KEY,
    wikilink TEXT NOT NULL UNIQUE,
    wikipedia_page_id BIGINT NULL UNIQUE,
    name TEXT NOT NULL,
    founded TEXT NULL,
    country_of_origin TEXT NULL,
    genre TEXT NULL,
    founder TEXT NULL,
    last_scraped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS labels;
