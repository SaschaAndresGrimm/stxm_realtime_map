package ingest

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"

	"github.com/fxamacker/cbor/v2"

	"stxm-map-go/internal/compression"
)

const (
	tagMultiDimArray = 40
	tagUint8         = 64
	tagUint16LE      = 69
	tagUint32LE      = 70
	tagFloat32LE     = 85
	tagDectris       = 56500
)

func decodeMultiDimArray(value any) (any, error) {
	tag, ok := value.(cbor.Tag)
	if !ok || tag.Number != tagMultiDimArray {
		return nil, fmt.Errorf("expected multidim tag 40")
	}

	items, ok := tag.Content.([]any)
	if !ok || len(items) != 2 {
		return nil, fmt.Errorf("invalid multidim array content")
	}

	dimsRaw, ok := items[0].([]any)
	if !ok || len(dimsRaw) != 2 {
		return nil, fmt.Errorf("invalid multidim dimensions")
	}

	rows, err := toInt(dimsRaw[0])
	if err != nil {
		return nil, err
	}
	cols, err := toInt(dimsRaw[1])
	if err != nil {
		return nil, err
	}

	flat, err := decodeTypedArray(items[1])
	if err != nil {
		return nil, err
	}

	switch v := flat.(type) {
	case []uint8:
		return reshapeUint8(v, rows, cols)
	case []uint16:
		return reshapeUint16(v, rows, cols)
	case []uint32:
		return reshapeUint32(v, rows, cols)
	case []float32:
		return reshapeFloat32(v, rows, cols)
	default:
		return nil, errors.New("unsupported typed array type")
	}
}

func decodeTypedArray(value any) (any, error) {
	tag, ok := value.(cbor.Tag)
	if !ok {
		return nil, fmt.Errorf("expected typed array tag")
	}

	dataBytes, err := extractBytes(tag)
	if err != nil {
		return nil, err
	}

	switch tag.Number {
	case tagUint8:
		return dataBytes, nil
	case tagUint16LE:
		return bytesToUint16(dataBytes), nil
	case tagUint32LE:
		return bytesToUint32(dataBytes), nil
	case tagFloat32LE:
		return bytesToFloat32(dataBytes), nil
	default:
		return nil, fmt.Errorf("unsupported typed array tag %d", tag.Number)
	}
}

func extractBytes(tag cbor.Tag) ([]byte, error) {
	switch v := tag.Content.(type) {
	case []byte:
		return v, nil
	case cbor.Tag:
		if v.Number != tagDectris {
			return nil, fmt.Errorf("unsupported nested tag %d", v.Number)
		}
		return decompressDectris(v)
	default:
		return nil, fmt.Errorf("unsupported typed array content %T", v)
	}
}

func decompressDectris(tag cbor.Tag) ([]byte, error) {
	items, ok := tag.Content.([]any)
	if !ok || len(items) != 3 {
		return nil, errors.New("invalid dectris tag content")
	}
	algorithm, ok := items[0].(string)
	if !ok {
		return nil, errors.New("invalid dectris algorithm")
	}
	elemSize, err := toInt(items[1])
	if err != nil {
		return nil, err
	}
	encoded, ok := items[2].([]byte)
	if !ok {
		return nil, errors.New("invalid dectris payload")
	}
	return compression.Decompress(encoded, algorithm, elemSize)
}

func bytesToUint16(data []byte) []uint16 {
	out := make([]uint16, len(data)/2)
	for i := 0; i < len(out); i++ {
		out[i] = binary.LittleEndian.Uint16(data[i*2 : i*2+2])
	}
	return out
}

func bytesToUint32(data []byte) []uint32 {
	out := make([]uint32, len(data)/4)
	for i := 0; i < len(out); i++ {
		out[i] = binary.LittleEndian.Uint32(data[i*4 : i*4+4])
	}
	return out
}

func bytesToFloat32(data []byte) []float32 {
	out := make([]float32, len(data)/4)
	for i := 0; i < len(out); i++ {
		bits := binary.LittleEndian.Uint32(data[i*4 : i*4+4])
		out[i] = math.Float32frombits(bits)
	}
	return out
}

func reshapeUint8(flat []uint8, rows, cols int) ([][]uint8, error) {
	if rows*cols != len(flat) {
		return nil, errors.New("dimension mismatch")
	}
	out := make([][]uint8, rows)
	for r := 0; r < rows; r++ {
		row := make([]uint8, cols)
		copy(row, flat[r*cols:(r+1)*cols])
		out[r] = row
	}
	return out, nil
}

func reshapeUint16(flat []uint16, rows, cols int) ([][]uint16, error) {
	if rows*cols != len(flat) {
		return nil, errors.New("dimension mismatch")
	}
	out := make([][]uint16, rows)
	for r := 0; r < rows; r++ {
		row := make([]uint16, cols)
		copy(row, flat[r*cols:(r+1)*cols])
		out[r] = row
	}
	return out, nil
}

func reshapeUint32(flat []uint32, rows, cols int) ([][]uint32, error) {
	if rows*cols != len(flat) {
		return nil, errors.New("dimension mismatch")
	}
	out := make([][]uint32, rows)
	for r := 0; r < rows; r++ {
		row := make([]uint32, cols)
		copy(row, flat[r*cols:(r+1)*cols])
		out[r] = row
	}
	return out, nil
}

func reshapeFloat32(flat []float32, rows, cols int) ([][]float32, error) {
	if rows*cols != len(flat) {
		return nil, errors.New("dimension mismatch")
	}
	out := make([][]float32, rows)
	for r := 0; r < rows; r++ {
		row := make([]float32, cols)
		copy(row, flat[r*cols:(r+1)*cols])
		out[r] = row
	}
	return out, nil
}
