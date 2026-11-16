# 当前项目架构与目录边界

更新时间：2026-11-16。本文优先于历史设计导出、旧计划中的启动路径。旧 Flutter 客户端已从当前项目移除，新的客户端尚未创建。移出的文件存放在仓库外的 `../_cleanup-backups/flutter-retired-20261116-184458/`，可用于恢复。

## 两个保留的运行入口

| 实现 | 维护位置 | 入口 / 命令 |
| --- | --- | --- |
| HTML/JS Web（线上桌面与移动端） | `web/` | `web/index.html`；`run_web_preview.bat` |
| FastAPI + SQLite 后端 | `backend/` | `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` |

Web 的 `web/stitch/router.js` 统一路由，`web/stitch/page-host.js` 保留页面文档和状态；`screens/`、`mobile/`、`components/` 都是当前实现。修改移动页面直接编辑 `web/stitch/mobile/`。
`web/stitch/actions.js` 根据显式动作标记分派 API 操作；专注页自己的 `data-focus-action` 由 `focus.js` 独占处理。日历渲染使用 `calendar.js`。形态决策见 [运行边界](superpowers/specs/2026-10-31-runtime-boundaries.md)。

`web/flutter_service_worker.js` 是用于注销旧 Flutter 缓存的迁移脚本，仍需发布，不能当作旧构建文件删除。

## 数据与兼容层

- 旧 Flutter 的 `lib/`、`test/`、五个平台工程、根目录 `assets/`、`stitch/`、依赖清单、项目缓存及专用构建输出已移出。`web/stitch/` 是现有 Web 前端，继续保留。
- `backend/tests/`、`tools/tests/`、`contracts/` 和共享 Python 脚本保留。旧 Dart/Python parity 因 Dart 执行器已删除而不可运行；依赖它的性能门禁仍会阻断，不能将历史报告作为本次通过证明。
- `backend/services_scheduling.py` 是当前兼容入口，委托 `backend/scheduling/`；不是第二套后端。
- `backend/data/`、`.appdata/` 为本地运行数据；SQLite、账户信息和业务数据不属于导出清理范围。
- `.appdata/` 中的历史部署快照及 `.worktrees/` 中的独立工作副本原样保留；其中出现旧 Flutter 文件不代表当前项目仍保留 Flutter 运行入口。
- 会话位于同一个 SQLite 数据库的 `auth_sessions`；`backend/settings.py` 管理有效期与 CORS，`deploy/database_maintenance.py` 管理备份恢复。

## 构建、校验与发布

```powershell
node tools/check_web_sources.mjs
node --test tools/tests/*.test.mjs
node tools/build_stitch_web.mjs
python -m pytest backend/tests -q
```

浏览器验收使用现有 `tools/check_stitch_navigation.mjs`、`tools/check_stitch_release.mjs`；本机需已安装 Playwright，可通过 `PLAYWRIGHT_MODULE` 指向对应模块。

Web 构建输出为 `build/stitch-web/<内容版本>/`；压缩包为 `build/stitch-<内容版本>.tar.gz`。当前包可保留，过期 Web 输出可按版本清理。不要整个删除 `build/`，其中也有 Web 版本、后端快照、本地数据与验收证据。

标准部署脚本在 `deploy/deploy_web_release.py`。线上静态文件指向 `/opt/ruanchuang/web/current`，由版本目录原子切换；服务器保留上一版以便回滚。仓库清理不触碰服务器版本、后端进程或数据库。

## 已停用链路

根目录旧 `stitch/screens/`、`design/stitch-mobile/` 和对应导出、同步工具已删除。历史文档中提到这些路径时应视为当时的设计背景，不能照此启动或发布。清理明细与恢复位置见 `cleanup-2026-10-29.md`。
