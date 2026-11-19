package main

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shixu-app/server/internal/api"
	"github.com/shixu-app/server/internal/apiadapter"
	"github.com/shixu-app/server/internal/auth"
	"github.com/shixu-app/server/internal/biometrics"
	"github.com/shixu-app/server/internal/config"
	"github.com/shixu-app/server/internal/engine"
	"github.com/shixu-app/server/internal/realtime"
	"github.com/shixu-app/server/internal/schedule"
	"github.com/shixu-app/server/internal/workspace"
)

func newRuntimeDeps(cfg config.Config, pool *pgxpool.Pool) RouterDeps {
	energyEngine := engine.NewEnergyEngine()
	hub := realtime.NewHub(pool, cfg.CORSAllowedOrigins, cfg.WSTicketTTL)
	authService := auth.NewService(pool, cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	authHTTP := apiadapter.NewAuth(authService, hub, cfg)
	biometricsService := biometrics.NewService(pool, energyEngine)
	calendar := schedule.NewService(pool)
	rescue := schedule.NewRescueService(pool, energyEngine, engine.NewRescueEngine(), biometrics.LoadInput)
	personal := apiadapter.NewPersonal(pool, biometricsService, calendar, rescue, hub)
	team := apiadapter.NewTeam(workspace.NewService(pool, engine.NewTeamPlannerEngine(), biometricsService), personal)
	authHTTP.OnChange = personal.Recompute
	return RouterDeps{Pinger: pool, Handlers: api.RouteHandlers{Auth: authHTTP, Biometrics: personal, Energy: personal, Schedule: personal, Workspaces: team}, AuthMiddleware: authHTTP.Middleware, WSHandler: hub}
}
