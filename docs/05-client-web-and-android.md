# 05 · Web 与 Android 双端应用架构规范

> **对应目录**：[apps/web](../apps/web/README.md)、[apps/android](../apps/android/README.md)
> **目标**：让 React Web 与 Kotlin Compose Android 在工程层级保持对等的严谨度——表现层各自发挥端优势，业务契约与状态流严格收口于后端 OpenAPI。

---

## Part A · Web 工作台架构 (`apps/web`)

### 1. 目录组织（Feature-First 模块化，彻底告别 `router.js` 大泥球）

```text
apps/web/src/
├── api/
│   ├── schema.d.ts          # openapi-typescript 自动生成（禁止手改）
│   ├── client.ts            # openapi-fetch 实例 + 401 自动 refresh 拦截器
│   └── ws.ts                # WebSocket 连接与断线重连控制器
├── stores/
│   └── auth-store.ts        # 当前用户会话与主题模式（Zustand，不存业务日程列表）
├── features/
│   ├── auth/                # 登录/注册视图与路由守卫
│   ├── focus/               # 今日专注计时与实时精力状态条
│   ├── calendar/            # 时间地图网格（日/周视图）、精力曲线叠层、紧急救援侧栏与对比弹窗
│   ├── team/                # 团队 Workspace 切换、脱敏状态网格、黄金窗口排会向导
│   ├── energy/              # 穿戴数据来源诊断、HRV/睡眠驱动因子、节律偏好设置
│   └── settings/            # 账号管理、工作时段与团队隐私颗粒度配置
├── components/
│   ├── shell/               # 260px 桌面侧栏 + 64px 顶栏 + 移动端底部栏
│   └── ui/                  # shadcn/ui 基础原子组件（Dialog, Sheet, Badge, Tooltip 等）
└── styles/
    └── tokens.css           # 承接 V1“时间地图”语义色板与日历基础规则
```

### 2. 状态分层与缓存一致性
- **服务端状态全归 TanStack Query**：按结构化 Query Key 管理，禁止把后端数据复制到 Zustand（Zustand 仅保留内存态 `accessToken`、`user` 档案与主题状态；Web Refresh Token 交由 `HttpOnly` Cookie 自动托管，`openapi-fetch` 必须启用 `credentials: 'include'` 并实现单飞 `401 -> /auth/refresh` 队列）：
  - `['energy', 'today', day]`、`['energy', 'profile']`
  - `['schedule', 'items', from, to]`、`['schedule', 'rescue', 'history']`
  - `['workspaces']`
  - `['workspace', workspaceId, 'members']`、`['workspace', workspaceId, 'availability', from, to]`、`['workspace', workspaceId, 'meetings']`
- **WS 事件精准失效**：
  - `energy.updated`：失效 `['energy', 'today']`（实现手机穿戴刚同步完、桌面端秒级响应）；
  - `energy.overload_alert`：触发非阻断式“精力保护救援建议”提示条；
  - `schedule.updated`：失效 `['schedule', 'items']` 与 `['schedule', 'rescue', 'history']`；
  - `workspace.meeting_confirmed` / `workspace.meeting_cancelled` / `workspace.meeting_responded`：失效 `['schedule', 'items']`、`['workspace', id, 'meetings']` 与 `['workspace', id, 'availability']`；
  - `workspace.availability_changed`：静默失效 `['workspace', id, 'availability']`。

### 3. 时间地图（Time-Map）渲染规范
- **全本地时区投影**：后端返回 UTC `startAt`/`endAt`，前端借助 `Intl.DateTimeFormat` / `date-fns-tz` 按用户选定时区投影到网格分钟偏移，**严禁按像素高度反向持久化时长**。
- **重叠事件分栏算法**：同一天内有时间交集的块采用标准区间贪心分列（Sweep-line Column Packing），按列数等分宽度并保留最小可读高度，避免像旧版那样重叠遮挡。
- **精力热区叠层**：日历时间轴最左侧增加一条细窄的“24h 预测精力色带”（峰区深松绿、平稳浅青、低谷灰蓝、过载琥珀警示），拖放/新建高负荷任务落入低谷时给出非阻断式友好提示。

---

## Part B · Android 客户端架构 (`apps/android`)

### 1. 模块组织（Clean Architecture + Jetpack Compose）

```text
apps/android/
├── app/                     # Application (Hilt), MainActivity, NavHost, 通知渠道初始化
├── core/
│   ├── network/             # Retrofit + OkHttp + Token Authenticator + OpenAPI 生成 DTO
│   ├── datastore/           # EncryptedSharedPreferences/DataStore（存令牌与 Health Connect ChangesToken）
│   ├── database/            # Room 离线缓冲库（仅缓存待补传的生理样本队列 + 今日只读日程快照）
│   ├── health/              # Health Connect SDK 封装、权限声明与增量拉取器
│   ├── ble/                 # BLE GATT 扫描与 0x180D 心率/RR 间期 RMSSD 计算管道
│   └── ui/                  # Material 3 Theme（对齐 Web tokens.css 深松绿/瓷白语义色）
└── feature/
    ├── energy/              # 穿戴连接状态、实时心率/HRV 面板、测试回放开关
    ├── schedule/            # 今日精力日程时间轴、突发过载救援确认 Sheet
    ├── team/                # 团队会议邀请通知、确认回执与发起轻量协同排会
    └── settings/            # 账号认证、隐私共享颗粒度与同步诊断
```

### 2. 穿戴设备后台采集与容错机制
1. **Health Connect 同步 Worker (`HealthSyncWorker` via WorkManager)**：
   - 触发条件：周期性每 15 分钟（`PeriodicWorkRequest`）+ App 启动/回到前台立即触发一次 `OneTimeWorkRequest`。
   - 失败退避与**强幂等入队**：入库 Room `pending_biometrics` 前**必须先生成确定性 `externalId`**（`Record.metadata.id` 或 `hc:{recordUid}:{subType}:{recordedAtEpochSec}`）；无网络或服务端 5xx 时暂存 Room，等待网络恢复后按每批 $\le 500$ 条补传；若收到 `422 INVALID_BIOMETRIC_SAMPLE`，按 `errors[].location` 剔除坏点避免死循环重传。
   - 权限降级：用户在系统设置撤销部分 Health Connect 权限时，不崩溃，在 `/energy` 顶部明确提示缺失的权限项并引导一键重授。
2. **BLE GATT 心率直连管理 (`BleHeartRateManager`)**：
   - 运行在独立协程作用域，维护清晰状态机：`Disconnected -> Scanning -> Connecting -> Streaming(hrBpm, latestRmssd)`。
   - 每 60 秒将去噪后的有效 RR 间期窗口计算为 `hrv_rmssd` 与平均 `heart_rate`，生成确定性 `externalId = ble:{deviceHash}:{metricType}:{recordedAtEpochSec}` 推入上传队列；蓝牙断开时自动进入指数重连或提示切换回 Health Connect。
3. **系统级本地通知与双端日程同步联动**：
   - **认证令牌管理**：从 `POST /auth/login`、`POST /auth/refresh` JSON Body 读取 `refreshToken` 加密写入 `EncryptedDataStore`；OkHttp `Authenticator` 在遇到 `401 UNAUTHORIZED` 时使用互斥锁单飞调用 `/auth/refresh`。
   - **过载保护通知**：接收到 WS `energy.overload_alert` 时弹出高优先级通知，点击直达“精力救援确认页”。
   - **黄金协同会议与跨端日程闹钟联动**：收到 WS `schedule.updated`、`workspace.meeting_confirmed` 或 `workspace.meeting_cancelled` 时，立即拉取 `GET /schedule/items` 更新 Room 今日快照，并同步注册或取消 `AlarmManager` 本地提前提醒闹钟（`reminderMinutes`）。

---

## 3. 双端能力边界对照（严禁越界）

| 能力项 | React Web | Android Compose | 共同唯一后端 (Go) |
| --- | --- | --- | --- |
| 穿戴硬件读取 (Health Connect / BLE) | 不支持（明确显示“由 Android 端采集同步”，可看结果与触发测试回放） | **主力采集与上报** | 存储清洗与基线计算 |
| 团队大屏排会时间轴矩阵 | **主力操作台**（多成员并排甘特/时间轴对比） | 简化版会议邀请、确认与移动发起 | 协同求解与冲突加锁 |
| 精力曲线与日程重排算法 | 仅渲染服务端方案与发送确认 | 仅渲染服务端方案与发送确认 | **100% 算法归属** |
| 离线能力 | 断网展示只读提示，禁止假装保存成功 | Room 缓存待传生理样本与今日只读视图 | 事务幂等兜底 |
