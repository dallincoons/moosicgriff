-- +goose Up
ALTER TABLE releases
    ADD COLUMN manual_number_of_reviews INTEGER NULL;

-- +goose Down
ALTER TABLE releases
    DROP COLUMN IF EXISTS manual_number_of_reviews;
