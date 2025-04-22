-- +goose Up
CREATE TABLE deadlinks (
    ID SERIAL PRIMARY KEY,
    link TEXT unique NOT NULL
);
