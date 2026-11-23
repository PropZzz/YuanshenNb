-- +goose Up
ALTER TABLE schedule_items ADD COLUMN presentation JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE schedule_items ADD CONSTRAINT schedule_presentation_object CHECK (jsonb_typeof(presentation) = 'object');

-- +goose Down
ALTER TABLE schedule_items DROP COLUMN presentation;
