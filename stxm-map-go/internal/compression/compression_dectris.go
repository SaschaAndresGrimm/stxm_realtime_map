//go:build dectris

package compression

import "errors"

// TODO: wire CGO bindings to the native dectris compression library.
func Decompress(_ []byte, _ string, _ int) ([]byte, error) {
	return nil, errors.New("dectris compression binding not implemented")
}
