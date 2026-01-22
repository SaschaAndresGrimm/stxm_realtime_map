package output

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const rawLogMagic = "STXMRAW1"

type RawLogWriter struct {
	mu sync.Mutex
	f  *os.File
	w  *bufio.Writer
}

func NewRawLogWriter(outputDir string, prefix string) (*RawLogWriter, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return nil, err
	}
	timestamp := time.Now().Format("20060102_150405")
	filename := filepath.Join(outputDir, fmt.Sprintf("%s_%s.bin", timestamp, prefix))
	f, err := os.Create(filename)
	if err != nil {
		return nil, err
	}
	w := bufio.NewWriterSize(f, 1024*1024)
	if _, err := w.WriteString(rawLogMagic); err != nil {
		_ = f.Close()
		return nil, err
	}
	if err := w.Flush(); err != nil {
		_ = f.Close()
		return nil, err
	}
	return &RawLogWriter{
		f: f,
		w: w,
	}, nil
}

func (r *RawLogWriter) Record(payload []byte) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.w == nil {
		return fmt.Errorf("raw log writer is closed")
	}
	var header [12]byte
	binary.LittleEndian.PutUint64(header[:8], uint64(time.Now().UnixNano()))
	binary.LittleEndian.PutUint32(header[8:12], uint32(len(payload)))
	if _, err := r.w.Write(header[:]); err != nil {
		return err
	}
	if _, err := r.w.Write(payload); err != nil {
		return err
	}
	return r.w.Flush()
}

func (r *RawLogWriter) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.w == nil {
		return nil
	}
	if err := r.w.Flush(); err != nil {
		_ = r.f.Close()
		r.w = nil
		return err
	}
	err := r.f.Close()
	r.w = nil
	return err
}
