package ingest

import (
	"reflect"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

func TestDecodeMultiDimArrayUint8(t *testing.T) {
	value := cbor.Tag{
		Number: tagMultiDimArray,
		Content: []any{
			[]any{2, 2},
			cbor.Tag{
				Number:  tagUint8,
				Content: []byte{1, 2, 3, 4},
			},
		},
	}

	got, err := decodeMultiDimArray(value)
	if err != nil {
		t.Fatalf("decodeMultiDimArray error: %v", err)
	}

	want := [][]uint8{
		{1, 2},
		{3, 4},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("decodeMultiDimArray mismatch: got %#v want %#v", got, want)
	}
}
