package api

import (
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// NewHumaConfig 构建主服务与 export-openapi CLI 共享的单一 Huma/OpenAPI 配置，确保运行期文档与契约产物 100% 一致。
func NewHumaConfig(version string) huma.Config {
	// 强制数组导出为非空 type: "array"，避免双端生成 List<T>? / T[] | null。
	huma.DefaultArrayNullable = false

	cfg := huma.DefaultConfig("时序智配 (Temporal Intelligence Scheduler) V2 API", version)
	// 移除默认 SchemaLinkTransformer，避免向所有请求/响应 DTO 注入冗余的 $schema 属性。
	cfg.CreateHooks = nil
	cfg.Info.Description = "基于穿戴设备生理节律感知的个人精力保护与团队协同排会中枢唯一接口契约。"
	cfg.Servers = []*huma.Server{
		{URL: "http://localhost:8080", Description: "Local Development Server"},
	}
	cfg.Tags = []*huma.Tag{
		{Name: "System", Description: "系统健康探针"},
		{Name: "Auth", Description: "身份认证、双端自适应令牌轮换与 WebSocket 票据"},
		{Name: "Biometrics", Description: "Android Health Connect / BLE GATT / 回放样本接入"},
		{Name: "Energy", Description: "个人精力电量、24h 节律曲线、保护窗与基线档案"},
		{Name: "Schedule", Description: "个人统一时间块 CRUD 与突发/疲劳可撤销救援"},
		{Name: "Workspaces", Description: "团队工作区、隐私防火墙、黄金窗口求解与会议事务协同"},
	}
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"BearerAuth": {
			Type:         "http",
			Scheme:       "bearer",
			BearerFormat: "JWT",
			Description:  "15 分钟短效 JWT Access Token",
		},
		"RefreshTokenCookie": {
			Type:        "apiKey",
			In:          "cookie",
			Name:        "rc_refresh_token",
			Description: "Web 端 HttpOnly Refresh Token Cookie（Android 端使用 JSON Body refreshToken 字段）",
		},
	}
	return cfg
}

// RegisterExtraSchemas 将标准错误响应与 WebSocket 事件信封及 7 大 Payload 写入 OpenAPI components.schemas。
func RegisterExtraSchemas(doc *huma.OpenAPI) {
	if doc == nil || doc.Components == nil || doc.Components.Schemas == nil {
		return
	}
	registry := doc.Components.Schemas
	registry.Schema(reflectType[ProblemDetail](), true, "ProblemDetail")
	registry.Schema(reflectType[WsEnvelope](), true, "WsEnvelope")
	registry.Schema(reflectType[WsEnergyUpdatedPayload](), true, "WsEnergyUpdatedPayload")
	registry.Schema(reflectType[WsEnergyOverloadAlertPayload](), true, "WsEnergyOverloadAlertPayload")
	registry.Schema(reflectType[WsScheduleUpdatedPayload](), true, "WsScheduleUpdatedPayload")
	registry.Schema(reflectType[WsWorkspaceMeetingConfirmedPayload](), true, "WsWorkspaceMeetingConfirmedPayload")
	registry.Schema(reflectType[WsWorkspaceMeetingCancelledPayload](), true, "WsWorkspaceMeetingCancelledPayload")
	registry.Schema(reflectType[WsWorkspaceMeetingRespondedPayload](), true, "WsWorkspaceMeetingRespondedPayload")
	registry.Schema(reflectType[WsAvailabilityChangedPayload](), true, "WsAvailabilityChangedPayload")
}

func reflectType[T any]() reflect.Type {
	var zero T
	return reflect.TypeOf(zero)
}
