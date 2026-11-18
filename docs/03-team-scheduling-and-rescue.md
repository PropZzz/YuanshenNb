# 03 · 团队协同排会与个人日程救援算法

> **对应后端模块**：`services/server/internal/engine/team_planner.go`、`services/server/internal/engine/rescue.go`  
> **目标**：把“个人穿戴精力约束”转化为“团队排会智能求解输入”，并在个人日程被打乱或过载时提供可解释、原子可撤销的重排能力。

---

## 1. 团队隐私投影层（Privacy-Preserving Availability）

在执行任何团队查询或协同排会前，服务端必须按 `workspace_members.privacy_level` 对每位参会者的 `schedule_items` 与 `energy_snapshots` 进行**服务端强制投影脱敏**，严禁把原始生理指标或未授权日程标题发往前端：

| 原始个人数据 | `privacy_level = busy_only` | `privacy_level = energy_tier`（默认） | `privacy_level = full_title` |
| --- | --- | --- | --- |
| 具体 HR / HRV / 睡眠时长 | **永不输出** | **永不输出** | **永不输出** |
| `hard_locked` / `meeting` 时段 | 投影为 `busy` | 投影为 `busy` | 投影为 `busy` + 标题 |
| `focus_shield` 保护时段 | 投影为 `busy` | 投影为 `focus_shield`（可被高优会议协商突破但扣高分） | 投影为 `focus_shield` + 标题 |
| `flexible` 弹性个人任务 | 投影为 `available`（或可协商软占用） | 投影为 `soft_busy` | 投影为 `soft_busy` + 标题 |
| 未来逐小时精力预测 | 不输出 | **输出脱敏档位**（`peak`/`steady`/`strained`/`depleted`） | 输出脱敏档位 |

---

## 2. 团队协同排会求解器（Golden Window Solver）

### 2.1 求解输入与输出
- **输入**：
  - `workspace_id`、`participant_ids`（区分 `required` 必选人与可选人）、`duration_minutes`（15–480 分钟，按 15 分钟步长对齐候选槽位）
  - `cognitive_load`（会议认知强度：`high` 脑暴/评审、`medium` 讨论、`low` 例行同步）
  - `search_window`（搜索起止日期范围，默认未来 5 个工作日）
  - `respect_focus_shields`（布尔值，默认 `true`）
- **输出**：按总分降序返回 **Top 3** 候选推荐窗口，每项包含：
  - `start_at` / `end_at`、总评分 `score`（0–100 归一化）
  - `affected_members`（脱敏后的成员状态影响：谁正处于 `focus_shield`、谁会因此进入连续高负荷）
  - `explanation_tags` 与可读推荐理由（由结构化解释码自动拼装，禁止硬编码假文案）

### 2.2 候选时段生成与硬约束过滤
1. 以 15 分钟为离散时间片（`slot_granularity = 15m`）生成搜索范围内所有连续长度为 `duration_minutes` 的候选窗口 $[s, s + L)$。
2. 对每位**必选参会者**执行工作边界与硬碰撞过滤：
   - 将参会者 `energy_profiles` 的本地工作日窗口（`work_start_minute` ~ `work_end_minute`，按各自 `users.timezone` 换算 UTC）求全员交集；若跨时区交集为空则提示无法在共同工作时间内安排。
   - 若候选窗口 $[s, s + L)$ 与任意必选参会者的 `hard_locked` 或已有 `meeting` 重叠，直接淘汰。
   - 若要求会前/会后保留保护缓冲，检查是否直接压扁了某位成员的强制 `recovery` 块。

### 2.3 多目标打分函数（核心差异化）

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

### 2.4 无解与降级诊断
若没有任何满足所有硬约束的窗口，求解器**不能返回空数组糊弄前端**，必须返回具体阻断诊断列表（`blocking_diagnostics`）：
- 列出哪个日期由于哪几位成员的忙碌块导致公共空档不足 $L$ 分钟，或跨时区交集过窄，并推荐替代动作（例如：“缩短至 45 分钟可解锁 周四 15:00” 或 “将李四设为可选参会人可解锁 明日 14:00”）。

---

## 3. 个人日程救援引擎（Urgent & Fatigue Rescue）

当以下事件发生时，调用个人救援引擎：
- 用户新增紧急任务（必须提供晚于当前的硬截止时间 `deadline_at`）；
- 接受团队会议后导致某参会者当天连续高负荷或弹性任务被挤出截止期；
- 穿戴监测触发 `wearable_fatigue` 过载预警。

### 3.1 三套固定权衡策略

所有方案共用同一套硬约束检查（绝不移动 `hard_locked` 与已确认 `meeting`），仅调整目标权重，产出 **3 个可对比方案**：

| 策略标识 | 中文名 | 算法权重倾向 | 核心代价指标 |
| --- | --- | --- | --- |
| `protect_deadline` | **优先保住截止期** | 允许移动更多 `flexible` 普通任务，将紧急/临近截止任务置顶塞入最早可用窗 | 移动任务数可能较多；恢复缓冲按剩余空档尽力保留 |
| `protect_recovery` | **优先保留恢复精力** | 结合实时穿戴精力曲线，高负荷任务绝不塞入 `strained`/`depleted` 区间；强制保证至少 `min_recovery_buffer_min`（默认 15m）恢复块间隔 | 部分非紧急低优任务可能被顺延至次日 |
| `minimize_changes` | **尽量少动原计划** | 锁定全部既有非阻塞任务位置，只在现有空档内插缝安排新任务或迁移最少数量冲突项 | 如果全天空档紧张，紧急任务可能出现逾期风险警告（明确标红提示，不静默忽略） |

### 3.2 方案差异对比与事务状态机

每个方案输出标准化对比对象：
- `moved_count`（被移动时间的任务数）、`deferred_count`（被延后至次日的任务数）、`recovery_minutes`（保障的总恢复缓冲分钟数）、`overdue_risk_count`（突破 `deadline_at` 的任务数）、`diff_items`（精确到每一项的 `before_start/end` → `after_start/end` 与变更原因标签）。

**状态机与原子撤销**：
- `options` 预览阶段完全无副作用（纯函数计算，不改库）；
- 用户选中其一调用 `apply` 时，后端校验乐观基线哈希（或最新修改版本号，防止多人刚约了会导致覆盖），在**单个 PostgreSQL 事务**内更新 `schedule_items` 并写入 `rescue_snapshots (status = 'applied')`；
- 撤销调用 `undo` 时，按快照 `before_items` 原样恢复并在同事务置 `status = 'reverted'`。
