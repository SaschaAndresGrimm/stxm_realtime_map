# STXM Map Real-Time Plotting and Data Processing

Stream-based STXM (Scanning Transmission X-ray Microscopy) data processor with real-time visualization and parallel processing.

## Installation

```bash
pip install numpy pyzmq cbor2 dectris-compression matplotlib
```

## Quick Start

### Real Detector (Production)
```bash
python main.py --hostname <detector-ip> --port 31001 --num-workers 8 --plot --grid-x 256 --grid-y 256
```

### Debug Mode (Testing - No Detector Needed)
```bash
python main.py --debug --plot --grid-x 256 --grid-y 256 --debug-acq-rate 100
```
## Command-Line Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--hostname` | localhost | ZMQ endpoint hostname |
| `--port` | 31001 | ZMQ port |
| `--num-workers` | 8 | Number of parallel worker processes |
| `--grid-x` | 52 | Scan grid width (pixels) |
| `--grid-y` | 52 | Scan grid height (pixels) |
| `--plot` | - | Enable real-time STXM map visualization |
| `--plot-frequency` | 1.0 | Plot update rate in Hz |
| `--plot-refresh-every` | 0 | Refresh plot every N frames (0 uses time-based refresh) |
| `--debug` | - | Run with simulated data (no ZMQ needed) |
| `--debug-acq-rate` | 100.0 | Simulated acquisition rate (frames/sec) |
| `-v, --verbose` | - | Enable debug logging |

## Usage Examples

**Basic data processing:**
```bash
python main.py --hostname 192.168.1.100 --port 31001 --num-workers 16
```

**High-speed acquisition with plotting (200 Hz acq, 10 Hz plot updates):**
```bash
python main.py --debug --plot --plot-frequency 10 --debug-acq-rate 200
```

**Large scan with slow updates:**
```bash
python main.py --debug --plot --grid-x 512 --grid-y 512 --plot-frequency 0.5
```

**Verbose debug mode:**
```bash
python main.py --debug --plot -v
```

## Output Files

All files are timestamped with format: `YYYYMMDD_HHMMSS`

- **Start data:** `{timestamp}_start_data.txt` - Acquisition metadata
- **End data:** `{timestamp}_end_data.txt` - Series completion data
- **Scan data:** `{timestamp}_output_{threshold}_data.txt` - Detector counts with columns: `image_index, x, y, timestamp, value`

## Logging

All application logs are written to: `stxm_map_debug.log`

## Features

✓ Real-time STXM map visualization with configurable update rate  
✓ Multi-threshold support (displays side-by-side heatmaps)  
✓ Asynchronous image processing (handles out-of-order arrivals via image_id)  
✓ Parallel worker processes for high-speed data handling (0.1 Hz - 4000+ Hz per point)  
✓ Debug mode with realistic simulated Gaussian spatial patterns  
✓ Graceful shutdown with Ctrl+C  
✓ Continuous multi-series operation  

## Data Format

Input: CBOR-encoded ZMQ messages with structure:
```python
{
    'type': 'image',
    'image_id': <int>,
    'start_time': <timestamp>,
    'data': {
        'threshold_0': <count>,
        'threshold_1': <count>,
        ...
    }
}
```

Output: CSV with header `image_index, x, y, timestamp, value`

## Scripts

- **main.py** - Main orchestrator, handles data collection and plotting
- **worker.py** - Parallel worker processes, connects to ZMQ endpoint
- **processing.py** - Frame processing logic (customize here)
- **logging_setup.py** - Logging configuration
- **plotter.py** - Real-time plotting utilities
- **simulation.py** - Debug-mode simulated data generator
- **data_collection.py** - Data aggregation and plot update helpers
- **io_utils.py** - Output and debug prompt helpers

## Performance Notes

- Adjust `--num-workers` based on CPU cores
- Use `--plot-frequency` to prevent display bottlenecks at high acquisition rates
- Debug mode simulates acquisition; real detector data bypasses this simulation
- Grid dimensions determine memory usage and processing time per series
