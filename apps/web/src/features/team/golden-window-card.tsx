import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, Sparkles } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { Button } from "@/components/ui/button";
import { displayDay, localDate, localTime } from "@/lib/datetime";
import { tierLabels } from "@/features/energy/queries";
import "./golden-window-card.css";

type WindowRec = ApiComponents["GoldenWindowRecommendation"];

type Props = {
  result?: ApiComponents["RecommendMeetingResponse"];
  timezone: string;
  canPlan: boolean;
  onPlan: () => void;
  onSelectWindow?: (window: WindowRec) => void;
};

export function breakdownItems(b: ApiComponents["ScoreBreakdown"]) {
  return [
    { key: "energyMatchScore", label: "精力匹配", value: Math.round(b.energyMatchScore) },
    { key: "focusShieldScore", label: "专注保护", value: Math.round(b.focusShieldScore) },
    { key: "compactnessScore", label: "日程紧凑", value: Math.round(b.compactnessScore) },
    { key: "earlinessScore", label: "尽早安排", value: Math.round(b.earlinessScore) },
    { key: "optionalAttendanceRatio", label: "可选出席", value: Math.round(b.optionalAttendanceRatio * 100) },
  ];
}

export function GoldenWindowCard({ result, timezone, canPlan, onPlan, onSelectWindow }: Props) {
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    setSelected(0);
  }, [result]);

  const windows = result?.recommendations ?? [];
  const current = windows[selected] ?? windows[0];

  function selectIndex(index: number, window: WindowRec) {
    setSelected(index);
    onSelectWindow?.(window);
  }

  return (
    <section className="team-golden-card" aria-label="黄金协作窗口">
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <span className="golden-tag">
          <Sparkles size={13} />
          {current ? `TOP ${current.rank} · 黄金协作窗口` : "GOLDEN FOCUS WINDOW"}
        </span>
        {current && <span className="golden-score">综合匹配 {current.score}/100</span>}
      </div>

      <h2 aria-live="polite">
        {current ? (
          <>
            {displayDay(localDate(current.startAt, timezone), { month: "numeric", day: "numeric" })}{" "}
            <time>
              {localTime(current.startAt, timezone)} — {localTime(current.endAt, timezone)}
            </time>
          </>
        ) : result ? (
          "这个范围内暂时没有合法窗口"
        ) : (
          "找到彼此都合适的那段时间"
        )}
      </h2>

      <p className="golden-summary">
        {current?.summary ??
          (result
            ? "可尝试延长搜索日期、缩短会议，或调整可选参会成员后重新比较。"
            : "在成员工作时段内，避开固定安排与专注保护。综合精力档位与日程分布，比较最多三个可行窗口。")}
      </p>

      {current && (
        <div className="golden-explain">
          <div className="golden-breakdown" aria-label="五维评分分解">
            {breakdownItems(current.breakdown).map(item => (
              <div key={item.key} className="golden-breakdown-row">
                <div className="golden-breakdown-label">
                  <span>{item.label}</span>
                  <strong>{item.value}%</strong>
                </div>
                <div className="golden-breakdown-track" aria-hidden="true">
                  <span style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }} />
                </div>
              </div>
            ))}
          </div>

          {current.explanationTags.length > 0 && (
            <div className="golden-tags" aria-label="可解释标签">
              {current.explanationTags.map(tag => (
                <span key={tag.code} className={`golden-explain-tag tone-${tag.tone}`}>
                  {tag.label}
                </span>
              ))}
            </div>
          )}

          {current.affectedMembers.length > 0 && (
            <div className="golden-members" aria-label="成员影响评估">
              {current.affectedMembers.map(member => (
                <span
                  key={member.userId}
                  className={`golden-member-chip ${
                    member.breaksFocusShield || member.causesContinuousOverload ? "has-warning" : ""
                  }`}
                >
                  <strong>{member.displayName}</strong>
                  {!member.required && <small>可选</small>}
                  {member.energyTier && <small className={`tier-dot-${member.energyTier}`}>{tierLabels[member.energyTier]}</small>}
                  {member.breaksFocusShield && (
                    <small className="chip-warn">
                      <AlertTriangle size={10} /> 触碰专注保护
                    </small>
                  )}
                  {member.causesContinuousOverload && (
                    <small className="chip-warn">
                      <AlertTriangle size={10} /> 连续负荷偏高
                    </small>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {windows.length > 1 && (
        <div className="golden-window-switcher" role="group" aria-label="推荐窗口切换">
          {windows.map((window, index) => (
            <button
              key={window.rank}
              type="button"
              aria-label={`查看第 ${window.rank} 推荐窗口`}
              aria-pressed={current === window}
              onClick={() => selectIndex(index, window)}
            >
              <span>
                Top {window.rank} · {window.score}分
              </span>
              <time>
                {localTime(window.startAt, timezone)}–{localTime(window.endAt, timezone)}
              </time>
            </button>
          ))}
        </div>
      )}

      <div className="golden-footer">
        <span>
          <ShieldCheck size={15} />
          比较只切换预览，排会仍需明确确认
        </span>
        <Button variant="secondary" onClick={onPlan} disabled={!canPlan}>
          <Sparkles size={15} />
          发起智能排会
        </Button>
      </div>
    </section>
  );
}
