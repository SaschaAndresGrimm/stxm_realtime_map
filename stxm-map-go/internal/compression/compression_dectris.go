//go:build dectris

package compression

/*
#cgo CFLAGS: -I${SRCDIR}/dectris/src -I${SRCDIR}/dectris/third_party/bitshuffle/src -I${SRCDIR}/dectris/third_party/lz4/lib
#include "dectris/src/compression.h"
#include "dectris/src/compression.c"
#include "dectris/third_party/bitshuffle/src/bitshuffle.c"
#include "dectris/third_party/lz4/lib/lz4.c"
*/
import "C"

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"unsafe"
)

func Decompress(encoded []byte, algorithm string, elemSize int) ([]byte, error) {
	alg, err := parseAlgorithm(algorithm)
	if err != nil {
		return nil, err
	}
	if elemSize <= 0 {
		return nil, fmt.Errorf("invalid element size %d", elemSize)
	}
	if len(encoded) == 0 {
		return []byte{}, nil
	}

	src := (*C.char)(unsafe.Pointer(&encoded[0]))
	srcSize := C.size_t(len(encoded))
	elem := C.size_t(elemSize)

	required := C.compression_decompress_buffer(alg, nil, 0, src, srcSize, elem)
	if required == C.COMPRESSION_ERROR {
		return nil, errors.New("dectris decompression failed (size query)")
	}
	if required == 0 {
		return []byte{}, nil
	}
	if required > C.size_t(math.MaxInt) {
		return nil, errors.New("decompressed size exceeds Go limits")
	}

	dst := make([]byte, int(required))
	out := C.compression_decompress_buffer(
		alg,
		(*C.char)(unsafe.Pointer(&dst[0])),
		C.size_t(len(dst)),
		src,
		srcSize,
		elem,
	)
	if out == C.COMPRESSION_ERROR || out != required {
		return nil, errors.New("dectris decompression failed")
	}
	return dst, nil
}

func parseAlgorithm(value string) (C.CompressionAlgorithm, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bslz4", "bs-lz4", "bitshuffle-lz4":
		return C.COMPRESSION_BSLZ4, nil
	case "lz4":
		return C.COMPRESSION_LZ4, nil
	default:
		return 0, fmt.Errorf("unsupported compression algorithm %q", value)
	}
}
