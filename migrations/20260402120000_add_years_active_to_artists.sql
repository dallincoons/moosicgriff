-- +goose Up
ALTER TABLE artists
ADD COLUMN year_start INTEGER NULL,
ADD COLUMN year_end INTEGER NULL;

-- +goose Down
ALTER TABLE artists
DROP COLUMN IF EXISTS year_start,
DROP COLUMN IF EXISTS year_end;
