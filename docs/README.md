# 时序智配 V2 架构文档总览

> **版本**：V2.0  
> **适用分支**：`refactor/v2-rebuild`  
> **核心定位**：基于穿戴设备生理节律感知的 **个人级智能精力保护** 与 **团队级协同排会最优解** 平台

---

## 1. 产品定位与核心价值闭环

V2 彻底放弃 V1 的多模块大杂烩路线，只围绕**一条高价值、可量化、全链路闭环**建设系统：

```text
[1] Android 穿戴采集层 (Health Connect / BLE 0x180D / 显式测试回放)
       │  增量上报标准化生理样本 (HR / HRV RMSSD / 睡眠分期 / 静息心率)
       ▼
[2] Go 精力推理引擎 (services/server/internal/engine)
       │  睡眠恢复 + HRV 偏离度 + 昼夜节律 + 日内会议消耗
       │  输出：实时精力电量 (0–100)、未来 24h 曲线、深度保护窗口、疲劳降载预警
       ▼
[3] 双向耦合调度层
   ├── 个人线：高负荷任务对齐高峰窗 · 疲劳插入恢复缓冲 · 突发打断 3 方案可撤销救援
   └── 团队线：脱敏输出个人状态边界 · 避开心流保护期 · 求解团队协同排会 Top 3 黄金窗口
       │
       ▼
[4] 双端一致呈现 (React Web 主控台 + Kotlin Compose Android 移动/采集端)
```

---

## 2. 技术栈唯一主线

| 分层 | 选型 | 关键职责与边界 |
| --- | --- | --- |
| **核心服务端** | **Go 1.24+** (`Chi v5` + `Huma v2` + `pgx/v5` + `sqlc` + `goose`) | 承担全部认证、穿戴入库、精力建模、协同排会求解、日程救援事务与 WebSocket 广播；自动产出 `contracts/openapi.json` |
| **主数据库** | **PostgreSQL 16** (`pgcrypto` + `btree_gist`) | 利用 `tstzrange` + GiST 索引实现毫秒级时间冲突查询，使用强事务保障团队约会与救援快照一致性 |
| **Web 工作台** | **React 19 + TypeScript + Vite 6 + Tailwind v4 + shadcn/ui** | 桌面协同排会与时间地图主控台；状态管理采用 TanStack Query v5 + Zustand；类型由 `openapi-typescript` 生成 |
| **Android 端** | **Kotlin 2.x + Jetpack Compose (Material 3) + Hilt** | 承担穿戴数据采集（Health Connect SDK + 原生 BLE GATT）与移动端随身日程/会议确认/过载提醒；不重复实现后端调度算法 |

---

## 3. 文档目录索引（模块化拆解）

为了避免单文档臃肿与各模块设计颗粒度不均，V2 架构拆分如下（各文档按同一深度标准编写，可直接用于接口评审与开发落地）：

| 编号 | 文档 | 核心内容 |
| --- | --- | --- |
| **01** | [01-domain-and-database.md](01-domain-and-database.md) | 领域边界、完整 ER 关系图、PostgreSQL 16 全表字段级规范、`tstzrange` 碰撞查询模式、数据隐私与幂等规则 |
| **02** | [02-wearable-energy-engine.md](02-wearable-energy-engine.md) | Android Health Connect 与 BLE GATT 采集协议、三源适配器、HRV/睡眠/节律精力数学公式、降级策略与保护窗口生成 |
| **03** | [03-team-scheduling-and-rescue.md](03-team-scheduling-and-rescue.md) | 团队隐私脱敏投影、协同排会黄金窗口求解器（约束与多目标打分）、事务确认锁定、个人 3 策略救援与原子撤销状态机 |
| **04** | [04-api-and-realtime-contracts.md](04-api-and-realtime-contracts.md) | `/api/v1` 全量 REST 端点契约、请求/响应 Schema、RFC 9457 统一错误码、WebSocket 实时推送协议、OpenAPI 生成流水线 |
| **05** | [05-client-web-and-android.md](05-client-web-and-android.md) | Web React 模块架构（缓存策略/时间轴布局/5 视图流转）与 Android Compose 模块架构（Clean Architecture/WorkManager/BLE 状态机） |
| **06** | [06-design-system-v2.md](06-design-system-v2.md) | 承接自 V1 “时间地图” 的浅/深色色彩令牌、字体排版、壳层响应式规范、页面精简映射与组件交互规范 |
| **07** | [07-security-testing-and-delivery.md](07-security-testing-and-delivery.md) | Argon2id + Refresh Token 轮换安全模型、隐私威胁防护、Go/Web/Android 测试金字塔与验收门禁 |
| **08** | [08-team-division-and-workflow.md](08-team-division-and-workflow.md) | 四人团队分工矩阵（P1 服务端基座 / P2 算法与验收 / P3 Web / P4 Android）、物理接口锁、并行里程碑与开发环境清单 |

---

## 4. 工程铁律

1. **后端单一计算大脑**：所有调度与精力计算逻辑 100% 放在 `services/server/internal/engine/`，双端禁止编写独立排程算法。
2. **标准物理时间建模**：全系统统一使用 UTC `TIMESTAMPTZ` 与整型 `duration_minutes`，彻底禁止使用 UI 像素高度换算时长。
3. **契约先行（Contract-First）**：任何 API 字段变更必须先改 Go `Huma` 定义并重新导出 `contracts/openapi.json`，同步触发双端编译检查。
4. **隐私与数据诚实性**：团队视图绝不暴露成员心率、HRV 原值或私密日程标题；无穿戴样本时必须如实标示 `baseline_only`，演示回放数据必须标示 `replay_demo`。
