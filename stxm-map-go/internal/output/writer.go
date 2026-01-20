package output

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"stxm-map-go/internal/processing"
)

func WriteSeries(
	outputDir string,
	runTimestamp string,
	gridX int,
	gridY int,
	data map[string]*processing.ThresholdData,
) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}

	for threshold, bundle := range data {
		filename := filepath.Join(outputDir, fmt.Sprintf("%s_output_%s_data.txt", runTimestamp, threshold))
		f, err := os.Create(filename)
		if err != nil {
			return err
		}

		_, _ = fmt.Fprintln(f, "image_index, x, y, timestamp, value")
		for imageID, ok := range bundle.Mask {
			if !ok {
				continue
			}
			x := imageID % gridX
			y := imageID / gridX
			_, _ = fmt.Fprintf(
				f,
				"%d, %d, %d, %.6f, %d\n",
				imageID,
				x,
				y,
				bundle.Timestamps[imageID],
				bundle.Values[imageID],
			)
		}
		_ = f.Close()
	}
	return nil
}

func WriteMetadata(outputDir, runTimestamp, kind string, meta map[string]any) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}

	filename := filepath.Join(outputDir, fmt.Sprintf("%s_%s_data.txt", runTimestamp, kind))
	f, err := os.Create(filename)
	if err != nil {
		return err
	}
	defer f.Close()

	encoder := json.NewEncoder(f)
	encoder.SetIndent("", "  ")
	return encoder.Encode(meta)
}
