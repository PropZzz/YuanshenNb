# 03 · 团队协同排会与个人日程救援算法

> **对应后端模块**：`services/server/internal/engine/team_planner.go`、`services/server/internal/engine/rescue.go`  
> **物理交接契约**：[services/server/internal/engine/contracts.go](../services/server/internal/engine/contracts.go)  
> **目标**：把“个人穿戴精力约束”转化为“团队排会智能求解输入”，并在个人日程被打乱或过载时提供可解释、原子可撤销的重排能力。

---

## 1. 团队隐私投影层（Privacy-Preserving Availability）

在执行任何团队查询或协同排会前，服务端必须按 `workspace_members.privacy_level` 对每位参会者的 `schedule_items` 与 `energy_snapshots` 进行**服务端强制投影脱敏**，在 Go 类型层面保证 `MemberAvailabilityView` **绝不包含任何 HR、HRV、睡眠时长或原始生理样本字段**，并严格按隐私等级裁剪日程标题与精力序列：

| 原始个人数据 | `privacy_level = busy_only` | `privacy_level = energy_tier`（默认） | `privacy_level = full_title` |
| --- | --- | --- | --- |
| 具体 HR / HRV / 睡眠时长 | **永不输出** | **永不输出** | **永不输出** |
| `hard_locked` / `meeting` 时段 | 投影为 `busy`（无标题） | 投影为 `busy`（无标题） | 投影为 `busy` + `title` |
| `focus_shield` 保护时段 | 投影为 `busy`（无标题） | 投影为 `focus_shield`（无标题，可被高优会议协商突破但扣高分） | 投影为 `focus_shield` + `title` |
| `flexible` 弹性个人任务 | 投影为 `available`（或可协商软占用） | 投影为 `soft_busy`（无标题） | 投影为 `soft_busy` + `title` |
| 未来逐小时精力预测 (`energyBuckets`) | 不输出（空数组/省略） | **仅输出带 UTC 时间戳的脱敏档位** `Array<{ hourStartAt: RFC3339, tier: EnergyTier }>`（**绝不输出具体 `score` 分数**） | 输出脱敏档位 `Array<{ hourStartAt: RFC3339, tier: EnergyTier }>` |

### 1.1 跨时区与多日对齐的 `energyBuckets` 结构
- 团队可用性接口返回的成员精力序列统一命名为 `energyBuckets: Array<{ hourStartAt: string, tier: 'peak' | 'steady' | 'strained' | 'depleted' }>`。
- 每个桶均携带显式 RFC 3339 UTC 整点时间戳 `hourStartAt`（如 `"2026-11-18T01:00:00Z"`），既杜绝泄漏具体精力数值（如 `84` 分），又支持跨时区成员及多日查询窗口的零歧义时间轴对齐。

---

## 2. 团队协同排会求解器（Golden Window Solver）

### 2.1 求解输入与输出
- **输入**：
  - `workspace_id`、`participant_ids`（区分 `required` 必选人与 `optional` 可选人）、`duration_minutes`（15–480 分钟，按 15 分钟步长对齐候选槽位）
  - `cognitive_load`（会议认知强度：`high` 脑暴/评审、`medium` 讨论、`low` 例行同步）
  - `search_window`（搜索起止时间范围 `[search_from, search_to)`，默认未来 5 个工作日）
  - `respect_focus_shields`（布尔值，默认 `true`）
- **输出**：按总分降序返回 **Top 3** 候选推荐窗口（`GoldenWindowRecommendation`），每项包含：
  - `rank`（1..3）、`startAt` / `endAt`、总评分 `score`（0–100 归一化）与分项评分 `breakdown`（`{ energyMatchScore, focusShieldScore, compactnessScore, optionalAttendanceRatio, earlinessScore }`）
  - `affectedMembers`（脱敏后的成员状态影响：`{ userId, displayName, required, energyTier?, breaksFocusShield, causesContinuousOverload }`）
  - `explanationTags`（`Array<{ code, tone, label }>`）与可读推荐摘要 `summary`

### 2.2 前向兼容的 `explanation_tags` 结构
为支持多语言标签渲染、语义着色及未来算法规则扩展，`explanation_tags` 统一采用结构化对象数组：
```json
[
  {
    "code": "ALL_PEAK_OR_STEADY",
    "tone": "positive",
    "label": "全员处于高峰或平稳精力窗"
  },
  {
    "code": "ZERO_FOCUS_SHIELD_INTRUSION",
    "tone": "positive",
    "label": "未打断任何成员的深度专注保护盾"
  },
  {
    "code": "COMPACT_ADJACENT_SLOT",
    "tone": "neutral",
    "label": "紧贴既有日程边界，避免切割整块开发时间"
  }
]
```
- `code`：稳定的机器可读标识码（如 `ALL_PEAK_OR_STEADY`、`LOW_LOAD_SAVES_PEAK`、`ZERO_FOCUS_SHIELD_INTRUSION`、`SHIELD_INTRUSION_PENALTY`、`COMPACT_ADJACENT_SLOT`）。
- `tone`：枚举值 `'positive' | 'warning' | 'neutral'`，前端直接映射为语义色胶囊（Emerald / Amber / Slate），无需在前端硬编码字符串匹配。
- `label`：由服务端根据实时打分因子动态生成的真实可读解释，禁止硬编码假文案。

### 2.3 候选时段生成与硬约束过滤
1. 以 15 分钟为离散时间片（`slot_granularity = 15m`）生成搜索范围内所有连续长度为 `duration_minutes` 的候选窗口 $[s, s + L)$。
2. 对每位**必选参会者**执行工作边界与硬碰撞过滤：
   - 将参会者 `energy_profiles` 的本地工作日窗口（`work_start_minute` ~ `work_end_minute`，按各自 `users.timezone` 换算 UTC）求全员交集；若跨时区交集为空则提示无法在共同工作时间内安排。
   - 若候选窗口 $[s, s + L)$ 与任意必选参会者的 `hard_locked` 或已有 `meeting` 重叠，直接淘汰。
   - 若要求会前/会后保留保护缓冲，检查是否直接压扁了某位成员的强制 `recovery` 块。

### 2.4 多目标打分函数（核心差异化）

对所有通过硬约束的合法候选窗口，计算综合效用分：

$$\text{Score}(s) = W_{\text{energy}} \cdot F_{\text{energy}}(s) + W_{\text{shield}} \cdot F_{\text{shield}}(s) + W_{\text{frag}} \cdot F_{\text{frag}}(s) + W_{\text{opt}} \cdot F_{\text{opt}}(s) + W_{\text{early}} \cdot F_{\text{early}}(s)$$

1. **$F_{\text{energy}}(s)$（团队认知负荷-精力匹配分，权重 35%）**：
   - 查询该时段所有必选参会者在 $s$ 时刻的预测精力档位（无实时穿戴数据的成员取节律基线）：
   - **当会议为 `high` 高认知负荷**（方案评审/脑暴）：全员处于 `peak`/`steady` 比例越高得分越高；若存在成员处于 `strained`/`depleted` 则大幅扣分（不把烧脑会约在全员疲劳期）。
   - **当会议为 `low` 低认知负荷**（站会/进度同步）：若把短平快同步会约在成员 `peak` 高峰时段反而**轻微扣分**（保护宝贵的上午高峰），优先推荐全员处于 `steady` 下午平稳窗口！
2. **$F_{\text{shield}}(s)$（心流保护盾尊重分，权重 30%）**：
   - 未侵占任何成员 `focus_shield` 时段得满分；
   - 每侵占 1 名必选成员的 `focus_shield` 保护窗，按重度扣分（若 `respect_focus_shields = true` 且存在替代时段，几乎不会选出侵占心流区的窗口）。
3. **$F_{\text{frag}}(s)$（反碎片化紧凑度分，权重 20%）**：
   - 衡量会议插入后对各成员整块空闲时间的切割损失：
     - 若新会议起点/终点恰好紧贴成员已有会议或午休边界（间隔 0–15 分钟），或落入原本就小于 60 分钟的碎片空档，得高分（**保护了其他人原本连续的 2–3 小时完整开发块**）；
     - 若把一个 3 小时完整空闲切成了两段各 60 分钟，扣高分。
4. **$F_{\text{opt}}(s)$（可选成员参与度分，权重 10%）**：
   - 统计 `required = false` 的可选参会人同时空闲的比例。
5. **$F_{\text{early}}(s)$（时效性偏好，权重 5%）**：
   - 在效用接近的前提下，适度偏好较早的合法窗口，避免排期无限后拖。

### 2.5 无解与降级诊断
若没有任何满足所有硬约束的窗口，求解器**不能返回空数组糊弄前端**，必须返回具体阻断诊断列表（`blockingDiagnostics`）：
- 每条 `BlockingDiagnostic` 包含：`code`（如 `NO_COMMON_WORK_HOURS`、`REQUIRED_MEMBER_LOCKED`、`SHIELD_BLOCKED_ALL_SLOTS`、`DURATION_TOO_LONG`）、`day?`（`YYYY-MM-DD`）、`message`、涉及阻断成员 `blockingUserIds[]` 与 `blockingDisplayNames[]`，以及可执行替代建议 `suggestedAction`（例如：“缩短至 45 分钟可解锁 周四 15:00” 或 “允许突破心流保护盾可解锁 明日 10:30”）。

---

## 3. 个人日程救援引擎（Urgent & Fatigue Rescue）

当以下事件发生时，调用个人救援引擎：
- 用户新增紧急任务（`triggerReason = 'urgent_task'`，必须提供晚于当前的硬截止时间 `deadline_at`）；
- 接受团队会议后导致某参会者当天连续高负荷或弹性任务被挤出截止期（`triggerReason = 'team_meeting_overload'`）；
- 穿戴监测触发疲劳过载预警（`triggerReason = 'wearable_fatigue'`）。

### 3.1 三套固定权衡策略

所有方案共用同一套硬约束检查（**绝不移动、缩短或篡改 `hard_locked` 与已确认 `meeting`**），仅调整目标权重，产出 **3 个可对比方案**：

| 策略标识 | 中文名 | 算法权重倾向 | 核心代价指标 |
| --- | --- | --- | --- |
| `protect_deadline` | **优先保住截止期** | 允许移动更多 `flexible` 普通任务，将紧急/临近截止任务置顶塞入最早可用窗 | 移动任务数可能较多；恢复缓冲按剩余空档尽力保留 |
| `protect_recovery` | **优先保留恢复精力** | 结合实时穿戴精力曲线，高负荷任务绝不塞入 `strained`/`depleted` 区间；强制保证至少 `min_recovery_buffer_min`（默认 15m）恢复块间隔 | 部分非紧急低优任务可能被顺延至次日 |
| `minimize_changes` | **尽量少动原计划** | 锁定全部既有非阻塞任务位置，只在现有空档内插缝安排新任务或迁移最少数量冲突项 | 如果全天空档紧张，紧急任务可能出现逾期风险警告（明确标红提示，不静默忽略） |

### 3.2 确定性无状态重算协议（`options` → `apply` → `undo`）

为彻底杜绝客户端伪造或篡改 `afterItems[]` 进而覆盖用户的 `hard_locked` / `meeting` 日程，个人救援引擎采用**服务端确定性无状态重算协议**：

1. **`options` 预览阶段（纯函数计算，零数据库副作用）**：
   - 客户端请求 `POST /api/v1/schedule/rescue/options`，提交 `{ day, triggerReason, urgentTask? }`。
   - 服务端拉取该用户在 `[dayStartUTC, dayStartUTC + 48h)` 内的有效日程，计算 `baselineVersion`（算法见 `docs/01` 4.2.2）。
   - 调用 `RescueEngine.BuildOptions` 针对三套策略确定性求解。每个方案（`RescueOption`）输出：
     - `strategy`：`'protect_deadline' | 'protect_recovery' | 'minimize_changes'`
     - `optionHash`：由 `(baselineVersion, strategy, triggerReason, diffItems)` 计算的确定性 SHA-256 前 16 位 hex 摘要
     - 对比汇总指标：`feasible`（布尔值，无逾期且满足全部硬约束时为 `true`）、`movedCount`、`deferredCount`、`recoveryMinutes`、`overdueRiskCount`、`summary`
     - `diffItems`：结构化变更明细数组，每项包含：
       - `op`：**`'create' | 'move' | 'defer' | 'unchanged'`**（`create` 为新建的紧急任务或自动插入的 `recovery` 恢复缓冲；`move` 为同日内平移；`defer` 为顺延至次日工作窗；`unchanged` 为保持原位）
       - `itemId?`（新建项为空，既有项为原 UUID）、`title`、`category`、`cognitiveLoad`、`flexibility`
       - `beforeStartAt?` / `beforeEndAt?`、`afterStartAt` / `afterEndAt`
       - `reasonCode` 与 `reasonLabel`（如 `reasonCode: "RESCUE_AVOID_FATIGUE"`、`reasonLabel: "避开穿戴疲劳低谷并插入 20m 恢复缓冲"`）
2. **`apply` 采纳阶段（服务端事务内重算校验，拒绝客户端直传 `afterItems[]`）**：
   - 客户端请求 `POST /api/v1/schedule/rescue/apply` 时，**只需提交输入参数与所选策略**：
     ```json
     {
       "day": "2026-11-18",
       "baselineVersion": "9a8b7c6d5e4f3a2b",
       "strategy": "protect_recovery",
       "triggerReason": "urgent_task",
       "urgentTask": {
         "title": "修复生产网关内存泄漏",
         "durationMinutes": 90,
         "cognitiveLoad": "high",
         "deadlineAt": "2026-11-18T10:00:00Z"
       },
       "expectedOptionHash": "f1e2d3c4b5a69788"
     }
     ```
   - 服务端在**单个 PostgreSQL 事务**中：
     1. 执行 `SELECT id FROM users WHERE id = $1 FOR UPDATE;` 锁住用户行；
     2. 重新查询 `[dayStartUTC, dayStartUTC + 48h)` 日程并计算当前 `baselineVersion`：若与请求不一致，立即拒绝并返回 `409 STALE_BASELINE_VERSION`；
     3. 用相同的确定性纯函数 `RescueEngine.BuildOptions` 重新生成所选 `strategy` 的方案（若提供了 `expectedOptionHash` 且与重算出的 `optionHash` 不一致，同样返回 `409 STALE_BASELINE_VERSION`）；
     4. 由服务端严格按照重算得出的 `diffItems` 更新/插入 `schedule_items`，并写入 `rescue_snapshots (local_day, baseline_version, option_hash, strategy, trigger_reason, before_items, after_items, status = 'applied')`。
3. **`undo` 撤销阶段（带还原冲突检测的原子回滚）**：
   - 客户端调用 `POST /api/v1/schedule/rescue/undo` 提交 `{ snapshotId }`。
   - 服务端在单事务内锁住该用户 `users` 行与 `rescue_snapshots` 行，校验 `status = 'applied'`，并检验 `before_items` 待还原的时间窗是否与快照应用后新产生的 `hard_locked` 或 `meeting` 冲突（冲突返 `409 SNAPSHOT_RESTORE_CONFLICT`）；无冲突则原子恢复 `before_items` 并置 `status = 'reverted', reverted_at = NOW()`。
