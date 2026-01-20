package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"stxm-map-go/internal/config"
	"stxm-map-go/internal/ingest"
	"stxm-map-go/internal/output"
	"stxm-map-go/internal/processing"
	"stxm-map-go/internal/server"
	"stxm-map-go/internal/simulator"
	"stxm-map-go/internal/types"
)

func main() {
	var (
		port           = flag.Int("port", 8888, "HTTP port for the web UI")
		endpoint       = flag.String("endpoint", "tcp://localhost:31001", "ZMQ endpoint")
		workers        = flag.Int("workers", 4, "Number of processing workers")
		gridX          = flag.Int("grid-x", 52, "Grid width in pixels")
		gridY          = flag.Int("grid-y", 52, "Grid height in pixels")
		debug          = flag.Bool("debug", true, "Run with simulated data")
		debugAcqRate   = flag.Float64("debug-acq-rate", 100.0, "Simulated acquisition rate (frames/sec)")
		outputDir      = flag.String("output-dir", "output", "Directory for output data files")
		ingestLogEvery = flag.Int("ingest-log-every", 100, "Log every Nth ingest error")
		ingestFallback = flag.Bool("ingest-fallback", true, "Fall back to simulator when ingest fails")
	)
	flag.Parse()

	cfg := config.AppConfig{
		Port:           *port,
		Endpoint:       *endpoint,
		Workers:        *workers,
		GridX:          *gridX,
		GridY:          *gridY,
		Debug:          *debug,
		DebugAcqRate:   *debugAcqRate,
		PlotThreshold:  []string{"threshold_0", "threshold_1"},
		OutputDir:      *outputDir,
		IngestLogEvery: *ingestLogEvery,
		IngestFallback: *ingestFallback,
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

	if cfg.Workers < 1 {
		cfg.Workers = 1
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

				if err := output.WriteSeries(cfg.OutputDir, ts, cfg.GridX, cfg.GridY, agg.Snapshot()); err != nil {
					log.Printf("output write failed: %v", err)
				} else {
					log.Printf("wrote series outputs for %s", ts)
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

	if err := server.Run(ctx, cfg, broadcast); err != nil {
		log.Printf("server stopped: %v", err)
	}
}
