package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/shixu-app/server/internal/api"
)

func main() {
	outPath := flag.String("out", "../../contracts/openapi.json", "output OpenAPI 3.1 JSON file path")
	flag.Parse()

	router := chi.NewRouter()
	cfg := api.NewHumaConfig("2.0.0")
	humaAPI := humachi.New(router, cfg)

	api.RegisterContractRoutes(humaAPI, api.RouteHandlers{}, api.RouteOptions{
		AllowUnimplementedStubs: true,
	})
	doc := humaAPI.OpenAPI()
	api.RegisterExtraSchemas(doc)

	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "marshal openapi spec: %v\n", err)
		os.Exit(1)
	}
	raw = append(raw, '\n')

	if err := os.MkdirAll(filepath.Dir(*outPath), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "create output directory: %v\n", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, raw, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "write openapi spec: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Exported OpenAPI 3.1 contract to %s\n", *outPath)
}
