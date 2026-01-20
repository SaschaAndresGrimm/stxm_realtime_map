package simulator

import (
	"context"
	"math"
	"math/rand"
	"time"

	"stxm-map-go/internal/types"
)

func Stream(ctx context.Context, gridX, gridY int, acqRate float64) <-chan types.RawMessage {
	out := make(chan types.RawMessage)
	go func() {
		defer close(out)

		totalPixels := gridX * gridY
		frameInterval := time.Duration(float64(time.Second) / acqRate)
		ticker := time.NewTicker(frameInterval)
		defer ticker.Stop()

		baseValues := make([]float64, totalPixels)
		sqrtBase := make([]float64, totalPixels)
		for i := 0; i < totalPixels; i++ {
			x := float64(i % gridX)
			y := float64(i / gridX)
			centerX := float64(gridX) / 2.0
			centerY := float64(gridY) / 2.0
			dx := x - centerX
			dy := y - centerY
			distance := math.Sqrt(dx*dx + dy*dy)
			base := 1000 * math.Exp(-(distance*distance)/(float64(gridX*gridY)/20))
			baseValues[i] = base
			sqrtBase[i] = math.Sqrt(base)
		}

		values := make([]uint32, totalPixels)
		imageID := 0
		scanID := 0

		out <- types.RawMessage{
			Type: "start",
			Meta: map[string]any{
				"scan_id": scanID,
			},
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if imageID == 0 {
					for i := 0; i < totalPixels; i++ {
						noise := rand.NormFloat64() * sqrtBase[i]
						val := baseValues[i] + noise
						if val < 0 {
							val = 0
						}
						values[i] = uint32(val)
					}
				}

				image0 := make([][]uint16, gridY)
				image1 := make([][]uint16, gridY)
				for y := 0; y < gridY; y++ {
					row0 := make([]uint16, gridX)
					row1 := make([]uint16, gridX)
					for x := 0; x < gridX; x++ {
						idx := y*gridX + x
						val := uint16(values[idx])
						row0[x] = val
						row1[x] = uint16(float64(val) * 0.7)
					}
					image0[y] = row0
					image1[y] = row1
				}

				frame := types.RawFrame{
					ImageID:   imageID,
					StartTime: float64(time.Now().UnixNano()) / 1e9,
					Data: map[string]any{
						"threshold_0": image0,
						"threshold_1": image1,
					},
				}
				out <- types.RawMessage{
					Type:  "image",
					Image: frame,
				}

				if imageID == totalPixels-1 {
					out <- types.RawMessage{
						Type: "end",
						Meta: map[string]any{
							"frames": totalPixels,
						},
					}
					scanID++
					out <- types.RawMessage{
						Type: "start",
						Meta: map[string]any{
							"scan_id": scanID,
						},
					}
					imageID = 0
				} else {
					imageID++
				}
			}
		}
	}()

	return out
}
