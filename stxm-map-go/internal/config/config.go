package config

import "time"

type AppConfig struct {
	Port                int
	Endpoint            string
	SimplonPollInterval time.Duration
	Workers             int
	GridX               int
	GridY               int
	Debug               bool
	DebugAcqRate        float64
	UIRate              time.Duration
	RawLogEnabled       bool
	RawLogDir           string
	PlotThreshold       []string
	OutputDir           string
	IngestLogEvery      int
	IngestFallback      bool
}
