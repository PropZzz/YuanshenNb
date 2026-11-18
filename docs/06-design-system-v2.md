# 06 · 视觉设计系统与界面承接规范（Web & Android 对齐）

> **对应视觉令牌文件**：[apps/web/src/styles/tokens.css](../apps/web/src/styles/tokens.css)
> **目标**：完整保留 V1 “时间地图” 高级冷静、低噪声的 Material 3 视觉气质，并统一 Web（React）与 Android（Jetpack Compose Material 3）的语义色板、组件密度与状态表达规则。

---

## 1. 保留提取的视觉资产与语义色板

1. **已提取文件**：
   - 品牌 Logo：[apps/web/public/brand-logo.png](../apps/web/public/brand-logo.png)
   - Favicon：[apps/web/public/favicon.png](../apps/web/public/favicon.png)
   - CSS 语义令牌：[apps/web/src/styles/tokens.css](../apps/web/src/styles/tokens.css)
2. **如需回溯 V1 旧界面参考**：所有旧 Stitch 静态页保留在 `main` 分支，随时执行 `git show main:web/stitch/screens/<page>/index.html` 查看。

### 核心语义色板（Web CSS 变量 & Android `ColorScheme` 共用）

| 语义角色 | 浅色模式 (Light) | 深色模式 (Dark) | 业务使用约定 |
| --- | --- | --- | --- |
| `surface`（画布） | `#faf8fe` | `#101b1d` | 整体背景，温润低刺眼 |
| `surface-container-lowest`（主卡） | `#ffffff` | `#172426` | 日程卡片、KPI 看板、决策抽屉 |
| `surface-container-low`（次级底） | `#f4f3f8` | `#152426` | 桌面侧栏底色、卡片内部指标嵌块 |
| `primary` / `primary-container` | `#002727` / `#163d3d` | `#a7cecd` / `#163d3d` | 品牌主色、当前导航激活态、团队黄金窗高亮底、深度保护块 |
| `secondary` | `#005db5` | `#62a1fe` | 主操作按钮（发起排会、确认方案、保存日程） |
| `tertiary` / `on-tertiary-container` | `#00290a` / `#1db84d` | `#53e16f` / `#72fe88` | 精力恢复缓冲、空闲可协作状态、健康达标徽标 |
| `error` / `error-container` | `#ba1a1a` / `#ffdad6` | `#ffb4ab` / `#3d1e1b` | 硬时间冲突、紧急插单、疲劳过载预警 |

---

## 2. 字体与数字排版规范

- **标题字族（Headline）**：`Noto Serif SC` / `Noto Serif`（用于页面主标题、精力得分大数字、团队看板标题，营造沉稳刊物级秩序感）。
- **正文字族（Body/Label）**：`Inter` + 系统无衬线（`PingFang SC` / `Microsoft YaHei`）。
- **等宽数字强制约束**：所有时间刻度（`09:00 - 10:30`）、专注倒计时、精力分数与偏差百分比必须启用 `font-variant-numeric: tabular-nums`，杜绝计时跳动。

---

## 3. 壳层布局规范

- **Web 桌面端（`>= 1024px`）**：
  - 左侧固定 `260px` 侧栏：顶部品牌 Lockup → 核心 5 项分组导航 → 底部账户与穿戴数据新鲜度徽标。
  - 顶部固定 `64px` 毛玻璃状态栏：页面面包屑 + 实时精力电量胶囊（点击可看穿戴详情）+ 两个高频主按钮（`+ 发起协同排会` / `+ 紧急插单或新建日程`）。
  - 主内容区最大宽度 `1360px`，12 栏响应式 Bento Grid。
- **Web 窄屏（`< 780px`）与 Android 端**：
  - 底部固定导航栏（5 项核心入口，Android 严格遵循 Compose `NavigationBar` 安全区规范，Web 保持 `calc(4.25rem + env(safe-area-inset-bottom))`）。
  - 复杂创建表单与救援对比采用 `ModalBottomSheet`（Android）或右侧滑出抽屉/全屏 Modal（Web）。

---

## 4. V2 核心 5 视图清单（由 V1 25 页大幅收敛）

| 路由 / Tab | 名称 | 核心布局结构 | 严格数据诚实准则 |
| --- | --- | --- | --- |
| `/focus` | **今日专注与精力** | 顶部 4 格指标带 + 左侧 8 栏专注主控卡（径向进度环 + 正向心流/番茄倒计时）+ 右侧 4 栏今日精力缓冲与后续待办 | 倒计时基于 wall-clock deadline 计算；无日程时展示清晰空状态并引导进入日历 |
| `/calendar` | **智能日历与救援** | 顶部视图控制器（日/周切换 + 能源曲线叠加开关）+ 左侧 9 栏时间地图（含左侧精力色带）+ 右侧 3 栏持久救援摘要/冲突检查面板 | 日程块内部根据容器高度自适应隐藏次要标签（`@container`）；救援对比必须显式展示 3 套方案指标且“点击确认才落库” |
| `/team` | **团队协同排会** | 顶部工作区头卡 + 4 格 KPI Bento + 深松绿“Top 1 黄金协作窗口”主卡（含另 2 个备选切页）+ 成员实时脱敏状态网格 | 成员卡片仅显示授权范围内的状态（`可用`/`深度专注保护`/`疲劳`/`忙碌`），绝不展示其他人 HRV 数值 |
| `/energy` | **穿戴精力洞察** | 5 栏实时精力电量 Hero 卡 + 7 栏穿戴数据来源诊断与 24h 节律预测折线图 + 下方影响因子（睡眠分/HRV 偏差/今日会议损耗） | 顶栏明确标记 `穿戴实时` / `最近同步` / `回放测试源` / `节律基线估算`；无假图表 |
| `/settings` | **账号与隐私** | 账户通行证（支持切换深浅色主题）、个人工作时间窗与 chronotype 设定、所在团队的 `privacy_level` 三档切换开关 | 修改即实时保存并反馈错误状态 |

---

## 5. 全局状态反馈与无障碍标准

- 每个列表与面板必须显式区分 **5 种状态**：`加载骨架`、`空数据引导`、`正常数据`、`服务端校验/冲突提示`、`断网/未鉴权（引导登录，不伪装成空列表）`。
- 错误、风险与疲劳预警必须同时使用 **图标 + 文字 + 语义色** 三重表达，不依赖单一颜色。
- 尊重 `prefers-reduced-motion: reduce`（Web）与系统动画缩放设置（Android），禁用持续性无意义背景闪烁动画。
