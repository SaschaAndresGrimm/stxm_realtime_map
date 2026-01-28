package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
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

type metrics struct {
	rawMessages      atomic.Uint64
	imageMessages    atomic.Uint64
	metaMessages     atomic.Uint64
	framesProcessed  atomic.Uint64
	framesBroadcast  atomic.Uint64
	outputWriteOK    atomic.Uint64
	outputWriteError atomic.Uint64
	metadataWriteErr atomic.Uint64
	processCount     atomic.Uint64
	processNanos     atomic.Uint64
	writeCount       atomic.Uint64
	writeNanos       atomic.Uint64
}

func (m *metrics) snapshot() map[string]any {
	return map[string]any{
		"raw_messages_total":       m.rawMessages.Load(),
		"image_messages_total":     m.imageMessages.Load(),
		"meta_messages_total":      m.metaMessages.Load(),
		"frames_processed_total":   m.framesProcessed.Load(),
		"frames_broadcast_total":   m.framesBroadcast.Load(),
		"output_write_ok_total":    m.outputWriteOK.Load(),
		"output_write_err_total":   m.outputWriteError.Load(),
		"metadata_write_err_total": m.metadataWriteErr.Load(),
		"process_total":            m.processCount.Load(),
		"process_nanos_total":      m.processNanos.Load(),
		"write_total":              m.writeCount.Load(),
		"write_nanos_total":        m.writeNanos.Load(),
	}
}

func main() {
	var (
		port            = flag.Int("port", 8888, "HTTP port for the web UI")
		detectorIP      = flag.String("detector-ip", "", "Detector IP used for ZMQ and SIMPLON API endpoints")
		apiPort         = flag.Int("api-port", 80, "SIMPLON API port")
		apiVersion      = flag.String("simplon-api-version", "1.8.0", "SIMPLON API version")
		zmqPort         = flag.Int("zmq-port", 31001, "ZMQ port")
		endpoint        = flag.String("endpoint", "tcp://localhost:31001", "ZMQ endpoint (used when detector-ip is empty)")
		simplonInterval = flag.Duration("simplon-interval", 1*time.Second, "Polling interval for SIMPLON status")
		workers         = flag.Int("workers", 4, "Number of processing workers")
		gridX           = flag.Int("grid-x", 52, "Grid width in pixels")
		gridY           = flag.Int("grid-y", 52, "Grid height in pixels")
		debug           = flag.Bool("debug", false, "Run with simulated data")
		debugAcqRate    = flag.Float64("debug-acq-rate", 100.0, "Simulated acquisition rate (frames/sec)")
		uiRate          = flag.Duration("ui-rate", 1*time.Second, "UI update interval for websocket clients")
		outputDir       = flag.String("output-dir", "output", "Directory for output data files")
		rawLogEnabled   = flag.Bool("raw-log", false, "Write raw CBOR messages to disk")
		rawLogDir       = flag.String("raw-log-dir", "rawlog", "Directory for raw ingest logs")
		ingestLogEvery  = flag.Int("ingest-log-every", 100, "Log every Nth ingest error")
		ingestFallback  = flag.Bool("ingest-fallback", true, "Fall back to simulator when ingest fails")
	)
	flag.Parse()

	resolvedEndpoint := *endpoint
	simplonBaseURL := ""
	detectorIPValue := *detectorIP
	zmqPortValue := *zmqPort
	apiPortValue := *apiPort
	if *detectorIP != "" {
		resolvedEndpoint = fmt.Sprintf("tcp://%s:%d", *detectorIP, *zmqPort)
		simplonBaseURL = fmt.Sprintf("http://%s:%d", *detectorIP, *apiPort)
	}

	cfg := config.AppConfig{
		Port:                *port,
		Endpoint:            resolvedEndpoint,
		SimplonPollInterval: *simplonInterval,
		SimplonAPIVersion:   *apiVersion,
		SimplonBaseURL:      simplonBaseURL,
		Workers:             *workers,
		GridX:               *gridX,
		GridY:               *gridY,
		Debug:               *debug,
		DebugAcqRate:        *debugAcqRate,
		UIRate:              *uiRate,
		RawLogEnabled:       *rawLogEnabled,
		RawLogDir:           *rawLogDir,
		PlotThreshold:       []string{"threshold_0", "threshold_1"},
		OutputDir:           *outputDir,
		IngestLogEvery:      *ingestLogEvery,
		IngestFallback:      *ingestFallback,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	gridXVal := cfg.GridX
	gridYVal := cfg.GridY
	var gridMu sync.RWMutex
	getGrid := func() (int, int) {
		gridMu.RLock()
		defer gridMu.RUnlock()
		return gridXVal, gridYVal
	}
	setGrid := func(x, y int) {
		gridMu.Lock()
		gridXVal = x
		gridYVal = y
		gridMu.Unlock()
	}

	var rawMessages <-chan types.RawMessage
	endpointUpdates := make(chan string, 1)
	if cfg.Debug {
		rawMessages = simulator.Stream(ctx, cfg.GridX, cfg.GridY, cfg.DebugAcqRate)
	} else {
		out := make(chan types.RawMessage, 128)
		rawMessages = out
		var recorder ingest.RawRecorder
		if cfg.RawLogEnabled {
			writer, err := output.NewRawLogWriter(cfg.RawLogDir, "raw_cbor")
			if err != nil {
				log.Fatalf("failed to start raw log: %v", err)
			}
			recorder = writer
			go func() {
				<-ctx.Done()
				if err := writer.Close(); err != nil {
					log.Printf("raw log close failed: %v", err)
				}
			}()
		}
		go func() {
			defer close(out)
			currentEndpoint := resolvedEndpoint
			var ingestCancel context.CancelFunc
			var ingestCh <-chan types.RawMessage
			startIngest := func(endpoint string) {
				if ingestCancel != nil {
					ingestCancel()
				}
				ingestCtx, cancel := context.WithCancel(ctx)
				ingestCancel = cancel
				frames, err := ingest.StreamWithLogEveryAndRecorder(ingestCtx, endpoint, cfg.IngestLogEvery, recorder)
				if err != nil {
					if cfg.IngestFallback {
						log.Printf("failed to start ingest: %v; falling back to simulator", err)
						x, y := getGrid()
						ingestCh = simulator.Stream(ingestCtx, x, y, cfg.DebugAcqRate)
					} else {
						log.Fatalf("failed to start ingest: %v", err)
					}
				} else {
					ingestCh = frames
				}
			}
			startIngest(currentEndpoint)
			for {
				select {
				case <-ctx.Done():
					if ingestCancel != nil {
						ingestCancel()
					}
					return
				case endpoint := <-endpointUpdates:
					if endpoint == "" {
						continue
					}
					currentEndpoint = endpoint
					startIngest(currentEndpoint)
				case msg, ok := <-ingestCh:
					if !ok {
						startIngest(currentEndpoint)
						continue
					}
					select {
					case <-ctx.Done():
						return
					case out <- msg:
					}
				}
			}
		}()
	}

	log.Printf("Starting web UI at http://localhost:%d\n", cfg.Port)

	processed := make(chan types.Frame, 128)
	incoming := make(chan types.RawFrame, 128)
	uiMessages := make(chan any, 16)
	agg := processing.NewAggregator(gridXVal, gridYVal)
	runTimestamp := ""
	var runMu sync.Mutex
	var statusMu sync.Mutex
	var metrics metrics
	var latestSnapshotMu sync.Mutex
	var latestSnapshot types.UISnapshot
	var hasSnapshot bool
	var thresholdsMu sync.Mutex
	currentThresholds := append([]string(nil), cfg.PlotThreshold...)
	var runMuStatus sync.Mutex
	var runStartMeta map[string]any
	var runEndMeta map[string]any
	var framesExpected int
	var framesReceived int
	var imageStatsMu sync.Mutex
	var imageStats map[string]map[string]float64
	status := map[string]any{
		"detector":    "unknown",
		"stream":      "idle",
		"filewriter":  "idle",
		"monitor":     "ok",
		"last_frame":  "",
		"last_write":  "",
		"last_ingest": "",
	}
	type gridUpdate struct {
		x int
		y int
	}
	gridUpdates := make(chan gridUpdate, 1)

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

	var simplonMu sync.Mutex
	var simplonCancel context.CancelFunc
	startSimplonPoll := func(baseURL string) {
		if cfg.Debug || baseURL == "" {
			return
		}
		simplonMu.Lock()
		defer simplonMu.Unlock()
		if simplonCancel != nil {
			simplonCancel()
		}
		pollCtx, cancel := context.WithCancel(ctx)
		simplonCancel = cancel
		go simplon.Poll(pollCtx, baseURL, cfg.SimplonAPIVersion, cfg.SimplonPollInterval, func(update simplon.Status) {
			statusMu.Lock()
			status["detector"] = update.Detector
			status["stream"] = update.Stream
			status["filewriter"] = update.Filewriter
			status["monitor"] = update.Monitor
			statusMu.Unlock()
		})
	}
	startSimplonPoll(simplonBaseURL)

	go func() {
		defer close(incoming)
		for msg := range rawMessages {
			metrics.rawMessages.Add(1)
			statusMu.Lock()
			status["last_ingest"] = time.Now().Format(time.RFC3339)
			statusMu.Unlock()
			if msg.Type != "image" {
				metrics.metaMessages.Add(1)
				if msg.Type == "start" {
					normalized := output.NormalizeJSONValue(msg.Meta)
					log.Printf("start meta:\n%s", mustPrettyJSON(normalized))
					if metaMap, ok := normalized.(map[string]any); ok {
						runMuStatus.Lock()
						runStartMeta = metaMap
						runEndMeta = nil
						framesReceived = 0
						if v, ok := metaMap["number_of_images"]; ok {
							if n, err := toInt(v); err == nil {
								framesExpected = n
							}
						}
						runMuStatus.Unlock()
					}
					if channels := extractChannels(msg.Meta); len(channels) > 0 {
						thresholdsMu.Lock()
						currentThresholds = channels
						thresholdsMu.Unlock()
						x, y := getGrid()
						select {
						case uiMessages <- map[string]any{
							"type":       "config",
							"grid_x":     x,
							"grid_y":     y,
							"thresholds": channels,
						}:
						default:
						}
					}
				} else if msg.Type == "end" {
					normalized := output.NormalizeJSONValue(msg.Meta)
					log.Printf("end meta:\n%s", mustPrettyJSON(normalized))
					if metaMap, ok := normalized.(map[string]any); ok {
						runMuStatus.Lock()
						runEndMeta = metaMap
						runMuStatus.Unlock()
					}
				}
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
					metrics.metadataWriteErr.Add(1)
					log.Printf("metadata write failed: %v", err)
				}
				if msg.Type == "end" {
					runMu.Lock()
					runTimestamp = ""
					runMu.Unlock()
				}
				continue
			}

			metrics.imageMessages.Add(1)
			frame := msg.Image
			runMuStatus.Lock()
			framesReceived++
			runMuStatus.Unlock()
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
				start := time.Now()
				frame, ok := processing.ProcessRawFrame(raw)
				metrics.processCount.Add(1)
				metrics.processNanos.Add(uint64(time.Since(start).Nanoseconds()))
				if !ok {
					continue
				}
				metrics.framesProcessed.Add(1)
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
		defer close(uiMessages)
		if cfg.UIRate <= 0 {
			cfg.UIRate = 1 * time.Second
		}
		ticker := time.NewTicker(cfg.UIRate)
		defer ticker.Stop()
		for {
			select {
			case update := <-gridUpdates:
				if update.x < 1 || update.y < 1 {
					continue
				}
				setGrid(update.x, update.y)
				agg = processing.NewAggregator(update.x, update.y)
				latestSnapshotMu.Lock()
				hasSnapshot = false
				latestSnapshot = types.UISnapshot{}
				latestSnapshotMu.Unlock()
				runMuStatus.Lock()
				framesExpected = 0
				framesReceived = 0
				runMuStatus.Unlock()
				thresholdsMu.Lock()
				thresholds := append([]string(nil), currentThresholds...)
				thresholdsMu.Unlock()
				select {
				case uiMessages <- map[string]any{
					"type":       "config",
					"grid_x":     update.x,
					"grid_y":     update.y,
					"thresholds": thresholds,
				}:
				default:
				}
			case <-ctx.Done():
				return
			case frame, ok := <-processed:
				if !ok {
					flushSnapshot(&metrics, uiMessages, agg, &latestSnapshotMu, &latestSnapshot, &hasSnapshot, &imageStatsMu, &imageStats)
					return
				}
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
					writeStart := time.Now()
					x, y := getGrid()
					err := output.WriteSeries(cfg.OutputDir, ts, x, y, agg.Snapshot())
					metrics.writeCount.Add(1)
					metrics.writeNanos.Add(uint64(time.Since(writeStart).Nanoseconds()))
					if err != nil {
						metrics.outputWriteError.Add(1)
						log.Printf("output write failed: %v", err)
						statusMu.Lock()
						status["filewriter"] = "error"
						statusMu.Unlock()
					} else {
						metrics.outputWriteOK.Add(1)
						log.Printf("wrote series outputs for %s", ts)
						statusMu.Lock()
						status["filewriter"] = "ok"
						status["last_write"] = time.Now().Format(time.RFC3339)
						statusMu.Unlock()
					}
					agg.Reset()
				}
			case <-ticker.C:
				flushSnapshot(&metrics, uiMessages, agg, &latestSnapshotMu, &latestSnapshot, &hasSnapshot, &imageStatsMu, &imageStats)
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

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				snapshot := metrics.snapshot()
				log.Printf("ingest stats: raw=%v image=%v meta=%v decode_failures=%v",
					snapshot["raw_messages_total"],
					snapshot["image_messages_total"],
					snapshot["meta_messages_total"],
					ingest.DecodeFailures(),
				)
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
		metricsPayload := metrics.snapshot()
		metricsPayload["ingest_decode_failures_total"] = ingest.DecodeFailures()
		decodeCount, decodeNanos := ingest.DecodeTiming()
		metricsPayload["ingest_decode_total"] = decodeCount
		metricsPayload["ingest_decode_nanos_total"] = decodeNanos
		copy["metrics"] = metricsPayload
		runMuStatus.Lock()
		if runStartMeta != nil {
			copy["run_start"] = runStartMeta
		}
		if runEndMeta != nil {
			copy["run_end"] = runEndMeta
		}
		copy["frames_expected"] = framesExpected
		copy["frames_received"] = framesReceived
		runMuStatus.Unlock()
		imageStatsMu.Lock()
		if imageStats != nil {
			copy["image_stats"] = imageStats
		}
		imageStatsMu.Unlock()
		return copy
	}

	snapshotFn := func() any {
		latestSnapshotMu.Lock()
		defer latestSnapshotMu.Unlock()
		if !hasSnapshot {
			return nil
		}
		return latestSnapshot
	}

	configFn := func() map[string]any {
		thresholdsMu.Lock()
		defer thresholdsMu.Unlock()
		x, y := getGrid()
		simplonMu.Lock()
		currentBaseURL := simplonBaseURL
		simplonMu.Unlock()
		return map[string]any{
			"type":             "config",
			"grid_x":           x,
			"grid_y":           y,
			"thresholds":       append([]string(nil), currentThresholds...),
			"detector_ip":      detectorIPValue,
			"zmq_port":         zmqPortValue,
			"api_port":         apiPortValue,
			"endpoint":         resolvedEndpoint,
			"simplon_base_url": currentBaseURL,
		}
	}

	gridFn := func(x, y int) error {
		select {
		case gridUpdates <- gridUpdate{x: x, y: y}:
			return nil
		default:
			return fmt.Errorf("grid update already pending")
		}
	}

	endpointFn := func(ip string, zmqPort int, apiPort int) error {
		if ip == "" || zmqPort < 1 || apiPort < 1 {
			return fmt.Errorf("invalid endpoint configuration")
		}
		detectorIPValue = ip
		zmqPortValue = zmqPort
		apiPortValue = apiPort
		resolvedEndpoint = fmt.Sprintf("tcp://%s:%d", ip, zmqPort)
		simplonBaseURL = fmt.Sprintf("http://%s:%d", ip, apiPort)
		startSimplonPoll(simplonBaseURL)
		select {
		case endpointUpdates <- resolvedEndpoint:
		default:
		}
		return nil
	}

	if err := server.Run(ctx, cfg, uiMessages, statusFn, snapshotFn, configFn, gridFn, endpointFn); err != nil {
		log.Printf("server stopped: %v", err)
	}
}

func flushSnapshot(metrics *metrics, uiMessages chan any, agg *processing.Aggregator, latestSnapshotMu *sync.Mutex, latestSnapshot *types.UISnapshot, hasSnapshot *bool, imageStatsMu *sync.Mutex, imageStats *map[string]map[string]float64) {
	snapshotData := agg.SnapshotCopy()
	if len(snapshotData) == 0 {
		return
	}
	if imageStatsMu != nil && imageStats != nil {
		stats := make(map[string]map[string]float64, len(snapshotData))
		for threshold, payload := range snapshotData {
			minVal := float64(0)
			maxVal := float64(0)
			sum := float64(0)
			count := 0.0
			initialized := false
			for i, value := range payload.Values {
				if len(payload.Mask) > 0 && !payload.Mask[i] {
					continue
				}
				v := float64(value)
				if !initialized {
					minVal = v
					maxVal = v
					initialized = true
				} else {
					if v < minVal {
						minVal = v
					}
					if v > maxVal {
						maxVal = v
					}
				}
				sum += v
				count++
			}
			mean := 0.0
			if count > 0 {
				mean = sum / count
			}
			stats[threshold] = map[string]float64{
				"min":  minVal,
				"max":  maxVal,
				"mean": mean,
			}
		}
		imageStatsMu.Lock()
		*imageStats = stats
		imageStatsMu.Unlock()
	}
	message := types.UISnapshot{
		Type: "snapshot",
		Data: snapshotData,
	}
	latestSnapshotMu.Lock()
	*latestSnapshot = message
	*hasSnapshot = true
	latestSnapshotMu.Unlock()
	select {
	case uiMessages <- message:
		metrics.framesBroadcast.Add(1)
	default:
	}
}

func mustPrettyJSON(value any) string {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprintf(`{"error":"%v"}`, err)
	}
	return string(data)
}

func extractChannels(meta map[string]any) []string {
	if meta == nil {
		return nil
	}
	norm, ok := output.NormalizeJSONValue(meta).(map[string]any)
	if !ok {
		return nil
	}
	raw, ok := norm["channels"]
	if !ok {
		return nil
	}
	list, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(list))
	for _, item := range list {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func toInt(v any) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case uint64:
		return int(n), nil
	case uint32:
		return int(n), nil
	case float64:
		return int(n), nil
	case float32:
		return int(n), nil
	default:
		return 0, fmt.Errorf("unsupported int type %T", v)
	}
}
