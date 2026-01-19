package server

import (
	"context"
	"embed"
	"encoding/json"
	"io/fs"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"stxm-map-go/internal/config"
	"stxm-map-go/internal/types"
)

//go:embed web/*
var webFS embed.FS

type Server struct {
	upgrader websocket.Upgrader
	clients  map[*websocket.Conn]struct{}
	mu       sync.Mutex
	cfg      config.AppConfig
}

func Run(ctx context.Context, cfg config.AppConfig, frames <-chan types.Frame) error {
	srv := &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients: make(map[*websocket.Conn]struct{}),
		cfg:     cfg,
	}

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/ws", srv.handleWS)
	mux.HandleFunc("/healthz", srv.handleHealth)
	mux.HandleFunc("/config", srv.handleConfig)

	httpServer := &http.Server{
		Addr:              ":" + itoa(cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		_ = httpServer.Close()
	}()

	go srv.broadcast(frames)

	return httpServer.ListenAndServe()
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	s.mu.Lock()
	s.clients[conn] = struct{}{}
	s.mu.Unlock()

	_ = conn.WriteJSON(map[string]any{
		"type":       "config",
		"grid_x":     s.cfg.GridX,
		"grid_y":     s.cfg.GridY,
		"thresholds": s.cfg.PlotThreshold,
	})

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.clients, conn)
			s.mu.Unlock()
			conn.Close()
		}()
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	payload := map[string]any{
		"grid_x":     s.cfg.GridX,
		"grid_y":     s.cfg.GridY,
		"thresholds": s.cfg.PlotThreshold,
		"port":       s.cfg.Port,
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) broadcast(frames <-chan types.Frame) {
	for frame := range frames {
		payload, err := json.Marshal(frame)
		if err != nil {
			continue
		}
		s.mu.Lock()
		for conn := range s.clients {
			_ = conn.WriteMessage(websocket.TextMessage, payload)
		}
		s.mu.Unlock()
	}
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := false
	if v < 0 {
		neg = true
		v = -v
	}
	buf := make([]byte, 0, 12)
	for v > 0 {
		buf = append(buf, byte('0'+v%10))
		v /= 10
	}
	if neg {
		buf = append(buf, '-')
	}
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}
