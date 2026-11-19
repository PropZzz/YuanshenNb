package engine

import (
	"fmt"
	"math"
	"sort"
	"time"
	_ "time/tzdata" // Keep IANA timezone behavior identical on Windows and deployment hosts.
)

type interval struct{ start, end time.Time }

func overlaps(a, b, c, d time.Time) bool { return a.Before(d) && c.Before(b) }
func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func earlier(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
func rounded(v float64) float64       { return math.Round(v*100) / 100 }
func scoreTier(score int) EnergyTier {
	switch {
	case score >= 80:
		return TierPeak
	case score >= 55:
		return TierSteady
	case score >= 35:
		return TierStrained
	default:
		return TierDepleted
	}
}
func validTier(t EnergyTier) bool {
	return t == TierPeak || t == TierSteady || t == TierStrained || t == TierDepleted
}
func validLoad(load CognitiveLoad) bool {
	return load == LoadHigh || load == LoadMedium || load == LoadLow
}
func activeItem(it ScheduleItemSnapshot) bool {
	return it.Status != StatusCancelled && (it.Status == StatusPlanned || it.Status == StatusInProgress || it.Status == StatusCompleted) && it.StartAt.Before(it.EndAt)
}
func immutableItem(it ScheduleItemSnapshot, now time.Time) bool {
	return it.Flexibility == FlexibilityHardLocked || it.Category == CategoryMeeting || it.Status == StatusCompleted || it.Status == StatusInProgress || it.StartAt.Before(now)
}
func hardCollision(it ScheduleItemSnapshot) bool {
	return it.Flexibility == FlexibilityHardLocked || it.Category == CategoryMeeting || it.Category == CategoryRecovery
}

func validateProfile(p WorkScheduleProfile) (*time.Location, error) {
	loc, err := time.LoadLocation(p.Timezone)
	if p.Timezone == "" || err != nil {
		return nil, fmt.Errorf("invalid profile timezone %q", p.Timezone)
	}
	if p.WorkStartMinute < 0 || p.WorkStartMinute >= 1440 || p.WorkEndMinute <= p.WorkStartMinute || p.WorkEndMinute > 1440 {
		return nil, fmt.Errorf("work window must be within one local day with start before end")
	}
	if p.MinRecoveryBufferMin < 0 || p.MinRecoveryBufferMin > 240 {
		return nil, fmt.Errorf("invalid recovery buffer")
	}
	if p.Chronotype != "" && p.Chronotype != ChronotypeBalanced && p.Chronotype != ChronotypeMorningLark && p.Chronotype != ChronotypeNightOwl {
		return nil, fmt.Errorf("invalid chronotype %q", p.Chronotype)
	}
	for _, w := range p.PreferredFocusWindows {
		if w.StartMinute < 0 || w.EndMinute > 1440 || w.StartMinute >= w.EndMinute {
			return nil, fmt.Errorf("invalid preferred focus window")
		}
	}
	return loc, nil
}

// localMinute uses wall-clock construction rather than adding elapsed hours, which
// preserves configured work boundaries on 23- and 25-hour calendar days.
func localMinute(day time.Time, minute int, loc *time.Location) time.Time {
	d := day.In(loc)
	return time.Date(d.Year(), d.Month(), d.Day(), minute/60, minute%60, 0, 0, loc).UTC()
}
func workWindow(day time.Time, p WorkScheduleProfile, loc *time.Location) interval {
	return interval{localMinute(day, p.WorkStartMinute, loc), localMinute(day, p.WorkEndMinute, loc)}
}
func inWorkWindow(start, end time.Time, p WorkScheduleProfile, loc *time.Location, weekdaysOnly bool) bool {
	d := start.In(loc)
	if weekdaysOnly && (d.Weekday() == time.Saturday || d.Weekday() == time.Sunday) {
		return false
	}
	w := workWindow(start, p, loc)
	return !start.Before(w.start) && !end.After(w.end)
}
func ceilQuarter(t time.Time) time.Time {
	const step = int64(15 * time.Minute)
	n := t.UnixNano()
	r := n % step
	if r != 0 {
		n += step - r
	}
	return time.Unix(0, n).UTC()
}
func sortedSchedules(items []ScheduleItemSnapshot) []ScheduleItemSnapshot {
	out := append([]ScheduleItemSnapshot(nil), items...)
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if !a.StartAt.Equal(b.StartAt) {
			return a.StartAt.Before(b.StartAt)
		}
		if !a.EndAt.Equal(b.EndAt) {
			return a.EndAt.Before(b.EndAt)
		}
		return a.ID.String() < b.ID.String()
	})
	return out
}
func curveTierAt(curve []HourlyEnergyPoint, at time.Time, p WorkScheduleProfile, loc *time.Location) EnergyTier {
	var found *HourlyEnergyPoint
	for i := range curve {
		point := &curve[i]
		if validTier(point.Tier) && !point.HourStartAt.After(at) && at.Before(point.HourStartAt.Add(time.Hour)) && (found == nil || point.HourStartAt.After(found.HourStartAt) || (point.HourStartAt.Equal(found.HourStartAt) && point.Tier < found.Tier)) {
			found = point
		}
	}
	if found != nil {
		return found.Tier
	}
	return scoreTier(int(math.Round(30 + circadian(at, p.Chronotype, loc))))
}

func unionDuration(xs []interval) time.Duration {
	if len(xs) == 0 {
		return 0
	}
	sort.Slice(xs, func(i, j int) bool { return xs[i].start.Before(xs[j].start) })
	s, e := xs[0].start, xs[0].end
	var duration time.Duration
	for _, x := range xs[1:] {
		if !x.start.After(e) {
			e = later(e, x.end)
		} else {
			duration += e.Sub(s)
			s, e = x.start, x.end
		}
	}
	return duration + e.Sub(s)
}
