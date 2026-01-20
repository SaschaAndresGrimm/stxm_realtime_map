package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"stxm-map-go/internal/config"
	"stxm-map-go/internal/ingest"
	"stxm-map-go/internal/output"
	"stxm-map-go/internal/processing"
	"stxm-map-go/internal/server"
	"stxm-map-go/internal/simplon"
	"stxm-map-go/internal/simulator"
	"stxm-map-go/internal/types"
)

func main() {
	var (
		port            = flag.Int("port", 8888, "HTTP port for the web UI")
		detectorIP      = flag.String("detector-ip", "", "Detector IP used for ZMQ and SIMPLON API endpoints")
		apiPort         = flag.Int("api-port", 80, "SIMPLON API port")
		zmqPort         = flag.Int("zmq-port", 31001, "ZMQ port")
		endpoint        = flag.String("endpoint", "tcp://localhost:31001", "ZMQ endpoint (used when detector-ip is empty)")
		simplonInterval = flag.Duration("simplon-interval", 1*time.Second, "Polling interval for SIMPLON status")
		workers         = flag.Int("workers", 4, "Number of processing workers")
		gridX           = flag.Int("grid-x", 52, "Grid width in pixels")
		gridY           = flag.Int("grid-y", 52, "Grid height in pixels")
		debug           = flag.Bool("debug", true, "Run with simulated data")
		debugAcqRate    = flag.Float64("debug-acq-rate", 100.0, "Simulated acquisition rate (frames/sec)")
		outputDir       = flag.String("output-dir", "output", "Directory for output data files")
		ingestLogEvery  = flag.Int("ingest-log-every", 100, "Log every Nth ingest error")
		ingestFallback  = flag.Bool("ingest-fallback", true, "Fall back to simulator when ingest fails")
	)
	flag.Parse()

	resolvedEndpoint := *endpoint
	simplonBaseURL := ""
	if *detectorIP != "" {
		resolvedEndpoint = fmt.Sprintf("tcp://%s:%d", *detectorIP, *zmqPort)
		simplonBaseURL = fmt.Sprintf("http://%s:%d", *detectorIP, *apiPort)
	}

	cfg := config.AppConfig{
		Port:                *port,
		Endpoint:            resolvedEndpoint,
		SimplonPollInterval: *simplonInterval,
		Workers:             *workers,
		GridX:               *gridX,
		GridY:               *gridY,
		Debug:               *debug,
		DebugAcqRate:        *debugAcqRate,
		PlotThreshold:       []string{"threshold_0", "threshold_1"},
		OutputDir:           *outputDir,
		IngestLogEvery:      *ingestLogEvery,
		IngestFallback:      *ingestFallback,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var rawMessages <-chan types.RawMessage
	if cfg.Debug {
		rawMessages = simulator.Stream(ctx, cfg.GridX, cfg.GridY, cfg.DebugAcqRate)
	} else {
		ingestFrames, err := ingest.StreamWithLogEvery(ctx, cfg.Endpoint, cfg.IngestLogEvery)
		if err != nil {
			if cfg.IngestFallback {
				log.Printf("failed to start ingest: %v; falling back to simulator", err)
				rawMessages = simulator.Stream(ctx, cfg.GridX, cfg.GridY, cfg.DebugAcqRate)
			} else {
				log.Fatalf("failed to start ingest: %v", err)
			}
		} else {
			rawMessages = ingestFrames
		}
	}

	log.Printf("Starting web UI at http://localhost:%d\n", cfg.Port)

	processed := make(chan types.Frame, 128)
	incoming := make(chan types.RawFrame, 128)
	broadcast := make(chan types.Frame, 128)
	agg := processing.NewAggregator(cfg.GridX, cfg.GridY)
	runTimestamp := ""
	var runMu sync.Mutex
	var statusMu sync.Mutex
	status := map[string]any{
		"detector":   "unknown",
		"stream":     "idle",
		"filewriter": "idle",
		"monitor":    "ok",
		"last_frame": "",
		"last_write": "",
	}

	if cfg.Workers < 1 {
		cfg.Workers = 1
	}

	if cfg.Debug {
		statusMu.Lock()
		status["detector"] = "simulator"
		statusMu.Unlock()
	} else {
		statusMu.Lock()
		status["detector"] = "stream"
		statusMu.Unlock()
	}

	if !cfg.Debug && simplonBaseURL != "" {
		go simplon.Poll(ctx, simplonBaseURL, cfg.SimplonPollInterval, func(update simplon.Status) {
			statusMu.Lock()
			status["detector"] = update.Detector
			status["stream"] = update.Stream
			status["filewriter"] = update.Filewriter
			status["monitor"] = update.Monitor
			statusMu.Unlock()
		})
	}

	go func() {
		defer close(incoming)
		for msg := range rawMessages {
			if msg.Type != "image" {
				runMu.Lock()
				if runTimestamp == "" {
					runTimestamp = processing.Timestamp()
				}
				ts := runTimestamp
				runMu.Unlock()

				kind := msg.Type
				if kind == "" {
					kind = "metadata"
				}
				if err := output.WriteMetadata(cfg.OutputDir, ts, kind, msg.Meta); err != nil {
					log.Printf("metadata write failed: %v", err)
				}
				if msg.Type == "end" {
					runMu.Lock()
					runTimestamp = ""
					runMu.Unlock()
				}
				continue
			}

			frame := msg.Image
			select {
			case <-ctx.Done():
				return
			case incoming <- frame:
			}
		}
	}()

	var wg sync.WaitGroup
	wg.Add(cfg.Workers)
	for i := 0; i < cfg.Workers; i++ {
		go func() {
			defer wg.Done()
			for raw := range incoming {
				frame, ok := processing.ProcessRawFrame(raw)
				if !ok {
					continue
				}
				statusMu.Lock()
				status["stream"] = "receiving"
				status["last_frame"] = time.Now().Format(time.RFC3339)
				statusMu.Unlock()
				select {
				case <-ctx.Done():
					return
				case processed <- frame:
				}
			}
		}()
	}

	go func() {
		wg.Wait()
		close(processed)
	}()

	go func() {
		defer close(broadcast)
		for frame := range processed {
			if agg.AddFrame(frame) {
				runMu.Lock()
				if runTimestamp == "" {
					runTimestamp = processing.Timestamp()
				}
				ts := runTimestamp
				runMu.Unlock()

				statusMu.Lock()
				status["filewriter"] = "writing"
				statusMu.Unlock()
				if err := output.WriteSeries(cfg.OutputDir, ts, cfg.GridX, cfg.GridY, agg.Snapshot()); err != nil {
					log.Printf("output write failed: %v", err)
					statusMu.Lock()
					status["filewriter"] = "error"
					statusMu.Unlock()
				} else {
					log.Printf("wrote series outputs for %s", ts)
					statusMu.Lock()
					status["filewriter"] = "ok"
					status["last_write"] = time.Now().Format(time.RFC3339)
					statusMu.Unlock()
				}
				agg.Reset()
			}
			select {
			case <-ctx.Done():
				return
			case broadcast <- frame:
			}
		}
	}()

	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				statusMu.Lock()
				lastFrame, _ := status["last_frame"].(string)
				if lastFrame == "" {
					status["stream"] = "idle"
				}
				statusMu.Unlock()
			}
		}
	}()

	statusFn := func() map[string]any {
		statusMu.Lock()
		defer statusMu.Unlock()
		copy := map[string]any{}
		for k, v := range status {
			copy[k] = v
		}
		return copy
	}

	if err := server.Run(ctx, cfg, broadcast, statusFn); err != nil {
		log.Printf("server stopped: %v", err)
	}
}
