package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/shixu-app/server/internal/api"
)

func main() {
	outPath := flag.String("out", "../../contracts/openapi.json", "output OpenAPI 3.1 JSON file path")
	flag.Parse()

	router := chi.NewRouter()
	cfg := huma.DefaultConfig("时序智配 (Temporal Intelligence Scheduler) V2 API", "2.0.0")
	cfg.Info.Description = "基于穿戴设备生理节律感知的个人精力保护与团队协同排会中枢唯一接口契约。"
	cfg.Servers = []*huma.Server{
		{URL: "http://localhost:8080", Description: "Local Development Server"},
	}
	cfg.Tags = []*huma.Tag{
		{Name: "System", Description: "系统健康探针"},
		{Name: "Auth", Description: "身份认证、双端自适应令牌轮换与 WebSocket 票据"},
		{Name: "Biometrics", Description: "Android Health Connect / BLE GATT / 回放样本接入"},
		{Name: "Energy", Description: "个人精力电量、24h 节律曲线、保护窗与基线档案"},
		{Name: "Schedule", Description: "个人统一时间块 CRUD 与突发/疲劳 3 策略可撤销救援"},
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

	humaAPI := humachi.New(router, cfg)
	api.RegisterContractRoutes(humaAPI, nil)

	// 将 WebSocket 事件信封与独立 Payload Schema 注入 OpenAPI components.schemas，供双端类型生成器消费
	doc := humaAPI.OpenAPI()
	registry := doc.Components.Schemas
	registry.Schema(reflectType[api.ProblemDetail](), true, "ProblemDetail")
	registry.Schema(reflectType[api.WsEnvelope](), true, "WsEnvelope")
	registry.Schema(reflectType[api.WsEnergyUpdatedPayload](), true, "WsEnergyUpdatedPayload")
	registry.Schema(reflectType[api.WsEnergyOverloadAlertPayload](), true, "WsEnergyOverloadAlertPayload")
	registry.Schema(reflectType[api.WsScheduleUpdatedPayload](), true, "WsScheduleUpdatedPayload")
	registry.Schema(reflectType[api.WsWorkspaceMeetingConfirmedPayload](), true, "WsWorkspaceMeetingConfirmedPayload")
	registry.Schema(reflectType[api.WsWorkspaceMeetingCancelledPayload](), true, "WsWorkspaceMeetingCancelledPayload")
	registry.Schema(reflectType[api.WsWorkspaceMeetingRespondedPayload](), true, "WsWorkspaceMeetingRespondedPayload")
	registry.Schema(reflectType[api.WsAvailabilityChangedPayload](), true, "WsAvailabilityChangedPayload")

	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal openapi spec: %v\n", err)
		os.Exit(1)
	}
	raw = append(raw, '\n')

	if err := os.MkdirAll(filepath.Dir(*outPath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "create output directory: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, raw, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write openapi spec: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Exported OpenAPI 3.1 contract to %s\n", *outPath)
}

func reflectType[T any]() reflect.Type {
	var zero T
	return reflect.TypeOf(zero)
}
