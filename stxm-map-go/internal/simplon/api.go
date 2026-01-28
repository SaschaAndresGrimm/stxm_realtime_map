package simplon

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

func BuildPaths(baseURL string, apiVersion string, module string, kind string, param string) []string {
	baseURL = strings.TrimRight(baseURL, "/")
	apiVersion = strings.Trim(apiVersion, "/")
	module = strings.Trim(module, "/")
	kind = strings.Trim(kind, "/")
	param = strings.TrimLeft(param, "/")
	if baseURL == "" || module == "" || kind == "" || param == "" {
		return nil
	}

	paths := make([]string, 0, 4)
	if apiVersion != "" {
		paths = append(paths, baseURL+"/"+module+"/api/"+apiVersion+"/"+kind+"/"+param)
		paths = append(paths, baseURL+"/api/"+apiVersion+"/"+module+"/"+kind+"/"+param)
	}
	paths = append(paths, baseURL+"/"+module+"/"+kind+"/"+param)
	return paths
}

func ConfigSetModule(ctx context.Context, baseURL string, apiVersion string, module string, param string, value any) (int, string) {
	if baseURL == "" {
		return http.StatusBadRequest, "missing base url"
	}
	if module == "" || param == "" {
		return http.StatusBadRequest, "missing parameter"
	}

	payload, err := json.Marshal(map[string]any{"value": value})
	if err != nil {
		return http.StatusBadRequest, "invalid value"
	}

	return doRequest(ctx, http.MethodPut, BuildPaths(baseURL, apiVersion, module, "config", param), payload, "application/json")
}

func ConfigGetModule(ctx context.Context, baseURL string, apiVersion string, module string, param string) (int, string) {
	if baseURL == "" {
		return http.StatusBadRequest, "missing base url"
	}
	if module == "" || param == "" {
		return http.StatusBadRequest, "missing parameter"
	}
	return doRequest(ctx, http.MethodGet, BuildPaths(baseURL, apiVersion, module, "config", param), nil, "")
}

func StatusGetModule(ctx context.Context, baseURL string, apiVersion string, module string, param string) (int, string) {
	if baseURL == "" {
		return http.StatusBadRequest, "missing base url"
	}
	if module == "" || param == "" {
		return http.StatusBadRequest, "missing parameter"
	}
	return doRequest(ctx, http.MethodGet, BuildPaths(baseURL, apiVersion, module, "status", param), nil, "")
}

func CommandAsyncModule(baseURL string, apiVersion string, module string, command string) error {
	if baseURL == "" {
		return ErrMissingBaseURL
	}
	if module == "" || command == "" {
		return ErrMissingParameter
	}

	paths := BuildPaths(baseURL, apiVersion, module, "command", command)
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

var (
	ErrMissingBaseURL   = &simplonError{"missing base url"}
	ErrMissingParameter = &simplonError{"missing parameter"}
)

type simplonError struct {
	msg string
}

func (e *simplonError) Error() string {
	return e.msg
}

func doRequest(ctx context.Context, method string, paths []string, payload []byte, contentType string) (int, string) {
	if len(paths) == 0 {
		return http.StatusBadRequest, "missing path"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	for _, path := range paths {
		var body io.Reader
		if len(payload) > 0 {
			body = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, path, body)
		if err != nil {
			continue
		}
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			return resp.StatusCode, strings.TrimSpace(string(respBody))
		}
	}
	return http.StatusNotFound, "not found"
}
