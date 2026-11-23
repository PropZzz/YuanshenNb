import { useEffect, useRef } from "react";
import { Circle, LockKeyhole, ShieldCheck, Sparkles } from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { dayRange, localDate, localDateTimeToISO, localTime, minuteLabel } from "@/lib/datetime";
import { tierLabels } from "@/features/energy/queries";
import "./team-time-map.css";

type Member = ApiComponents["MemberAvailabilityView"];
type Slot = ApiComponents["AvailabilitySlot"];
type HighlightWindow = ApiComponents["GoldenWindowRecommendation"];

const HOUR_MS = 3_600_000;
const HOUR_WIDTH = 64;
const slotLabels = { busy: "忙碌", focus_shield: "深度专注保护", soft_busy: "可协商安排" } as const;

// Display geometry only: preserve all server intervals and separate overlaps into rows.
function projectSlots(slots: Slot[], from: number, to: number) {
  const ends: number[] = [];
  return slots
    .map(slot => ({
      slot,
      start: Math.max(from, Date.parse(slot.startAt)),
      end: Math.min(to, Date.parse(slot.endAt)),
    }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map(item => {
      let lane = ends.findIndex(end => end <= item.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = item.end;
      return {
        ...item,
        lane,
        left: ((item.start - from) / (to - from)) * 100,
        width: ((item.end - item.start) / (to - from)) * 100,
      };
    });
}

function isoMinuteOnMemberDay(day: string, minute: number, memberTz: string): number {
  const clamped = Math.max(0, Math.min(1440, minute));
  if (clamped === 1440) {
    const startMs = Date.parse(localDateTimeToISO(`${day}T00:00`, memberTz));
    return startMs + 86_400_000;
  }
  return Date.parse(localDateTimeToISO(`${day}T${minuteLabel(clamped)}`, memberTz));
}

function computeOffHoursSegments(
  from: number,
  to: number,
  member: Member,
): Array<{ left: number; width: number }> {
  try {
    if (member.workStartMinute <= 0 && member.workEndMinute >= 1440) return [];
    const candidateDays = Array.from(
      new Set([
        localDate(from, member.timezone),
        localDate(from + (to - from) / 2, member.timezone),
        localDate(to - 1000, member.timezone),
      ]),
    );
    const working: Array<[number, number]> = [];
    for (const mDay of candidateDays) {
      const ws = isoMinuteOnMemberDay(mDay, member.workStartMinute, member.timezone);
      const we = isoMinuteOnMemberDay(mDay, member.workEndMinute, member.timezone);
      const clippedStart = Math.max(from, ws);
      const clippedEnd = Math.min(to, we);
      if (clippedEnd > clippedStart) {
        working.push([clippedStart, clippedEnd]);
      }
    }
    working.sort((a, b) => a[0] - b[0]);

    const off: Array<[number, number]> = [];
    let cursor = from;
    for (const [ws, we] of working) {
      if (ws > cursor) off.push([cursor, ws]);
      cursor = Math.max(cursor, we);
    }
    if (cursor < to) off.push([cursor, to]);

    const span = Math.max(1, to - from);
    return off.map(([start, end]) => ({
      left: ((start - from) / span) * 100,
      width: ((end - start) / span) * 100,
    }));
  } catch {
    return [];
  }
}

export function TeamTimeMap({
  members,
  day,
  timezone,
  highlightedWindow,
}: {
  members: Member[];
  day: string;
  timezone: string;
  highlightedWindow?: HighlightWindow;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const range = dayRange(day, timezone);
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const span = Math.max(1, to - from);
  const hours = span / HOUR_MS;
  const timelineWidth = hours * HOUR_WIDTH;
  const ticks = Array.from({ length: Math.ceil(hours) + 1 }, (_, index) => Math.min(to, from + index * HOUR_MS));

  const goldenOverlay = (() => {
    if (!highlightedWindow) return null;
    const gs = Math.max(from, Date.parse(highlightedWindow.startAt));
    const ge = Math.min(to, Date.parse(highlightedWindow.endAt));
    if (!(ge > gs)) return null;
    return {
      left: ((gs - from) / span) * 100,
      width: ((ge - gs) / span) * 100,
      rank: highlightedWindow.rank,
      score: highlightedWindow.score,
      period: `${localTime(highlightedWindow.startAt, timezone)}–${localTime(highlightedWindow.endAt, timezone)}`,
    };
  })();

  useEffect(() => {
    if (scroll.current) {
      if (goldenOverlay) {
        const px = (goldenOverlay.left / 100) * timelineWidth;
        scroll.current.scrollLeft = Math.max(0, px - 120);
      } else {
        scroll.current.scrollLeft = 8 * HOUR_WIDTH;
      }
    }
  }, [day, timezone, goldenOverlay?.left, timelineWidth]);

  if (members.length === 0) return <p className="team-map-empty">暂时没有可展示的共享安排。</p>;

  return (
    <div className="team-time-map">
      <div className="team-map-legend" aria-label="共享安排图例">
        <span><i className="busy" />忙碌</span>
        <span><i className="focus_shield" />深度专注保护</span>
        <span><i className="soft_busy" />可协商安排</span>
        <span><i className="offhours" />非工作时段</span>
        <span><i className="energy_peak" />精力高峰（仅非隐私隐藏）</span>
      </div>
      <div ref={scroll} className="team-map-scroll" role="region" tabIndex={0} aria-label="横向滚动查看全天共享安排">
        <table className="team-map-table" aria-label="成员共享日程时间轴" style={{ width: timelineWidth + 156 }}>
          <colgroup>
            <col style={{ width: 156 }} />
            <col style={{ width: timelineWidth }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="team-map-name">
                成员<span>{hours} 小时 · {timezone}</span>
              </th>
              <th scope="col" className="team-map-axis-cell">
                <span className="sr-only">所选日期的本地时间刻度</span>
                <div className="team-map-axis">
                  {goldenOverlay && (
                    <div
                      className="team-map-golden-header"
                      style={{ left: `${goldenOverlay.left}%`, width: `${Math.max(goldenOverlay.width, 4)}%` }}
                    >
                      <span>
                        <Sparkles size={11} /> Top {goldenOverlay.rank} · {goldenOverlay.score} 分
                      </span>
                    </div>
                  )}
                  {ticks.map((at, index) => (
                    <time
                      key={at}
                      dateTime={new Date(at).toISOString()}
                      style={{ left: `${((at - from) / span) * 100}%` }}
                      className={index === 0 ? "first" : index === ticks.length - 1 ? "last" : undefined}
                      title={new Intl.DateTimeFormat("zh-CN", {
                        timeZone: timezone,
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZoneName: "shortOffset",
                      }).format(at)}
                    >
                      {at === to ? "24:00" : localTime(at, timezone)}
                    </time>
                  ))}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => {
              const slots = projectSlots(member.slots, from, to);
              const lanes = Math.max(1, ...slots.map(slot => slot.lane + 1));
              const offHours = computeOffHoursSegments(from, to, member);
              const canShowEnergy = member.privacyLevel !== "busy_only";
              const energyBuckets = canShowEnergy
                ? (member.energyBuckets ?? [])
                    .map(bucket => {
                      const bs = Math.max(from, Date.parse(bucket.hourStartAt));
                      const be = Math.min(to, Date.parse(bucket.hourStartAt) + HOUR_MS);
                      return { bucket, start: bs, end: be };
                    })
                    .filter(b => b.end > b.start)
                : [];

              return (
                <tr key={member.userId}>
                  <th scope="row" className="team-map-name">
                    <div className="team-map-member-head">
                      <strong title={member.displayName}>{member.displayName}</strong>
                      {member.privacyLevel === "busy_only" && (
                        <span className="team-map-lock-pill" title="该成员仅共享忙闲，精力档位已脱敏">
                          <LockKeyhole size={10} />
                        </span>
                      )}
                    </div>
                    <span>
                      {minuteLabel(member.workStartMinute)}–{minuteLabel(member.workEndMinute)} · {member.timezone}
                    </span>
                  </th>
                  <td className="team-map-slots-cell">
                    <div
                      className="team-map-track"
                      style={{ height: lanes * 42 + 16, backgroundSize: `${HOUR_WIDTH}px 100%` }}
                    >
                      {offHours.map((seg, i) => (
                        <div
                          key={`off-${i}`}
                          className="team-map-offhours"
                          aria-hidden="true"
                          style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                        />
                      ))}

                      {energyBuckets.map(({ bucket, start, end }, idx) => (
                        <div
                          key={`energy-${bucket.hourStartAt}-${idx}`}
                          className={`team-map-energy-bucket tier-${bucket.tier}`}
                          data-energy-tier={bucket.tier}
                          title={`精力档位：${tierLabels[bucket.tier]}（${localTime(bucket.hourStartAt, timezone)}）`}
                          style={{
                            left: `${((start - from) / span) * 100}%`,
                            width: `${((end - start) / span) * 100}%`,
                          }}
                        />
                      ))}

                      {goldenOverlay && (
                        <div
                          className="team-map-golden-overlay"
                          data-golden-rank={goldenOverlay.rank}
                          aria-label={`高亮候选窗口 Top ${goldenOverlay.rank}（${goldenOverlay.period}）`}
                          style={{
                            left: `${goldenOverlay.left}%`,
                            width: `${goldenOverlay.width}%`,
                          }}
                        />
                      )}

                      {slots.map(({ slot, lane, left, width }, index) => {
                        const label =
                          member.privacyLevel === "full_title" && slot.title
                            ? slot.title
                            : slotLabels[slot.kind];
                        const period = `${localTime(slot.startAt, timezone)}–${localTime(slot.endAt, timezone)}`;
                        const Icon =
                          slot.kind === "focus_shield" ? ShieldCheck : slot.kind === "busy" ? LockKeyhole : Circle;
                        return (
                          <div
                            key={`${slot.startAt}-${index}`}
                            className={`team-map-slot ${slot.kind}`}
                            role="group"
                            tabIndex={0}
                            aria-label={`${label}，${period}，${slotLabels[slot.kind]}`}
                            title={`${label} · ${period} · ${slotLabels[slot.kind]}`}
                            style={{ left: `${left}%`, width: `${width}%`, top: lane * 42 + 8 }}
                          >
                            <span>
                              <Icon size={11} />
                              <strong>{label}</strong>
                            </span>
                            <time>{period}</time>
                          </div>
                        );
                      })}
                      {slots.length === 0 && <span className="team-map-no-slots">没有共享占用记录</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="team-map-note">
        仅展示已授权的占用记录与精力档位背景；对「仅忙闲」成员始终隐藏精力档位与日程标题，未显示占用不代表全天空闲。
      </p>
    </div>
  );
}
