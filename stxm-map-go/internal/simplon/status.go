package simplon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Status struct {
	Detector   string
	Stream     string
	Filewriter string
	Monitor    string
}

func Poll(ctx context.Context, baseURL string, interval time.Duration, update func(Status)) {
	if baseURL == "" || update == nil {
		return
	}
	baseURL = strings.TrimRight(baseURL, "/")
	client := &http.Client{
		Timeout: 900 * time.Millisecond,
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		status := Status{
			Detector:   fetchStatus(ctx, client, baseURL+"/detector/api/1.8.0/status"),
			Stream:     fetchStatus(ctx, client, baseURL+"/stream/api/1.8.0/status"),
			Filewriter: fetchStatus(ctx, client, baseURL+"/filewriter/api/1.8.0/status"),
			Monitor:    fetchStatus(ctx, client, baseURL+"/monitor/api/1.8.0/status"),
		}
		update(status)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func fetchStatus(ctx context.Context, client *http.Client, endpoint string) string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "error"
	}
	resp, err := client.Do(req)
	if err != nil {
		return "error"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Sprintf("http_%d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "error"
	}
	if len(body) == 0 {
		return "ok"
	}

	state, ok := extractState(body)
	if !ok {
		return "ok"
	}
	return state
}

func extractState(payload []byte) (string, bool) {
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return "", false
	}
	state := findState(decoded)
	if state == "" {
		return "", false
	}
	return strings.ToLower(state), true
}

func findState(value any) string {
	switch v := value.(type) {
	case map[string]any:
		for _, key := range []string{"state", "status", "value"} {
			if entry, ok := v[key]; ok {
				switch inner := entry.(type) {
				case string:
					return inner
				default:
					if nested := findState(inner); nested != "" {
						return nested
					}
				}
			}
		}
	case []any:
		for _, entry := range v {
			if nested := findState(entry); nested != "" {
				return nested
			}
		}
	}
	return ""
}
