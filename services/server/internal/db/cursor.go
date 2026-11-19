package db

import (
	"encoding/base64"
	"errors"
	"github.com/google/uuid"
	"strings"
	"time"
)

// Cursor includes the UUID tie-breaker so rows sharing a transaction timestamp
// are not skipped when paging by (created_at, id) or (applied_at, id).
func EncodeCursor(at time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(at.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}
func DecodeCursor(raw string) (*time.Time, uuid.UUID, error) {
	if raw == "" {
		return nil, uuid.Nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, uuid.Nil, errors.New("invalid cursor")
	}
	parts := strings.Split(string(data), "|")
	if len(parts) != 2 {
		return nil, uuid.Nil, errors.New("invalid cursor")
	}
	at, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, uuid.Nil, errors.New("invalid cursor")
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, uuid.Nil, errors.New("invalid cursor")
	}
	return &at, id, nil
}
