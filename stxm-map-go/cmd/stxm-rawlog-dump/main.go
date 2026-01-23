package main

import (
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"github.com/fxamacker/cbor/v2"

	"stxm-map-go/internal/output"
)

const rawLogMagic = "STXMRAW1"

func main() {
	var (
		path  = flag.String("path", "", "Path to rawlog .bin file")
		limit = flag.Int("limit", 1, "Number of records to dump")
	)
	flag.Parse()

	if *path == "" {
		log.Fatal("path is required")
	}

	f, err := os.Open(*path)
	if err != nil {
		log.Fatalf("open rawlog: %v", err)
	}
	defer f.Close()

	header := make([]byte, len(rawLogMagic))
	if _, err := io.ReadFull(f, header); err != nil {
		log.Fatalf("read magic: %v", err)
	}
	if string(header) != rawLogMagic {
		log.Fatalf("unexpected rawlog magic %q", string(header))
	}

	count := 0
	for {
		if *limit > 0 && count >= *limit {
			return
		}
		var meta [12]byte
		if _, err := io.ReadFull(f, meta[:]); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return
			}
			log.Fatalf("read record header: %v", err)
		}
		ts := int64(binary.LittleEndian.Uint64(meta[:8]))
		size := binary.LittleEndian.Uint32(meta[8:12])
		if size == 0 {
			log.Printf("record %d: empty payload", count)
			continue
		}
		payload := make([]byte, size)
		if _, err := io.ReadFull(f, payload); err != nil {
			log.Fatalf("read payload: %v", err)
		}

		var decoded any
		if err := cbor.Unmarshal(payload, &decoded); err != nil {
			log.Printf("record %d: CBOR decode error: %v", count, err)
			continue
		}

		normalized := output.NormalizeJSONValue(decoded)
		pretty, err := json.MarshalIndent(normalized, "", "  ")
		if err != nil {
			log.Printf("record %d: JSON encode error: %v", count, err)
			continue
		}

		log.Printf("record %d timestamp=%s size=%d", count, time.Unix(0, ts).Format(time.RFC3339Nano), size)
		fmt.Println(string(pretty))
		count++
	}
}
