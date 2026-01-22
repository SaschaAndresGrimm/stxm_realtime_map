# STXM Map (Go + Web UI)

Minimal Go prototype with a web UI (embedded assets) streaming simulated frames.

## Run (requires Go)

```bash
go mod tidy
go run ./cmd/stxm-map --port 8888 --grid-x 52 --grid-y 52 --debug --debug-acq-rate 100 --output-dir output
```

Open `http://localhost:8888` in your browser.

## Notes

- Currently uses the simulator only. ZMQ/CBOR ingest is the next step.
- `--detector-ip` sets the detector IP for both ZMQ ingest and SIMPLON status polling.
- `--api-port` sets the SIMPLON API port (default: 80).
- `--zmq-port` sets the ZMQ port (default: 31001).
- `--endpoint` is used for ZMQ ingest when `--detector-ip` is not set.
- `--simplon-interval` sets the polling interval for detector status (default: 1s).
- `--ingest-log-every` controls ingest error log frequency (default: 100).
- `--ingest-fallback` toggles simulator fallback on ingest failure.
- `--workers` sets the number of processing workers.
- Web assets are embedded via `//go:embed`.

## Example (ingest mode)

```bash
go run ./cmd/stxm-map --port 8888 --endpoint tcp://localhost:31001 --ingest-log-every 500 --ingest-fallback=false
```

## Output Files

Files are written to the output directory once a full scan completes:

- `{timestamp}_output_{threshold}_data.txt` with columns `image_index, x, y, timestamp, value`
- `{timestamp}_start_data.txt` and `{timestamp}_end_data.txt` for series metadata

## Processing

The Go pipeline expects 2D unsigned integer frame payloads and computes
per-threshold counts as the number of pixels below the maximum value for
that data type (mirrors the Python `processFrame` behavior).

## Endpoints

- `GET /healthz` returns `ok`
- `GET /config` returns JSON configuration for grid/thresholds

## CBOR Decode Harness

Inspect Stream V2 CBOR dumps without full decompression:

```bash
go run ./cmd/stxm-decode -path internal/simulator/cbor_testdata -limit 3
```

## Dectris Compression (cgo)

To enable tag 56500 decompression, place the dectris `compression` repo at
`stxm-map-go/internal/compression/dectris` (symlink is fine) and build with:

```bash
go run -tags dectris ./cmd/stxm-map --debug
```
