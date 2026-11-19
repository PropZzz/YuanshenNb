# `contracts` — OpenAPI 3.1 唯一真相契约

本目录存放由 Go 服务端（`services/server` via Huma v2）导出的 `openapi.json`，作为前后端接口的唯一编译期契约（已覆盖 27 个路径 / 32 个 REST 操作及 7 类 WebSocket 事件 Schema）：

- **契约产物**：[openapi.json](openapi.json)
- **后端契约源**：[services/server/internal/api/contracts.go](../services/server/internal/api/contracts.go) & [services/server/cmd/export-openapi/main.go](../services/server/cmd/export-openapi/main.go)
- **Web (`apps/web`)**：使用 `openapi-typescript` 生成类型文件，配合 `openapi-fetch` 实现全链路类型安全请求：
  ```powershell
  npx openapi-typescript contracts/openapi.json -o apps/web/src/api/schema.d.ts
  ```
- **Android (`apps/android`)**：使用 OpenAPI Generator (Kotlin + `kotlinx.serialization` + Retrofit) 生成 DTO 与接口声明。

任何后端 API 请求/响应字段修改后，必须同步更新 Go `Huma` 定义并重新导出 `contracts/openapi.json`，再触发双端类型生成检查，避免接口漂移。
