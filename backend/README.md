# Ruanchuang Backend

唯一的 FastAPI + SQLite 后端，承接当前 HTML/JS Web 的账号、日程、微任务和算法推荐接口。旧Flutter客户端已经移除。目录边界见 `docs/current-architecture.md`；本轮模块结构与兼容说明见 [服务器与数据库基础](../docs/server-database-foundation-2026-11-23.md)。

## 安装依赖

在项目根目录执行（本轮使用 Python 3.13.5）：

```powershell
python -m pip install -r backend/requirements.txt
```

## 启动服务

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

启动后可访问：

- `GET http://127.0.0.1:8000/health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET|POST /schedule`
- `PUT|DELETE /schedule/{entry_id}`
- `POST /schedule/replan`
- `POST /schedule/rescue/options`
- `POST /schedule/rescue/apply`
- `POST /schedule/rescue/undo`
- `GET /schedule/rescue/history`
- `GET|POST /events`
- `POST /events/batch`
- `GET /review/weekly`
- `GET /review/monthly`
- `GET /review/rescue-history`
- `GET|PUT /review/tuning`
- `POST /review/tuning/apply`
- `GET|POST /microtasks`
- `PUT|DELETE /microtasks/{task_id}`
- `POST /microtasks/recommend-crystals`
- `GET /emotion/current`
- `POST|GET /emotion/checkins`
- `GET /emotion/care-alert`
- `GET /energy/current`
- `POST /energy/samples`
- `GET /energy/profile`
- `GET|POST /goals`
- `PUT|DELETE /goals/{goal_id}`
- `POST /goals/{goal_id}/tasks`
- `PUT /goals/{goal_id}/tasks/{task_id}`
- `GET|POST /team/members`
- `PUT|DELETE /team/members/{member_id}`
- `PUT /team/members/{member_id}/permission`
- `GET /team/calendars`

默认 SQLite 数据库文件保存在 `backend/data/shixuzhipei.db`。生产部署使用 `SHIXUZHIPEI_DB_PATH` 指向持久化数据目录。

当前已实现平台诊断、账号退出/昵称更新、ICS 导入导出、日程批量/冲突/救援、微任务批量操作、目标下一任务、团队冲突/黄金窗口/会议预约和基础 `/sync/*` 游标同步。

AI、设备、第三方集成、文件、推送和密码重置仍返回结构化 HTTP 501 `RESERVED_ENDPOINT`，直到对应外部服务或硬件完成接入。

## 错误语义与并发设置

- `401`：缺少/无效/已过期/已退出的 Bearer token；`404`：资源不存在；`409`：跨用户复用同一资源 ID、基线哈希过期或重复写入冲突；`422`：请求体字段校验失败；`501`：预留接口。
- 资源 ID 冲突统一在仓库层用 `_check_global_owner` 判定并返回 409，不会因 SQLite `UNIQUE` 约束冒泡成 500；`main.py` 还为 `RepositoryNotFoundError` / `RepositoryConflictError` / `RepositoryValidationError` 注册了兜底处理器。
- 注册接口会拒绝空白账号、空白昵称和少于 6 位的密码，并去除账号/昵称首尾空格；登录同样会去除账号首尾空格。
- `database.py` 为每个连接设置 `busy_timeout=5000` 并启用 `journal_mode=WAL`、`synchronous=NORMAL`，并发写入时等待锁而不是立刻报 `database is locked`；仍按单实例写入部署。
- Bearer 会话保存在本应用数据库的 `auth_sessions`，只存 SHA-256 摘要、用户 ID、创建及到期时间；默认有效期 7 天。有效会话跨进程重启，退出即删除对应记录，撤销也跨重启保留。首次从旧内存令牌版本迁移需重新登录。

## 生产配置与维护

密码使用标准库PBKDF2-HMAC-SHA256（600000次迭代、独立随机盐、恒定时间比较）。旧SHA256账号仅在正确登录时惰性升级，无需修改表结构。升级后回滚代码必须保留双格式验证能力；不得直接回滚到仅理解旧哈希的版本。

仓储位于 `backend/repositories/`，原 `from backend.repositories import ...` 继续可用；初始化位于 `backend/schema.py`。发布必须包含整个backend包，历史单文件日程增量脚本会拒绝不完整发布。

- `SHIXUZHIPEI_DB_PATH`：持久化 SQLite 路径。
- `SHIXUZHIPEI_SESSION_TTL_SECONDS`：正整数秒，默认 `604800`。
- `SHIXUZHIPEI_CORS_ORIGINS`：逗号分隔的显式 HTTP(S) origin；默认 `http://8.133.250.216,http://127.0.0.1:5353,http://localhost:5353`。其他本地端口也需配置；`*`、带路径或凭据的 URL 会被拒绝。

示例见 `deploy/backend.env.example`。备份使用 SQLite backup API，包含 WAL；恢复会验证完整性、表计数，并保留操作前备份。工具、Linux 初始化和待配置 TLS 模板见 [生产准备](../docs/production-preparation-2026-10-31.md)。
本轮为源码和本地恢复验收，用户暂无域名；不能据此认定现有生产服务器已经升级。

## 验证

```powershell
python -m pytest backend/tests -q
node --test tools/tests/*.test.mjs
node tools/check_web_sources.mjs
git diff --check
```

2026-10-31：后端连续两轮全量各 265 passed。完整客户端、Web、对拍和环境证据见 [验证记录](../docs/verification-2026-10-31.md)。
