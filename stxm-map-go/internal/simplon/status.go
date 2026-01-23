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

func Poll(ctx context.Context, baseURL string, apiVersion string, interval time.Duration, update func(Status)) {
	if baseURL == "" || update == nil {
		return
	}
	baseURL = strings.TrimRight(baseURL, "/")
	apiVersion = strings.Trim(apiVersion, "/")
	client := &http.Client{
		Timeout: 900 * time.Millisecond,
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		status := Status{
			Detector:   fetchWithFallback(ctx, client, baseURL+"/detector", apiVersion),
			Stream:     fetchWithFallback(ctx, client, baseURL+"/stream", apiVersion),
			Filewriter: fetchWithFallback(ctx, client, baseURL+"/filewriter", apiVersion),
			Monitor:    fetchWithFallback(ctx, client, baseURL+"/monitor", apiVersion),
		}
		update(status)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func Command(ctx context.Context, baseURL string, apiVersion string, command string) (int, string) {
	if baseURL == "" {
		return http.StatusBadRequest, "missing base url"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	apiVersion = strings.Trim(apiVersion, "/")

	paths := make([]string, 0, 3)
	if apiVersion != "" {
		paths = append(paths, baseURL+"/detector/api/"+apiVersion+"/command/"+command)
		paths = append(paths, baseURL+"/api/"+apiVersion+"/detector/command/"+command)
	}
	paths = append(paths, baseURL+"/detector/command/"+command)

	client := &http.Client{Timeout: 2 * time.Second}
	for _, path := range paths {
		req, err := http.NewRequestWithContext(ctx, http.MethodPut, path, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			return resp.StatusCode, strings.TrimSpace(string(body))
		}
	}
	return http.StatusNotFound, "not found"
}

func CommandAsync(baseURL string, apiVersion string, command string) error {
	if baseURL == "" {
		return fmt.Errorf("missing base url")
	}
	baseURL = strings.TrimRight(baseURL, "/")
	apiVersion = strings.Trim(apiVersion, "/")

	paths := make([]string, 0, 3)
	if apiVersion != "" {
		paths = append(paths, baseURL+"/detector/api/"+apiVersion+"/command/"+command)
		paths = append(paths, baseURL+"/api/"+apiVersion+"/detector/command/"+command)
	}
	paths = append(paths, baseURL+"/detector/command/"+command)

	client := &http.Client{Timeout: 2 * time.Second}
	go func() {
		for _, path := range paths {
			req, err := http.NewRequest(http.MethodPut, path, nil)
			if err != nil {
				continue
			}
			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			_, _ = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				return
			}
		}
	}()
	return nil
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

func fetchWithFallback(ctx context.Context, client *http.Client, base string, apiVersion string) string {
	apiVersion = strings.Trim(apiVersion, "/")
	paths := make([]string, 0, 3)
	if apiVersion != "" {
		paths = append(paths, base+"/api/"+apiVersion+"/status/state")
	}
	paths = append(paths, base+"/status/state")
	if apiVersion != "" {
		paths = append(paths, base+"/api/"+apiVersion+"/status")
	}
	paths = append(paths, base+"/status")

	for _, path := range paths {
		status := fetchStatus(ctx, client, path)
		if !strings.HasPrefix(status, "http_404") {
			return status
		}
	}
	return "http_404"
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
