-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    RENAME releasename to title;

ALTER TABLE releases
    RENAME releaseyear to dateyear;

ALTER TABLE releases
    RENAME releaselabel to label;

ALTER TABLE releases
    ADD COLUMN datemonth INTEGER NULL;

ALTER TABLE releases
    ADD COLUMN dateday INTEGER NULL;
-- +goose StatementEnd
