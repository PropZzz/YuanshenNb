package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TxManager 抽象数据库事务边界，使各领域 Service 不直接耦合 *pgxpool.Pool，便于单测与注入。
type TxManager interface {
	WithTx(ctx context.Context, fn func(ctx context.Context, q *Queries) error) error
}

// PGXStore 封装 pgx 连接池与 sqlc Queries，并提供标准事务执行器。
type PGXStore struct {
	pool    *pgxpool.Pool
	queries *Queries
}

func NewPGXStore(pool *pgxpool.Pool) *PGXStore {
	return &PGXStore{
		pool:    pool,
		queries: New(pool),
	}
}

func (s *PGXStore) Queries() *Queries {
	return s.queries
}

func (s *PGXStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *PGXStore) Close() {
	s.pool.Close()
}

// WithTx 在单个 PostgreSQL 事务中执行 fn，发生 error 或 panic 时自动安全回滚。
func (s *PGXStore) WithTx(ctx context.Context, fn func(ctx context.Context, q *Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if rbErr := tx.Rollback(ctx); rbErr != nil && !errors.Is(rbErr, pgx.ErrTxClosed) {
			// Rollback 失败通常发生在上下文已取消或连接已断开场景，外层错误优先返回
			_ = rbErr
		}
	}()

	if err := fn(ctx, s.queries.WithTx(tx)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
