# P3 服务器与数据库基础批次

用户已确认沿用 FastAPI + SQLite，在一轮中完成认证安全与仓储模块化；最后推送并创建未合并PR。

## 范围与接口

- 基线 main 2cf0733；分支 codex/p3-server-database-foundation。已有未跟踪ios残留原样保留，不暂存、不删除。
- 保持路由、JSON、用户ID、现有表和救援事务边界。单实例/单worker；调度规则与contracts冻结。
- 认证：Python标准库PBKDF2-HMAC-SHA256，600000次，随机盐与恒定时间比较。password_hash使用带算法/迭代次数前缀的自描述字符串；保留原password_salt/password_hash列，不新增破坏性迁移。旧SHA256只在正确密码登录时条件更新为新格式；错误密码、未知/损坏格式不得改库。成功升级需保持已有会话与业务数据。
- 数据库：将现有初始化与兼容增量DDL抽到schema模块；仓储按common/users/schedule/rescue/events/microtasks/review/settings/emotion/energy/goals/team/sync拆分，各模块小于600行。backend.repositories包保留现有函数/异常导入；跨域直接显式导入，不使用星号导入或动态转发。
- 连接：保留WAL、锁等待、外键和事务语义；只改有测试证明的失败资源清理，不擅自重写同步/批量事务。
- 历史单文件增量部署器不适用于包结构；增加部署前显式拒绝，不上传残缺后端。生产发布另行审查，不在本轮连接/改动生产库。
- 原有依赖仅恢复到隔离环境，不改requirements或安装新项目依赖。前端、token浏览器存储、提醒新功能、MySQL/PostgreSQL、TLS与实际部署不包含在本批。

## TDD与执行顺序

1. 恢复已有Python依赖，跑当前后端基线；记录真实阻塞。为新哈希、旧密码升级/失败不改库、会话保持、损坏格式、并发升级写失败测试。
2. 新增passwords模块并最小接入users；正确密码升级用旧哈希与盐作CAS条件，避免覆盖并发凭据变化。
3. 先验证API/旧库幂等初始化、事务失败回滚、模块导入一致性，再机械提取仓储与schema，原函数体不改；新增结构合同测试证明真实函数归属与兼容入口一致。保留部署器前置保护并测试。
4. 跑全部backend测试、Node测试、Web源码检查、Python编译和git diff --check；不降低旧断言。独立整分支审查，修复实质问题后重跑。
5. 小提交保留回滚点，一轮整体推送、main-base PR，不自动合并。报告代码回滚不等于密码数据降级；旧版本不懂新哈希，生产回滚必须用带双格式校验的兼容版本，禁止还原整库覆盖新业务数据。

## 记录

- 全局Python现为D:/python/python.exe，已有fastapi/starlette/jsonschema但无pytest；隔离环境build/p3-backend-venv（忽略目录）。固定依赖镜像首次不可用，转官方PyPI重试中。
- 600000参数依据OWASP Password Storage Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html 。不宣称本机实现具备FIPS认证。
