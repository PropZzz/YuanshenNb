# `contracts` — OpenAPI 3.1 唯一真相契约

本目录存放由 Go 服务端（`services/server` via Huma v2）导出的 `openapi.json`，作为前后端接口的唯一编译期契约：

- **Web (`apps/web`)**：使用 `openapi-typescript` 生成类型文件，配合 `openapi-fetch` 实现全链路类型安全请求。
- **Android (`apps/android`)**：使用 OpenAPI Generator (Kotlin + `kotlinx.serialization` + Retrofit) 生成 DTO 与接口声明。

任何后端 API 请求/响应字段修改后，必须重新导出 `contracts/openapi.json` 并同步生成双端模型，避免接口漂移。
