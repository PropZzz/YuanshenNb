# 提醒配置与事件删除契约

本批为 P3 后端能力；不修改前端、调度排序、认证契约或生产环境。所有新接口均使用现有 Bearer 会话。此前这些路径返回 501，现在执行真实持久化操作；推送、设备及通知测试接口继续返回结构化 501。

## 提醒配置

创建：`POST /reminders`，成功 201：

```json
{"scheduleId":"schedule-1","enabled":true,"minutesBefore":null}
```

`scheduleId` 必填且不能全空白；服务端生成提醒 ID。一个账号的一条日程只能有一份配置。重复创建 409；不存在或属于他人的日程统一 404。

更新：`PUT /reminders/{id}`，成功 200，完整替换 `enabled`（省略默认 true）与 `minutesBefore`（省略默认 null）。不接受 `scheduleId` 或 `id`，不能换绑。提前量仅接受 0..10080 的整数（拒绝字符串、bool、小数）；enabled 仅接受 bool。所有未知字段、非法 day、非法请求均返回 422，原配置不变。删除：`DELETE /reminders/{id}` 成功 204；不存在或他人提醒 404，重复删除也返回 404。数据库异常保持 500，不伪装为成功或业务冲突。

查询：`GET /reminders` 返回本人所有配置，按提醒 ID 排序。可传 `day=YYYY-MM-DD`，表示**日程发生日期**；省略时用当前日程锚定日期，无锚定日期时为 dateRequired。不是查询未来最近提醒，也不按服务器日期自动替用户选择日期。

```json
[
  {
    "id":"server-generated-id",
    "scheduleId":"schedule-1",
    "enabled":true,
    "minutesBefore":10,
    "usesScheduleOffset":true,
    "status":"ready",
    "triggerAtLocal":"2026-11-24T08:50:00",
    "unavailableReason":null
  }
]
```

配置 offset 为 null 时，`usesScheduleOffset=true`，每次读取继承日程当前 `reminderMinutesBefore`；显式整数覆盖它，不会反向修改日程。响应的 minutesBefore 是有效值，历史值非法或关联日程缺失时可能为 null。

`triggerAtLocal` 是没有时区偏移的日程本地墙上时间：09:00 提前 10 分钟是 08:50，00:05 提前 20 分钟是前一天 23:45。不得直接当 UTC；调用端应使用与日历相同的时区解释。现有日程无时区字段，本批不推断用户所在时区、不提供跨时区投递保证。

| status | triggerAtLocal | 含义 |
| --- | --- | --- |
| ready | 时间字符串 | 该日期存在有效日程发生项，时间已计算；不表示已到期、位于未来或已发送 |
| disabled | null | 用户关闭提醒；关闭优先于日程可用性 |
| notScheduled | null | 该日不符合重复规则或超出起止日期 |
| unavailable | null | unavailableReason 为 scheduleMissing/dateRequired/invalidSchedule/unsupportedRepeat |

支持 none/daily/weekly/monthly，与现有日历保持一致：不能早于锚定日期；repeatUntil 含当天；monthly 逐月夹到月底（1月31日→2月28日→3月28日）；无锚定日期的 floating 日程在显式指定 day 后每天发生。未知重复规则及坏历史日期/时间/提前量均显式 unavailable，不生成虚构时间。

日程时间和提前量不缓存；列表用带 user_id 的单次 JOIN 读取一致快照，因此日程编辑、批量更新、救援采用/撤销立即影响投影。救援临时删除和重建同 ID 日程不会删除配置。最终移除的日程保留 reminder 并显示 scheduleMissing；若原用户恢复相同 ID 日程则重新生效。此保留策略是为撤销救援服务；客户端永久删除后若不再需要配置，应显式 DELETE 提醒。新日程不会自动注册配置。

账号数据导出新增 reminders 配置，继续按用户隔离，不导出计算缓存。

## 删除错误事件

`DELETE /events/{event_id}` 成功返回 204。缺登录 401；不存在、已删或属于他人的事件统一 404。

同一 `BEGIN IMMEDIATE` 事务先把完整原始数据库行写入 task_event_deletions（含 event_id、操作账号 user_id、payload_json、schema_version=1、UTC deleted_at），再删除 task_events 行。任一步失败全部回滚，接口返回真实失败，用户可重试。

事件列表、周/月复盘、个人统计及 taskEvents 导出不再包含已删除事件；周报调参在下次请求周报时按当前事件重新计算。不逆向修改独立的目标/微任务完成状态，也不撤销救援方案。救援事件删除后从历史列表消失，救援快照本身仍保留且可正常撤销；救援 reason 前缀不变。

已删 ID 是持久化墓碑，单条/批次上传重用它都返回 409；批次整体回滚，避免旧客户端重新上传后恢复错误事件。补录使用新 ID。审计无普通用户查询/修改/删除接口；受限运维可按审计 JSON 查证，不应删表来回滚应用。

## 升级、回滚与交接

init_db 幂等新增 reminders 和 task_event_deletions 两表，不改写已有业务数据；无新增依赖。发布仍须先按 P4 流程备份数据库。代码可回滚至本批前版本并保留新表；旧版不会理解删除墓碑，会重新开放已删 ID 写入，需停写或保留本批墓碑检查，不能将旧版本回滚视为等价行为。恢复整库备份将丢失备份之后的数据，须另行授权并演练。

P2 后续接入前端提醒配置、指定发生日期查询和真实失败展示；通知投递/去重、时区持久化另立任务。P4 补真实浏览器联调、完整备份恢复与发布证据。部署、SSH 密钥和 TLS 仍暂停，未在本批执行。
