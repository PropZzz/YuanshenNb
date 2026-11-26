package apiadapter

import (
	"errors"
	"testing"

	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/biometrics"
	"github.com/shixu-app/server/internal/schedule"
)

// TestPersonalProblemMapsDomainErrors 锁住领域错误到 HTTP 状态码与业务错误码的映射。
// 这类映射写错不会 panic，只会让前端提示错误的文案，所以每条分支都需要单独断言。
func TestPersonalProblemMapsDomainErrors(t *testing.T) {
	for _, tt := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   api.ErrorCode
	}{
		{"presentation_invalid", schedule.ErrPresentation, 422, api.ErrValidationFailed},
		{"schedule_not_found", schedule.ErrNotFound, 404, api.ErrNotFound},
		{"schedule_overlap", schedule.ErrOverlap, 409, api.ErrConflictScheduleOverlap},
		{"meeting_managed", schedule.ErrManaged, 409, api.ErrMeetingManagedByProposal},
		{"invalid_time_range", schedule.ErrTime, 422, api.ErrInvalidTimeRange},
		{"range_too_large", schedule.ErrRange, 422, api.ErrRangeTooLarge},
		{"deadline_in_past", schedule.ErrDeadline, 422, api.ErrDeadlineInPast},
		{"stale_baseline", schedule.ErrStale, 409, api.ErrStaleBaselineVersion},
		{"already_reverted", schedule.ErrReverted, 409, api.ErrAlreadyReverted},
		{"restore_conflict", schedule.ErrRestoreConflict, 409, api.ErrSnapshotRestoreConflict},
		{"plan_infeasible", schedule.ErrPlan, 409, api.ErrConflict},
		{"sample_invalid", biometrics.ErrSample, 422, api.ErrInvalidBiometricSample},
		{"work_hours_invalid", biometrics.ErrHours, 422, api.ErrInvalidWorkHours},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var problem *api.ProblemDetail
			if !errors.As(personalProblem(tt.err), &problem) {
				t.Fatalf("期望返回 *api.ProblemDetail")
			}
			if problem.Status != tt.wantStatus {
				t.Fatalf("状态码 = %d，期望 %d", problem.Status, tt.wantStatus)
			}
			if problem.Code != tt.wantCode {
				t.Fatalf("错误码 = %s，期望 %s", problem.Code, tt.wantCode)
			}
			if problem.Detail == "" {
				t.Fatal("detail 不应为空，否则前端无法展示原因")
			}
		})
	}
}

// TestPersonalProblemLocatesInvalidSample 验证样本校验失败时会带上具体下标与字段，
// 前端据此高亮出错的那一条样本，而不是笼统提示"你有一批数据有问题"。
func TestPersonalProblemLocatesInvalidSample(t *testing.T) {
	sampleErr := &biometrics.SampleValidationError{Index: 3, Field: "numericValue", Message: "out of range"}

	var problem *api.ProblemDetail
	if !errors.As(personalProblem(sampleErr), &problem) {
		t.Fatal("期望返回 *api.ProblemDetail")
	}
	if problem.Status != 422 || problem.Code != api.ErrInvalidBiometricSample {
		t.Fatalf("状态/错误码不符: %d %s", problem.Status, problem.Code)
	}
	if len(problem.Errors) != 1 {
		t.Fatalf("期望 1 条错误明细，实际 %d 条", len(problem.Errors))
	}
	const wantLocation = "body.samples[3].numericValue"
	if problem.Errors[0].Location != wantLocation {
		t.Fatalf("定位 = %q，期望 %q", problem.Errors[0].Location, wantLocation)
	}
	if problem.Errors[0].Message != "out of range" {
		t.Fatalf("明细消息 = %q", problem.Errors[0].Message)
	}
}

// TestPersonalProblemFallsBackForUnknownError 验证未识别的错误不会被误判成业务错误，
// 而是落到通用兜底分支，避免把内部错误伪装成 4xx 掩盖问题。
func TestPersonalProblemFallsBackForUnknownError(t *testing.T) {
	var problem *api.ProblemDetail
	if !errors.As(personalProblem(errors.New("unexpected storage failure")), &problem) {
		t.Fatal("期望返回 *api.ProblemDetail")
	}
	if problem.Status < 500 {
		t.Fatalf("未知错误应落到 5xx，实际 %d", problem.Status)
	}
}
