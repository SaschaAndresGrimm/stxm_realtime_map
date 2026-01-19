package types

type Frame struct {
	ImageID   int               `json:"image_id"`
	StartTime float64           `json:"start_time"`
	Data      map[string]uint32 `json:"data"`
}
