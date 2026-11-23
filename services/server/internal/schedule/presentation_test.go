package schedule

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/testutil"
)

func TestPresentationValidation(t *testing.T) {
	for _, value := range []*api.SchedulePresentation{{AttributeTag: "made-up"}, {GoalID: "orphan"}, {GoalTitle: "orphan"}} {
		if validPresentation(value) {
			t.Fatalf("invalid presentation accepted: %+v", value)
		}
	}
	if !validPresentation(nil) || !validPresentation(&api.SchedulePresentation{}) {
		t.Fatal("existing schedules must stay valid")
	}
}

func TestSchedulePresentationSurvivesCreatePatchAndList(t *testing.T) {
	pool := testutil.Postgres(t)
	ctx := context.Background()
	user := uuid.New()
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Presentation','hash')", user, user.String()+"@example.com"); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool)
	start := time.Now().UTC().Truncate(time.Hour).Add(72 * time.Hour)
	created, err := service.Create(ctx, user, api.CreateScheduleItemRequest{Title: "真实属性", Category: "deep_work", CognitiveLoad: "medium", Flexibility: "flexible", StartAt: start, EndAt: start.Add(time.Hour), Presentation: &api.SchedulePresentation{AttributeTag: "study", GoalID: "local-goal-1", GoalTitle: "期末复习"}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Presentation == nil || created.Presentation.AttributeTag != "study" || created.Presentation.GoalTitle != "期末复习" {
		t.Fatalf("presentation not persisted: %+v", created)
	}
	title := "修改主题仍保留属性"
	patched, err := service.Update(ctx, user, created.ID, api.UpdateScheduleItemRequest{Title: &title})
	if err != nil || patched.Presentation == nil || patched.Presentation.AttributeTag != "study" {
		t.Fatalf("partial patch lost metadata: %+v %v", patched, err)
	}
	list, err := service.List(ctx, user, start, start.Add(24*time.Hour), false)
	if err != nil || len(list) != 1 || list[0].Presentation.GoalID != "local-goal-1" {
		t.Fatalf("list mismatch: %+v %v", list, err)
	}
	cleared, err := service.Update(ctx, user, created.ID, api.UpdateScheduleItemRequest{Presentation: &api.SchedulePresentation{}})
	if err != nil || cleared.Presentation == nil || cleared.Presentation.AttributeTag != "" || cleared.Presentation.GoalID != "" {
		t.Fatalf("clear mismatch: %+v %v", cleared, err)
	}
	other, err := service.List(ctx, uuid.New(), start, start.Add(24*time.Hour), false)
	if err != nil || len(other) != 0 {
		t.Fatalf("cross-account metadata leak: %+v %v", other, err)
	}
}
