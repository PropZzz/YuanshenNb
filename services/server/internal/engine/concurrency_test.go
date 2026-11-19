package engine_test

import (
	"context"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/engine"
)

func TestEnginesShareInputsSafelyAcrossConcurrentPreviews(t *testing.T) {
	ctx := context.Background()
	now := moment("2026-11-19T09:00:00Z")
	e, team, r := engine.NewEnergyEngine(), engine.NewTeamPlannerEngine(), engine.NewRescueEngine()
	energyIn := engine.EnergyComputeInput{Now: now, LocalDay: "2026-11-19", Profile: profile("UTC")}
	m := member("11111111-1111-1111-1111-111111111111", engine.PrivacyEnergyTier, "UTC")
	meetingIn := engine.MeetingSolverInput{DurationMinutes: 30, CognitiveLoad: engine.LoadMedium, RequiredUserIDs: []uuid.UUID{m.UserID}, SearchFrom: now, SearchTo: now.Add(3 * time.Hour), Members: []engine.MemberRawSchedulingData{m}}
	rescueIn := rescueInput()
	wantEnergy, err := e.ComputeSnapshot(ctx, energyIn)
	if err != nil {
		t.Fatal(err)
	}
	wantMeeting, err := team.RecommendWindows(ctx, meetingIn)
	if err != nil {
		t.Fatal(err)
	}
	wantRescue, err := r.BuildOptions(ctx, rescueIn)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	failures := make(chan error, 12)
	for worker := 0; worker < 12; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			gotEnergy, err := e.ComputeSnapshot(ctx, energyIn)
			if err != nil || !reflect.DeepEqual(gotEnergy, wantEnergy) {
				failures <- fmt.Errorf("concurrent energy changed: %v", err)
				return
			}
			gotMeeting, err := team.RecommendWindows(ctx, meetingIn)
			if err != nil || !reflect.DeepEqual(gotMeeting, wantMeeting) {
				failures <- fmt.Errorf("concurrent meeting changed: %v", err)
				return
			}
			gotRescue, err := r.BuildOptions(ctx, rescueIn)
			if err != nil || !reflect.DeepEqual(gotRescue, wantRescue) {
				failures <- fmt.Errorf("concurrent rescue changed: %v", err)
			}
		}()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
}
