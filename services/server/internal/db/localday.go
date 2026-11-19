package db

import (
	"fmt"
	"time"
)

const localDayLayout = "2006-01-02"

// ParseLocalDay 将 YYYY-MM-DD 解析为固定 UTC 零点的 time.Time，匹配 PostgreSQL DATE 列语义，避免时区偏移错天。
func ParseLocalDay(day string) (time.Time, error) {
	if len(day) != len(localDayLayout) {
		return time.Time{}, fmt.Errorf("invalid local day %q: expected YYYY-MM-DD", day)
	}
	parsed, err := time.Parse(localDayLayout, day)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid local day %q: %w", day, err)
	}
	return parsed.UTC(), nil
}

// FormatLocalDay 按日历年月日格式化 PostgreSQL DATE 对应的 time.Time，不受接收值 Location 偏移影响。
func FormatLocalDay(t time.Time) string {
	return t.Format(localDayLayout)
}
