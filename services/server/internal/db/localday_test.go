package db_test

import (
	"testing"
	"time"

	"github.com/shixu-app/server/internal/db"
)

func TestParseAndFormatLocalDay(t *testing.T) {
	parsed, err := db.ParseLocalDay("2026-11-19")
	if err != nil {
		t.Fatalf("ParseLocalDay failed: %v", err)
	}
	want := time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)
	if !parsed.Equal(want) || parsed.Location() != time.UTC {
		t.Fatalf("expected %v UTC, got %v (%v)", want, parsed, parsed.Location())
	}
	if got := db.FormatLocalDay(parsed); got != "2026-11-19" {
		t.Fatalf("expected 2026-11-19, got %q", got)
	}

	// 即便传入带时区的零点，也应保留其日历日期而非倒退一天
	loc := time.FixedZone("UTC+8", 8*3600)
	localMidnight := time.Date(2026, 11, 19, 0, 0, 0, 0, loc)
	if got := db.FormatLocalDay(localMidnight); got != "2026-11-19" {
		t.Fatalf("expected 2026-11-19 without TZ shift, got %q", got)
	}

	if _, err := db.ParseLocalDay("2026-11-19T00:00:00Z"); err == nil {
		t.Fatalf("expected error for RFC3339 timestamp")
	}
	if _, err := db.ParseLocalDay("2026-02-30"); err == nil {
		t.Fatalf("expected error for impossible calendar date")
	}
}
