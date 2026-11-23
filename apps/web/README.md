# `apps/web` — React 19 + TypeScript 工作台

## 技术栈与锁定版本

- **Node.js**：`>= 20`（实测 `v24.15.0` / `npm 11.12.1`）
- **构建与框架**：`Vite 6`（`^6.4.6`）+ `React 19`（`^19.1.0`）+ `TypeScript`（`^5.8.3`）+ `React Router v7`
- **样式与组件**：`Tailwind CSS v4`（`@tailwindcss/vite ^4.1.0`）+ Radix/shadcn 风格原子组件 + [设计令牌](src/styles/tokens.css)
- **状态与契约**：`TanStack Query v5`（`^5.74.0`）+ `Zustand v5`（`^5.0.3`）+ `openapi-typescript ^7.13.0` / `openapi-fetch ^0.17.0`
- **测试**：`Vitest 4.1.12` + `jsdom`、`Playwright 1.55.1`；Vite 保持 6

## 已实现页面与状态边界

- `features/auth`：真实注册/登录、HttpOnly Cookie 恢复与会话守卫。
- `features/focus`：真实今日日程、正向/倒计时、跨视图保留的内存计时会话、任务开始与完成。
- `features/calendar`：日/周时间地图、时区投影、重叠事件布局、日程创建/编辑；紧急插单、疲劳恢复和会议过载三类救援入口，三策略预览、显式应用与快照撤销。
- `features/team`：创建/加入/切换工作区、成员隐私投影、全天共享日程时间轴、最多三个黄金窗口切换、单独确认、会议回执与取消。
- `features/energy`：服务端整点曲线、来源/基线诊断、解释因子、推荐保护窗口及明确确认的测试回放。
- `features/settings`：账户/时区、主题、工作时段、chronotype、恢复缓冲与各工作区隐私保存。

共享 UI 位于 `components/ui`，壳层位于 `components/shell`。查询按账号隔离；身份变化时重建缓存。Access Token 仅驻内存，Refresh Token 由 HttpOnly Cookie 托管。Web 只渲染服务端预测与方案，不实现精力或调度算法。

没有样本标为 `baseline_only`，主动回放标为 `replay_demo`；真实 Health Connect/BLE 采集由 Android 完成。空数据、失败与离线不会伪装成保存成功。

## 起步与常用命令

```powershell
cd apps/web
npm ci

# 根据 ../../contracts/openapi.json 重新生成强类型 schema.d.ts
npm run gen:api

# 先按 ../../services/server/README.md 启动真实 PostgreSQL 和 API
# 默认 5173，代理 /api 和 WS 至 localhost:8080
npm run dev -- --host 127.0.0.1

# 验收门禁（PR 合并前必跑）
npm run typecheck
npm run build
npm test
npm audit
```

通过进程变量 `VITE_API_PROXY_TARGET` 修改开发代理目标。服务端 `CORS_ALLOWED_ORIGINS` 需包含实际来源，例如 `http://127.0.0.1:5173`。应用直接进入认证/工作台，不使用 V1 iframe/router.js。

2026-11-19 线上原版复原轮次：类型、构建及 10 文件 / 50 项测试通过；此前同一依赖锁文件的 `npm audit` 报告 0 项已知漏洞。五个工作视图按路由加载，生产入口脚本为 380.65 kB（gzip 120.89 kB），已消除此前约 516 kB 入口的体积提示。此前 Go 重新导出的 OpenAPI 与现有契约一致，Web 类型重新生成至临时文件后也与 `src/api/schema.d.ts` 一致，本轮没有修改这些文件。

救援表单修改输入后立即作废旧预览，延迟返回的旧结果不会恢复确认按钮；同一方案临时失败后重试沿用原 `Idempotency-Key`。疲劳保护提醒可直接进入恢复方案，无需填写虚构的紧急任务。生成预览不会修改日程，应用和撤销均需单独确认。

团队时间轴按用户时区投影服务端区间，裁切跨午夜部分并分行显示重叠安排；夏令时重复小时保留真实时长。仅 `full_title` 展示授权标题，没有共享记录不等于全天空闲。黄金窗口卡可通过鼠标或键盘比较服务端方案，切换本身不会创建会议。

## 真实浏览器验收

API、数据库及 Vite 需已经运行。验收直接调用真实后端，每轮注册独立 QA 账户/工作区，不清空既有数据，不模拟 API。

```powershell
npx playwright install chromium
npm run test:e2e -- --workers=1
```

已有 Chromium 时，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定绝对路径；应用来源用 `E2E_BASE_URL` 覆盖。三个场景各在 1440×1000 与 390×844 执行，本轮完整运行 6/6 通过，覆盖主流程、独立双账号实时协作和线上布局度量；最后修正手机认证页顶部对齐后，重新执行布局场景 2/2 通过。救援分别验证紧急插单与无新增任务的疲劳恢复，以及实际保存的救援原因、所选策略和撤销流程。团队页额外验证键盘切换第二推荐窗口、单独确认创建会议，以及已保存会议在共享时间轴中的真实占用。测试时区固定为 Asia/Shanghai。

视口/长截图在被忽略的 `.appdata/qa/v2`，失败诊断在 `.appdata/qa/playwright-results`。长图中的固定底栏体现截图时的视口位置；以不带 `-full` 的视口图判断实际可视区域。本轮限定 Web 的本地验收已完成；Android 历史进度及全端验收边界见 [迁移执行记录](../../docs/plans/2026-11-19-v1-to-v2-migration.md)，不属于本轮开发范围。

## 线上原版对照

用户指定 `http://8.133.250.216/#/focus`（发布 `d011b2b0001c180c`）作为最新视觉依据。本轮恢复紧凑专注指标和空态、侧栏与手机导航、账户通行证、手机周日期选择、日历救援摘要及账户横向布局，校准团队与精力页的比例。桌面专注首项指标为 84px 高，空态控制区在 (292, 204)，宽 736px、高 256px；390px 手机登录卡片距顶 16px，宽 358px。

八个原版入口与 V2 五视图/认证的对应、真实数据差异及逐页验收见 [线上复原记录](../../docs/plans/2026-11-19-online-reference-restoration.md)。原版的静态任务、成员、精力，以及没有对应服务能力的游客登录、通知开关和 SQLite 提示均不伪造迁入。参考截图位于 `.appdata/reference/online`，新布局截图与尺寸位于 `.appdata/qa/online-restored`；这些 QA 证据不会进入生产包。

## 已保留的 V1 视觉资产

- `public/brand-logo.png` — 品牌 Logo
- `public/favicon.png` — 浏览器图标
- `src/styles/tokens.css` — 浅/深色品牌语义令牌与日历时间线样式
- `public/fonts/` — 原参考字体及来源说明，页面独立加载，不迁入旧脚本

设计规范与 V1→V2 页面精简映射见 [docs/06-design-system-v2.md](../../docs/06-design-system-v2.md)，Web 模块架构见 [docs/05-client-web-and-android.md](../../docs/05-client-web-and-android.md)。

## 2026-11-23：日历与选择机制

日历日期、日/周/月/甘特视图及甘特尺度现保存到地址中，支持刷新和浏览器前进/后退恢复。月份切换保留可用日（例如 1 月 31 日切至 2 月 28 日），详情/编辑入口携带真实日期，关闭新建不残留旧时间。

日期面板支持年月切换、今天、方向键、Home/End、PageUp/PageDown 与 Shift 按年跳转；只有确认才应用，取消保留原值及原始时分。日历表单按账号时区选择今天。月历提供所选日期完整列表及更多日程入口；时间地图可用上下键按 15 分钟移动、左右键切换日期、回车打开草稿。所有日程写入仍需用户明确保存。

本轮 23 文件 / 144 单元测试、类型检查及构建通过；选择机制浏览器回归 5 场景（明确 API 夹具）及真实服务主流程 4 场景均已通过。覆盖桌面、390px 手机、280px 窄屏及短窗口重定位。详见 [执行记录](../../docs/plans/2026-11-23-calendar-selection.md)。

## 2026-11-23：页面与二级界面动效

页面切换使用单一内容区过渡，侧栏、顶部栏与手机底部导航保持清晰；首次加载和只修改查询参数时不重复播放页面动效。保留路由的 Suspense 边界，等待新视图提交后再生成过渡快照。快速连续导航以最后一次选择为准，浏览器历史和不支持原生过渡的环境使用轻量替代效果。

抽屉保留桌面右入、手机底部进入及导入界面固定右侧的约定。拖动手机把手时面板和遮罩同步跟随，根据距离与近期速度决定关闭或平滑回位；取消手势、动画中途反向操作、响应式尺寸变化及减少动态效果模式均会收束当前状态。普通弹窗也在退场结束后移除，退场内容保持稳定，旧界面关闭不会抢走新界面的焦点。

动效和日历隔离浏览器回归：`npm run test:e2e -- e2e/motion.pw.ts e2e/calendar-selection.pw.ts --workers=1`。这些场景显式使用 API 测试夹具，不代表真实写入；真实服务与完整入口验收使用 `e2e/full-fidelity.pw.ts`。动效截图在被忽略的 `.appdata/qa/web-motion`，执行细节见 [动效记录](../../docs/plans/2026-11-23-web-motion.md)。

## 2026-11-23：日历标注反馈落实

十一种细分属性现可选择并随日程保存。日、周、月、所选日列表与甘特使用同一配色，不再把已识别标签仅拼进备注。新字段 `presentation` 是可选显示元数据，旧日程和旧请求保持兼容；运行新版 API 前须先应用服务端 `0003_schedule_presentation.sql` 迁移。

三个排期模式使用原生互斥单选；标题输入增加内边距与提示间距，跳转日期只保留一个焦点框。属性、状态、提醒/缓冲、真实目标关联和时间标尺由各自显示开关控制，精力色带偏好可保存且明确仅适用于日/周视图。短事件以带说明的状态、提醒和目标图标节省空间，详情与较宽列表保留全文。

目标可关联到当前账号已有的本机目标，选择的标识和名称随日程保存；目标本体仍属于本机模块，没有声称跨设备同步目标库。精力与保护窗口明确区分预测和实测来源；日程数与分钟数按所选日期实际相交时段计算，读取失败不显示为零。手机端也展示全部三项统计及来源说明。

`e2e/calendar-feedback.pw.ts` 使用独立 QA 账号，通过真实服务验证属性/颜色/约束/关联的保存与刷新，以及 CSV、ICS、JSON、Excel 课程表从预览到确认写入、读回的完整流程；另有明确标注的读取失败注入场景。文件在本机解析，只有确认才发送日程写入。现有 TSV、课表周次、编码、重复检查和部分失败重试的单元回归继续保留。截图在 `.appdata/qa/calendar-feedback`，详见 [落实记录](../../docs/plans/2026-11-23-calendar-feedback.md)。
