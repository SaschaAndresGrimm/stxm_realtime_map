package types

type Frame struct {
	ImageID   int               `json:"image_id"`
	StartTime float64           `json:"start_time"`
	Data      map[string]uint32 `json:"data"`
}

type RawFrame struct {
	ImageID   int
	StartTime float64
	Data      map[string]any
}

type RawMessage struct {
	Type  string
	Image RawFrame
	Meta  map[string]any
}
