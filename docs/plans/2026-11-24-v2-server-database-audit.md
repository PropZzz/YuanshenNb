# V2 服务端与数据库核对及修复

用户确认：以真正默认分支 refactor/v2-rebuild 为基线，按新版 P1 服务端/数据库职责核对并补齐。旧 main 上的 V1 Python/SQLite 提交仅保留历史，不合入 V2；V1 的 357 项测试不作为 V2 证据。用户另行批准在 ignored .appdata 中安装项目规定的 Go 和 PostgreSQL 开发工具，不更改依赖清单、不操作生产服务器。

基线：4b476728fc19b58ee2b258281069fe6dd4608836；分支 oxygen/p1-v2-server-database。Git 直连失败后通过 GitHub API 确认最新 SHA，下载同一 SHA 的归档，558 个 blob 逐个与 Git 树 SHA 校验后写入对象缓存，再以 --no-overwrite-ignore 切换。既有 Flutter 残留、Python 缓存和 ignored build 均保留，不纳入提交。origin 已改为迁移后的规范仓库地址 https://github.com/PropZzz/YuanshenNb.git。

## 边界

遵循 AGENT.md、docs/01、04、07、08。只修改 P1 服务端、数据库测试和相应文档；不改 P2 engine、Web、Android，不引入 V1 的提醒资源、事件表、像素字段或 PBKDF2。Go + PostgreSQL、Argon2id、Huma、现有 OpenAPI 继续为准。不改生产数据库，不部署，不把旧 main 合并进默认分支。

## 核对清单

| P1 交付 | 初步代码证据 | 本轮验证 |
| --- | --- | --- |
| 注册/Argon2id/JWT/Refresh 族轮换 | internal/auth/security.go、service.go，已有真实 PG 测试 | 基线和新增故障/重试回归通过 |
| REST 与对象归属 | apiadapter、schedule/workspace SQL 绑定 user_id/成员资格 | 既有 32 操作集成测试及新增 HTTP 故障测试通过 |
| 迁移与并发 | 0001..0003、用户按序行锁、tstzrange、救援快照 | 真 PG16/race 全量通过，未改迁移 |
| WebSocket | 一次性数据库票据、Origin、心跳、提交后发布 | 既有集成/race 回归通过，未改实现 |
| OpenAPI | Huma 导出、contracts/openapi.json | 重导出 JSON 与已提交契约语义完全一致 |

## 已发现的修复候选与取舍

认证服务将任意登录查询错误转为 ErrCredentials，刷新读取错误也统一转为 ErrRefresh；数据库故障/取消可能被伪装为 401，导致调用端误判账号失效。先通过公开服务/HTTP 边界写稳定失败测试，区分 pgx.ErrNoRows 与真实基础设施错误；保留现有 RFC 9457 字典，不自行扩展接口。

本轮优先修证据确认的服务端错误边界，并验证全部既有 P1 交付；不凭旧版分工新增 V2 已移除模块。发现职责越界或需改变迁移/接口模型时先说明。

## 执行顺序

1. 准备批准的便携 Go/PG16，独立测试集群只监听 localhost，测试 schema 隔离，不使用生产凭据。
2. 运行 go vet、普通测试及真实 PG 基线，记录实际跳过/失败；用有界超时定位，不把未运行写为通过。
3. TDD 修复认证数据库错误语义，补缺失用户/非法令牌的 401 对照、故障返回真实错误、轮换/事务不部分成功等回归。
4. 只 gofmt 本批修改文件；go vet ./...、go test -race '-ldflags=-linkmode=external' -count=1 ./...；导出契约到 ignored 临时文件比较，不改前端生成文件。
5. 独立审查本轮差异；小提交推送，创建 base=refactor/v2-rebuild 的 PR。未经本轮明确授权不自动合并、不部署。

## 实际证据

### 环境与基线

- 本机初始无 go / psql / postgres / docker，不能沿用 README 中其他工作区的已安装状态。用户明确批准便携开发工具后，安装到 ignored .appdata：Go 1.27.4、PostgreSQL 16.16；GCC 使用已有 C:/mingw64/bin/gcc.exe。未修改 go.mod / go.sum，也未安装系统服务。
- Go 来源为 https://go.dev/dl/ 官方发布元数据，Windows amd64 zip SHA256 校验为 178ab98950ac69ab25069307dc6ade79f3816e414cce95b4da166a115cde1e7e。PG16 来源为 PostgreSQL 官方 Windows 页面指向的 EDB binaries（fileid=1260731），只使用 bin/lib/share 服务器组件。工具、压缩包、数据目录不进入提交。
- proxy.golang.org 恢复固定依赖失败，退出 1（连接超时）；改用进程级 GOPROXY=https://goproxy.cn 后 mod download 退出 0，保留固定 go.sum 校验。Git 不使用已启用的系统代理而反复超时，按命令临时使用系统代理后 fetch 成功；未改全局代理配置。
- 新建独立测试集群 .appdata/pg-v2-test，只监听 127.0.0.1:55436，测试库 v2_test；未使用生产地址/凭据，未连接或更改服务器。各 PG 测试使用随机 schema，结束后检查 test_% schema 数为 0。
- 基线从确认 SHA 的归档复制 services/server 与 contracts 到 ignored .appdata/v2-baseline-4b47672，保留本轮新增失败测试原位；在该不变副本运行全量普通测试，退出 0：79 个顶层测试 / 含子例 131 项通过，10 个有测试的包通过，0 个测试跳过。JSON 中另有 3 个无测试文件的工具包，不是被跳过的 PG 用例。

### TDD 与修复

- 登录取消/关闭池：首次 2 failed，均错误返回 invalid credentials。
- 刷新初次 token_hash 查询及 FOR UPDATE 的 family_id 查询：独立 PG schema 中临时改列名故障，首次两个子例 failed，均错误返回 invalid refresh token。
- HTTP 登录、刷新两次查询：首次三个子例 failed，实际 401 而非既有契约的 500。
- 最小修复仅区分 pgx.ErrNoRows 和其他错误，保留原查询、行锁、user_id 绑定及回滚。定向 auth 与 cmd/api 通过；另补不存在账号/令牌继续 401、错误因果链、失败 Cookie/SQL 信息边界及恢复后重试断言。
- docs/04 和 docs/07 同步错误语义；请求/响应模型、OpenAPI、认证协议、表结构均不改。PG 临时改列仅存在测试随机 schema，不是项目或生产迁移。
- 独立分支审查未发现新增重要问题，确认两个刷新查询保持错误传递、锁/归属与事务回滚；审查者未代跑测试，以下结果由主代理实际执行。

### 最终验证

下列命令均从仓库根目录执行；进程环境设置 GOPATH=.appdata/go、GOCACHE=.appdata/go-cache、GOPROXY=https://goproxy.cn。PG 测试设置独立本机 TEST_DATABASE_URL；race 设置 CGO_ENABLED=1、CC=C:/mingw64/bin/gcc.exe，PATH 含该目录。

| 命令 | 实际结果 |
| --- | --- |
| .appdata/toolchains/go/bin/go.exe -C .appdata/v2-baseline-4b47672/services/server test -json -count=1 -timeout=180s ./... | exit 0；原始基线 79 顶层 / 131 含子例通过 |
| 同 Go -C services/server test ./internal/auth ./cmd/api -run 'TestLoginPreserves\|TestPostgresRefreshPreserves\|TestPostgresAuthDatabaseFailure' -count=1 -timeout=90s | exit 0；TDD 定向绿测 |
| 同 Go -C services/server vet ./... | exit 0；最终修改后再执行通过 |
| 同 Go -C services/server test -race '-ldflags=-linkmode=external' -json -count=1 -timeout=300s ./... | exit 0；最终 84 顶层 / 141 含子例通过；10 个有测试包通过；0 测试跳过；3 工具包无测试文件 |
| 同 Go -C services/server run ./cmd/export-openapi -out ../../.appdata/v2-openapi-check.json | exit 0；与 contracts/openapi.json JSON 结构完全一致，无契约漂移 |
| gofmt -w 本轮三个 Go 文件 | 仅修改本轮文件，无全仓格式化 |
| git diff --check | exit 0 |

完整日志位于 ignored build/v2-*.log / *.jsonl，不进入仓库。未运行 Web/Android 门禁：本轮不修改这两端或生成类型；不把过去 V1 Node/Flutter 检查当作 V2 证据。本分支基线无 .github workflow，不能声称云端 CI 已通过。未执行生产数据库迁移、备份恢复或部署。

### 剩余边界与回滚

P1 已有实现和上述本轮回归覆盖相符，不代表所有生产风险已消除。真实 Android 穿戴、浏览器与服务器端到端演示属于 P2/P3/P4 协同验收；生产 TLS/凭据、发布与备份恢复需要另行安排。旧 main 上的 V1 提交保留，不复刻已移除模块；这也意味着不能把 V1 的“15 张 SQLite 表”作为 V2 数据库完成证据：V2 当前为 12 张 PostgreSQL 业务表、3 份迁移。

本轮无 Schema / 数据变更，回滚本轮修复提交即可回到之前行为；回滚会重新将数据库故障误报 401，不建议作为长期方案。推送只包含列出的服务端/文档文件，新 PR 的 base 固定为 refactor/v2-rebuild；保留所有原有未跟踪文件，不自动合并、不部署。
