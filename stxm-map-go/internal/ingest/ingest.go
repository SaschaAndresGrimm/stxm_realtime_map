package ingest

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/pebbe/zmq4"

	"stxm-map-go/internal/types"
)

var decodeFailures atomic.Uint64
var decodeCount atomic.Uint64
var decodeNanos atomic.Uint64

func DecodeFailures() uint64 {
	return decodeFailures.Load()
}

func DecodeTiming() (count uint64, nanos uint64) {
	return decodeCount.Load(), decodeNanos.Load()
}

// Stream returns a channel of frames from a real detector.
// Expects CBOR messages shaped like the Python pipeline:
// { "type": "image", "image_id": <int>, "start_time": <float>, "data": { "threshold_0": <int>, ... } }
func Stream(ctx context.Context, endpoint string) (<-chan types.RawMessage, error) {
	return streamWithConfig(ctx, endpoint, 1, nil)
}

func StreamWithLogEvery(ctx context.Context, endpoint string, logEvery int) (<-chan types.RawMessage, error) {
	if logEvery < 1 {
		logEvery = 1
	}
	return streamWithConfig(ctx, endpoint, logEvery, nil)
}

type RawRecorder interface {
	Record(payload []byte) error
}

func StreamWithLogEveryAndRecorder(ctx context.Context, endpoint string, logEvery int, recorder RawRecorder) (<-chan types.RawMessage, error) {
	if logEvery < 1 {
		logEvery = 1
	}
	return streamWithConfig(ctx, endpoint, logEvery, recorder)
}

func streamWithConfig(ctx context.Context, endpoint string, logEvery int, recorder RawRecorder) (<-chan types.RawMessage, error) {
	socket, err := zmq4.NewSocket(zmq4.PULL)
	if err != nil {
		return nil, err
	}
	if err := socket.SetLinger(0); err != nil {
		_ = socket.Close()
		return nil, err
	}
	if err := socket.SetRcvtimeo(500 * time.Millisecond); err != nil {
		_ = socket.Close()
		return nil, err
	}
	if err := socket.Connect(endpoint); err != nil {
		_ = socket.Close()
		return nil, err
	}

	out := make(chan types.RawMessage, 128)
	go func() {
		defer close(out)
		defer socket.Close()

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			msg, err := socket.RecvBytes(0)
			if err != nil {
				if zmq4.AsErrno(err) == zmq4.Errno(syscall.EAGAIN) {
					continue
				}
				logEveryN(logEvery, "ingest recv error: %v", err)
				continue
			}

			if recorder != nil {
				if err := recorder.Record(msg); err != nil {
					logEveryN(logEvery, "ingest raw log error: %v", err)
				}
			}

			message, ok := decodeMessage(msg, logEvery)
			if !ok {
				logEveryN(logEvery, "ingest decode skipped message")
				continue
			}

			select {
			case <-ctx.Done():
				return
			case out <- message:
			}
		}
	}()

	return out, nil
}

func decodeMessage(msg []byte, logEvery int) (types.RawMessage, bool) {
	start := time.Now()
	defer func() {
		decodeCount.Add(1)
		decodeNanos.Add(uint64(time.Since(start).Nanoseconds()))
	}()

	var payload map[string]any
	if err := cbor.Unmarshal(msg, &payload); err != nil {
		logEveryN(logEvery, "ingest CBOR decode error: %v", err)
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}

	msgType, _ := payload["type"].(string)
	if msgType == "" {
		logEveryN(logEvery, "ingest missing message type")
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}

	if msgType != "image" {
		meta := make(map[string]any, len(payload))
		for key, value := range payload {
			if key == "type" {
				continue
			}
			meta[key] = value
		}
		return types.RawMessage{
			Type: msgType,
			Meta: meta,
		}, true
	}

	dataRaw, ok := toStringMap(payload["data"])
	if !ok {
		logEveryN(logEvery, "ingest invalid data field")
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}

	decoded := make(map[string]any, len(dataRaw))
	for key, value := range dataRaw {
		array, err := decodeMultiDimArray(value)
		if err != nil {
			logEveryN(logEvery, "ingest failed to decode %s: %v", key, err)
			continue
		}
		decoded[key] = array
	}
	if len(decoded) == 0 {
		logEveryN(logEvery, "ingest image had no decoded channels")
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}

	imageID, err := toInt(payload["image_id"])
	if err != nil {
		logEveryN(logEvery, "ingest invalid image_id: %v", err)
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}
	startTime, err := parseTimeValue(payload["start_time"])
	if err != nil {
		logEveryN(logEvery, "ingest invalid start_time: %v", err)
		decodeFailures.Add(1)
		return types.RawMessage{}, false
	}

	return types.RawMessage{
		Type: "image",
		Image: types.RawFrame{
			ImageID:   imageID,
			StartTime: startTime,
			Data:      decoded,
		},
	}, true
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
	default:
		return 0, fmt.Errorf("unsupported int type %T", v)
	}
}

func toFloat(v any) (float64, error) {
	switch n := v.(type) {
	case float64:
		return n, nil
	case float32:
		return float64(n), nil
	case int:
		return float64(n), nil
	case int64:
		return float64(n), nil
	case uint64:
		return float64(n), nil
	case uint32:
		return float64(n), nil
	default:
		return 0, fmt.Errorf("unsupported float type %T", v)
	}
}

func parseTimeValue(v any) (float64, error) {
	if v == nil {
		return 0, errors.New("missing time value")
	}
	switch t := v.(type) {
	case []any:
		if len(t) != 2 {
			return 0, fmt.Errorf("invalid time array length %d", len(t))
		}
		sec, err := toFloat(t[0])
		if err != nil {
			return 0, err
		}
		nsec, err := toFloat(t[1])
		if err != nil {
			return 0, err
		}
		return sec + nsec*1e-9, nil
	default:
		return toFloat(t)
	}
}

func toStringMap(v any) (map[string]any, bool) {
	if typed, ok := v.(map[string]any); ok {
		return typed, true
	}
	raw, ok := v.(map[any]any)
	if !ok {
		return nil, false
	}
	out := make(map[string]any, len(raw))
	for key, value := range raw {
		ks, ok := key.(string)
		if !ok {
			return nil, false
		}
		out[ks] = value
	}
	return out, true
}

// toUint32 kept for future typed-array helpers.
func toUint32(v any) (uint32, error) {
	switch n := v.(type) {
	case uint32:
		return n, nil
	case uint64:
		return uint32(n), nil
	case int:
		return uint32(n), nil
	case int64:
		return uint32(n), nil
	case float64:
		return uint32(n), nil
	default:
		return 0, errors.New("unsupported uint type")
	}
}

var logCounter int

func logEveryN(n int, format string, args ...any) {
	logCounter++
	if logCounter%n == 0 {
		log.Printf(format, args...)
	}
}
