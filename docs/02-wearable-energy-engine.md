# 02 · 穿戴设备接入与个人精力保护引擎

> **对应后端模块**：`services/server/internal/biometrics/`、`services/server/internal/engine/energy.go`  
> **对应 Android 模块**：`apps/android/core/health/`、`apps/android/core/ble/`  
> **目标**：把异构穿戴硬件数据安全、稳定地转为可解释的个人精力电量与 24h 节律曲线，为个人保护与团队协同提供客观输入。

---

## 1. 穿戴设备三路接入架构（统一入库，诚实打标）

所有来源最终标准化为统一的 `BiometricSample` 写入 `biometric_samples` 表，并通过 `source_type` 严格区分数据可信度与展示标签：

```text
┌─────────────────────────────────────────────────────────────────────┐
│                     Android 客户端采集层                             │
│  [1] Health Connect SDK       [2] BLE GATT (0x180D)   [3] Demo Replay│
│  • 睡眠/分期/RHR/HRV/热量     • 实时心率 & RR 间期      • 研发/答辩回放 │
│  • WorkManager 每 15m 增量    • 前台服务/实时流聚合     • 显式标记来源 │
└──────────────┬───────────────────────────┬──────────────────┬────────┘
               │                           │                  │
               └─────────────┬─────────────┴──────────────────┘
                             ▼ POST /api/v1/biometrics/samples/batch
┌─────────────────────────────────────────────────────────────────────┐
│                    Go 服务端入库与标准化层                           │
│  • 物理合理性清洗（剔除 HR < 30 或 > 220、HRV > 250ms 等伪影）        │
│  • 基于 (user_id, source_type, metric_type, external_id) 幂等去重   │
│  • 触发用户 energy_profiles 基线更新 & energy_snapshots 异步重算     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 主力生产通道：Android Health Connect SDK
- **覆盖生态**：通过 Android 系统级健康中枢自动兼容支持 Health Connect 的穿戴厂商（小米运动健康、OPPO 健康、Samsung Health、Garmin Connect、Pixel Watch 等），无需逐家接入封闭商业 SDK。
- **申请权限集合（最小必要原则）**：
  - `HeartRateRecord`（READ）
  - `HeartRateVariabilityRmssdRecord`（READ）
  - `RestingHeartRateRecord`（READ）
  - `SleepSessionRecord`（READ，含 `stages` 分期明细）
  - `ActiveCaloriesBurnedRecord`（READ）
- **增量同步机制**：
  - 首次授权拉取最近 **14 天**历史数据用于快速建立个人生理基线（`hrv_baseline_ms`、`rhr_baseline_bpm`）。
  - 保存 Health Connect `ChangesToken` 于本地 `DataStore`；后续由 `WorkManager` 每 15 分钟（以及 App 回到前台时）执行 `getChanges(token)` 增量拉取；若 Token 过期（系统超过 30 天未拉取），自动回退到按最近 48 小时时间窗兜底重拉，依托服务端 `external_id` 唯一索引自动去重。

### 1.2 实时演示与增强通道：原生 BLE GATT (`0x180D`)
- **适用场景**：支持佩戴标准心率带/支持广播标准 Heart Rate Service (`0x0000180D-0000-1000-8000-00805f9b34fb`) 的运动手表，在现场演示或深度工作期间做**分钟级实时压力监测**。
- **解析协议（Characteristic `0x2A37` Heart Rate Measurement）**：
  - 按蓝牙 SIG 规范解析 Flags 字节：提取 `uint8` 或 `uint16` 心率值，以及可选的 **RR-Interval 列表**（单位 `1/1024` 秒 → 换算为毫秒 `rr_ms = raw * 1000.0 / 1024.0`）。
- **端侧信号去噪与聚合**：
  - 剔除连续 RR 间期跳变超过 25% 的运动/接触伪影；
  - 每 60 秒滑窗计算一次 `RMSSD`：
    $$\text{RMSSD} = \sqrt{\frac{1}{N-1}\sum_{i=1}^{N-1}(RR_{i+1} - RR_i)^2}$$
  - 将 1 分钟均值 `heart_rate` 与计算得到的 `hrv_rmssd` 打包批量上报，避免每跳一次写一次库。

### 1.3 受控测试回放通道：`replay_demo`
- **适用场景**：团队 Web 开发者本地联调、无可用穿戴硬件测试环境或评审试用。
- **红线约束**：必须由用户/开发者显式触发 `POST /api/v1/biometrics/replay-seed`（可选预设场景：`well_rested` 充沛状态、`sleep_deprived` 睡眠不足、`high_stress` 连续高压），所有记录强制标记 `source_type = 'replay_demo'`，且 Web/Android 顶部状态胶囊必须清晰显示 **“回放测试源”** 字样，绝不冒充真实手环。

---

## 2. 精力电量与 24h 节律计算模型

后端精力引擎对指定时刻 $t$ 输出统一精力分数 $E(t) \in [0, 100]$（保留整型展示）与四个等级：
- `peak`（$80\text{–}100$）：适合深度创作、复杂架构、高负荷攻关会议
- `steady`（$55\text{–}79$）：适合常规开发、日常评审与协作沟通
- `strained`（$35\text{–}54$）：建议只做低负荷事务或轻量同步，插入恢复缓冲
- `depleted`（$0\text{–}34$）：强制预警，触发过载救援与休息保护

### 2.1 四因子透明可解释公式

$$E(t) = \operatorname{clamp}\Big(0,\; 100,\; S_{\text{sleep}} + S_{\text{autonomic}} + C_{\text{circadian}}(t) - D_{\text{load}}(t) + R_{\text{buffer}}(t)\Big)$$

#### 因子 A：睡眠恢复基线 $S_{\text{sleep}} \in [10, 45]$
读取过去 24 小时内最近一次完整 `sleep_session`（合并间隔 $< 60$ 分钟的片段）：
- 时长得分（满分 32 分）：目标 7.5 小时（450 分钟）为满分；低于 4 小时快速衰减至 10 分，超过 9.5 小时封顶。
- 结构加权（满分 13 分）：若包含 `sleep_stage`，计算深睡（目标 $\ge 18\%$）与 REM（目标 $\ge 20\%$）达标度；若设备不提供分期，则给予中性基准分 `8` 分。

#### 因子 B：自主神经恢复修正 $S_{\text{autonomic}} \in [-20, +25]$
结合个人近 14 日基线 $\mu_{\text{HRV}}, \sigma_{\text{HRV}}$（至少需 3 天历史数据；不足 3 天时仅使用绝对安全阈值而不误报极端偏差）：
- **HRV 偏离 Z-score**：$z_{\text{HRV}} = \frac{\text{HRV}_{\text{recent}} - \mu_{\text{HRV}}}{\max(\sigma_{\text{HRV}}, 5.0)}$，贡献 $\operatorname{clamp}(-15, +18, 8 \cdot z_{\text{HRV}})$。
- **静息心率漂移惩罚**：若今日 `resting_hr` 较个人基线 $\mu_{\text{RHR}}$ 升高 $\ge 5\text{ bpm}$，按每升高 1 bpm 扣 `1.5` 分（最多扣 10 分，反映身体潜在疲劳/亚健康）；反之轻微加分最多 `+7` 分。

#### 因子 C：个人昼夜节律波动 $C_{\text{circadian}}(t) \in [+5, +30]$
按用户 `energy_profiles.chronotype` 与本地时区小时 $h \in [0, 24)$ 生成平滑双峰曲线（采用两个高斯峰叠加上下午低谷凹陷）：
- `morning_lark`：上午主峰 `09:30`（+28），午后低谷 `13:30`（+6），下午次峰 `15:30`（+18）
- `balanced`（默认）：上午主峰 `10:00`（+26），午后低谷 `14:00`（+7），下午次峰 `16:00`（+22）
- `night_owl`：上午次峰 `11:00`（+18），午后低谷 `14:30`（+8），下午/傍晚主峰 `17:30`（+28）

#### 因子 D：日内认知负荷消耗 $D_{\text{load}}(t)$ 与恢复回补 $R_{\text{buffer}}(t)$
遍历当日已开始或正在进行的 `schedule_items`（`status IN ('in_progress', 'completed', 'planned')` 且截止到时刻 $t$）：
- 消耗速率（每小时）：
  - `cognitive_load = 'high'`（含高负荷会议）：`-9.0` 分/小时
  - `cognitive_load = 'medium'`：`-5.0` 分/小时
  - `cognitive_load = 'low'`：`-2.0` 分/小时
- **连续无缓冲惩罚**：若连续安排超过 120 分钟 `high`/`medium` 任务而中间未穿插 `recovery` 或空闲间隙 $\ge 15$ 分钟，超出部分消耗速率放大 `1.35×`。
- **恢复缓冲回补 $R_{\text{buffer}}(t)$**：每完整度过 1 个 $\ge 15$ 分钟的 `recovery` 块或空白休息块，回补 `+4` 至 `+8` 分（每日回补上限 `+16` 分，不能凭空突破睡眠决定的体能天花板）。

---

## 3. 数据新鲜度降级规则（永不伪造）

| 判定条件 | `data_freshness` | 计算行为 | 前端展示要求 |
| --- | --- | --- | --- |
| 过去 2 小时内有 `health_connect` 或 `ble_gatt` 样本 | `live_wearable` | 启用全部 4 因子实测计算 | 绿点徽标：“穿戴实时同步中” |
| 过去 24 小时内有真实睡眠/晨起 HRV 样本 | `recent_wearable` | 睡眠+HRV 固定，日内按节律与日程推演 | 蓝绿徽标：“今日穿戴基线已加载” |
| 最新有效样本来自 `replay_demo` | `replay_demo` | 使用回放数据跑全量公式 | 琥珀徽标：“模拟回放数据（仅供演示）” |
| 账号无任何生理样本或超过 48 小时无新数据 | `baseline_only` | $S_{\text{sleep}}=30, S_{\text{autonomic}}=0$，仅靠节律+日程扣减 | 灰标：“未连接穿戴，当前为节律基线估算” |

---

## 4. 保护窗口生成与过载预警触发条件

1. **自动推荐“深度专注保护盾”（Focus Shield）**：
   - 每日扫描未来 24 小时预测曲线，找出 $E(t) \ge 75$ 且连续 $\ge 90$ 分钟的峰值区间，结合用户 `preferred_focus_windows`，若未被会议占用，则标记为推荐保护窗口；在团队视图投影中展示为 `focus_shield` 状态。
2. **穿戴疲劳过载触发救援（`wearable_fatigue`）**：
   - 当同时满足以下任意一条时，后端向用户推送**精力保护建议**（不静默改表，弹窗给用户确认）：
     - 当前精力分 $E(\text{now}) < 40$，且未来 2 小时内排有 `high` 负荷的 `flexible` 任务；
     - 连续 2 天晨间 HRV 低于个人基线 $-1.2\sigma$，且当日计划会议总时长超过 4 小时。
   - 触发后自动调用救援引擎生成 `protect_recovery` 预演方案，建议将高负荷任务延后至下一高峰窗或插入 20 分钟 `recovery` 恢复缓冲。
