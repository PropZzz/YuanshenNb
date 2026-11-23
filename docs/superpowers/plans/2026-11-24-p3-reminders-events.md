# P3 提醒与事件删除实施记录

基线：origin/main 377a31b；分支：codex/p3-reminders-events。用户批准继续 P3 后端工作，部署暂停。工作树原有 ios/ 下未跟踪文件不纳入本批。

## 接口与数据设计

- GET/POST /reminders、PUT/DELETE /reminders/{id} 全部要求登录。POST 为已拥有的日程创建一份配置，重复创建返回 409；PUT 为完整替换配置，不允许换绑日程；DELETE 成功 204。不存在和他人资源统一 404，请求非法 422。
- POST 字段 scheduleId、enabled（默认 true）、minutesBefore（可空，0..10080 严格整数）；PUT 字段 enabled、minutesBefore。空 offset 表示动态继承日程 reminderMinutesBefore，非空表示显式覆盖。未知字段拒绝，避免前端拼错字段却保存成功。
- 响应 id、scheduleId、enabled、minutesBefore（有效提前量）、usesScheduleOffset、status、triggerAtLocal。GET 可传 day，表示日程发生日期而非提醒发出日期；省略时使用日程锚定日期。时间为日程本地墙上时间，无 UTC/服务器时区推断，跨午夜照常减提前量。
- status 为 ready / disabled / notScheduled / unavailable。unavailable 的 reason 表示 scheduleMissing、dateRequired、invalidSchedule 或 unsupportedRepeat。ready 只表示计算有效，不表示已发送、未来或已到期。
- 日程日期、时间、提前量与重复规则直接从同一条带 user_id 的 LEFT JOIN 查询读取，不缓存触发时间。支持现有 none/daily/weekly/monthly；monthly 沿用前端逐月夹到月末的语义；floating 需显式 day。repeatUntil 含当天。未知重复规则或坏历史值显式 unavailable，不捏造时间。
- reminders 只外键关联用户，不级联关联日程，避免救援临时 DELETE/INSERT 丢失配置。日程移除后保留配置并标记 scheduleMissing；恢复原用户同 ID 日程后重新生效。新增日程不会自动建提醒，由 P2 显式接入。
- DELETE /events/{id} 在同一事务中先保存完整原始行、操作者、UTC 删除时间、审计版本，再删事件；不存在/他人事件 404。复盘、个人统计和导出读取当前事件，自然排除已删记录；不逆向修改独立目标完成状态或撤销救援快照。救援历史事件同样可删除，操作事实保留在快照及删除审计中。
- 审计记录不提供普通用户删除或恢复接口；恢复使用原始事件的新 ID 显式重新录入。已删 ID 返回 409，避免陈旧批量重传恢复错误事件。
- 新表通过 init_db 的 CREATE IF NOT EXISTS 幂等加入，旧表数据不改写。回滚应用代码后新表保留，不能删掉审计数据。

以上字段是本批实现选择，原文档仅预留路由；不改变已有日程/事件请求和响应。无新依赖，不修改前端或冻结调度。

## 实施顺序和测试边界

按 API 公共边界和数据库持久化边界测试（后者验证审计原文、幂等初始化、事务回滚）：

1. 提醒 CRUD 最小闭环：先看到 501 失败，再实现模型、表、仓储、路由。
2. 用户隔离、401/404/409/422、日程更新/删除/恢复、重复与跨午夜、救援采用/撤销；逐个失败后补实现。
3. 事件删除：先失败，再补审计事务；验证跨用户、重复删除、统计变化、失败回滚与旧 ID 重传。
4. 全量 backend pytest、Node 测试、Web 源检查、compileall、git diff --check；独立审查整个分支。
5. 只提交任务文件，推送并创建 main base 的未合并 PR；不部署。

## 执行证据

- 提醒 CRUD 首次定向 1 failed（501 而非 201），最小实现后 1 passed；删除日程后投影首次抛 TypeError，修复为 scheduleMissing 后 2 passed。
- 重复日期/无日期/非法历史值 14 failed → 16 passed；补账号隔离、422、覆盖、救援联动后 33 passed。救援测试最初遗漏已有 due 必填字段，修正测试输入，未改生产契约。
- 事件删除首次 1 failed（501 而非 204）→ 1 passed；旧 ID 重传测试 1 failed → 5 passed（含隔离和事务失败）。
- 数据导出缺 reminders 的 KeyError 失败 → 增加带 user_id 的导出；create 写入触发器失败曾误映射 409，失败测试后改为真实 500，仅显式查重返回 409。
- 旧库幂等初始化、保留原账号、重启读取、并发创建、备份恢复、删除上传并发均通过。
- 独立审查发现上传先提交再读响应存在并发删除竞态；单条及批次测试稳定复现 2 failed（空响应），改为事务内读取、由 _connect 提交后 2 passed。审查其余隔离/投影/审计无阻止提交问题。
- 初次全量 351 passed / 1 failed（旧清单仍要求已实现删除接口返回 501）。五条路径转入真实响应和 401 断言，原有 29 条继续严格校验 501，OpenAPI 仍覆盖所有路径；定向 4 passed。未删除测试或放宽 501 断言。

最终验证（2026-11-24，Python 3.13，现有 build/p3-backend-venv，无新增依赖）：

| 命令 | 退出状态 | 结果 |
| --- | --- | --- |
| build/p3-backend-venv/Scripts/python.exe -m pytest backend/tests -q --tb=short | 0 | 357 passed，73.32s；169 条现有 Starlette 弃用警告 |
| 同 Python -m pytest backend/tests/test_reminders_api.py backend/tests/test_event_deletion.py backend/tests/test_reserved_endpoints.py -q --tb=short | 0 | 审查修复前 49 passed，修复后另跑 2 passed；最终全量包含全部 51 项 |
| node --test tools/tests/*.test.mjs | 0 | 34 passed |
| node tools/check_web_sources.mjs | 0 | 111 文件 / 27 路由 / 296 引用 |
| node tools/build_stitch_web.mjs | 0 | 构建 bf0daeb42fc6787c，产物仅在 ignored build/ |
| 同 Python -m compileall -q backend | 0 | 无语法错误 |
| git diff --check | 0 | 无空白错误 |

环境记录：首次沙箱内 `build/p3-backend-venv/Scripts/python.exe -m pytest backend/tests/test_reminders_api.py -q` 持续无输出，手动中止退出 1，记为阻塞/未通过。现有环境的同解释器带 `-X faulthandler`、`dump_traceback_later(45, exit=True)` 有界运行在 2.66s 内返回预期 501 失败，之后上述完整验证在该环境运行。

进一步在沙箱以隐藏 Start-Process 执行 `build/p3-backend-venv/Scripts/python.exe -X faulthandler -m pytest backend/tests/test_reminders_api.py -q -k reminder_crud -o faulthandler_timeout=10`，25s 外层超时后仅终止该诊断进程，退出 124，仍记为阻塞/未通过。10s 栈报告显示卡在 Starlette TestClient 初始化：AnyIO 启动 asyncio ProactorEventLoop → _make_self_pipe → socket._fallback_socketpair → socket.accept，主线程等待 blocking portal。沙箱 `python -V` 正常返回 3.13.5。问题已定位到沙箱内事件循环创建本机 socket 对的阶段，可能受隔离网络限制；未证实更底层原因，未修改事件循环或测试来绕过。诊断日志仅保留在 ignored build/。

未运行：真实浏览器前端接入、真实服务器部署/HTTPS/推送、生产库升级和恢复。Flutter 已不属于当前 Web + FastAPI 仓库验证链，未运行 Flutter 命令。

决策：新增接口字段按本计划落地，既有接口字段不变；事件删除不逆向撤销独立任务或救援状态。回滚保留新增表，旧版本不识别墓碑，需停写或保留墓碑检查；线上恢复需 P4 演练与另行批准。创建 PR 后暂停，不合并不部署。
