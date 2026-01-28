package server

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"stxm-map-go/internal/config"
	"stxm-map-go/internal/simplon"
)

//go:embed web/* web/assets/*
var webFS embed.FS

type Server struct {
	upgrader   websocket.Upgrader
	clients    map[*websocket.Conn]*sync.Mutex
	mu         sync.Mutex
	cfg        config.AppConfig
	statusFn   func() map[string]any
	snapshotFn func() any
	configFn   func() map[string]any
	gridFn     func(int, int) error
	endpointFn func(string, int, int) error
}

const (
	writeWait = 10 * time.Second
	pongWait  = 60 * time.Second
	pingEvery = (pongWait * 9) / 10
)

func Run(ctx context.Context, cfg config.AppConfig, messages <-chan any, statusFn func() map[string]any, snapshotFn func() any, configFn func() map[string]any, gridFn func(int, int) error, endpointFn func(string, int, int) error) error {
	srv := &Server{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		clients:    make(map[*websocket.Conn]*sync.Mutex),
		cfg:        cfg,
		statusFn:   statusFn,
		snapshotFn: snapshotFn,
		configFn:   configFn,
		gridFn:     gridFn,
		endpointFn: endpointFn,
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
	mux.HandleFunc("/detector/command/", srv.handleDetectorCommand)
	mux.HandleFunc("/detector/config/", srv.handleDetectorConfig)
	mux.HandleFunc("/simplon/", srv.handleSimplon)
	mux.HandleFunc("/ui/grid", srv.handleGrid)
	mux.HandleFunc("/ui/endpoint", srv.handleEndpoint)

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
	if s.configFn != nil {
		if cfg := s.configFn(); cfg != nil {
			for key, value := range cfg {
				payload[key] = value
			}
		}
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

func (s *Server) handleDetectorCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	cmd := strings.TrimPrefix(r.URL.Path, "/detector/command/")
	switch cmd {
	case "initialize", "arm", "trigger", "disarm":
	default:
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "unsupported command",
		})
		return
	}
	if s.cfg.SimplonBaseURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "simplon base url not configured",
		})
		return
	}
	if err := simplon.CommandAsync(s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, cmd); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":      false,
			"status":  http.StatusBadRequest,
			"command": cmd,
			"error":   err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"status":  http.StatusAccepted,
		"command": cmd,
	})
}

func (s *Server) handleDetectorConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	param := strings.TrimPrefix(r.URL.Path, "/detector/config/")
	if param == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "missing parameter",
		})
		return
	}
	if s.cfg.SimplonBaseURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "simplon base url not configured",
		})
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid json body",
		})
		return
	}
	value, ok := payload["value"]
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "missing value",
		})
		return
	}
	code, body := simplon.ConfigSet(r.Context(), s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, param, value)
	ok = code >= 200 && code < 300
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     ok,
		"status": code,
		"param":  param,
		"body":   body,
	})
}

func (s *Server) handleGrid(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid json body",
		})
		return
	}
	gridX, okX := payload["grid_x"]
	gridY, okY := payload["grid_y"]
	if !okX || !okY {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "missing grid_x or grid_y",
		})
		return
	}
	x, err := toInt(gridX)
	if err != nil || x < 1 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid grid_x",
		})
		return
	}
	y, err := toInt(gridY)
	if err != nil || y < 1 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid grid_y",
		})
		return
	}
	if s.gridFn == nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "grid updates disabled",
		})
		return
	}
	if err := s.gridFn(x, y); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"status": http.StatusOK,
		"grid_x": x,
		"grid_y": y,
	})
}

func (s *Server) handleEndpoint(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid json body",
		})
		return
	}
	detectorIP, _ := payload["detector_ip"].(string)
	if detectorIP == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "missing detector_ip",
		})
		return
	}
	zmqPort, err := toInt(payload["zmq_port"])
	if err != nil || zmqPort < 1 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid zmq_port",
		})
		return
	}
	apiPort, err := toInt(payload["api_port"])
	if err != nil || apiPort < 1 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid api_port",
		})
		return
	}
	if s.endpointFn == nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "endpoint updates disabled",
		})
		return
	}
	if err := s.endpointFn(detectorIP, zmqPort, apiPort); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":          true,
		"status":      http.StatusOK,
		"detector_ip": detectorIP,
		"zmq_port":    zmqPort,
		"api_port":    apiPort,
	})
}

func (s *Server) handleSimplon(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/simplon/")
	parts := strings.SplitN(path, "/", 3)
	if len(parts) < 3 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "invalid path",
		})
		return
	}
	module := parts[0]
	kind := parts[1]
	param := parts[2]
	if param == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "missing parameter",
		})
		return
	}
	if s.cfg.SimplonBaseURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "simplon base url not configured",
		})
		return
	}
	switch kind {
	case "command":
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if err := simplon.CommandAsyncModule(s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, module, param); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     false,
				"status": http.StatusBadRequest,
				"error":  err.Error(),
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     true,
			"status": http.StatusAccepted,
			"param":  param,
		})
	case "config":
		if r.Method == http.MethodPut {
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ok":    false,
					"error": "invalid json body",
				})
				return
			}
			value, ok := payload["value"]
			if !ok {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ok":    false,
					"error": "missing value",
				})
				return
			}
			code, body := simplon.ConfigSetModule(r.Context(), s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, module, param, value)
			ok = code >= 200 && code < 300
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     ok,
				"status": code,
				"param":  param,
				"body":   body,
			})
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		code, body := simplon.ConfigGetModule(r.Context(), s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, module, param)
		ok := code >= 200 && code < 300
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     ok,
			"status": code,
			"param":  param,
			"body":   body,
		})
	case "status":
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		code, body := simplon.StatusGetModule(r.Context(), s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, module, param)
		ok := code >= 200 && code < 300
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     ok,
			"status": code,
			"param":  param,
			"body":   body,
		})
	case "images":
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		s.proxySimplon(w, r, module, "images", param)
	default:
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "unsupported operation",
		})
	}
}

func (s *Server) proxySimplon(w http.ResponseWriter, r *http.Request, module string, kind string, param string) {
	paths := simplon.BuildPaths(s.cfg.SimplonBaseURL, s.cfg.SimplonAPIVersion, module, kind, param)
	if len(paths) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, path := range paths {
		if r.URL.RawQuery != "" {
			path = path + "?" + r.URL.RawQuery
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, path, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode == http.StatusNotFound {
			_ = resp.Body.Close()
			continue
		}
		for key, values := range resp.Header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		_ = resp.Body.Close()
		return
	}
	w.WriteHeader(http.StatusNotFound)
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

func toInt(v any) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case float64:
		return int(n), nil
	case float32:
		return int(n), nil
	case json.Number:
		i64, err := n.Int64()
		if err != nil {
			return 0, err
		}
		return int(i64), nil
	default:
		return 0, fmt.Errorf("unsupported int type %T", v)
	}
}
