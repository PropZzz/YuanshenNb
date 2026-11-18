# `apps/android` — Kotlin + Jetpack Compose 客户端

## 技术栈

- **UI**：Kotlin 2.x + Jetpack Compose (Material 3)
- **架构与网络**：Hilt + ViewModel + StateFlow + Retrofit/OkHttp + `kotlinx.serialization`
- **穿戴设备与后台同步**：
  - **Android Health Connect SDK**（读取系统健康中枢的 HRV、静息心率、睡眠分期、活动消耗）
  - **原生 BLE GATT (`0x180D` Heart Rate Service)**（现场实时心率 & RR 间期演示通道）
  - **WorkManager**（周期性/增量批量上报至 `POST /api/v1/biometrics/samples/batch`）

## 核心原则

- Android 端**不重写**精力曲线或团队调度算法，仅负责：
  1. 授权并采集穿戴设备原始生理数据；
  2. 展示今日精力电量、个人日程与团队会议确认/提醒；
  3. 接收服务端推送的疲劳过载保护建议并触发用户确认。
- 本地编译现代 Android Gradle 工程需要 **JDK 17+**（随 Android Studio 自带）。
