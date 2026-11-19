package api

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
)

// ── Huma 请求/响应包装结构体（含 Path/Query/Header/Cookie 绑定） ──

type HealthOutput struct {
	Status int
	Body   HealthResponse
}

type RegisterInput struct {
	Body RegisterRequest
}

type AuthTokensOutput struct {
	Status    int
	SetCookie []string `header:"Set-Cookie"`
	Body      AuthTokensResponse
}

type LoginInput struct {
	Body LoginRequest
}

type RefreshInput struct {
	RefreshCookie string               `cookie:"rc_refresh_token" hidden:"true" doc:"Web 端 HttpOnly Refresh Token Cookie"`
	Body          *RefreshTokenRequest // 指针类型使 RequestBody 在 OpenAPI 中为可选（支持仅凭 Cookie 刷新）
}

type LogoutInput struct {
	RefreshCookie string         `cookie:"rc_refresh_token" hidden:"true"`
	Body          *LogoutRequest // 指针类型支持无 Body 纯 Cookie 注销
}

type LogoutOutput struct {
	Status    int
	SetCookie []string `header:"Set-Cookie"`
}

type UserProfileOutput struct {
	Body UserProfile
}

type UpdateMeInput struct {
	Body UpdateMeRequest
}

type WsTicketOutput struct {
	Body WsTicketResponse
}

type BiometricBatchInput struct {
	Body BiometricBatchRequest
}

type BiometricBatchOutput struct {
	Body BiometricBatchResponse
}

type ReplaySeedInput struct {
	Body ReplaySeedRequest
}

type ReplaySeedOutput struct {
	Body ReplaySeedResponse
}

type EnergyTodayInput struct {
	Day string `query:"day" format:"date" doc:"用户本地日期 YYYY-MM-DD（默认今日）"`
}

type EnergyTodayOutput struct {
	Body EnergyTodayResponse
}

type EnergyProfileOutput struct {
	Body EnergyProfileDTO
}

type UpdateEnergyProfileInput struct {
	Body UpdateEnergyProfileRequest
}

type ListScheduleItemsInput struct {
	From             time.Time `query:"from" required:"true" format:"date-time"`
	To               time.Time `query:"to" required:"true" format:"date-time"`
	IncludeCancelled bool      `query:"includeCancelled" default:"false"`
}

type ListScheduleItemsOutput struct {
	Body ScheduleItemListResponse
}

type CreateScheduleItemInput struct {
	Body CreateScheduleItemRequest
}

type ScheduleMutationOutput struct {
	Status int
	Body   ScheduleMutationResponse
}

type UpdateScheduleItemInput struct {
	ID   uuid.UUID `path:"id" format:"uuid"`
	Body UpdateScheduleItemRequest
}

type ScheduleItemIDInput struct {
	ID uuid.UUID `path:"id" format:"uuid"`
}

type RescueOptionsInput struct {
	Body RescueOptionsRequest
}

type RescueOptionsOutput struct {
	Body RescueOptionsResponse
}

type RescueApplyInput struct {
	IdempotencyKey string `header:"Idempotency-Key" doc:"可选请求幂等键（防弱网重复应用救援方案）"`
	Body           RescueApplyRequest
}

type RescueApplyOutput struct {
	Body RescueApplyResponse
}

type RescueUndoInput struct {
	Body RescueUndoRequest
}

type RescueUndoOutput struct {
	Body RescueUndoResponse
}

type RescueHistoryInput struct {
	Limit  int    `query:"limit" minimum:"1" maximum:"50" default:"20"`
	Cursor string `query:"cursor"`
}

type RescueHistoryOutput struct {
	Body RescueHistoryResponse
}

type CreateWorkspaceInput struct {
	Body CreateWorkspaceRequest
}

type WorkspaceOutput struct {
	Status int
	Body   WorkspaceDTO
}

type WorkspaceListOutput struct {
	Body WorkspaceListResponse
}

type JoinWorkspaceInput struct {
	Body JoinWorkspaceRequest
}

type WorkspaceIDInput struct {
	ID uuid.UUID `path:"id" format:"uuid"`
}

type UpdateWorkspacePrivacyInput struct {
	ID   uuid.UUID `path:"id" format:"uuid"`
	Body UpdateWorkspaceMemberConfigRequest
}

type WorkspaceMemberOutput struct {
	Body WorkspaceMemberDTO
}

type WorkspaceMembersOutput struct {
	Body WorkspaceMemberListResponse
}

type WorkspaceAvailabilityInput struct {
	ID        uuid.UUID   `path:"id" format:"uuid"`
	From      time.Time   `query:"from" required:"true" format:"date-time"`
	To        time.Time   `query:"to" required:"true" format:"date-time"`
	MemberIDs []UUIDParam `query:"memberIds" doc:"可选过滤工作区成员子集"`
}

// Resolve 校验逗号分隔的 memberIds 均为合法 UUID。
func (in *WorkspaceAvailabilityInput) Resolve(huma.Context) []error {
	var errs []error
	for i, raw := range in.MemberIDs {
		if _, err := uuid.Parse(string(raw)); err != nil {
			errs = append(errs, &huma.ErrorDetail{
				Location: fmt.Sprintf("query.memberIds[%d]", i),
				Message:  "must be a valid UUID",
				Value:    string(raw),
			})
		}
	}
	return errs
}

// ParsedMemberIDs 返回已解析的 UUID 切片（供业务 Handler 消费）。
func (in *WorkspaceAvailabilityInput) ParsedMemberIDs() ([]uuid.UUID, error) {
	if len(in.MemberIDs) == 0 {
		return nil, nil
	}
	ids := make([]uuid.UUID, len(in.MemberIDs))
	for i, raw := range in.MemberIDs {
		id, err := uuid.Parse(string(raw))
		if err != nil {
			return nil, fmt.Errorf("invalid memberIds[%d]: %w", i, err)
		}
		ids[i] = id
	}
	return ids, nil
}

type WorkspaceAvailabilityOutput struct {
	Body WorkspaceAvailabilityResponse
}

type RecommendMeetingInput struct {
	ID   uuid.UUID `path:"id" format:"uuid"`
	Body RecommendMeetingRequest
}

type RecommendMeetingOutput struct {
	Body RecommendMeetingResponse
}

type ConfirmMeetingInput struct {
	ID             uuid.UUID `path:"id" format:"uuid"`
	IdempotencyKey string    `header:"Idempotency-Key" doc:"可选请求幂等键"`
	Body           ConfirmMeetingRequest
}

type ConfirmMeetingOutput struct {
	Status int
	Body   ConfirmMeetingResponse
}

type ListWorkspaceMeetingsInput struct {
	ID     uuid.UUID             `path:"id" format:"uuid"`
	Status MeetingProposalStatus `query:"status"`
	From   time.Time             `query:"from" format:"date-time"`
	To     time.Time             `query:"to" format:"date-time"`
	Limit  int                   `query:"limit" minimum:"1" maximum:"50" default:"20"`
	Cursor string                `query:"cursor"`
}

type ListWorkspaceMeetingsOutput struct {
	Body MeetingProposalListResponse
}

type RespondMeetingInput struct {
	ID         uuid.UUID `path:"id" format:"uuid"`
	ProposalID uuid.UUID `path:"proposalId" format:"uuid"`
	Body       RespondMeetingRequest
}

type RespondMeetingOutput struct {
	Body RespondMeetingResponse
}

type CancelMeetingInput struct {
	ID         uuid.UUID             `path:"id" format:"uuid"`
	ProposalID uuid.UUID             `path:"proposalId" format:"uuid"`
	Body       *CancelMeetingRequest // 指针类型支持无 Body 取消会议
}

type CancelMeetingOutput struct {
	Body CancelMeetingResponse
}

// ── 按限界上下文拆分的领域处理器接口（ISP：支持各模块独立开发、注入与单测） ──

type SystemHandlers interface {
	GetHealth(ctx context.Context, in *struct{}) (*HealthOutput, error)
}

type AuthHandlers interface {
	RegisterUser(ctx context.Context, in *RegisterInput) (*AuthTokensOutput, error)
	LoginUser(ctx context.Context, in *LoginInput) (*AuthTokensOutput, error)
	RefreshTokens(ctx context.Context, in *RefreshInput) (*AuthTokensOutput, error)
	LogoutUser(ctx context.Context, in *LogoutInput) (*LogoutOutput, error)
	GetCurrentUser(ctx context.Context, in *struct{}) (*UserProfileOutput, error)
	UpdateCurrentUser(ctx context.Context, in *UpdateMeInput) (*UserProfileOutput, error)
	IssueWsTicket(ctx context.Context, in *struct{}) (*WsTicketOutput, error)
}

type BiometricsHandlers interface {
	IngestBiometricSamplesBatch(ctx context.Context, in *BiometricBatchInput) (*BiometricBatchOutput, error)
	SeedBiometricReplay(ctx context.Context, in *ReplaySeedInput) (*ReplaySeedOutput, error)
}

type EnergyHandlers interface {
	GetTodayEnergy(ctx context.Context, in *EnergyTodayInput) (*EnergyTodayOutput, error)
	GetEnergyProfile(ctx context.Context, in *struct{}) (*EnergyProfileOutput, error)
	UpdateEnergyProfile(ctx context.Context, in *UpdateEnergyProfileInput) (*EnergyProfileOutput, error)
}

type ScheduleHandlers interface {
	ListScheduleItems(ctx context.Context, in *ListScheduleItemsInput) (*ListScheduleItemsOutput, error)
	CreateScheduleItem(ctx context.Context, in *CreateScheduleItemInput) (*ScheduleMutationOutput, error)
	UpdateScheduleItem(ctx context.Context, in *UpdateScheduleItemInput) (*ScheduleMutationOutput, error)
	DeleteScheduleItem(ctx context.Context, in *ScheduleItemIDInput) (*struct{}, error)
	PreviewRescueOptions(ctx context.Context, in *RescueOptionsInput) (*RescueOptionsOutput, error)
	ApplyRescueOption(ctx context.Context, in *RescueApplyInput) (*RescueApplyOutput, error)
	UndoRescueSnapshot(ctx context.Context, in *RescueUndoInput) (*RescueUndoOutput, error)
	ListRescueHistory(ctx context.Context, in *RescueHistoryInput) (*RescueHistoryOutput, error)
}

type WorkspacesHandlers interface {
	CreateWorkspace(ctx context.Context, in *CreateWorkspaceInput) (*WorkspaceOutput, error)
	ListWorkspaces(ctx context.Context, in *struct{}) (*WorkspaceListOutput, error)
	JoinWorkspace(ctx context.Context, in *JoinWorkspaceInput) (*WorkspaceOutput, error)
	UpdateWorkspacePrivacy(ctx context.Context, in *UpdateWorkspacePrivacyInput) (*WorkspaceMemberOutput, error)
	ListWorkspaceMembers(ctx context.Context, in *WorkspaceIDInput) (*WorkspaceMembersOutput, error)
	GetWorkspaceAvailability(ctx context.Context, in *WorkspaceAvailabilityInput) (*WorkspaceAvailabilityOutput, error)
	RecommendWorkspaceMeetings(ctx context.Context, in *RecommendMeetingInput) (*RecommendMeetingOutput, error)
	ConfirmWorkspaceMeeting(ctx context.Context, in *ConfirmMeetingInput) (*ConfirmMeetingOutput, error)
	ListWorkspaceMeetings(ctx context.Context, in *ListWorkspaceMeetingsInput) (*ListWorkspaceMeetingsOutput, error)
	RespondWorkspaceMeeting(ctx context.Context, in *RespondMeetingInput) (*RespondMeetingOutput, error)
	CancelWorkspaceMeeting(ctx context.Context, in *CancelMeetingInput) (*CancelMeetingOutput, error)
}

// RouteHandlers 聚合各领域模块的处理器实现，未实现的领域模块置为 nil 即可。
type RouteHandlers struct {
	System     SystemHandlers
	Auth       AuthHandlers
	Biometrics BiometricsHandlers
	Energy     EnergyHandlers
	Schedule   ScheduleHandlers
	Workspaces WorkspacesHandlers
}

// RouteOptions 控制认证中间件挂载与契约导出模式。
type RouteOptions struct {
	// AuthMiddleware 作用于所有受保护路由组（含 /auth/logout, /auth/me, /auth/ws-ticket 及全部业务接口）。
	AuthMiddleware func(ctx huma.Context, next func(huma.Context))
	// AllowUnimplementedStubs 仅限 export-openapi 或契约测试启用；运行期为 false，严禁暴露 501 占位路由。
	AllowUnimplementedStubs bool
}

func stubHandler[I any, O any]() func(context.Context, *I) (*O, error) {
	return func(context.Context, *I) (*O, error) {
		return nil, huma.Error501NotImplemented("openapi export stub only")
	}
}

func pick[T any, I any, O any](impl T, isNil bool, fn func(T) func(context.Context, *I) (*O, error)) func(context.Context, *I) (*O, error) {
	if isNil {
		return stubHandler[I, O]()
	}
	return fn(impl)
}

// RegisterContractRoutes 将公开与受保护 REST 端点按领域模块注册至 Huma API。
func RegisterContractRoutes(humaAPI huma.API, h RouteHandlers, opts RouteOptions) {
	ConfigureHumaErrors()

	publicGroup := huma.NewGroup(humaAPI)
	protectedGroup := huma.NewGroup(humaAPI)
	if opts.AuthMiddleware != nil {
		protectedGroup.UseMiddleware(opts.AuthMiddleware)
	}
	protectedGroup.UseSimpleModifier(func(o *huma.Operation) {
		if len(o.Security) == 0 {
			o.Security = []map[string][]string{{"BearerAuth": {}}}
		}
		if !slices.Contains(o.Errors, http.StatusUnauthorized) {
			o.Errors = append(o.Errors, http.StatusUnauthorized)
		}
	})

	if h.System != nil || opts.AllowUnimplementedStubs {
		registerSystemRoutes(publicGroup, h.System)
	}
	if h.Auth != nil || opts.AllowUnimplementedStubs {
		registerAuthPublicRoutes(publicGroup, h.Auth)
		registerAuthProtectedRoutes(protectedGroup, h.Auth)
	}
	if h.Biometrics != nil || opts.AllowUnimplementedStubs {
		registerBiometricsRoutes(protectedGroup, h.Biometrics)
	}
	if h.Energy != nil || opts.AllowUnimplementedStubs {
		registerEnergyRoutes(protectedGroup, h.Energy)
	}
	if h.Schedule != nil || opts.AllowUnimplementedStubs {
		registerScheduleRoutes(protectedGroup, h.Schedule)
	}
	if h.Workspaces != nil || opts.AllowUnimplementedStubs {
		registerWorkspacesRoutes(protectedGroup, h.Workspaces)
	}
}

func registerSystemRoutes(api huma.API, h SystemHandlers) {
	isNil := h == nil
	huma.Register(api, huma.Operation{
		OperationID: "getHealth",
		Method:      http.MethodGet,
		Path:        "/api/v1/health",
		Summary:     "数据库与服务连通性探针",
		Tags:        []string{"System"},
		Errors:      []int{http.StatusServiceUnavailable},
	}, pick(h, isNil, func(x SystemHandlers) func(context.Context, *struct{}) (*HealthOutput, error) {
		return x.GetHealth
	}))
}

func registerAuthPublicRoutes(api huma.API, h AuthHandlers) {
	isNil := h == nil
	refreshSecurity := []map[string][]string{{"RefreshTokenCookie": {}}, {}}

	huma.Register(api, huma.Operation{
		OperationID:   "registerUser",
		Method:        http.MethodPost,
		Path:          "/api/v1/auth/register",
		Summary:       "注册新账号并初始化默认精力节律档案",
		Tags:          []string{"Auth"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *RegisterInput) (*AuthTokensOutput, error) {
		return x.RegisterUser
	}))

	huma.Register(api, huma.Operation{
		OperationID: "loginUser",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/login",
		Summary:     "Argon2id 密码校验登录并签发令牌族",
		Tags:        []string{"Auth"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *LoginInput) (*AuthTokensOutput, error) {
		return x.LoginUser
	}))

	huma.Register(api, huma.Operation{
		OperationID: "refreshTokens",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/refresh",
		Summary:     "轮换 Refresh Token（支持 JSON Body 或 HttpOnly Cookie，含重放盗用检测）",
		Tags:        []string{"Auth"},
		Security:    refreshSecurity,
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *RefreshInput) (*AuthTokensOutput, error) {
		return x.RefreshTokens
	}))
}

func registerAuthProtectedRoutes(api huma.API, h AuthHandlers) {
	isNil := h == nil

	huma.Register(api, huma.Operation{
		OperationID:   "logoutUser",
		Method:        http.MethodPost,
		Path:          "/api/v1/auth/logout",
		Summary:       "吊销当前设备 Refresh Token 并清除 Cookie",
		Tags:          []string{"Auth"},
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *LogoutInput) (*LogoutOutput, error) {
		return x.LogoutUser
	}))

	huma.Register(api, huma.Operation{
		OperationID: "getCurrentUser",
		Method:      http.MethodGet,
		Path:        "/api/v1/auth/me",
		Summary:     "获取当前登录用户档案",
		Tags:        []string{"Auth"},
		Errors:      []int{http.StatusUnauthorized},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *struct{}) (*UserProfileOutput, error) {
		return x.GetCurrentUser
	}))

	huma.Register(api, huma.Operation{
		OperationID: "updateCurrentUser",
		Method:      http.MethodPatch,
		Path:        "/api/v1/auth/me",
		Summary:     "更新用户昵称、时区或外观主题偏好",
		Tags:        []string{"Auth"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *UpdateMeInput) (*UserProfileOutput, error) {
		return x.UpdateCurrentUser
	}))

	huma.Register(api, huma.Operation{
		OperationID: "issueWsTicket",
		Method:      http.MethodPost,
		Path:        "/api/v1/auth/ws-ticket",
		Summary:     "签发 30 秒一次性 WebSocket 握手票据",
		Tags:        []string{"Auth"},
		Errors:      []int{http.StatusUnauthorized},
	}, pick(h, isNil, func(x AuthHandlers) func(context.Context, *struct{}) (*WsTicketOutput, error) {
		return x.IssueWsTicket
	}))
}

func registerBiometricsRoutes(api huma.API, h BiometricsHandlers) {
	isNil := h == nil

	huma.Register(api, huma.Operation{
		OperationID: "ingestBiometricSamplesBatch",
		Method:      http.MethodPost,
		Path:        "/api/v1/biometrics/samples/batch",
		Summary:     "批量上报穿戴生理样本（按 externalId 幂等去重并触发精力重算）",
		Tags:        []string{"Biometrics"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x BiometricsHandlers) func(context.Context, *BiometricBatchInput) (*BiometricBatchOutput, error) {
		return x.IngestBiometricSamplesBatch
	}))

	huma.Register(api, huma.Operation{
		OperationID: "seedBiometricReplay",
		Method:      http.MethodPost,
		Path:        "/api/v1/biometrics/replay-seed",
		Summary:     "显式注入 replay_demo 测试回放样本",
		Tags:        []string{"Biometrics"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x BiometricsHandlers) func(context.Context, *ReplaySeedInput) (*ReplaySeedOutput, error) {
		return x.SeedBiometricReplay
	}))
}

func registerEnergyRoutes(api huma.API, h EnergyHandlers) {
	isNil := h == nil

	huma.Register(api, huma.Operation{
		OperationID: "getTodayEnergy",
		Method:      http.MethodGet,
		Path:        "/api/v1/energy/today",
		Summary:     "获取指定日期的实时精力电量、四因子拆解、本地自然日节律曲线、保护盾与穿戴源诊断",
		Tags:        []string{"Energy"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x EnergyHandlers) func(context.Context, *EnergyTodayInput) (*EnergyTodayOutput, error) {
		return x.GetTodayEnergy
	}))

	huma.Register(api, huma.Operation{
		OperationID: "getEnergyProfile",
		Method:      http.MethodGet,
		Path:        "/api/v1/energy/profile",
		Summary:     "获取个人工作时间窗、昼夜节律类型、偏好心流窗口与 14 日生理基线",
		Tags:        []string{"Energy"},
		Errors:      []int{http.StatusUnauthorized},
	}, pick(h, isNil, func(x EnergyHandlers) func(context.Context, *struct{}) (*EnergyProfileOutput, error) {
		return x.GetEnergyProfile
	}))

	huma.Register(api, huma.Operation{
		OperationID: "updateEnergyProfile",
		Method:      http.MethodPut,
		Path:        "/api/v1/energy/profile",
		Summary:     "更新个人工作时间窗、昼夜节律类型、心流保护窗与最小恢复缓冲",
		Tags:        []string{"Energy"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x EnergyHandlers) func(context.Context, *UpdateEnergyProfileInput) (*EnergyProfileOutput, error) {
		return x.UpdateEnergyProfile
	}))
}

func registerScheduleRoutes(api huma.API, h ScheduleHandlers) {
	isNil := h == nil

	huma.Register(api, huma.Operation{
		OperationID: "listScheduleItems",
		Method:      http.MethodGet,
		Path:        "/api/v1/schedule/items",
		Summary:     "按 UTC 时间区间拉取个人日程与 48h 乐观锁基线版本（最大跨度 62 天）",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *ListScheduleItemsInput) (*ListScheduleItemsOutput, error) {
		return x.ListScheduleItems
	}))

	huma.Register(api, huma.Operation{
		OperationID:   "createScheduleItem",
		Method:        http.MethodPost,
		Path:          "/api/v1/schedule/items",
		Summary:       "新建个人日程时间块（含 GiST 硬锁定冲突检测）",
		Tags:          []string{"Schedule"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *CreateScheduleItemInput) (*ScheduleMutationOutput, error) {
		return x.CreateScheduleItem
	}))

	huma.Register(api, huma.Operation{
		OperationID: "updateScheduleItem",
		Method:      http.MethodPatch,
		Path:        "/api/v1/schedule/items/{id}",
		Summary:     "更新个人日程",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *UpdateScheduleItemInput) (*ScheduleMutationOutput, error) {
		return x.UpdateScheduleItem
	}))

	huma.Register(api, huma.Operation{
		OperationID:   "deleteScheduleItem",
		Method:        http.MethodDelete,
		Path:          "/api/v1/schedule/items/{id}",
		Summary:       "取消/软删除个人日程（置 status='cancelled'）",
		Tags:          []string{"Schedule"},
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *ScheduleItemIDInput) (*struct{}, error) {
		return x.DeleteScheduleItem
	}))

	huma.Register(api, huma.Operation{
		OperationID: "previewRescueOptions",
		Method:      http.MethodPost,
		Path:        "/api/v1/schedule/rescue/options",
		Summary:     "预览突发插单或疲劳过载的日程救援方案（纯函数计算，不写库）",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *RescueOptionsInput) (*RescueOptionsOutput, error) {
		return x.PreviewRescueOptions
	}))

	huma.Register(api, huma.Operation{
		OperationID: "applyRescueOption",
		Method:      http.MethodPost,
		Path:        "/api/v1/schedule/rescue/apply",
		Summary:     "确认采纳某套救援策略（单事务校验 48h baselineVersion、服务端确定性重算落库）",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *RescueApplyInput) (*RescueApplyOutput, error) {
		return x.ApplyRescueOption
	}))

	huma.Register(api, huma.Operation{
		OperationID: "undoRescueSnapshot",
		Method:      http.MethodPost,
		Path:        "/api/v1/schedule/rescue/undo",
		Summary:     "原子撤销已应用的救援快照（校验无新增锁定会议冲突后按 before_items 还原）",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *RescueUndoInput) (*RescueUndoOutput, error) {
		return x.UndoRescueSnapshot
	}))

	huma.Register(api, huma.Operation{
		OperationID: "listRescueHistory",
		Method:      http.MethodGet,
		Path:        "/api/v1/schedule/rescue/history",
		Summary:     "分页查询近期日程救援采纳与撤销历史",
		Tags:        []string{"Schedule"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x ScheduleHandlers) func(context.Context, *RescueHistoryInput) (*RescueHistoryOutput, error) {
		return x.ListRescueHistory
	}))
}

func registerWorkspacesRoutes(api huma.API, h WorkspacesHandlers) {
	isNil := h == nil

	huma.Register(api, huma.Operation{
		OperationID:   "createWorkspace",
		Method:        http.MethodPost,
		Path:          "/api/v1/workspaces",
		Summary:       "创建团队工作区并将创建者设为 owner",
		Tags:          []string{"Workspaces"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *CreateWorkspaceInput) (*WorkspaceOutput, error) {
		return x.CreateWorkspace
	}))

	huma.Register(api, huma.Operation{
		OperationID: "listWorkspaces",
		Method:      http.MethodGet,
		Path:        "/api/v1/workspaces",
		Summary:     "列出当前用户已加入的全部团队工作区",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *struct{}) (*WorkspaceListOutput, error) {
		return x.ListWorkspaces
	}))

	huma.Register(api, huma.Operation{
		OperationID: "joinWorkspace",
		Method:      http.MethodPost,
		Path:        "/api/v1/workspaces/join",
		Summary:     "通过邀请码加入团队工作区",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *JoinWorkspaceInput) (*WorkspaceOutput, error) {
		return x.JoinWorkspace
	}))

	huma.Register(api, huma.Operation{
		OperationID: "updateWorkspacePrivacy",
		Method:      http.MethodPatch,
		Path:        "/api/v1/workspaces/{id}/me",
		Summary:     "修改当前用户在该团队工作区的隐私脱敏投影级别",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *UpdateWorkspacePrivacyInput) (*WorkspaceMemberOutput, error) {
		return x.UpdateWorkspacePrivacy
	}))

	huma.Register(api, huma.Operation{
		OperationID: "listWorkspaceMembers",
		Method:      http.MethodGet,
		Path:        "/api/v1/workspaces/{id}/members",
		Summary:     "获取团队工作区成员名册",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *WorkspaceIDInput) (*WorkspaceMembersOutput, error) {
		return x.ListWorkspaceMembers
	}))

	huma.Register(api, huma.Operation{
		OperationID: "getWorkspaceAvailability",
		Method:      http.MethodGet,
		Path:        "/api/v1/workspaces/{id}/availability",
		Summary:     "获取经服务端严格隐私脱敏后的团队成员状态网格与整点精力档位（最大跨度 14 天）",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *WorkspaceAvailabilityInput) (*WorkspaceAvailabilityOutput, error) {
		return x.GetWorkspaceAvailability
	}))

	huma.Register(api, huma.Operation{
		OperationID: "recommendWorkspaceMeetings",
		Method:      http.MethodPost,
		Path:        "/api/v1/workspaces/{id}/meetings/recommend",
		Summary:     "求解团队协同排会黄金窗口（最大搜索跨度 14 天）",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *RecommendMeetingInput) (*RecommendMeetingOutput, error) {
		return x.RecommendWorkspaceMeetings
	}))

	huma.Register(api, huma.Operation{
		OperationID:   "confirmWorkspaceMeeting",
		Method:        http.MethodPost,
		Path:          "/api/v1/workspaces/{id}/meetings/confirm",
		Summary:       "单事务按序加锁确认团队会议并同步落库全员 schedule_items",
		Tags:          []string{"Workspaces"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *ConfirmMeetingInput) (*ConfirmMeetingOutput, error) {
		return x.ConfirmWorkspaceMeeting
	}))

	huma.Register(api, huma.Operation{
		OperationID: "listWorkspaceMeetings",
		Method:      http.MethodGet,
		Path:        "/api/v1/workspaces/{id}/meetings",
		Summary:     "查询团队工作区的会议提案列表及各参会人回执状态",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *ListWorkspaceMeetingsInput) (*ListWorkspaceMeetingsOutput, error) {
		return x.ListWorkspaceMeetings
	}))

	huma.Register(api, huma.Operation{
		OperationID: "respondWorkspaceMeeting",
		Method:      http.MethodPost,
		Path:        "/api/v1/workspaces/{id}/meetings/{proposalId}/respond",
		Summary:     "参会成员提交会议回执（accepted / declined）",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *RespondMeetingInput) (*RespondMeetingOutput, error) {
		return x.RespondWorkspaceMeeting
	}))

	huma.Register(api, huma.Operation{
		OperationID: "cancelWorkspaceMeeting",
		Method:      http.MethodPost,
		Path:        "/api/v1/workspaces/{id}/meetings/{proposalId}/cancel",
		Summary:     "组织者或管理员取消团队会议",
		Tags:        []string{"Workspaces"},
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusConflict, http.StatusUnprocessableEntity},
	}, pick(h, isNil, func(x WorkspacesHandlers) func(context.Context, *CancelMeetingInput) (*CancelMeetingOutput, error) {
		return x.CancelWorkspaceMeeting
	}))
}
