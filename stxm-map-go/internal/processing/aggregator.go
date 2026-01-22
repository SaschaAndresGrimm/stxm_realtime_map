package processing

import (
	"time"

	"stxm-map-go/internal/types"
)

type ThresholdData struct {
	Values     []uint32
	Timestamps []float64
	Mask       []bool
}

type Aggregator struct {
	gridX       int
	gridY       int
	totalPixels int
	frameCount  int
	data        map[string]*ThresholdData
}

func NewAggregator(gridX, gridY int) *Aggregator {
	return &Aggregator{
		gridX:       gridX,
		gridY:       gridY,
		totalPixels: gridX * gridY,
		data:        make(map[string]*ThresholdData),
	}
}

func (a *Aggregator) AddFrame(frame types.Frame) bool {
	if frame.ImageID < 0 || frame.ImageID >= a.totalPixels {
		return false
	}

	for threshold, value := range frame.Data {
		td, ok := a.data[threshold]
		if !ok {
			td = &ThresholdData{
				Values:     make([]uint32, a.totalPixels),
				Timestamps: make([]float64, a.totalPixels),
				Mask:       make([]bool, a.totalPixels),
			}
			a.data[threshold] = td
		}
		td.Values[frame.ImageID] = value
		td.Timestamps[frame.ImageID] = frame.StartTime
		td.Mask[frame.ImageID] = true
	}

	a.frameCount++
	if a.frameCount >= a.totalPixels {
		return true
	}
	return false
}

func (a *Aggregator) Reset() {
	a.frameCount = 0
	a.data = make(map[string]*ThresholdData)
}

func (a *Aggregator) Snapshot() map[string]*ThresholdData {
	return a.data
}

func (a *Aggregator) SnapshotCopy() map[string]types.ThresholdSnapshot {
	snapshot := make(map[string]types.ThresholdSnapshot, len(a.data))
	for threshold, data := range a.data {
		values := make([]uint32, len(data.Values))
		copy(values, data.Values)
		mask := make([]bool, len(data.Mask))
		copy(mask, data.Mask)
		snapshot[threshold] = types.ThresholdSnapshot{
			Values: values,
			Mask:   mask,
		}
	}
	return snapshot
}

func Timestamp() string {
	return time.Now().Format("20060102_150405")
}
