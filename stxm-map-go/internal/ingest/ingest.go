package ingest

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/fxamacker/cbor/v2"
	"github.com/pebbe/zmq4"

	"stxm-map-go/internal/types"
)

// Stream returns a channel of frames from a real detector.
// Expects CBOR messages shaped like the Python pipeline:
// { "type": "image", "image_id": <int>, "start_time": <float>, "data": { "threshold_0": <int>, ... } }
func Stream(ctx context.Context, endpoint string) (<-chan types.Frame, error) {
	return streamWithConfig(ctx, endpoint, 1)
}

func StreamWithLogEvery(ctx context.Context, endpoint string, logEvery int) (<-chan types.Frame, error) {
	if logEvery < 1 {
		logEvery = 1
	}
	return streamWithConfig(ctx, endpoint, logEvery)
}

func streamWithConfig(ctx context.Context, endpoint string, logEvery int) (<-chan types.Frame, error) {
	socket, err := zmq4.NewSocket(zmq4.PULL)
	if err != nil {
		return nil, err
	}
	if err := socket.Connect(endpoint); err != nil {
		_ = socket.Close()
		return nil, err
	}

	out := make(chan types.Frame, 128)
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
				logEveryN(logEvery, "ingest recv error: %v", err)
				continue
			}

			frame, ok := decodeFrame(msg, logEvery)
			if !ok {
				logEveryN(logEvery, "ingest decode skipped message")
				continue
			}

			select {
			case <-ctx.Done():
				return
			case out <- frame:
			}
		}
	}()

	return out, nil
}

func decodeFrame(msg []byte, logEvery int) (types.Frame, bool) {
	var payload map[string]any
	if err := cbor.Unmarshal(msg, &payload); err != nil {
		logEveryN(logEvery, "ingest CBOR decode error: %v", err)
		return types.Frame{}, false
	}

	msgType, _ := payload["type"].(string)
	if msgType != "image" {
		logEveryN(logEvery, "ingest ignoring message type %q", msgType)
		return types.Frame{}, false
	}

	imageID, err := toInt(payload["image_id"])
	if err != nil {
		logEveryN(logEvery, "ingest invalid image_id: %v", err)
		return types.Frame{}, false
	}
	startTime, err := toFloat(payload["start_time"])
	if err != nil {
		logEveryN(logEvery, "ingest invalid start_time: %v", err)
		return types.Frame{}, false
	}

	dataRaw, ok := payload["data"].(map[string]any)
	if !ok {
		logEveryN(logEvery, "ingest invalid data field")
		return types.Frame{}, false
	}

	data := make(map[string]uint32, len(dataRaw))
	for key, value := range dataRaw {
		count, err := toUint32(value)
		if err != nil {
			logEveryN(logEvery, "ingest invalid threshold %q: %v", key, err)
			continue
		}
		data[key] = count
	}
	if len(data) == 0 {
		logEveryN(logEvery, "ingest message had no usable thresholds")
		return types.Frame{}, false
	}

	return types.Frame{
		ImageID:   imageID,
		StartTime: startTime,
		Data:      data,
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
	default:
		return 0, fmt.Errorf("unsupported float type %T", v)
	}
}

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
