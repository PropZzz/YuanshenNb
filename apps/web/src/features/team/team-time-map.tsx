import { useEffect, useRef } from "react";
import { Circle, LockKeyhole, ShieldCheck } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { dayRange, localTime } from "@/lib/datetime";
import "./team-time-map.css";

type Member = ApiComponents["MemberAvailabilityView"];
type Slot = ApiComponents["AvailabilitySlot"];
const HOUR_MS = 3_600_000;
const HOUR_WIDTH = 64;
const slotLabels = { busy: "忙碌", focus_shield: "深度专注保护", soft_busy: "可协商安排" } as const;

// Display geometry only: preserve all server intervals and separate overlaps into rows.
function projectSlots(slots: Slot[], from: number, to: number) {
  const ends: number[] = [];
  return slots.map(slot => ({ slot, start: Math.max(from, Date.parse(slot.startAt)), end: Math.min(to, Date.parse(slot.endAt)) }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(item => {
      let lane = ends.findIndex(end => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.end;
      return { ...item, lane, left: (item.start - from) / (to - from) * 100, width: (item.end - item.start) / (to - from) * 100 };
    });
}

export function TeamTimeMap({ members, day, timezone }: { members: Member[]; day: string; timezone: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const range = dayRange(day, timezone), from = Date.parse(range.from), to = Date.parse(range.to);
  const hours = (to - from) / HOUR_MS, timelineWidth = hours * HOUR_WIDTH;
  const ticks = Array.from({ length: Math.ceil(hours) + 1 }, (_, index) => Math.min(to, from + index * HOUR_MS));
  useEffect(() => { if (scroll.current) scroll.current.scrollLeft = Math.max(0, 7.5 * HOUR_WIDTH); }, [day, timezone]);
  if (members.length === 0) return <p className="team-map-empty">暂时没有可展示的共享安排。</p>;
  return <div className="team-time-map">
    <div className="team-map-legend" aria-label="共享安排图例">
      <span><i className="busy" />忙碌</span><span><i className="focus_shield" />深度专注保护</span><span><i className="soft_busy" />可协商安排</span>
    </div>
    <div ref={scroll} className="team-map-scroll" role="region" tabIndex={0} aria-label="横向滚动查看全天共享安排">
      <table className="team-map-table" aria-label="成员共享日程时间轴" style={{ width: timelineWidth + 136 }}>
        <colgroup><col style={{ width: 136 }} /><col style={{ width: timelineWidth }} /></colgroup>
        <thead><tr><th scope="col" className="team-map-name">成员<span>{hours} 小时 · {timezone}</span></th><th scope="col" className="team-map-axis-cell"><span className="sr-only">所选日期的本地时间刻度</span><div className="team-map-axis">
          {ticks.map((at, index) => <time key={at} dateTime={new Date(at).toISOString()} style={{ left: `${(at - from) / (to - from) * 100}%` }} className={index === 0 ? "first" : index === ticks.length - 1 ? "last" : undefined} title={new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" }).format(at)}>{at === to ? "24:00" : localTime(at, timezone)}</time>)}
        </div></th></tr></thead>
        <tbody>{members.map(member => {
          const slots = projectSlots(member.slots, from, to), lanes = Math.max(1, ...slots.map(slot => slot.lane + 1));
          return <tr key={member.userId}><th scope="row" className="team-map-name"><strong title={member.displayName}>{member.displayName}</strong><span>{member.timezone}</span></th><td className="team-map-slots-cell">
            <div className="team-map-track" style={{ height: lanes * 42 + 12, backgroundSize: `${HOUR_WIDTH}px 100%` }}>
              {slots.map(({ slot, lane, left, width }, index) => {
                const label = member.privacyLevel === "full_title" && slot.title ? slot.title : slotLabels[slot.kind];
                const period = `${localTime(slot.startAt, timezone)}–${localTime(slot.endAt, timezone)}`;
                const Icon = slot.kind === "focus_shield" ? ShieldCheck : slot.kind === "busy" ? LockKeyhole : Circle;
                return <div key={`${slot.startAt}-${index}`} className={`team-map-slot ${slot.kind}`} role="group" tabIndex={0} aria-label={`${label}，${period}，${slotLabels[slot.kind]}`} title={`${label} · ${period} · ${slotLabels[slot.kind]}`} style={{ left: `${left}%`, width: `${width}%`, top: lane * 42 + 6 }}><span><Icon size={11} /><strong>{label}</strong></span><time>{period}</time></div>;
              })}
              {slots.length === 0 && <span className="team-map-no-slots">没有共享占用记录</span>}
            </div>
          </td></tr>;
        })}</tbody>
      </table>
    </div>
    <p className="team-map-note">仅展示已授权的占用记录；未显示占用不代表全天空闲。横向滚动可查看全天，聚焦时间块可读取完整信息。</p>
  </div>;
}
