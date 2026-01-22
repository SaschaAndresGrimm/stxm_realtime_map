package server

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"stxm-map-go/internal/config"
)

func TestHandleConfig(t *testing.T) {
	srv := &Server{
		cfg: config.AppConfig{
			GridX:         3,
			GridY:         4,
			PlotThreshold: []string{"1", "2", "3"},
			Port:          9999,
		},
	}

	req := httptest.NewRequest("GET", "/config", nil)
	rec := httptest.NewRecorder()
	srv.handleConfig(rec, req)

	if rec.Code != 200 {
		t.Fatalf("unexpected status: %d", rec.Code)
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if payload["grid_x"].(float64) != 3 {
		t.Fatalf("unexpected grid_x: %v", payload["grid_x"])
	}
	if payload["grid_y"].(float64) != 4 {
		t.Fatalf("unexpected grid_y: %v", payload["grid_y"])
	}
	if payload["port"].(float64) != 9999 {
		t.Fatalf("unexpected port: %v", payload["port"])
	}
}
