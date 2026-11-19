# `apps/android` — Kotlin + Jetpack Compose 客户端

## 技术栈与锁定版本

- **JDK & SDK**：`JDK 17 / 21`（实测 Temurin `21.0.2`）、`compileSdk 36` / `targetSdk 35` / `minSdk 26`
- **构建插件**：`Gradle 8.14`（自带 `gradlew` / `gradlew.bat`）、`AGP 8.9.3`、`Kotlin 2.0.21`、`KSP 2.0.21-1.0.28`
- **UI 与架构**：`Jetpack Compose`（BOM `2024.10.01`, Material 3 对齐 `tokens.css`）、`Navigation Compose 2.8.4`、`Hilt 2.52`
- **穿戴采集与离线缓冲**：
  - **Android Health Connect SDK `1.1.0`**（读取睡眠分期、HRV RMSSD、静息心率、心率、活动消耗）
  - **原生 BLE GATT (`0x180D` Heart Rate Service)**（现场实时心率 & RR 间期通道）
  - **WorkManager `2.10.0`** + **Room `2.6.1`** + **DataStore `1.1.1`**
- **网络与契约**：`Retrofit 2.11.0` + `OkHttp 4.12.0` + `kotlinx-serialization-json 1.7.3`（由 `OpenAPI Generator 7.27.0` 生成 `app/src/main/kotlin/app/shixu/core/network/generated/`）

## 包边界（单 `:app` 模块 Clean Architecture）

```text
apps/android/app/src/main/kotlin/app/shixu/
├── app/                     # ShixuApplication (Hilt), MainActivity, Navigation
├── core/
│   ├── network/generated/   # scripts/gen-api.ps1 自动生成（禁止手改）
│   ├── datastore/           # Token 与 Health Connect ChangesToken（P4 实现）
│   ├── database/            # Room pending_biometrics 与今日只读快照（P4 实现）
│   ├── health/              # Health Connect 权限与增量拉取（P4 实现）
│   ├── ble/                 # BLE GATT 扫描与 60s RMSSD 聚合（P4 实现）
│   └── ui/theme/            # ShixuTheme（浅/深色 ColorScheme 对齐 Web tokens.css）
└── feature/                 # energy / schedule / team / settings 页面与 ViewModel（P4 实现）
```

## 起步与常用命令

```powershell
# 1. 根据 ../../contracts/openapi.json 重新生成 Kotlin DTO 与 Retrofit 接口
powershell -ExecutionPolicy Bypass -File apps/android/scripts/gen-api.ps1

# 2. 运行单元测试与 Lint 门禁
cd apps/android
.\gradlew.bat testDebugUnitTest lintDebug
```

> 模拟器访问宿主机 Go 服务端默认通过 `BuildConfig.API_BASE_URL`（`http://10.0.2.2:8080/`）。

## 核心原则

- Android 端**不重写**精力曲线或团队调度算法，仅负责：
  1. 授权并采集穿戴设备原始生理数据；
  2. 展示今日精力电量、个人日程与团队会议确认/提醒；
  3. 接收服务端推送的疲劳过载保护建议并触发用户确认。
