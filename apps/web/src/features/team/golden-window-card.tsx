import { useEffect, useState } from "react";
import { ShieldCheck, Sparkles } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { Button } from "@/components/ui/button";
import { displayDay, localDate, localTime } from "@/lib/datetime";
import "./golden-window-card.css";

type Props = {
  result?: ApiComponents["RecommendMeetingResponse"];
  timezone: string;
  canPlan: boolean;
  onPlan: () => void;
};

export function GoldenWindowCard({ result, timezone, canPlan, onPlan }: Props) {
  const [selected, setSelected] = useState(0);
  useEffect(() => { setSelected(0); }, [result]);
  const windows = result?.recommendations ?? [];
  const current = windows[selected] ?? windows[0];
  return <section className="team-golden-card" aria-label="黄金协作窗口">
    <div className="flex justify-between items-center gap-2">
      <span className="golden-tag"><Sparkles size={13} />{current ? `TOP ${current.rank} · 黄金协作窗口` : "GOLDEN FOCUS WINDOW"}</span>
      {current && <span className="golden-score">综合匹配 {current.score}/100</span>}
    </div>
    <h2 aria-live="polite">{current ? <>{displayDay(localDate(current.startAt, timezone), { month: "numeric", day: "numeric" })} <time>{localTime(current.startAt, timezone)} — {localTime(current.endAt, timezone)}</time></> : result ? "这个范围内暂时没有合法窗口" : "找到彼此都合适的那段时间"}</h2>
    <p>{current?.summary ?? (result ? "可尝试延长搜索日期、缩短会议，或调整可选参会成员后重新比较。" : "在成员工作时段内，避开固定安排与专注保护。综合精力档位与日程分布，比较最多三个可行窗口。")}</p>
    {windows.length > 1 && <div className="golden-window-switcher" role="group" aria-label="推荐窗口切换">
      {windows.map((window, index) => <button key={window.rank} type="button" aria-label={`查看第 ${window.rank} 推荐窗口`} aria-pressed={current === window} onClick={() => setSelected(index)}>
        <span>Top {window.rank}</span><time>{localTime(window.startAt, timezone)}–{localTime(window.endAt, timezone)}</time>
      </button>)}
    </div>}
    <div className="golden-footer"><span><ShieldCheck size={15} />比较只切换预览，排会仍需明确确认</span><Button variant="secondary" onClick={onPlan} disabled={!canPlan}><Sparkles size={15} />发起智能排会</Button></div>
  </section>;
}
