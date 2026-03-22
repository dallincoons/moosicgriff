-- +goose Up
-- +goose StatementBegin
ALTER TABLE releases
    ADD COLUMN wikipedia_page_id BIGINT;

CREATE INDEX releases_wikipedia_page_id_idx
    ON releases (wikipedia_page_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS releases_wikipedia_page_id_idx;

ALTER TABLE releases
    DROP COLUMN IF EXISTS wikipedia_page_id;
-- +goose StatementEnd
