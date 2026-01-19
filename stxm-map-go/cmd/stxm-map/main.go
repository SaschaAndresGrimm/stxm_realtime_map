package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
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
		port         = flag.Int("port", 8888, "HTTP port for the web UI")
		endpoint     = flag.String("endpoint", "tcp://localhost:31001", "ZMQ endpoint")
		gridX        = flag.Int("grid-x", 52, "Grid width in pixels")
		gridY        = flag.Int("grid-y", 52, "Grid height in pixels")
		debug        = flag.Bool("debug", true, "Run with simulated data")
		debugAcqRate = flag.Float64("debug-acq-rate", 100.0, "Simulated acquisition rate (frames/sec)")
		outputDir    = flag.String("output-dir", "output", "Directory for output data files")
		ingestLogEvery = flag.Int("ingest-log-every", 100, "Log every Nth ingest error")
		ingestFallback = flag.Bool("ingest-fallback", true, "Fall back to simulator when ingest fails")
	)
	flag.Parse()

	cfg := config.AppConfig{
		Port:          *port,
		Endpoint:      *endpoint,
		GridX:         *gridX,
		GridY:         *gridY,
		Debug:         *debug,
		DebugAcqRate:  *debugAcqRate,
		PlotThreshold: []string{"threshold_0", "threshold_1"},
		OutputDir:     *outputDir,
		IngestLogEvery: *ingestLogEvery,
		IngestFallback: *ingestFallback,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var frames <-chan types.Frame
	if cfg.Debug {
		frames = simulator.Stream(ctx, cfg.GridX, cfg.GridY, cfg.DebugAcqRate)
	} else {
		ingestFrames, err := ingest.StreamWithLogEvery(ctx, cfg.Endpoint, cfg.IngestLogEvery)
		if err != nil {
			if cfg.IngestFallback {
				log.Printf("failed to start ingest: %v; falling back to simulator", err)
				frames = simulator.Stream(ctx, cfg.GridX, cfg.GridY, cfg.DebugAcqRate)
			} else {
				log.Fatalf("failed to start ingest: %v", err)
			}
		} else {
			frames = ingestFrames
		}
	}

	log.Printf("Starting web UI at http://localhost:%d\n", cfg.Port)

	broadcast := make(chan types.Frame, 128)
	agg := processing.NewAggregator(cfg.GridX, cfg.GridY)

	go func() {
		defer close(broadcast)
		for frame := range frames {
			if agg.AddFrame(frame) {
				runTimestamp := processing.Timestamp()
				if err := output.WriteSeries(cfg.OutputDir, runTimestamp, cfg.GridX, cfg.GridY, agg.Snapshot()); err != nil {
					log.Printf("output write failed: %v", err)
				} else {
					log.Printf("wrote series outputs for %s", runTimestamp)
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
