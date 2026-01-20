package processing

import (
	"math"
	"reflect"

	"stxm-map-go/internal/types"
)

func ProcessRawFrame(raw types.RawFrame) (types.Frame, bool) {
	if raw.ImageID < 0 {
		return types.Frame{}, false
	}

	data := make(map[string]uint32, len(raw.Data))
	for threshold, payload := range raw.Data {
		value, ok := ProcessFrame(payload)
		if !ok {
			continue
		}
		data[threshold] = value
	}
	if len(data) == 0 {
		return types.Frame{}, false
	}

	return types.Frame{
		ImageID:   raw.ImageID,
		StartTime: raw.StartTime,
		Data:      data,
	}, true
}

func ProcessFrame(payload any) (uint32, bool) {
	switch v := payload.(type) {
	case []uint16:
		return countBelowMaxUint16(v), true
	case []uint32:
		return countBelowMaxUint32(v), true
	case []uint64:
		return countBelowMaxUint64(v), true
	case []uint8:
		return countBelowMaxUint8(v), true
	case []int:
		return countBelowMaxInt(v, int(math.MaxInt)), true
	case []int64:
		return countBelowMaxInt64(v, math.MaxInt64), true
	case [][]uint16:
		return countBelowMaxUint16(flattenUint16(v)), true
	case [][]uint32:
		return countBelowMaxUint32(flattenUint32(v)), true
	case [][]uint64:
		return countBelowMaxUint64(flattenUint64(v)), true
	case [][]uint8:
		return countBelowMaxUint8(flattenUint8(v)), true
	case [][]int:
		return countBelowMaxInt(flattenInt(v), int(math.MaxInt)), true
	case [][]int64:
		return countBelowMaxInt64(flattenInt64(v), math.MaxInt64), true
	case []any:
		return countBelowMaxAny(v)
	case [][]any:
		flat := make([]any, 0)
		for _, row := range v {
			flat = append(flat, row...)
		}
		return countBelowMaxAny(flat)
	default:
		rv := reflect.ValueOf(payload)
		if rv.Kind() == reflect.Slice {
			return countBelowMaxAny(sliceToAny(rv))
		}
		return 0, false
	}
}

func countBelowMaxUint16(values []uint16) uint32 {
	var count uint32
	for _, v := range values {
		if v < math.MaxUint16 {
			count++
		}
	}
	return count
}

func countBelowMaxUint32(values []uint32) uint32 {
	var count uint32
	for _, v := range values {
		if v < math.MaxUint32 {
			count++
		}
	}
	return count
}

func countBelowMaxUint64(values []uint64) uint32 {
	var count uint32
	for _, v := range values {
		if v < math.MaxUint64 {
			count++
		}
	}
	return count
}

func countBelowMaxUint8(values []uint8) uint32 {
	var count uint32
	for _, v := range values {
		if v < math.MaxUint8 {
			count++
		}
	}
	return count
}

func countBelowMaxInt(values []int, max int) uint32 {
	var count uint32
	for _, v := range values {
		if v < max {
			count++
		}
	}
	return count
}

func countBelowMaxInt64(values []int64, max int64) uint32 {
	var count uint32
	for _, v := range values {
		if v < max {
			count++
		}
	}
	return count
}

func countBelowMaxAny(values []any) (uint32, bool) {
	if len(values) == 0 {
		return 0, false
	}

	var count uint32
	switch values[0].(type) {
	case uint64, uint32, uint16, uint8, int64, int, float64:
		for _, v := range values {
			switch n := v.(type) {
			case uint64:
				if n < math.MaxUint64 {
					count++
				}
			case uint32:
				if n < math.MaxUint32 {
					count++
				}
			case uint16:
				if n < math.MaxUint16 {
					count++
				}
			case uint8:
				if n < math.MaxUint8 {
					count++
				}
			case int64:
				if n < math.MaxInt64 {
					count++
				}
			case int:
				if n < math.MaxInt {
					count++
				}
			case float64:
				if n < math.MaxFloat64 {
					count++
				}
			}
		}
		return count, true
	default:
		return 0, false
	}
}

func flattenUint16(values [][]uint16) []uint16 {
	flat := make([]uint16, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func flattenUint32(values [][]uint32) []uint32 {
	flat := make([]uint32, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func flattenUint64(values [][]uint64) []uint64 {
	flat := make([]uint64, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func flattenUint8(values [][]uint8) []uint8 {
	flat := make([]uint8, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func flattenInt(values [][]int) []int {
	flat := make([]int, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func flattenInt64(values [][]int64) []int64 {
	flat := make([]int64, 0)
	for _, row := range values {
		flat = append(flat, row...)
	}
	return flat
}

func sliceToAny(rv reflect.Value) []any {
	out := make([]any, rv.Len())
	for i := 0; i < rv.Len(); i++ {
		out[i] = rv.Index(i).Interface()
	}
	return out
}
