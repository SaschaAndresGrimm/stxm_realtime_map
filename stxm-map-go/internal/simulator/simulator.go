package simulator

import (
	"context"
	"math"
	"math/rand"
	"time"

	"stxm-map-go/internal/types"
)

func Stream(ctx context.Context, gridX, gridY int, acqRate float64) <-chan types.Frame {
	out := make(chan types.Frame)
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

				value := values[imageID]
				frame := types.Frame{
					ImageID:   imageID,
					StartTime: float64(time.Now().UnixNano()) / 1e9,
					Data: map[string]uint32{
						"threshold_0": value,
						"threshold_1": uint32(float64(value) * 0.7),
					},
				}
				out <- frame

				imageID++
				if imageID >= totalPixels {
					imageID = 0
				}
			}
		}
	}()

	return out
}
