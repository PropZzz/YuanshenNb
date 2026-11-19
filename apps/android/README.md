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
│   ├── datastore/           # Android Keystore + AES-GCM 原子加密令牌信封
│   ├── database/            # 按账号隔离的 Room 待传队列与今日只读快照
│   ├── health/              # 最小权限、14 天历史 / ChangesToken 增量 / Worker
│   ├── ble/                 # 0x180D 扫描、0x2A37 解析、60s RR/RMSSD 聚合
│   └── ui/theme/            # ShixuTheme（浅/深色 ColorScheme 对齐 Web tokens.css）
└── feature/                 # energy / schedule / team / settings 页面与 ViewModel
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

真机通过 `local.properties` 的 `shixu.apiBaseUrl` 或环境变量 `ANDROID_API_BASE_URL` 指向可达的服务端地址；Debug 支持本地 HTTP，正式部署应使用 HTTPS。`local.properties` 不入库。

## 已接通的产品闭环

- **账号**：真实注册、登录、`/auth/me` 会话恢复、令牌单飞轮换与注销。刷新遇到断网或 5xx 会保留有效的 Refresh Token；服务端明确拒绝时才清除并引导重新登录。
- **专注与日历**：真实今日日程、日期选择、创建/编辑/完成/取消；25 分钟专注使用真实时钟截止时间，切换 Tab 后继续计时。服务端救援预览展示三套策略、指标和逐项前后对比，确认才应用，可按快照撤销。
- **团队**：创建/邀请码加入/切换工作区；成员名册与服务端脱敏状态；本人三档隐私设置；选择参会人后请求黄金窗口，显式确认后创建会议，并可接受/拒绝或按权限取消会议。端侧不计算排程。
- **精力与设置**：仅绘制服务端返回的分数、因子、整点曲线、来源诊断；无样本显示基线估算，显式回放显示 `replay_demo`。账户、时区、主题、工作时段和 chronotype 均调用真实保存接口。
- **采集补传**：Health Connect 五类最小读取权限、首次近 14 天、ChangesToken 增量与过期后 48 小时重拉；按系统支持情况单独申请后台读取权限。WorkManager 周期 15 分钟及前台触发，网络可用时每批最多 500 条上传；确定性 externalId + Room 唯一主键防重；422 仅剔除服务端指出的坏点，断网/5xx 保留批次。
- **BLE**：扫描标准 `0x180D` 设备，按 Flags 解析 8/16 位心率、能量字段及 RR 列表；剔除超过 25% 跳变的 RR，60 秒窗口聚合心率与 RMSSD 后入队。保持应用前台进行采集，离开前台自动停止；不提供 RR 的设备不会产生假 HRV。
- **双端联动**：短效票据 WebSocket、指数退避重连、重连后重新拉取状态；日程/会议事件更新今日 Room 快照与本地提醒；精力过载通知点击进入救援页。提醒使用不需特殊权限的非精确 AlarmManager 闹钟，并尊重通知授权。

## 验证与当前边界

`testDebugUnitTest` 覆盖契约反序列化、令牌轮换、离线刷新保留会话、加密持久化与损坏数据、BLE 协议/RR、Health Connect 单位转换、队列账号隔离、500 条上限、422 坏点处理和 5xx 保留。

常规门禁为 `testDebugUnitTest lintDebug`，APK 可另执行 `assembleDebug`。不得跳过失败项、降低锁定版本或手改 `generated/`。

- 尚需在真实 Android 设备验证权限授权流程、系统后台策略、真实设备 BLE/RR、通知到达，以及浅/深色与小屏视觉；本地构建和 JVM 单测不能替代这些验收。
- 冷启动需要服务端恢复账户资料后进入工作台；进入后断网时，可显示按账号隔离的今日只读快照，不能离线假保存。
- Health Connect 不可用、缺少权限或不支持后台读取时会明确提示；已缓存样本仍可补传。当前契约没有删除生理样本的接口，Health Connect 的删除变更不伪装成服务端已删除。
- Android 不持有调度或精力推理算法；会议/救援是否可应用、版本冲突和隐私脱敏以服务端结果为准。

## 核心原则

- Android 端**不重写**精力曲线或团队调度算法，仅负责：
  1. 授权并采集穿戴设备原始生理数据；
  2. 展示今日精力电量、个人日程与团队会议确认/提醒；
  3. 接收服务端推送的疲劳过载保护建议并触发用户确认。
