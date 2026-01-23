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
)

//go:embed web/*
var webFS embed.FS

type Server struct {
	upgrader   websocket.Upgrader
	clients    map[*websocket.Conn]*sync.Mutex
	mu         sync.Mutex
	cfg        config.AppConfig
	statusFn   func() map[string]any
	snapshotFn func() any
	configFn   func() map[string]any
}

const (
	writeWait = 10 * time.Second
	pongWait  = 60 * time.Second
	pingEvery = (pongWait * 9) / 10
)

func Run(ctx context.Context, cfg config.AppConfig, messages <-chan any, statusFn func() map[string]any, snapshotFn func() any, configFn func() map[string]any) error {
	srv := &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients:    make(map[*websocket.Conn]*sync.Mutex),
		cfg:        cfg,
		statusFn:   statusFn,
		snapshotFn: snapshotFn,
		configFn:   configFn,
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
	mux.HandleFunc("/status", srv.handleStatus)

	httpServer := &http.Server{
		Addr:              ":" + itoa(cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	go srv.broadcast(ctx, messages)

	return httpServer.ListenAndServe()
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	s.mu.Lock()
	writeMu := &sync.Mutex{}
	s.clients[conn] = writeMu
	s.mu.Unlock()

	payload := map[string]any{
		"type":       "config",
		"grid_x":     s.cfg.GridX,
		"grid_y":     s.cfg.GridY,
		"thresholds": s.cfg.PlotThreshold,
	}
	if s.configFn != nil {
		if cfg := s.configFn(); cfg != nil {
			payload = cfg
		}
	}
	_ = s.writeJSON(conn, writeMu, payload)

	go func() {
		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingEvery)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					if err := s.writeMessage(conn, writeMu, websocket.PingMessage, nil); err != nil {
						_ = conn.Close()
						return
					}
				}
			}
		}()
		defer close(done)
		defer s.removeClient(conn)
		for {
			messageType, payload, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if messageType != websocket.TextMessage {
				continue
			}
			var request map[string]any
			if err := json.Unmarshal(payload, &request); err != nil {
				continue
			}
			if request["type"] == "snapshot_request" {
				if s.snapshotFn == nil {
					continue
				}
				snapshot := s.snapshotFn()
				if snapshot == nil {
					continue
				}
				_ = s.writeJSON(conn, writeMu, snapshot)
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

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	payload := map[string]any{}
	if s.statusFn != nil {
		payload = s.statusFn()
	}
	if metrics, ok := payload["metrics"].(map[string]any); ok {
		metrics["ws_clients"] = s.clientCount()
	} else {
		payload["ws_clients"] = s.clientCount()
	}
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) broadcast(ctx context.Context, messages <-chan any) {
	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			payload, err := json.Marshal(message)
			if err != nil {
				continue
			}
			var stale []*websocket.Conn
			s.mu.Lock()
			for conn, writeMu := range s.clients {
				if err := s.writeMessage(conn, writeMu, websocket.TextMessage, payload); err != nil {
					stale = append(stale, conn)
				}
			}
			s.mu.Unlock()
			for _, conn := range stale {
				s.removeClient(conn)
			}
		}
	}
}

func (s *Server) removeClient(conn *websocket.Conn) {
	s.mu.Lock()
	delete(s.clients, conn)
	s.mu.Unlock()
	conn.Close()
}

func (s *Server) clientCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.clients)
}

func (s *Server) writeJSON(conn *websocket.Conn, writeMu *sync.Mutex, payload any) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
	return conn.WriteJSON(payload)
}

func (s *Server) writeMessage(conn *websocket.Conn, writeMu *sync.Mutex, messageType int, payload []byte) error {
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
	return conn.WriteMessage(messageType, payload)
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
