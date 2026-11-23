import { useEffect, useState, type FormEvent } from "react";
import {
  Bell,
  Check,
  Clock3,
  HeartPulse,
  Info,
  Plus,
  Sparkles,
  Wind,
} from "@/components/ui/reference-icons";
import type { ApiComponents } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Dialog } from "@/components/ui/dialog";
import { InlineError, Notice } from "@/components/ui/states";
import { localDate, localTime } from "@/lib/datetime";
import "./mood-journal.css";

const emotions = [
  { value: "Serene", label: "平静" },
  { value: "Focused", label: "专注" },
  { value: "Fatigued", label: "轻微疲倦" },
  { value: "Anxious", label: "焦虑烦躁" },
  { value: "Exhausted", label: "深度倦怠" },
] as const;

type Emotion = (typeof emotions)[number]["value"];
type MoodEntry = { id: string; at: string; emotion: Emotion; note: string; kind: "checkin" | "breathing" };

function validEntry(value: unknown): value is MoodEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MoodEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.at === "string" &&
    Number.isFinite(Date.parse(entry.at)) &&
    emotions.some(emotion => emotion.value === entry.emotion) &&
    typeof entry.note === "string" &&
    (entry.kind === "checkin" || entry.kind === "breathing")
  );
}

export function useLocalMoodJournal(userId: string) {
  const storageKey = `shixu:mood-journal:${userId}`;
  const [state, setState] = useState<{ owner: string; entries: MoodEntry[] }>({
    owner: storageKey,
    entries: [],
  });
  const [error, setError] = useState<unknown>(null);
  const entries = state.owner === storageKey ? state.entries : [];

  useEffect(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      setState({
        owner: storageKey,
        entries: Array.isArray(raw) ? raw.filter(validEntry).slice(0, 500) : [],
      });
      setError(null);
    } catch {
      setState({ owner: storageKey, entries: [] });
      setError(new Error("无法读取此浏览器的心情记录。记录未同步到服务器。"));
    }
  }, [storageKey]);

  function record(emotion: Emotion, note: string, kind: MoodEntry["kind"] = "checkin") {
    const id =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const entry: MoodEntry = {
      id,
      at: new Date().toISOString(),
      emotion,
      note: note.trim().slice(0, 1000),
      kind,
    };
    try {
      const next = [entry, ...entries].slice(0, 500);
      localStorage.setItem(storageKey, JSON.stringify(next));
      setState({ owner: storageKey, entries: next });
      setError(null);
      return true;
    } catch {
      setError(new Error("本机记录保存失败，请检查浏览器存储权限。此条尚未保存。"));
      return false;
    }
  }

  return { entries, record, error };
}

type Journal = ReturnType<typeof useLocalMoodJournal>;

export function MoodCheckIn({
  journal,
  timezone,
  day,
}: {
  journal: Journal;
  timezone: string;
  day: string;
}) {
  const [selected, setSelected] = useState<Emotion>("Focused");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const todayCount = journal.entries.filter(entry => localDate(entry.at, timezone) === day).length;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (journal.record(selected, note)) {
      setNote("");
      setSaved(true);
    }
  }

  return (
    <article className="mood-checkin">
      <header>
        <div>
          <h2>即时心境打卡记录</h2>
          <p>选择当下感受，记录仅保存在此浏览器，不改变服务端精力分数。</p>
        </div>
        <span>今日 {todayCount} 次 · 仅本机</span>
      </header>
      <div className="mood-options" aria-label="选择当下心境">
        {emotions.map(emotion => (
          <button
            type="button"
            key={emotion.value}
            className={`mood-option mood-${emotion.value} ${selected === emotion.value ? "selected" : ""}`}
            aria-label={`${emotion.label} ${emotion.value}`}
            aria-pressed={selected === emotion.value}
            onClick={() => {
              setSelected(emotion.value);
              setSaved(false);
            }}
          >
            <i />
            <strong>{emotion.label}</strong>
            <small>{emotion.value}</small>
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="mood-note-form">
        <label className="sr-only" htmlFor="mood-note-input">
          添加状态笔记
        </label>
        <input
          id="mood-note-input"
          value={note}
          maxLength={1000}
          onChange={event => {
            setNote(event.target.value);
            setSaved(false);
          }}
          autoComplete="off"
          placeholder="添加简短状态笔记，记录此刻的感受…"
        />
        <Button type="submit" variant="secondary">
          <Check size={15} />
          记录打卡
        </Button>
      </form>
      <InlineError error={journal.error} />
      {saved && (
        <p role="status" className="mood-save-note">
          已保存到此浏览器，未上传服务器。
        </p>
      )}
    </article>
  );
}

export function MoodTimeline({
  journal,
  timezone,
  day,
  onAdd,
}: {
  journal: Journal;
  timezone: string;
  day: string;
  onAdd: () => void;
}) {
  const [selected, setSelected] = useState<MoodEntry>();
  const entries = journal.entries.filter(entry => localDate(entry.at, timezone) === day);

  return (
    <>
      <section className="mood-timeline">
        <header>
          <div>
            <h2>今日打卡流水</h2>
            <p>心境与恢复练习 · 仅此账户在本机的记录</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Plus size={15} />
            补记一条
          </Button>
        </header>
        <div className="mood-timeline-list">
          {entries.length ? (
            entries.map(entry => (
              <button
                type="button"
                className="mood-log"
                key={entry.id}
                aria-label="查看打卡详情"
                onClick={() => setSelected(entry)}
              >
                <div>
                  <time dateTime={entry.at}>{localTime(entry.at, timezone)}</time>
                  <span className={`mood-log-label mood-label-${entry.emotion}`}>
                    {emotions.find(emotion => emotion.value === entry.emotion)?.label}
                  </span>
                  <small>{entry.kind === "breathing" ? "恢复练习" : "仅本机"}</small>
                </div>
                <p>{entry.note || "无附带备注，已记录当下感受。"}</p>
              </button>
            ))
          ) : (
            <div className="mood-empty">
              <Sparkles size={22} />
              <strong>今天还没有心境记录</strong>
              <p>选择当下的感受，留下第一条只属于你的本机记录。</p>
            </div>
          )}
        </div>
        <footer>
          <Info size={14} />
          主观心境独立保存，不作为生理测量或调度算法输入。
        </footer>
      </section>

      <Drawer
        open={!!selected}
        onOpenChange={open => {
          if (!open) setSelected(undefined);
        }}
        title="心境打卡详情"
        description="此条仅保存在此浏览器，未上传或同步到其他设备。"
        width={420}
        className="mood-detail-drawer"
      >
        {selected && (
          <>
            <div className="mood-detail-heading">
              <span className={`mood-log-label mood-label-${selected.emotion}`}>
                {emotions.find(emotion => emotion.value === selected.emotion)?.label}
              </span>
              <time dateTime={selected.at}>
                {localDate(selected.at, timezone)} {localTime(selected.at, timezone)}
              </time>
            </div>
            <p className="mood-detail-note">{selected.note || "无附带备注。"}</p>
            <dl className="mood-detail-fields">
              <div>
                <dt>记录类型</dt>
                <dd>
                  {selected.kind === "breathing" ? "五分钟呼吸练习完成" : "主观心境打卡"}
                </dd>
              </div>
              <div>
                <dt>保存范围</dt>
                <dd>当前账号 · 当前浏览器本机</dd>
              </div>
              <div>
                <dt>展示时区</dt>
                <dd>{timezone}</dd>
              </div>
              <div>
                <dt>服务端精力分数</dt>
                <dd>未被此条主观记录修改</dd>
              </div>
            </dl>
          </>
        )}
      </Drawer>
    </>
  );
}

export function CareTools({
  journal,
  open,
  onOpenChange,
}: {
  journal: Journal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [deadline, setDeadline] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [snoozedUntil, setSnoozedUntil] = useState<number>();

  useEffect(() => {
    if ((!open || deadline === undefined) && snoozedUntil === undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [open, deadline, snoozedUntil]);

  const remaining = deadline === undefined ? 300 : Math.max(0, Math.ceil((deadline - now) / 1000));
  const elapsed = 300 - remaining;
  const phase =
    elapsed % 19 < 4 ? "缓慢吸气" : elapsed % 19 < 11 ? "舒适停顿" : "缓慢呼气";
  const phaseSeconds =
    elapsed % 19 < 4
      ? 4 - (elapsed % 19)
      : elapsed % 19 < 11
        ? 11 - (elapsed % 19)
        : 19 - (elapsed % 19);

  function close() {
    onOpenChange(false);
    setDeadline(undefined);
  }

  function complete() {
    if (
      deadline !== undefined &&
      remaining === 0 &&
      journal.record("Serene", "完成了 5 分钟呼吸节律练习。", "breathing")
    ) {
      close();
    }
  }

  return (
    <>
      <section
        className={`mood-care-strip ${snoozedUntil && snoozedUntil > now ? "mood-care-snoozed" : ""}`}
      >
        <span className="mood-care-icon">
          <HeartPulse size={20} />
        </span>
        <div>
          <h2>
            关怀与恢复建议 <span>仅本机辅助</span>
          </h2>
          <p>
            {snoozedUntil && snoozedUntil > now
              ? "已暂缓关怀提示，将在本页停留满 5 分钟后重新显示。不会发送系统推送。"
              : "为当下留一点恢复空间。可以尝试一段舒适的呼吸练习，或做一条心境打卡。"}
          </p>
        </div>
        <div className="mood-care-actions">
          <Button variant="ghost" onClick={() => onOpenChange(true)}>
            <Wind size={15} />
            启动 5m 极简呼吸
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="5分钟后在本页提醒"
            title="5分钟后在本页提醒"
            onClick={() => {
              setNow(Date.now());
              setSnoozedUntil(Date.now() + 300000);
            }}
          >
            <Bell size={15} />
          </Button>
        </div>
      </section>

      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) close();
        }}
        title="5分钟极简节律重置"
        description="按舒适的节奏呼吸，可以随时停止；这是本机计时练习，不会自动调整日程或精力分数。"
      >
        <div className="mood-breathing-guide">
          <div className={`mood-breath-circle ${deadline !== undefined && remaining > 0 ? "is-running" : ""}`}>
            <span>
              {deadline === undefined ? "5m" : remaining === 0 ? "完成" : `${phaseSeconds}s`}
            </span>
          </div>
          <strong>
            {deadline === undefined ? "准备好，再开始" : remaining === 0 ? "练习计时已完成" : phase}
          </strong>
          <time role="timer" aria-label="呼吸练习剩余时间">
            {String(Math.floor(remaining / 60)).padStart(2, "0")}:
            {String(remaining % 60).padStart(2, "0")}
          </time>
        </div>
        <Notice>
          <Clock3 size={14} />
          完成记录仅在五分钟计时结束且你确认后写入本机。提前关闭不会记录为完成。
        </Notice>
        <InlineError error={journal.error} />
        <div className="form-actions">
          {deadline === undefined ? (
            <Button
              variant="outline"
              onClick={() => {
                setNow(Date.now());
                setDeadline(Date.now() + 300000);
              }}
            >
              开始 5 分钟练习
            </Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              结束练习
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={deadline === undefined || remaining > 0}
            onClick={complete}
          >
            完成呼吸并记入恢复
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function MoodJournalDrawer({
  open,
  onOpenChange,
  journal,
  timezone,
  day,
  careOpen,
  onCareOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journal: Journal;
  timezone: string;
  day: string;
  careOpen: boolean;
  onCareOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={620}
      title="心境与呼吸辅助"
      description="仅保存于当前浏览器的主观感受打卡与 5 分钟呼吸练习，不改写服务端精力数据。"
      className="mood-drawer"
    >
      <div className="mood-drawer-stack">
        <MoodCheckIn journal={journal} timezone={timezone} day={day} />
        <CareTools journal={journal} open={careOpen} onOpenChange={onCareOpenChange} />
        <MoodTimeline
          journal={journal}
          timezone={timezone}
          day={day}
          onAdd={() => {
            document.getElementById("mood-note-input")?.focus();
            document.getElementById("mood-note-input")?.scrollIntoView?.({ behavior: "smooth", block: "center" });
          }}
        />
      </div>
    </Drawer>
  );
}

export function SourceDetails({
  energy,
  open,
  onOpenChange,
}: {
  energy: ApiComponents["EnergyTodayResponse"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const diagnostics = energy.diagnostics;
  const sources = {
    health_connect: "Health Connect",
    ble_gatt: "BLE 心率设备",
    replay_demo: "回放测试源",
  };
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={480}
      title="穿戴数据来源详情"
      description="以下字段直接来自本次服务端精力响应，不读取或连接新的硬件。"
      className="energy-source-drawer"
    >
      <dl className="mood-detail-fields">
        <div>
          <dt>当前数据来源</dt>
          <dd>{diagnostics.primarySource ? sources[diagnostics.primarySource] : "尚未收到可用穿戴样本"}</dd>
        </div>
        <div>
          <dt>计算日期与时区</dt>
          <dd>
            {energy.localDay} · {energy.timezone}
          </dd>
        </div>
        <div>
          <dt>最近计算时间</dt>
          <dd>{localTime(energy.computedAt, energy.timezone)}</dd>
        </div>
        <div>
          <dt>最近样本同步</dt>
          <dd>
            {diagnostics.lastSyncedAt
              ? `${localDate(diagnostics.lastSyncedAt, energy.timezone)} ${localTime(
                  diagnostics.lastSyncedAt,
                  energy.timezone,
                )}`
              : "尚未同步"}
          </dd>
        </div>
        <div>
          <dt>个人基线积累</dt>
          <dd>{diagnostics.baselineReadyDays} / 14 天</dd>
        </div>
        <div>
          <dt>HRV 基线</dt>
          <dd>
            {diagnostics.hrvBaselineMs === undefined ? "尚未建立" : `${diagnostics.hrvBaselineMs} ms`}
          </dd>
        </div>
        <div>
          <dt>静息心率基线</dt>
          <dd>
            {diagnostics.rhrBaselineBpm === undefined ? "尚未建立" : `${diagnostics.rhrBaselineBpm} bpm`}
          </dd>
        </div>
      </dl>
      <Notice>
        Android 端负责实际穿戴采集。网页不会将回放样本、主观心情或节律基线显示成实时硬件测量。
      </Notice>
    </Drawer>
  );
}
