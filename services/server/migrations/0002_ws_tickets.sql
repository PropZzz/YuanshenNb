-- +goose Up
-- Shared across server instances; atomic DELETE RETURNING prevents ticket replay.
CREATE TABLE ws_tickets (
 token_hash TEXT PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_ws_tickets_expiry ON ws_tickets(expires_at);

-- +goose Down
DROP TABLE ws_tickets;
