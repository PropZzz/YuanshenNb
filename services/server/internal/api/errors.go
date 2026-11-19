package api

import (
	"fmt"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// ErrorCode 定义符合 RFC 9457 的标准机器可读业务错误码字典。
type ErrorCode string

const (
	ErrBadRequest                   ErrorCode = "BAD_REQUEST"
	ErrUnauthorized                 ErrorCode = "UNAUTHORIZED"
	ErrInvalidCredentials           ErrorCode = "INVALID_CREDENTIALS"
	ErrInvalidRefreshToken          ErrorCode = "INVALID_REFRESH_TOKEN"
	ErrTokenReuseDetected           ErrorCode = "TOKEN_REUSE_DETECTED"
	ErrInvalidWSTicket              ErrorCode = "INVALID_WS_TICKET"
	ErrForbidden                    ErrorCode = "FORBIDDEN"
	ErrForbiddenNotWorkspaceMember  ErrorCode = "FORBIDDEN_NOT_WORKSPACE_MEMBER"
	ErrForbiddenInsufficientRole    ErrorCode = "FORBIDDEN_INSUFFICIENT_ROLE"
	ErrForbiddenNotParticipant      ErrorCode = "FORBIDDEN_NOT_MEETING_PARTICIPANT"
	ErrNotFound                     ErrorCode = "NOT_FOUND"
	ErrInviteCodeNotFound           ErrorCode = "INVITE_CODE_NOT_FOUND"
	ErrMeetingProposalNotFound      ErrorCode = "MEETING_PROPOSAL_NOT_FOUND"
	ErrSnapshotNotFound             ErrorCode = "SNAPSHOT_NOT_FOUND"
	ErrMethodNotAllowed             ErrorCode = "METHOD_NOT_ALLOWED"
	ErrConflict                     ErrorCode = "CONFLICT"
	ErrEmailAlreadyExists           ErrorCode = "EMAIL_ALREADY_EXISTS"
	ErrAlreadyWorkspaceMember       ErrorCode = "ALREADY_WORKSPACE_MEMBER"
	ErrConflictScheduleOverlap      ErrorCode = "CONFLICT_SCHEDULE_OVERLAP"
	ErrConflictMemberBusy           ErrorCode = "CONFLICT_MEMBER_BUSY"
	ErrMeetingManagedByProposal     ErrorCode = "MEETING_MANAGED_BY_PROPOSAL"
	ErrMeetingAlreadyCancelled      ErrorCode = "MEETING_ALREADY_CANCELLED"
	ErrStaleBaselineVersion         ErrorCode = "STALE_BASELINE_VERSION"
	ErrAlreadyReverted              ErrorCode = "ALREADY_REVERTED"
	ErrSnapshotRestoreConflict      ErrorCode = "SNAPSHOT_RESTORE_CONFLICT"
	ErrValidationFailed             ErrorCode = "VALIDATION_FAILED"
	ErrRangeTooLarge                ErrorCode = "RANGE_TOO_LARGE"
	ErrInvalidTimeRange             ErrorCode = "INVALID_TIME_RANGE"
	ErrDeadlineInPast               ErrorCode = "DEADLINE_IN_PAST"
	ErrInvalidBiometricSample       ErrorCode = "INVALID_BIOMETRIC_SAMPLE"
	ErrInvalidWorkHours             ErrorCode = "INVALID_WORK_HOURS"
	ErrParticipantNotInWorkspace    ErrorCode = "PARTICIPANT_NOT_IN_WORKSPACE"
	ErrTooManyRequests              ErrorCode = "TOO_MANY_REQUESTS"
	ErrInternalServer               ErrorCode = "INTERNAL_SERVER_ERROR"
	ErrServiceUnavailable           ErrorCode = "SERVICE_UNAVAILABLE"
)

func (ErrorCode) Schema(r huma.Registry) *huma.Schema {
	return registerEnumSchema(
		r,
		"ErrorCode",
		string(ErrBadRequest),
		string(ErrUnauthorized),
		string(ErrInvalidCredentials),
		string(ErrInvalidRefreshToken),
		string(ErrTokenReuseDetected),
		string(ErrInvalidWSTicket),
		string(ErrForbidden),
		string(ErrForbiddenNotWorkspaceMember),
		string(ErrForbiddenInsufficientRole),
		string(ErrForbiddenNotParticipant),
		string(ErrNotFound),
		string(ErrInviteCodeNotFound),
		string(ErrMeetingProposalNotFound),
		string(ErrSnapshotNotFound),
		string(ErrMethodNotAllowed),
		string(ErrConflict),
		string(ErrEmailAlreadyExists),
		string(ErrAlreadyWorkspaceMember),
		string(ErrConflictScheduleOverlap),
		string(ErrConflictMemberBusy),
		string(ErrMeetingManagedByProposal),
		string(ErrMeetingAlreadyCancelled),
		string(ErrStaleBaselineVersion),
		string(ErrAlreadyReverted),
		string(ErrSnapshotRestoreConflict),
		string(ErrValidationFailed),
		string(ErrRangeTooLarge),
		string(ErrInvalidTimeRange),
		string(ErrDeadlineInPast),
		string(ErrInvalidBiometricSample),
		string(ErrInvalidWorkHours),
		string(ErrParticipantNotInWorkspace),
		string(ErrTooManyRequests),
		string(ErrInternalServer),
		string(ErrServiceUnavailable),
	)
}

type ErrorDetailItem struct {
	Location string `json:"location,omitempty"`
	Message  string `json:"message"`
	Value    any    `json:"value,omitempty"`
}

// ProblemDetail 遵循 RFC 9457 (application/problem+json)，扩展机器可读业务 ErrorCode，并兼容 huma.StatusError。
type ProblemDetail struct {
	Type   string            `json:"type" format:"uri"`
	Title  string            `json:"title"`
	Status int               `json:"status"`
	Detail string            `json:"detail"`
	Code   ErrorCode         `json:"code"`
	Errors []ErrorDetailItem `json:"errors,omitempty"`
}

func (p *ProblemDetail) Error() string {
	if p.Detail != "" {
		return p.Detail
	}
	return p.Title
}

func (p *ProblemDetail) GetStatus() int {
	if p.Status == 0 {
		return http.StatusInternalServerError
	}
	return p.Status
}

func (p *ProblemDetail) ContentType(string) string {
	return "application/problem+json"
}

// DefaultErrorCodeForStatus 为未显式指定业务码的框架/兜底 HTTP 状态映射通用错误码，避免语义张冠李戴。
func DefaultErrorCodeForStatus(status int) ErrorCode {
	switch status {
	case http.StatusBadRequest:
		return ErrBadRequest
	case http.StatusUnauthorized:
		return ErrUnauthorized
	case http.StatusForbidden:
		return ErrForbidden
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusMethodNotAllowed:
		return ErrMethodNotAllowed
	case http.StatusConflict:
		return ErrConflict
	case http.StatusUnprocessableEntity:
		return ErrValidationFailed
	case http.StatusTooManyRequests:
		return ErrTooManyRequests
	case http.StatusServiceUnavailable:
		return ErrServiceUnavailable
	default:
		return ErrInternalServer
	}
}

// NewProblem 构造符合 RFC 9457 的标准业务异常。
func NewProblem(status int, code ErrorCode, detail string, errs ...ErrorDetailItem) *ProblemDetail {
	return &ProblemDetail{
		Type:   fmt.Sprintf("https://shixu.app/errors/%s", code),
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
		Code:   code,
		Errors: errs,
	}
}

// ConfigureHumaErrors 将 Huma 全局错误工厂统一替换为 ProblemDetail（引用 ErrorCode 枚举）。
func ConfigureHumaErrors() {
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		items := make([]ErrorDetailItem, 0, len(errs))
		for _, err := range errs {
			if err == nil {
				continue
			}
			if d, ok := err.(huma.ErrorDetailer); ok {
				ed := d.ErrorDetail()
				items = append(items, ErrorDetailItem{
					Location: ed.Location,
					Message:  ed.Message,
					Value:    ed.Value,
				})
				continue
			}
			items = append(items, ErrorDetailItem{Message: err.Error()})
		}
		return NewProblem(status, DefaultErrorCodeForStatus(status), msg, items...)
	}
}
