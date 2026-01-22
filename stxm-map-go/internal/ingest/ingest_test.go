package ingest

import (
	"testing"

	"github.com/fxamacker/cbor/v2"
)

func TestDecodeMessageImage(t *testing.T) {
	msg := map[string]any{
		"type":       "image",
		"image_id":   7,
		"start_time": 1.25,
		"data": map[string]any{
			"threshold_0": cbor.Tag{
				Number: tagMultiDimArray,
				Content: []any{
					[]any{1, 2},
					cbor.Tag{
						Number:  tagUint8,
						Content: []byte{10, 20},
					},
				},
			},
		},
	}

	payload, err := cbor.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	raw, ok := decodeMessage(payload, 1)
	if !ok {
		t.Fatalf("decodeMessage returned ok=false")
	}

	if raw.Type != "image" {
		t.Fatalf("unexpected type: %q", raw.Type)
	}
	if raw.Image.ImageID != 7 {
		t.Fatalf("unexpected image_id: %d", raw.Image.ImageID)
	}
	if raw.Image.StartTime != 1.25 {
		t.Fatalf("unexpected start_time: %v", raw.Image.StartTime)
	}

	if len(raw.Image.Data) != 1 {
		t.Fatalf("unexpected data length: %d", len(raw.Image.Data))
	}
	value, ok := raw.Image.Data["threshold_0"]
	if !ok {
		t.Fatalf("missing threshold_0")
	}
	matrix, ok := value.([][]uint8)
	if !ok {
		t.Fatalf("unexpected data type %T", value)
	}
	if len(matrix) != 1 || len(matrix[0]) != 2 {
		t.Fatalf("unexpected matrix shape: %#v", matrix)
	}
	if matrix[0][0] != 10 || matrix[0][1] != 20 {
		t.Fatalf("unexpected matrix values: %#v", matrix)
	}
}
