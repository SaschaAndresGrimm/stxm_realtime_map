//go:build !dectris

package compression

import "errors"

func Decompress(_ []byte, _ string, _ int) ([]byte, error) {
	return nil, errors.New("dectris compression not enabled; build with -tags dectris")
}
