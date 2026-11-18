# 时序智配 V2 系统架构与开发蓝图

> **版本**：V2.0 (Rebuild Blueprint)
> **分支**：`refactor/v2-rebuild`
> **核心命题**：基于穿戴设备生理节律的**个人级智能精力保护**与**团队级协同排会最优解**

---

## 1. 为什么彻底重构

V1 在不断叠加功能与多端删改过程中积累了不可接受的结构性债：
1. **定位失焦**：同时堆叠微任务积分、目标树、蓝牙裸特征值调试、空壳 MCP 监听与 37 个 `501` 占位接口。
2. **领域模型畸形**：日程时长以 UI 像素 `height` 存储，团队成员 `team_members` 实为单账号下的静态假人，前后端类型靠手工对齐。
3. **跨端逻辑撕裂**：曾因双端重复实现调度引擎导致 Flutter 移除后验证断链。

**V2 铁律**：
- **收敛主线**：只服务“穿戴设备精力感知 → 个人日程保护与救援 → 团队协同排会”单一闭环。
- **算法单点收口**：全部精力计算、日程冲突检测、团队黄金窗口搜索、突发重排逻辑 **100% 位于 Go 服务端**；Web 与 Android 不写第二套调度算法。
- **契约先行（Contract-First）**：Go 服务端通过 `Huma v2` 自动产出唯一 `contracts/openapi.json`，一键生成 Web TypeScript 类型与 Android Kotlin DTO。

---

## 2. 技术栈选型

| 层级 | 选型 | 关键组件与职责 |
| --- | --- | --- |
| **核心服务端** | **Go 1.24+** | `Chi v5` + `Huma v2`（REST + 自动 OpenAPI 3.1）· `pgx/v5` + `sqlc`（编译期 SQL 校验）· `goose`（数据库迁移）· 原生 WebSocket/SSE（团队协作实时同步） |
| **主数据库** | **PostgreSQL 16** | `btree_gist` + `tstzrange` 区间索引（毫秒级时间碰撞检测）、强事务保障协同约会与救援撤销 |
| **Web 工作台** | **React 19 + TypeScript + Vite 6** | Tailwind CSS v4 + `shadcn/ui` · TanStack Query v5 + Zustand · `openapi-typescript` + `openapi-fetch` |
| **Android 端** | **Kotlin 2.x + Jetpack Compose** | Material 3 · Hilt · Retrofit/OkHttp + `kotlinx.serialization` · **Android Health Connect SDK** · 原生 BLE GATT (`0x180D`) · WorkManager |
| **认证安全** | **Argon2id + JWT** | `Argon2id` 密码哈希 · 短效 Access Token + 可吊销 Refresh Token（`refresh_tokens` 表） |

---

## 3. 核心业务闭环（穿戴精力 × 个人保护 × 团队排会）

```text
[Android 穿戴设备采集]
   ├─ 正式源：Health Connect (HRV RMSSD / 静息心率 / 睡眠分期 / 活动消耗)
   ├─ 演示源：BLE GATT 0x180D (心率 & RR 间期实时流)
   └─ 调试源：显式标记 source = 'replay_demo' 的标准生理节律回放
        │
        ▼ (增量上报 POST /api/v1/biometrics/samples)
[Go 精力引擎]
   ├─ 个人生理基线 (7/14 日滑动中位数 HRV & RHR)
   ├─ 睡眠恢复系数 + 昼夜节律曲线 + 连续高负荷衰减
   └─ 生成实时精力电量 (0-100) + 未来 24h 预测曲线 + 保护窗口建议
        │
        ├─────────────────────────────┬─────────────────────────────┐
        ▼                             ▼                             ▼
[个人智能日历 & 保护]        [隐私边界脱敏层]             [突发扰动救援]
• 高负荷任务对齐高峰窗       • 不暴露原始心率/HRV          • 给定紧急截止时间
• 疲劳自动插入恢复缓冲       • 仅输出时段状态标签:         • 生成 3 套可解释方案
• 专注期屏蔽非紧急打断         available / busy /          • 事务写入 + 一键撤销
                               focus_shield / low_energy
                                      │
                                      ▼
                          [团队协同排会求解器]
                          • 输入：参会人、时长、会议认知强度 (high/medium/low)
                          • 约束：全员空闲交集 + 避开个人心流保护期 + 最小化碎片化
                          • 输出：Top 3 可解释推荐窗口 + 成员负载代价评估
                          • 确认：单事务写入全员日程 + 触发过载成员保护提醒
```

---

## 4. 数据库领域模型（PostgreSQL 16）

完整 DDL 见 [services/server/migrations/0001_init.sql](file:///d:/AAACode/Ruanchuang/services/server/migrations/0001_init.sql)。核心表设计要点：

1. **彻底消除 UI 耦合**：废除旧版 `height`（像素高度）和 `color`（ARGB 整数），全部采用标准 `start_at TIMESTAMPTZ`、`end_at TIMESTAMPTZ` 与计算列 `time_range tstzrange`。
2. **原生时间碰撞索引**：`schedule_items` 通过 `CREATE INDEX ... USING gist (user_id, time_range)` 支持亚毫秒级时间交集、冲突与空档扫描。
3. **真实多用户团队协作**：
   - `workspaces`（团队工作区）与 `workspace_members`（成员角色 `owner/admin/member` + **隐私共享等级 `privacy_level`**：`busy_only` / `energy_tier` / `full_title`）。
   - `meeting_proposals` 与 `meeting_participants` 记录排会草案、推荐评分理由与参会回执状态。
4. **穿戴时序与精力快照分离**：
   - `biometric_samples` 按 `(user_id, metric_type, recorded_at DESC)` 索引去重存储原始生理点（`source_type` 严格区分 `health_connect` / `ble_gatt` / `replay_demo`）。
   - `energy_profiles` 存储用户个人近 14 日 HRV/静息心率基线与昼夜节律偏好；`energy_snapshots` 缓存当前精力分数与 24h 预测点位。
5. **可审计的救援事务**：
   - `rescue_snapshots` 保存救援前/后完整时间块 JSON 与 `status` (`applied` / `reverted`)，保证单事务写入与原子回滚。

---

## 5. 核心算法设计（全部位于 Go `internal/engine`）

### 5.1 穿戴设备精力指数模型（可解释、抗缺失）

将多源数据归一化为统一精力电量 $E(t) \in [0, 100]$ 与精力等级（`peak` $\ge 80$、`steady` $55\text{–}79$、`strained` $35\text{–}54$、`depleted` $< 35$）：

1. **睡眠恢复基线 $S_{\text{sleep}} \in [0, 45]$**
   - 依据昨晚总睡眠时长（目标 7.5–8.5h）及深睡/REM 比例（若设备提供）计算晨间恢复起步分。
2. **自主神经压力调节 $S_{\text{hrv}} \in [-20, +25]$**
   - 对比当前夜间/晨起 HRV（RMSSD）与个人 14 日基线 $\mu_{\text{HRV}}, \sigma_{\text{HRV}}$ 的 Z-score：
     - HRV 显著高于基线 → 副交感活跃，恢复加分；
     - HRV 明显低于基线（Z < -1.0）或静息心率异常抬升 → 识别为身体疲劳/高压预警。
3. **昼夜节律基线 $C(h) \in [-15, +20]$**
   - 双峰日节律模板（默认上午专注高峰 09:00–11:30、午后低谷 13:30–14:30、下午次高峰 15:30–17:30），并随用户历史高专注时段与偏好微调。
4. **日内认知消耗衰减 $D(t)$**
   - 已参加会议时长与高认知负荷任务连续块按时间窗口累积扣分；完整插入 $\ge 15$ 分钟恢复缓冲块后按恢复系数回补部分电量。
5. **降级策略**：若当日无最新穿戴数据（如 Web 端刚注册且未同步手表），明确返回 `data_freshness = "baseline_only"`，退回基于节律模板+日程负荷的基线估算，绝不伪造硬件实时状态。

### 5.2 团队协同排会求解器（Golden Window Finder）

给定参会成员集合 $M$、会议时长 $L$、认知负荷等级 $\text{load} \in \{\text{high}, \text{medium}, \text{low}\}$、目标日期范围：

1. **硬约束过滤（Feasibility）**：
   - 剔除所有参会者在工作时间窗外或与既有 `hard_locked` / 已确认会议 `schedule_items` 重叠的时段。
2. **多目标代价打分（越低越优 / 得分越高越推荐）**：
   - **心流保护惩罚（Focus Shield Penalty）**：若候选窗口落入某成员个人高精力保护期（尤其对低重要度/低负荷同步会），施加高额扣分。
   - **负荷-精力匹配分（Energy-Load Fit）**：高认知负荷会议（设计评审/技术方案/脑暴）优先匹配全员加权精力曲线的共同高峰或平稳区；低负荷会议（站会/同步）主动让出上午高峰，优先落在平稳或轻微低谷区。
   - **碎片化惩罚（Fragmentation Penalty）**：优先紧邻已有固定会议或边界对齐（例如 10:00 接续 09:30 的会议），避免把原本完整的 2 小时深度工作切碎成两段 45 分钟垃圾时间。
   - **心理安全缓冲**：默认预留会前/会后缓冲检查，防止背靠背连轴转导致精力雪崩。
3. **输出结构**：返回 Top 3 推荐时段，每个候选附带**人类可读的推荐原因**（例如：*“避开 3 位成员上午心流保护期，且紧邻已有例会，为团队保住 2.5 小时完整深度窗口”*）及**成员受影响明细（脱敏）**。

### 5.3 个人突发打断救援（保留 V1 精华并升级）

当突发高优任务或团队紧急会议插入导致个人过载/时间冲突时，生成 3 种策略对比方案（均在服务端执行，前端只渲染对比并发送 `apply`/`undo`）：
1. **保截止期（`protect_deadline`）**：优先保证紧急截点，重排可移动的弹性任务。
2. **保精力恢复（`protect_recovery`）**：控制连续高负荷跨度，强制保留至少 15 分钟恢复缓冲，并依据当前穿戴精力电量避免把烧脑任务推到低谷期。
3. **最小扰动（`minimize_changes`）**：锁定绝大多数已有计划，只利用空档或仅顺延最少数量任务。

---

## 6. 核心 API 端点规划（OpenAPI `/api/v1`）

- **Auth**：`POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me`
- **Biometrics & Energy**：
  - `POST /biometrics/samples/batch`（Android Health Connect / BLE 批量幂等上报）
  - `POST /biometrics/replay-seed`（显式写入测试回放生理样本，严格打标 `replay_demo`）
  - `GET /energy/today`（当前电量、数据来源状态、24h 曲线、保护盾与恢复建议）
  - `PUT /energy/preferences`（工作日工作窗、深度保护时段偏好、隐私设置）
- **Personal Schedule & Rescue**：
  - `GET/POST /schedule/items`、`PATCH/DELETE /schedule/items/{id}`
  - `POST /schedule/rescue/options`、`POST /schedule/rescue/apply`、`POST /schedule/rescue/undo`
- **Team Workspaces & Collaborative Planner**：
  - `POST /workspaces`、`GET /workspaces`、`POST /workspaces/{id}/invite`、`POST /workspaces/join`
  - `GET /workspaces/{id}/availability`（脱敏后的团队成员状态视图）
  - `POST /workspaces/{id}/meetings/recommend`（智能计算 Top 3 协同黄金窗口）
  - `POST /workspaces/{id}/meetings/confirm`（单事务写入全员日程并广播通知）
- **Realtime**：`GET /ws`（团队日程与会议确认实时推送）

---

## 7. V2 四人协作分工（按领域强隔离）

| 角色 | 负责目录 | 核心职责 |
| --- | --- | --- |
| **P1 服务端基座与数据层** | `services/server/internal/{auth,db,workspace,api}` | PostgreSQL 迁移、`sqlc` 查询、JWT/Argon2id、Workspace 多用户权限、WebSocket 推送、导出 `openapi.json` |
| **P2 精力与协同调度引擎** | `services/server/internal/engine/` | 穿戴精力曲线计算、保护窗口推导、团队排会黄金窗口求解器、个人 3 策略救援算法与单元测试 |
| **P3 Web 工作台** | `apps/web/` | React 19 + TS + shadcn/ui 五大核心视图重建，承接 V1 视觉令牌、时间地图交互、团队排会对比看板 |
| **P4 Android 穿戴与移动端** | `apps/android/` | Kotlin + Compose 壳层、Health Connect 授权与后台增量同步、BLE 心率/RR 直连、随身日程/会议确认与提醒 |
