package db

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCursorRoundTripKeepsUTCInstantAndUUIDTieBreaker(t *testing.T) {
	at := time.Date(2026, 11, 19, 16, 2, 3, 123456789, time.FixedZone("UTC+8", 8*60*60))
	id := uuid.New()
	got, gotID, err := DecodeCursor(EncodeCursor(at, id))
	if err != nil || got == nil || !got.Equal(at) || gotID != id || got.Location() != time.UTC {
		t.Fatalf("cursor lost tuple position: %v %s %v", got, gotID, err)
	}
	if got, id, err := DecodeCursor(""); err != nil || got != nil || id != uuid.Nil {
		t.Fatal("empty cursor must represent the first page")
	}
	for _, raw := range []string{"%%%", "2026-11-19T00:00:00Z", "bad-date|" + id.String(), at.Format(time.RFC3339Nano) + "|bad-id"} {
		if _, _, err := DecodeCursor(raw); err == nil {
			t.Fatalf("invalid cursor accepted: %q", raw)
		}
		if _, _, err := DecodeCursor(base64.RawURLEncoding.EncodeToString([]byte(raw))); err == nil {
			t.Fatalf("malformed cursor payload accepted: %q", raw)
		}
	}
}
