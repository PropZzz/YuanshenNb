package api

import (
	"bytes"
	"encoding/json"
	"reflect"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// NullableField 表示三态 PATCH 可空字段，用于精确区分：
// - 未传入该键（Set == false）
// - 显式传入 null 清空（Set == true && !Valid）
// - 显式传入新值（Set == true && Valid）
type NullableField[T any] struct {
	Set   bool
	Valid bool
	Value T
}

func NewNullableField[T any](v T) NullableField[T] {
	return NullableField[T]{Set: true, Valid: true, Value: v}
}

func NullField[T any]() NullableField[T] {
	return NullableField[T]{Set: true, Valid: false}
}

// IsZero 配合 Go 1.24 `omitzero` 标签，使未设置字段既不在 JSON 序列化输出，也不被 OpenAPI 标记为 required。
func (f NullableField[T]) IsZero() bool {
	return !f.Set
}

func (f *NullableField[T]) UnmarshalJSON(data []byte) error {
	f.Set = true
	trimmed := bytes.TrimSpace(data)
	if bytes.Equal(trimmed, []byte("null")) {
		var zero T
		f.Value = zero
		f.Valid = false
		return nil
	}
	var v T
	if err := json.Unmarshal(trimmed, &v); err != nil {
		return err
	}
	f.Value = v
	f.Valid = true
	return nil
}

func (f NullableField[T]) MarshalJSON() ([]byte, error) {
	if !f.Set || !f.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(f.Value)
}

func (NullableField[T]) Schema(r huma.Registry) *huma.Schema {
	t := reflect.TypeFor[T]()
	if t == reflect.TypeFor[time.Time]() {
		return &huma.Schema{
			Type:     huma.TypeString,
			Format:   "date-time",
			Nullable: true,
		}
	}
	var base *huma.Schema
	if r != nil {
		base = r.Schema(t, true, "")
	} else {
		base = huma.SchemaFromType(huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer), t)
	}
	if base == nil {
		return &huma.Schema{Nullable: true}
	}
	cloned := *base
	if cloned.Ref == "" {
		cloned.Nullable = true
	}
	return &cloned
}
