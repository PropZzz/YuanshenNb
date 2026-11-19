package testutil

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres isolates each integration test in an actual PostgreSQL schema.
// CI must provide TEST_DATABASE_URL; absence is explicitly reported as skipped.
func Postgres(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real PostgreSQL integration requires TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := admin.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(785412); CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public; SELECT pg_advisory_unlock(785412)"); err != nil {
		conn.Release()
		t.Fatal(err)
	}
	conn.Release()
	schema := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	_, file, _, _ := runtime.Caller(0)
	migrations, err := filepath.Glob(filepath.Join(filepath.Dir(file), "..", "..", "migrations", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range migrations {
		sql, e := os.ReadFile(migration)
		if e != nil {
			t.Fatal(e)
		}
		up := strings.Split(string(sql), "-- +goose Down")[0]
		if _, err = pool.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		pool.Close()
		admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}
