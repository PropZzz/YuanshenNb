# 时序智配 V2 Web 视觉设计系统与承接规范

> **设计原则**：继承 V1 “时间地图” 高级冷静、低噪声的 Material 3 视觉语言与色彩体系，剥离旧版 `iframe` 拼装外壳、静态假数据与冗余页面，用 React 19 + Tailwind CSS v4 + shadcn/ui 组件化实现。

---

## 1. 已提取保留的视觉资产

1. **品牌资产**：
   - Logo：[apps/web/public/brand-logo.png](file:///d:/AAACode/Ruanchuang/apps/web/public/brand-logo.png)
   - Favicon：[apps/web/public/favicon.png](file:///d:/AAACode/Ruanchuang/apps/web/public/favicon.png)
2. **语义色彩与排版令牌**：
   - 完整保留于 [apps/web/src/styles/tokens.css](file:///d:/AAACode/Ruanchuang/apps/web/src/styles/tokens.css)，同时覆盖 Light 与 Dark 模式：
     - **主品牌深松绿**：`#163d3d` (`primary-container`) / `#002727` (`primary`)，用于选中导航、精力高亮看板、深度保护块。
     - **温润瓷白画布**：`#faf8fe` (`surface`) + `#ffffff` (`surface-container-lowest`) + `#f4f3f8` (`surface-container-low`) 形成三层卡片纵深，减少硬边框压迫感。
     - **语义交互色**：
       - 主动作蓝：`#005db5` (`secondary`) —— 发起会议、保存日程、一键预约。
       - 精力恢复绿：`#1db84d` / `#53e16f` (`tertiary`) —— 空闲可协作、HRV 恢复良好、恢复缓冲窗口。
       - 风险与高负荷红：`#ba1a1a` (`error`) —— 硬冲突警告、紧急插单、疲劳过载提醒。
     - **字体**：标题用 `Noto Serif SC`（沉稳刊物感），正文/控件用 `Inter`，所有倒计时/时间刻度强制开启 `tabular-nums` 等宽数字防抖动。
3. **如需对照 V1 原始 HTML 细节**：
   - V1 所有页面快照完整保留在 `main` 分支，可通过以下命令随时检出查看：
     ```powershell
     git show main:web/stitch/screens/smart-calendar/index.html
     git show main:web/stitch/screens/team/index.html
     git show main:web/stitch/screens/emotion-energy/index.html
     git show main:web/stitch/screens/rescue-comparison/index.html
     ```

---

## 2. 壳层与响应式布局规则（承接自旧版主框架）

- **桌面端（`>= 1024px`）**：
  - 左侧固定 `260px` 侧边栏（品牌区 + 分组导航 + 底部当前用户与穿戴同步状态徽标）。
  - 顶部固定 `64px` 毛玻璃状态栏（面包屑 + 当前实时精力电量胶囊 + 全局快捷动作 `+ 发起团队排会` / `+ 紧急插单` / `+ 新建日程`）。
  - 主工作区最大宽度 `1360px` 居中，采用 12 栏 Bento Grid。
- **移动端 Web（`< 780px`）**：
  - 收起左侧栏，切换为底部固定 5 项导航栏（`calc(4.25rem + env(safe-area-inset-bottom))`），所有复杂表单与救援对比矩阵改为全屏抽屉或 Bottom Sheet。

---

## 3. 页面架构精简映射（25 个旧页 → 5 个高信号核心页）

| V2 路由 | 页面名称 | 承接自旧版 UI 区块 | V2 核心升级点 |
| --- | --- | --- | --- |
| `/focus` | **今日专注与精力** | 原 `focus` 径向计时环 + 4 格顶部指标卡 | 接入真实穿戴精力曲线与当前专注保护窗；去掉静态伪造的子任务列表 |
| `/calendar` | **智能日历与救援** | 原 `smart-calendar` 时间地图网格 + 右侧持久救援摘要栏 + `rescue-comparison` 三方案对比 | 废除像素高度换算，改用真实时间轴；叠穿个人精力曲线热区与“深度专注保护盾”标识；保留 3 方案对比与一键撤销 |
| `/team` | **团队协同排会** | 原 `team` 顶栏看板 + 4 KPI Bento + 深松绿“黄金协作窗口”大卡 + 成员实时状态网络 | 替换为真实多用户 Workspace 数据；新增“会议认知强度选择”与 Top 3 黄金窗口推荐卡片；成员状态严格脱敏（仅展示空闲/保护/忙碌，不泄漏生理隐私） |
| `/energy` | **穿戴精力洞察** | 原 `emotion-energy` 实时能量池 Hero + 节律曲线 | **核心数据源改为穿戴同步数据**（Health Connect / BLE 心率带 / 显式测试回放），展示昨夜睡眠恢复分、HRV 偏离度与今日可承受高负荷窗口 |
| `/settings` | **账号与团队权限** | 原 `login` 与 `settings-drawer` | 账号登录/注册、深浅色主题切换、Workspace 管理与**向团队公开日程/精力颗粒度的隐私开关** |

> 原版中的 `bluetooth`（独立扫描页）、`integrations`（空壳 MCP）、`goals`、`microtasks`、`diagnostics` 在 V2 中不再作为独立一级页面堆砌，避免导航臃肿；短任务直接作为轻量级日程任务在日历与专注页处理，穿戴设备状态收口在 `/energy` 顶部同步徽标内。
