package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"

	"github.com/fxamacker/cbor/v2"
)

const (
	tagMultiDimArray = 40
	tagDectris       = 56500
)

func main() {
	path := flag.String("path", "", "Path to CBOR file or directory")
	limit := flag.Int("limit", 5, "Max number of image messages to summarize")
	flag.Parse()

	if *path == "" {
		log.Fatal("missing -path")
	}

	files, err := listFiles(*path)
	if err != nil {
		log.Fatalf("list files: %v", err)
	}

	var imageCount int
	var startCount int
	var endCount int

	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			log.Printf("read %s: %v", file, err)
			continue
		}

		msg, err := decodeMessage(data)
		if err != nil {
			log.Printf("decode %s: %v", file, err)
			continue
		}

		switch msg.Type {
		case "start":
			startCount++
			fmt.Printf("start: %s\n", file)
			fmt.Printf("  channels: %v\n", msg.Channels)
		case "end":
			endCount++
		case "image":
			imageCount++
			if imageCount <= *limit {
				fmt.Printf("image: %s\n", file)
				fmt.Printf("  image_id: %v\n", msg.ImageID)
				fmt.Printf("  series_id: %v\n", msg.SeriesID)
				for ch, info := range msg.ChannelInfo {
					fmt.Printf("  channel %s: %s\n", ch, info)
				}
			}
		}
	}

	fmt.Printf("summary: start=%d image=%d end=%d\n", startCount, imageCount, endCount)
}

type messageSummary struct {
	Type        string
	ImageID     any
	SeriesID    any
	Channels    []string
	ChannelInfo map[string]string
}

func decodeMessage(data []byte) (messageSummary, error) {
	var payload map[string]any
	if err := cbor.Unmarshal(data, &payload); err != nil {
		return messageSummary{}, err
	}
	msgType, _ := payload["type"].(string)
	summary := messageSummary{Type: msgType}
	switch msgType {
	case "start":
		if channels, ok := payload["channels"].([]any); ok {
			for _, ch := range channels {
				if s, ok := ch.(string); ok {
					summary.Channels = append(summary.Channels, s)
				}
			}
		}
	case "image":
		summary.ImageID = payload["image_id"]
		summary.SeriesID = payload["series_id"]
		summary.ChannelInfo = map[string]string{}
		if dataMap, ok := payload["data"].(map[string]any); ok {
			for ch, v := range dataMap {
				summary.ChannelInfo[ch] = describeData(v)
			}
		}
	}
	return summary, nil
}

func describeData(value any) string {
	tag, ok := value.(cbor.Tag)
	if !ok {
		return fmt.Sprintf("type %T", value)
	}
	if tag.Number != tagMultiDimArray {
		return fmt.Sprintf("tag %d", tag.Number)
	}
	items, ok := tag.Content.([]any)
	if !ok || len(items) != 2 {
		return "invalid multidim"
	}
	dims, ok := items[0].([]any)
	if !ok || len(dims) != 2 {
		return "invalid dims"
	}
	dataTag, _ := items[1].(cbor.Tag)
	if dataTag.Number == tagDectris {
		return fmt.Sprintf("dims %v (compressed)", dims)
	}
	return fmt.Sprintf("dims %v tag %d", dims, dataTag.Number)
}

func listFiles(path string) ([]string, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return []string{path}, nil
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if filepath.Ext(entry.Name()) == ".cbor" {
			files = append(files, filepath.Join(path, entry.Name()))
		}
	}
	sort.Strings(files)
	return files, nil
}
