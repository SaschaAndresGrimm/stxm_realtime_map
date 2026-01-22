package types

type ThresholdSnapshot struct {
	Values []uint32 `json:"values"`
	Mask   []bool   `json:"mask"`
}

type UISnapshot struct {
	Type string                       `json:"type"`
	Data map[string]ThresholdSnapshot `json:"data"`
}
