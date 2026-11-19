package engine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
)

type rescueEngine struct{}

// NewRescueEngine returns an offline, deterministic preview solver. It never
// persists changes; applying or undoing a plan belongs to the service transaction.
func NewRescueEngine() RescueEngine { return rescueEngine{} }

type rescueJob struct {
	item    ScheduleItemSnapshot
	created bool
	urgent  bool
}
type rescuePlacement struct {
	job        rescueJob
	start, end time.Time
}
type rescuePlanner struct {
	ctx        context.Context
	in         RescueSolverInput
	loc        *time.Location
	start, end time.Time
	buffer     time.Duration
	originals  []rescueJob
}

func (rescueEngine) BuildOptions(ctx context.Context, in RescueSolverInput) (RescueSolverOutput, error) {
	out := RescueSolverOutput{LocalDay: in.LocalDay, BaselineVersion: in.BaselineVersion, Options: []RescueOptionPlan{}}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if in.Now.IsZero() {
		return out, fmt.Errorf("now must be explicit")
	}
	loc, err := validateProfile(in.Profile.WorkScheduleProfile)
	if err != nil {
		return out, err
	}
	start, end, err := RescueWindowUTC(in.LocalDay, in.Profile.Timezone)
	if err != nil {
		return out, err
	}
	if !in.Now.Before(end) {
		return out, fmt.Errorf("the selected 48-hour rescue horizon must not already have ended")
	}
	if in.TriggerReason != TriggerUrgentTask && in.TriggerReason != TriggerWearableFatigue && in.TriggerReason != TriggerTeamMeetingOverload {
		return out, fmt.Errorf("invalid rescue trigger")
	}
	if in.TriggerReason == TriggerUrgentTask && in.UrgentTask == nil {
		return out, fmt.Errorf("urgent_task trigger requires urgentTask")
	}
	if in.UrgentTask != nil {
		u := in.UrgentTask
		if u.Title == "" || u.DurationMinutes < 15 || u.DurationMinutes > 480 || !validLoad(u.CognitiveLoad) || !u.DeadlineAt.After(in.Now) {
			return out, fmt.Errorf("urgent task needs a title, a 15–480 minute duration, valid cognitive load and a future deadline")
		}
	}
	strategies := append([]RescueStrategy(nil), in.Strategies...)
	if len(strategies) == 0 {
		strategies = []RescueStrategy{StrategyProtectDeadline, StrategyProtectRecovery, StrategyMinimizeChanges}
	}
	seen := map[RescueStrategy]bool{}
	for _, s := range strategies {
		if s != StrategyProtectDeadline && s != StrategyProtectRecovery && s != StrategyMinimizeChanges {
			return out, fmt.Errorf("unknown rescue strategy %q", s)
		}
		if seen[s] {
			return out, fmt.Errorf("duplicate rescue strategy %q", s)
		}
		seen[s] = true
	}
	buffer := in.Profile.MinRecoveryBufferMin
	if buffer <= 0 {
		buffer = 15
	}
	p := rescuePlanner{ctx: ctx, in: in, loc: loc, start: start, end: end, buffer: time.Duration(buffer) * time.Minute}
	ids := map[uuid.UUID]bool{}
	for _, it := range sortedSchedules(in.WindowSchedules) {
		if it.Status == StatusCancelled {
			continue
		}
		if !activeItem(it) {
			return out, fmt.Errorf("invalid rescue schedule %s", it.ID)
		}
		if !overlaps(it.StartAt, it.EndAt, start, end) {
			continue
		}
		if it.ID == uuid.Nil || ids[it.ID] {
			return out, fmt.Errorf("rescue schedules require unique nonzero IDs")
		}
		ids[it.ID] = true
		p.originals = append(p.originals, rescueJob{item: it})
	}
	for _, s := range strategies {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		placements, missing, reason := p.solve(s)
		if err := ctx.Err(); err != nil {
			return out, err
		}
		option := p.summarize(s, placements, missing, reason)
		out.Options = append(out.Options, option)
	}
	return out, nil
}

func (p *rescuePlanner) urgentJob() rescueJob {
	u := p.in.UrgentTask
	deadline := u.DeadlineAt.UTC()
	return rescueJob{created: true, urgent: true, item: ScheduleItemSnapshot{Title: u.Title, Notes: u.Notes, Category: CategoryUrgent, CognitiveLoad: u.CognitiveLoad, Flexibility: FlexibilityFlexible, Status: StatusPlanned, DurationMinutes: u.DurationMinutes, DeadlineAt: &deadline}}
}
func (p *rescuePlanner) isFixed(job rescueJob) bool {
	return immutableItem(job.item, p.in.Now) || job.item.Flexibility == FlexibilityFocusShield
}
func unchangedPlacement(job rescueJob) rescuePlacement {
	return rescuePlacement{job: job, start: job.item.StartAt, end: job.item.EndAt}
}
func jobDuration(job rescueJob) time.Duration {
	if !job.item.StartAt.IsZero() && job.item.StartAt.Before(job.item.EndAt) {
		return job.item.EndAt.Sub(job.item.StartAt)
	}
	return time.Duration(job.item.DurationMinutes) * time.Minute
}
func (p *rescuePlanner) highEnergyAllowed(job rescueJob, start, end time.Time) bool {
	if job.item.CognitiveLoad != LoadHigh || job.item.Category == CategoryRecovery {
		return true
	}
	for at := start; at.Before(end); at = at.Add(15 * time.Minute) {
		tier := curveTierAt(p.in.PredictedCurve, at, p.in.Profile.WorkScheduleProfile, p.loc)
		if tier == TierStrained || tier == TierDepleted {
			return false
		}
	}
	return true
}
func placementConflicts(start, end time.Time, placements []rescuePlacement) bool {
	for _, x := range placements {
		if overlaps(start, end, x.start, x.end) {
			return true
		}
	}
	return false
}

// availableSlot checks elapsed durations and calendar-local work boundaries
// independently; the rescue horizon itself is always exactly 48 physical hours.
func (p *rescuePlanner) availableSlot(job rescueJob, start time.Time, occupied []rescuePlacement, recovery bool) (rescuePlacement, bool) {
	end := start.Add(jobDuration(job))
	reservedEnd := end
	if recovery && job.item.Category != CategoryRecovery {
		reservedEnd = reservedEnd.Add(p.buffer)
	}
	if start.Before(p.in.Now) || start.Before(p.start) || reservedEnd.After(p.end) || !inWorkWindow(start, reservedEnd, p.in.Profile.WorkScheduleProfile, p.loc, false) || placementConflicts(start, reservedEnd, occupied) {
		return rescuePlacement{}, false
	}
	if recovery && !p.highEnergyAllowed(job, start, end) {
		return rescuePlacement{}, false
	}
	return rescuePlacement{job: job, start: start.UTC(), end: end.UTC()}, true
}
func (p *rescuePlanner) earliestSlot(job rescueJob, occupied []rescuePlacement, recovery bool) (rescuePlacement, bool) {
	for at := ceilQuarter(later(p.in.Now, p.start)); at.Before(p.end); at = at.Add(15 * time.Minute) {
		if p.ctx.Err() != nil {
			return rescuePlacement{}, false
		}
		if x, ok := p.availableSlot(job, at, occupied, recovery); ok {
			return x, true
		}
	}
	return rescuePlacement{}, false
}
func (p *rescuePlanner) recoveryAfter(x rescuePlacement) rescuePlacement {
	job := rescueJob{created: true, item: ScheduleItemSnapshot{Title: "恢复缓冲", Category: CategoryRecovery, CognitiveLoad: LoadLow, Flexibility: FlexibilityFlexible, Status: StatusPlanned, DurationMinutes: int(p.buffer / time.Minute)}}
	return rescuePlacement{job: job, start: x.end, end: x.end.Add(p.buffer)}
}

func (p *rescuePlanner) solve(strategy RescueStrategy) ([]rescuePlacement, int, string) {
	if strategy == StrategyMinimizeChanges {
		return p.minimize()
	}
	occupied := []rescuePlacement{}
	jobs := []rescueJob{}
	for _, job := range p.originals {
		if p.isFixed(job) {
			occupied = append(occupied, unchangedPlacement(job))
		} else {
			jobs = append(jobs, job)
		}
	}
	if p.in.UrgentTask != nil {
		jobs = append(jobs, p.urgentJob())
	}
	// Earliest deadline first is deterministic and keeps the deadline strategy
	// distinct from minimum-change preservation. Undated tasks follow deadlines.
	sort.Slice(jobs, func(i, j int) bool {
		a, b := jobs[i], jobs[j]
		if a.item.DeadlineAt != nil && b.item.DeadlineAt == nil {
			return true
		}
		if a.item.DeadlineAt == nil && b.item.DeadlineAt != nil {
			return false
		}
		if a.item.DeadlineAt != nil && b.item.DeadlineAt != nil && !a.item.DeadlineAt.Equal(*b.item.DeadlineAt) {
			return a.item.DeadlineAt.Before(*b.item.DeadlineAt)
		}
		if a.urgent != b.urgent {
			return a.urgent
		}
		if !a.item.StartAt.Equal(b.item.StartAt) {
			return a.item.StartAt.Before(b.item.StartAt)
		}
		return a.item.ID.String() < b.item.ID.String()
	})
	missing := 0
	reason := ""
	for _, job := range jobs {
		if p.ctx.Err() != nil {
			break
		}
		x, ok := p.earliestSlot(job, occupied, strategy == StrategyProtectRecovery)
		if !ok {
			missing++
			if !job.created {
				occupied = append(occupied, unchangedPlacement(job))
			}
			reason = "存在任务在工作边界、锁定日程、精力限制及48小时窗口内无法安置"
			continue
		}
		occupied = append(occupied, x)
		if strategy == StrategyProtectRecovery && job.item.Category != CategoryRecovery {
			occupied = append(occupied, p.recoveryAfter(x))
		}
	}
	if strategy == StrategyProtectRecovery {
		hasRecovery := false
		for _, x := range occupied {
			if x.job.item.Category == CategoryRecovery && x.end.Sub(later(x.start, p.in.Now)) >= p.buffer {
				hasRecovery = true
				break
			}
		}
		if !hasRecovery && !p.insertFreeRecovery(&occupied) {
			missing++
			reason = "保留锁定日程后没有空间插入最低恢复缓冲"
		}
	}
	if strategy == StrategyProtectRecovery {
		for _, x := range occupied {
			if !x.job.created && p.isFixed(x.job) && x.end.After(p.in.Now) && !p.highEnergyAllowed(x.job, later(x.start, p.in.Now), x.end) {
				missing++
				reason = "锁定高负荷日程位于疲劳区间，恢复策略无法越权移动"
			}
		}
	}
	return occupied, missing, reason
}

func (p *rescuePlanner) insertFreeRecovery(occupied *[]rescuePlacement) bool {
	job := rescueJob{created: true, item: ScheduleItemSnapshot{Title: "恢复缓冲", Category: CategoryRecovery, CognitiveLoad: LoadLow, Flexibility: FlexibilityFlexible, DurationMinutes: int(p.buffer / time.Minute), Status: StatusPlanned}}
	x, ok := p.earliestSlot(job, *occupied, false)
	if ok {
		*occupied = append(*occupied, x)
	}
	return ok
}

func (p *rescuePlanner) minimize() ([]rescuePlacement, int, string) {
	original := make([]rescuePlacement, 0, len(p.originals))
	for _, job := range p.originals {
		original = append(original, unchangedPlacement(job))
	}
	if p.in.UrgentTask == nil {
		if p.in.TriggerReason == TriggerWearableFatigue || p.in.TriggerReason == TriggerTeamMeetingOverload {
			if !p.insertFreeRecovery(&original) {
				return original, 1, "现有任务全部保留后没有空间插入恢复缓冲"
			}
		}
		return original, 0, ""
	}
	urgent := p.urgentJob()
	var best []rescuePlacement
	bestMoved, bestOverdue := int(^uint(0)>>1), int(^uint(0)>>1)
	var bestAt time.Time
	for at := ceilQuarter(later(p.in.Now, p.start)); at.Before(p.end); at = at.Add(15 * time.Minute) {
		if p.ctx.Err() != nil {
			break
		}
		end := at.Add(jobDuration(urgent))
		if end.After(p.end) || !inWorkWindow(at, end, p.in.Profile.WorkScheduleProfile, p.loc, false) {
			continue
		}
		kept := []rescuePlacement{}
		displaced := []rescueJob{}
		blocked := false
		for _, x := range original {
			if overlaps(at, end, x.start, x.end) {
				if p.isFixed(x.job) {
					blocked = true
					break
				}
				displaced = append(displaced, x.job)
			} else {
				kept = append(kept, x)
			}
		}
		if blocked || len(displaced) > bestMoved {
			continue
		}
		kept = append(kept, rescuePlacement{job: urgent, start: at, end: end})
		sort.Slice(displaced, func(i, j int) bool {
			a, b := displaced[i], displaced[j]
			if a.item.DeadlineAt != nil && b.item.DeadlineAt == nil {
				return true
			}
			if a.item.DeadlineAt == nil && b.item.DeadlineAt != nil {
				return false
			}
			if a.item.DeadlineAt != nil && b.item.DeadlineAt != nil && !a.item.DeadlineAt.Equal(*b.item.DeadlineAt) {
				return a.item.DeadlineAt.Before(*b.item.DeadlineAt)
			}
			return a.item.ID.String() < b.item.ID.String()
		})
		valid := true
		for _, job := range displaced {
			x, ok := p.earliestSlot(job, kept, false)
			if !ok {
				valid = false
				break
			}
			kept = append(kept, x)
		}
		if !valid {
			continue
		}
		overdue := placementOverdue(kept)
		if len(displaced) < bestMoved || (len(displaced) == bestMoved && (overdue < bestOverdue || (overdue == bestOverdue && (bestAt.IsZero() || at.Before(bestAt))))) {
			best, bestMoved, bestOverdue, bestAt = kept, len(displaced), overdue, at
		}
		if bestMoved == 0 && bestOverdue == 0 {
			break
		}
	}
	if best == nil {
		return original, 1, "保留锁定日程且不删除既有任务时，48小时内无法放入紧急任务"
	}
	return best, 0, ""
}

func placementOverdue(placements []rescuePlacement) int {
	count := 0
	for _, x := range placements {
		if x.job.item.Status != StatusCompleted && x.job.item.DeadlineAt != nil && x.end.After(*x.job.item.DeadlineAt) {
			count++
		}
	}
	return count
}

func (p *rescuePlanner) summarize(strategy RescueStrategy, placements []rescuePlacement, missing int, reason string) RescueOptionPlan {
	option := RescueOptionPlan{Strategy: strategy, Feasible: missing == 0, DiffItems: []RescueDiffItem{}, OverdueRiskCount: placementOverdue(placements)}
	if p.in.UrgentTask != nil {
		urgentPlaced := false
		for _, x := range placements {
			if x.job.urgent {
				urgentPlaced = true
				break
			}
		}
		if !urgentPlaced {
			option.OverdueRiskCount++
		}
	}
	sort.Slice(placements, func(i, j int) bool {
		a, b := placements[i], placements[j]
		if !a.start.Equal(b.start) {
			return a.start.Before(b.start)
		}
		if !a.end.Equal(b.end) {
			return a.end.Before(b.end)
		}
		if a.job.item.ID != b.job.item.ID {
			return a.job.item.ID.String() < b.job.item.ID.String()
		}
		if a.job.item.Category != b.job.item.Category {
			return a.job.item.Category < b.job.item.Category
		}
		return a.job.item.Title < b.job.item.Title
	})
	for i, x := range placements {
		for _, y := range placements[i+1:] {
			if !y.start.Before(x.end) {
				break
			}
			if overlaps(x.start, x.end, y.start, y.end) {
				option.Feasible = false
				if reason == "" {
					reason = "原有锁定冲突或无法安置的任务仍需人工处理"
				}
			}
		}
		job := x.job
		diff := RescueDiffItem{Op: DiffOpCreate, Title: job.item.Title, Category: job.item.Category, CognitiveLoad: job.item.CognitiveLoad, Flexibility: job.item.Flexibility, AfterStartAt: x.start.UTC(), AfterEndAt: x.end.UTC(), ReasonCode: "RESCUE_INSERT_URGENT", ReasonLabel: "为新增紧急任务安排可用工作时间"}
		if !job.created {
			id := job.item.ID
			beforeStart, beforeEnd := job.item.StartAt.UTC(), job.item.EndAt.UTC()
			diff.ItemID = &id
			diff.BeforeStartAt = &beforeStart
			diff.BeforeEndAt = &beforeEnd
			diff.Op = DiffOpMove
			diff.ReasonCode = "RESCUE_PROTECT_DEADLINE"
			diff.ReasonLabel = "调整弹性任务以保留截止期"
			if x.start.Equal(job.item.StartAt) && x.end.Equal(job.item.EndAt) {
				diff.Op = DiffOpUnchanged
				diff.ReasonCode = "RESCUE_PRESERVE_EXISTING"
				diff.ReasonLabel = "保留既有计划及锁定约束"
			} else if x.start.In(p.loc).Format("2006-01-02") > job.item.StartAt.In(p.loc).Format("2006-01-02") {
				diff.Op = DiffOpDefer
				option.DeferredCount++
				diff.ReasonCode = "RESCUE_DEFER_TO_NEXT_WORKDAY"
				diff.ReasonLabel = "顺延至后续本地工作窗口"
			} else {
				option.MovedCount++
			}
			if diff.Op != DiffOpUnchanged && strategy == StrategyProtectRecovery {
				diff.ReasonCode = "RESCUE_AVOID_FATIGUE"
				diff.ReasonLabel = "避开疲劳区间并保留恢复缓冲"
			}
			if diff.Op != DiffOpUnchanged && strategy == StrategyMinimizeChanges {
				diff.ReasonCode = "RESCUE_MINIMAL_DISPLACEMENT"
				diff.ReasonLabel = "仅迁移与新增任务直接冲突的弹性任务"
			}
		}
		if job.item.Category == CategoryRecovery {
			option.RecoveryMinutes += int(x.end.Sub(x.start) / time.Minute)
			if job.created {
				diff.ReasonCode = "RESCUE_INSERT_RECOVERY"
				diff.ReasonLabel = fmt.Sprintf("插入 %d 分钟恢复缓冲", int(x.end.Sub(x.start)/time.Minute))
			}
		}
		if job.item.DeadlineAt != nil && x.end.After(*job.item.DeadlineAt) && job.item.Status != StatusCompleted {
			diff.ReasonCode = "RESCUE_DEADLINE_RISK"
			diff.ReasonLabel = "可用工作窗口晚于任务截止期，需要用户明确处理"
		}
		option.DiffItems = append(option.DiffItems, diff)
	}
	if option.OverdueRiskCount > 0 {
		option.Feasible = false
	}
	label := map[RescueStrategy]string{StrategyProtectDeadline: "优先保住截止期", StrategyProtectRecovery: "优先保留恢复精力", StrategyMinimizeChanges: "尽量少动原计划"}[strategy]
	option.Summary = fmt.Sprintf("%s：同日移动 %d 项，顺延 %d 项，恢复 %d 分钟，逾期风险 %d 项", label, option.MovedCount, option.DeferredCount, option.RecoveryMinutes, option.OverdueRiskCount)
	if reason != "" {
		option.Summary += "；" + reason
	}
	payload := struct {
		BaselineVersion string              `json:"baselineVersion"`
		Strategy        RescueStrategy      `json:"strategy"`
		TriggerReason   RescueTriggerReason `json:"triggerReason"`
		DiffItems       []RescueDiffItem    `json:"diffItems"`
	}{p.in.BaselineVersion, strategy, p.in.TriggerReason, option.DiffItems}
	data, _ := json.Marshal(payload)
	sum := sha256.Sum256(data)
	option.OptionHash = hex.EncodeToString(sum[:])[:16]
	return option
}
