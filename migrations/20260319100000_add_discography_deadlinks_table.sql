-- +goose Up
CREATE TABLE discography_deadlinks (
    ID SERIAL PRIMARY KEY,
    link TEXT UNIQUE NOT NULL
);

-- +goose Down
DROP TABLE IF EXISTS discography_deadlinks;
