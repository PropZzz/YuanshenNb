import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "@/components/ui/reference-icons";
import { apiClient, type ApiComponents } from "@/api/client";
import { ApiError } from "@/api/errors";
import { unwrap } from "@/api/unwrap";
import { queryKeys } from "@/api/query-keys";
import { displayDay, localDate, localDateTimeToISO, localInput, localTime, shiftDay } from "@/lib/datetime";
import { useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { DateTimeField } from "@/components/ui/date-time-field";
import { InlineError, Notice } from "@/components/ui/states";
import { loadLabels } from "@/features/calendar/queries";
import { tierLabels } from "@/features/energy/queries";
import { breakdownItems } from "./golden-window-card";

type Recommendation = ApiComponents["GoldenWindowRecommendation"];
type RoleMap = Record<string, "required" | "optional" | "excluded">;

export function MeetingPlanner({
  workspaceId,
  members,
  open = true,
  onClose,
  onRecommended,
  onConfirmed,
  onHighlight,
}: {
  open?: boolean;
  workspaceId: string;
  members: ApiComponents["WorkspaceMemberDTO"][];
  onClose: () => void;
  onRecommended: (result: ApiComponents["RecommendMeetingResponse"]) => void;
  onConfirmed: () => void;
  onHighlight?: (option: Recommendation) => void;
}) {
  const timezone = useAuthStore(s => s.user?.timezone ?? "Asia/Shanghai");
  const cache = useQueryClient();
  const today = localDate(new Date(), timezone);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [cognitiveLoad, setCognitiveLoad] = useState<ApiComponents["CognitiveLoad"]>("medium");
  const [fromValue, setFromValue] = useState(() => localInput(new Date(Date.now() + 15 * 60_000).toISOString(), timezone));
  const [toValue, setToValue] = useState(() => `${shiftDay(today, 7)}T18:00`);
  const [respectFocusShields, setRespectFocusShields] = useState(true);
  const [roles, setRoles] = useState<RoleMap>(() =>
    Object.fromEntries(members.map(m => [m.userId, "required"])),
  );

  const [request, setRequest] = useState<ApiComponents["RecommendMeetingRequest"]>();
  const [candidate, setCandidate] = useState<Recommendation>();
  const [validation, setValidation] = useState<unknown>(null);

  const recommendations = useMutation({
    mutationFn: async (body: ApiComponents["RecommendMeetingRequest"]) =>
      unwrap(
        await apiClient.POST("/api/v1/workspaces/{id}/meetings/recommend", {
          params: { path: { id: workspaceId } },
          body,
        }),
      ),
    onSuccess: onRecommended,
  });

  const confirm = useMutation({
    mutationFn: async () => {
      if (!request || !candidate) throw new Error("请先选择一个推荐窗口");
      return unwrap(
        await apiClient.POST("/api/v1/workspaces/{id}/meetings/confirm", {
          params: { path: { id: workspaceId } },
          body: {
            title: request.title,
            description: request.description,
            cognitiveLoad: request.cognitiveLoad,
            participantIds: request.participantIds,
            optionalIds: request.optionalIds,
            startAt: candidate.startAt,
            endAt: candidate.endAt,
            recommendationMeta: {
              rank: candidate.rank,
              score: candidate.score,
              breakdown: candidate.breakdown,
              explanationTags: candidate.explanationTags,
              summary: candidate.summary,
            },
          },
        }),
      );
    },
    onSuccess: () => {
      void Promise.all([
        cache.invalidateQueries({ queryKey: queryKeys.workspaces.meetings(workspaceId) }),
        cache.invalidateQueries({ queryKey: queryKeys.workspaces.availabilityRoot(workspaceId) }),
        cache.invalidateQueries({ queryKey: queryKeys.schedule.itemsRoot }),
        cache.invalidateQueries({ queryKey: queryKeys.energy.todayRoot }),
      ]);
      setCandidate(undefined);
      onConfirmed();
      onClose();
    },
  });

  function resetResults() {
    recommendations.reset();
    confirm.reset();
    setCandidate(undefined);
    setRequest(undefined);
    setValidation(null);
  }

  function buildAndSearch(overrides?: {
    toOverride?: string;
    shieldsOverride?: boolean;
    rolesOverride?: RoleMap;
  }) {
    setValidation(null);
    confirm.reset();
    try {
      const activeRoles = overrides?.rolesOverride ?? roles;
      const participantIds = members.filter(m => activeRoles[m.userId] === "required").map(m => m.userId);
      const optionalIds = members.filter(m => activeRoles[m.userId] === "optional").map(m => m.userId);
      if (!participantIds.length) throw new Error("请至少选择一名必需参会成员");
      const effectiveTo = overrides?.toOverride ?? toValue;
      const searchFrom = localDateTimeToISO(fromValue, timezone);
      const searchTo = localDateTimeToISO(effectiveTo, timezone);
      if (Date.parse(searchTo) <= Date.parse(searchFrom)) {
        throw new Error("搜索结束时间需要晚于开始时间");
      }
      const body: ApiComponents["RecommendMeetingRequest"] = {
        title: title.trim(),
        description,
        durationMinutes,
        cognitiveLoad,
        participantIds,
        optionalIds,
        searchFrom,
        searchTo,
        respectFocusShields: overrides?.shieldsOverride ?? respectFocusShields,
        maxResults: 3,
      };
      setRequest(body);
      recommendations.mutate(body);
    } catch (error) {
      setValidation(error);
    }
  }

  function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    buildAndSearch();
  }

  function extendSearchThreeDays() {
    const baseDay = toValue.slice(0, 10) || today;
    const nextTo = `${shiftDay(baseDay, 3)}T${toValue.slice(11, 16) || "18:00"}`;
    setToValue(nextTo);
    buildAndSearch({ toOverride: nextTo });
  }

  function relaxFocusShields() {
    setRespectFocusShields(false);
    buildAndSearch({ shieldsOverride: false });
  }

  function makeMemberOptional(userId: string) {
    const nextRoles: RoleMap = { ...roles, [userId]: "optional" };
    setRoles(nextRoles);
    buildAndSearch({ rolesOverride: nextRoles });
  }

  const requiredCount = members.filter(m => roles[m.userId] === "required").length;
  const isConfirmConflict =
    confirm.error instanceof ApiError &&
    (confirm.error.status === 409 || confirm.error.code === "CONFLICT");

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={isOpen => {
          if (!isOpen && !confirm.isPending) onClose();
        }}
        title="寻找黄金协作窗口"
        description={`按 ${timezone} 显示。服务端综合成员工作时间、精力档位与专注保护，推荐最多三个窗口。`}
        width={760}
        className="team-meeting-drawer"
      >
        <form onSubmit={preview} className="form-stack">
          <div className="form-grid">
            <label className="field">
              会议主题
              <input
                name="title"
                required
                maxLength={200}
                value={title}
                onChange={e => {
                  setTitle(e.target.value);
                  resetResults();
                }}
                placeholder="这次会议希望达成什么？"
                autoFocus
              />
            </label>
            <label className="field">
              会议时长
              <select
                name="duration"
                value={durationMinutes}
                onChange={e => {
                  setDurationMinutes(Number(e.target.value));
                  resetResults();
                }}
              >
                {[15, 30, 45, 60, 90, 120, 180, 240].map(n => (
                  <option key={n} value={n}>
                    {n} 分钟
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid">
            <DateTimeField
              label="搜索开始时间"
              name="from"
              required
              value={fromValue}
              onChange={val => {
                setFromValue(val);
                resetResults();
              }}
            />
            <DateTimeField
              label="搜索结束时间"
              name="to"
              required
              value={toValue}
              onChange={val => {
                setToValue(val);
                resetResults();
              }}
            />
          </div>

          <div className="form-grid">
            <label className="field">
              会议认知负荷
              <select
                name="load"
                value={cognitiveLoad}
                onChange={e => {
                  setCognitiveLoad(e.target.value as ApiComponents["CognitiveLoad"]);
                  resetResults();
                }}
              >
                {Object.entries(loadLabels).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              会议说明（可选）
              <input
                name="description"
                value={description}
                onChange={e => {
                  setDescription(e.target.value);
                  resetResults();
                }}
                placeholder="议题、材料或准备事项"
              />
            </label>
          </div>

          <fieldset className="meeting-members">
            <legend>
              参会成员 <span>至少一位必需成员，可选成员单独标注</span>
            </legend>
            {members.map(member => (
              <label key={member.userId}>
                <span className="avatar">{member.displayName.slice(0, 1)}</span>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>{member.timezone}</small>
                </span>
                <select
                  aria-label={`${member.displayName}的参会要求`}
                  value={roles[member.userId] ?? "excluded"}
                  onChange={e => {
                    setRoles(s => ({ ...s, [member.userId]: e.target.value as RoleMap[string] }));
                    resetResults();
                  }}
                >
                  <option value="required">必需参会</option>
                  <option value="optional">可选参会</option>
                  <option value="excluded">不参与</option>
                </select>
              </label>
            ))}
          </fieldset>

          <label className="meeting-shield">
            <input
              type="checkbox"
              name="shields"
              checked={respectFocusShields}
              onChange={e => {
                setRespectFocusShields(e.target.checked);
                resetResults();
              }}
            />
            <ShieldCheck size={16} />
            尊重成员的深度专注保护窗口
          </label>

          <InlineError error={validation ?? recommendations.error} />
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" pending={recommendations.isPending}>
              <Sparkles size={15} />
              计算黄金窗口
            </Button>
          </div>
        </form>

        {recommendations.data && (
          <section className="meeting-results">
            <div className="flex items-center justify-between gap-2">
              <h3>
                为「{request?.title}」找到 {recommendations.data.recommendations.length} 个窗口
              </h3>
              <span className="badge">预览不会创建会议</span>
            </div>

            {recommendations.data.recommendations.length === 0 ? (
              <div className="meeting-diagnostics">
                <h4>这个范围内暂时没有合法窗口</h4>
                {recommendations.data.blockingDiagnostics.map((d, i) => (
                  <div key={i} className="meeting-diagnostic-card">
                    <div className="meeting-diagnostic-head">
                      <strong>{d.message}</strong>
                      {d.day && <span className="badge">{d.day}</span>}
                    </div>
                    <p>{d.suggestedAction}</p>
                    {d.blockingDisplayNames.length > 0 && (
                      <div className="meeting-diagnostic-members">
                        <span>涉及成员：</span>
                        {d.blockingDisplayNames.map((name, idx) => (
                          <span key={d.blockingUserIds[idx] ?? name} className="badge">
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                    {requiredCount > 1 && d.blockingUserIds.some(id => roles[id] === "required") && (
                      <div className="meeting-diagnostic-actions">
                        {d.blockingUserIds
                          .filter(id => roles[id] === "required")
                          .map((uid, idx) => {
                            const labelName =
                              d.blockingDisplayNames[idx] ??
                              members.find(m => m.userId === uid)?.displayName ??
                              "该成员";
                            return (
                              <Button
                                key={uid}
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => makeMemberOptional(uid)}
                              >
                                将 {labelName} 改为可选并重试
                              </Button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                ))}

                <div className="meeting-diagnostic-actions">
                  <Button type="button" size="sm" variant="outline" onClick={extendSearchThreeDays}>
                    <RefreshCw size={13} /> 延长搜索 +3 天
                  </Button>
                  {respectFocusShields && (
                    <Button type="button" size="sm" variant="outline" onClick={relaxFocusShields}>
                      <ShieldCheck size={13} /> 关闭保护盾重试
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="meeting-candidates">
                {recommendations.data.recommendations.map(option => (
                  <article key={option.rank} className={option.rank === 1 ? "best-candidate" : ""}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="badge">Top {option.rank}</span>
                      <strong>
                        {option.score}
                        <small> /100</small>
                      </strong>
                    </div>
                    <h4>
                      {displayDay(localDate(option.startAt, timezone), {
                        month: "long",
                        day: "numeric",
                        weekday: "short",
                      })}
                    </h4>
                    <time>
                      {localTime(option.startAt, timezone)} — {localTime(option.endAt, timezone)}
                    </time>
                    <p>{option.summary}</p>

                    <div className="meeting-candidate-breakdown">
                      {breakdownItems(option.breakdown).map(item => (
                        <div key={item.key} className="meeting-breakdown-item">
                          <span>{item.label}</span>
                          <div className="meeting-breakdown-bar">
                            <span style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }} />
                          </div>
                          <b>{item.value}%</b>
                        </div>
                      ))}
                    </div>

                    {option.explanationTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {option.explanationTags.map(tag => (
                          <span className={`badge badge-tone-${tag.tone}`} key={tag.code}>
                            {tag.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {option.affectedMembers.length > 0 && (
                      <div className="meeting-affected-members">
                        {option.affectedMembers.map(member => (
                          <span
                            key={member.userId}
                            className={`badge ${
                              member.breaksFocusShield || member.causesContinuousOverload ? "badge-warn" : ""
                            }`}
                          >
                            {member.displayName}
                            {member.energyTier ? ` · ${tierLabels[member.energyTier]}` : ""}
                            {member.breaksFocusShield ? " · 破盾" : ""}
                            {member.causesContinuousOverload ? " · 连续过载" : ""}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="meeting-candidate-actions">
                      {onHighlight && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onHighlight(option)}
                        >
                          在时间轴高亮
                        </Button>
                      )}
                      <Button
                        variant={option.rank === 1 ? "secondary" : "outline"}
                        onClick={() => {
                          confirm.reset();
                          setCandidate(option);
                          onHighlight?.(option);
                        }}
                      >
                        预览并确认
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </Drawer>

      <Dialog
        open={!!candidate}
        onOpenChange={isOpen => {
          if (!isOpen && !confirm.isPending) setCandidate(undefined);
        }}
        title="确认这个会议窗口？"
        description="确认后会原子创建参会日程并通知成员；服务端会再次检查冲突。"
      >
        <div className="meeting-confirm-summary">
          <CalendarCheck size={26} />
          <h3>{request?.title}</h3>
          <p>
            {candidate &&
              `${displayDay(localDate(candidate.startAt, timezone))} · ${localTime(
                candidate.startAt,
                timezone,
              )}–${localTime(candidate.endAt, timezone)}`}
          </p>
          <small>
            {timezone} · {request?.durationMinutes} 分钟
          </small>
        </div>
        <Notice>
          <Check size={14} />
          必需 {request?.participantIds.length ?? 0} 人 · 可选 {request?.optionalIds?.length ?? 0}{" "}
          人。冲突时会阻止创建，请重新计算。
        </Notice>
        {isConfirmConflict && (
          <div className="meeting-conflict-alert" role="status">
            <AlertTriangle size={15} />
            <span>成员在此期间新增了日程占用，当前窗口已失效。请重新求解最新候选窗口。</span>
          </div>
        )}
        <InlineError error={confirm.error} />
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => setCandidate(undefined)}
          >
            返回比较
          </Button>
          {isConfirmConflict && request ? (
            <Button
              variant="secondary"
              onClick={() => {
                setCandidate(undefined);
                confirm.reset();
                recommendations.mutate(request);
              }}
            >
              <RefreshCw size={15} />
              重新求解候选窗口
            </Button>
          ) : (
            <Button
              variant="secondary"
              pending={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              <Clock3 size={15} />
              确认创建会议
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
