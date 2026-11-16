# 时序智配开发指引

目录和启动边界以 `docs/current-architecture.md` 为准；旧设计计划只提供历史背景。

## 当前实现

- 线上 Web：`web/` 中的 HTML/JS，入口 `web/index.html`，路由 `web/stitch/router.js`，持久页面宿主 `web/stitch/page-host.js`。
- 旧 Flutter/Dart 客户端及五个平台工程已于 2026-11-16 删除，等待重新构建；不要依赖旧原生源码、资源或测试路径。
- 后端：`backend.main:app`，唯一的 FastAPI + SQLite 服务，当前服务 Web。
- `backend/services_scheduling.py` 是当前调度兼容入口；`backend/scheduling/` 是模块化实现，不是两套后端。

## 修改约束

- Web 桌面、移动和二级页面分别在 `web/stitch/screens/`、`web/stitch/mobile/`、`web/stitch/components/` 直接维护。
- 保持统一导航选中态、持久页面状态、可打断的切换动画与减少动态效果支持。
- `web/flutter_service_worker.js` 是旧缓存退役脚本，必须保留。
- Web 资源在 `web/stitch/assets/`；根目录旧 `assets/`、`stitch/` 和 `pubspec.yaml` 已删除。
- 保护 SQLite、`.appdata/` 与 `.worktrees/` 内的未提交工作。
- 共享 Python 调度脚本仍供后端测试使用；旧跨语言 parity 暂不可运行，不绕过其性能门禁。
- 不从旧导出复制页面，不在 `build/` 中维护部署脚本，不把密码写入文件。

## 常用命令

```powershell
.\run_web_preview.bat
node tools/check_web_sources.mjs
node --test tools/tests/stitch_release.test.mjs
node tools/build_stitch_web.mjs
python -m pytest backend/tests -q
```

部署使用 `python deploy/deploy_web_release.py`；浏览器回归使用 `tools/check_stitch_navigation.mjs` 与 `tools/check_stitch_release.mjs`。具体环境要求见 `deploy/README.md`。
