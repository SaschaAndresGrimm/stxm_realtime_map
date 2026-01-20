package config

type AppConfig struct {
	Port          int
	Endpoint      string
	Workers       int
	GridX         int
	GridY         int
	Debug         bool
	DebugAcqRate  float64
	PlotThreshold []string
	OutputDir     string
	IngestLogEvery int
	IngestFallback bool
}
