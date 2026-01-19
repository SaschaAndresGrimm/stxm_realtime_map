# main.py
import sys
import time
import logging
from typing import Any, Dict, Iterator, Optional
from multiprocessing import Process, Event, Queue
from queue import Empty
from worker import worker  # Import the worker function
import argparse
from logging.handlers import QueueListener
from logging_setup import setup_logging
import numpy as np
import pprint  # Import pprint for formatting data
from datetime import datetime  # Import datetime for timestamp
import matplotlib.pyplot as plt

# Constants for plotter settings
MIN_PLOT_FREQUENCY = 0.01  # Hz
DEBUG_SLEEP_INTERVAL = 0.001  # seconds

def save_start_or_end_data(data: Dict[str, Any], filename: str) -> None:
    # Save the data to a text file using pprint for formatting
    with open(filename, 'w') as f:
        f.write(pprint.pformat(data))


def collect_data_point(
    threshold: str,
    image_id: Optional[int],
    timestamp: Optional[float],
    value: int,
    collected_data: Dict[str, Dict[str, np.ndarray]],
    total_pixels: int,
    logger: logging.Logger,
) -> None:
    """Record a single (threshold, image_id, timestamp, value) data point."""
    if image_id is None or image_id < 0 or image_id >= total_pixels:
        logger.warning(f"Threshold {threshold}: Missing or out-of-range image_id, skipping entry")
        return

    if threshold not in collected_data:
        collected_data[threshold] = {
            'values': np.zeros(total_pixels, dtype=np.uint32),
            'mask': np.zeros(total_pixels, dtype=bool),
            'timestamps': np.zeros(total_pixels, dtype=np.float64),
        }
    collected_data[threshold]['values'][image_id] = value
    collected_data[threshold]['timestamps'][image_id] = timestamp
    collected_data[threshold]['mask'][image_id] = True


def maybe_update_plot(
    threshold: str,
    image_id: Optional[int],
    value: int,
    active_thresholds: set,
    plotter: Optional["RealtimeSTXMPlotter"],
    enable_plotting: bool,
    grid_x: int,
    grid_y: int,
    logger: logging.Logger,
    plot_frequency: float,
    plot_refresh_every: int,
) -> Optional["RealtimeSTXMPlotter"]:
    """Update plotter state for a single data point.

    Returns possibly-updated `plotter` instance.
    """
    active_thresholds.add(threshold)

    if enable_plotting and active_thresholds:
        if plotter is None:
            plotter = RealtimeSTXMPlotter(
                grid_x,
                grid_y,
                sorted(active_thresholds),
                logger,
                plot_frequency,
                update_every_n_frames=plot_refresh_every,
            )
        elif threshold not in plotter.thresholds:
            plotter.add_threshold(threshold)

    if plotter is not None and threshold in active_thresholds and image_id is not None:
        plotter.update(threshold, image_id, value)
        plotter.refresh_display()

    return plotter


def simulate_detector_data(
    grid_x: int,
    grid_y: int,
    num_frames: Optional[int] = None,
    acquisition_rate: float = 10.0,
) -> Iterator[Dict[str, Any]]:
    """Generator that yields simulated detector data for testing.
    
    Args:
        grid_x: Width of scan grid in pixels
        grid_y: Height of scan grid in pixels
        num_frames: Total number of frames to generate (None = infinite)
        acquisition_rate: Frames per second to simulate
    
    Yields:
        Dict with simulated frame data
    """
    frame_interval = 1.0 / acquisition_rate
    total_pixels = grid_x * grid_y
    image_id = 0
    frame_count = 0

    # Precompute base Gaussian pattern for the full grid.
    xs = np.arange(total_pixels) % grid_x
    ys = np.arange(total_pixels) // grid_x
    center_x, center_y = grid_x / 2, grid_y / 2
    dx = xs - center_x
    dy = ys - center_y
    distance = np.sqrt(dx**2 + dy**2)
    base_values = 1000 * np.exp(-(distance ** 2) / (grid_x * grid_y / 20))
    sqrt_base = np.sqrt(base_values)
    values_buffer = None
    
    if num_frames is not None:
        yield {'type': 'start', 'data': {'scan_id': 0}}

    while num_frames is None or frame_count < num_frames:
        # Vectorized noise per full scan, then index per pixel.
        if values_buffer is None or image_id == 0:
            noise = np.random.normal(0, sqrt_base)
            values_buffer = np.maximum(0, base_values + noise).astype(np.uint32)
        value = int(values_buffer[image_id])
        
        # Create message structure similar to real detector
        message = {
            'type': 'image',
            'image_id': image_id,
            'start_time': time.time(),
            'data': {
                'threshold_0': value,
                'threshold_1': int(value * 0.7),  # Secondary threshold with less counts
            }
        }
        
        yield message
        
        # Move to next position
        image_id = (image_id + 1) % total_pixels
        frame_count += 1
        time.sleep(frame_interval)

    if num_frames is not None:
        yield {'type': 'end', 'data': {'frames': frame_count}}


def save_collected_data(
    collected_data: Dict[str, Dict[str, np.ndarray]],
    run_timestamp: str,
    grid_x: int,
    grid_y: int,
    logger: logging.Logger,
) -> None:
    """Write collected per-threshold data to text files."""
    for threshold, data_bundle in collected_data.items():
        mask = data_bundle['mask']
        if not np.any(mask):
            logger.info(f"No data collected for threshold {threshold}. Skipping file creation.")
            continue

        image_ids = np.nonzero(mask)[0].astype(np.uint32)
        values = data_bundle['values'][mask].astype(np.uint32)
        timestamps = data_bundle['timestamps'][mask].astype(np.float64)
        x = (image_ids % grid_x).astype(np.uint32)
        y = (image_ids // grid_x).astype(np.uint32)

        output_array = np.column_stack((image_ids, x, y, timestamps, values))
        filename = f"{run_timestamp}_output_{threshold}_data.txt"
        header = 'image_index, x, y, timestamp, value'
        fmt = ['%d', '%d', '%d', '%.6f', '%d']
        np.savetxt(filename, output_array, fmt=fmt, delimiter=',', header=header, comments='')
        logger.info(f"Saved data for threshold {threshold} to {filename}")


def prompt_next_debug_scan(logger: logging.Logger) -> None:
    """Pause between debug scans so users can inspect the current output."""
    try:
        input("Debug mode: press Enter to start the next scan or Ctrl+C to quit...")
    except EOFError:
        logger.info("Debug mode: no stdin available; continuing to next scan.")


class RealtimeSTXMPlotter:
    """Real-time plotter for STXM maps with multiple thresholds."""
    
    def __init__(
        self,
        grid_x: int,
        grid_y: int,
        thresholds: list,
        logger: logging.Logger,
        update_frequency_hz: float = 1.0,
        update_every_n_frames: int = 0,
    ) -> None:
        """Initialize the plotter.
        
        Args:
            grid_x: Grid width in pixels
            grid_y: Grid height in pixels
            thresholds: List of threshold identifiers
            logger: Logger instance
            update_frequency_hz: Plot update frequency in Hz (default: 1.0 Hz)
            update_every_n_frames: Refresh plot every N frames (0 uses time-based refresh)
        """
        self.grid_x = grid_x
        self.grid_y = grid_y
        self.thresholds = thresholds
        self.logger = logger
        self.update_every_n_frames = max(0, int(update_every_n_frames))
        self.frame_count = 0
        
        # Enable interactive mode for better display handling
        plt.ion()
        
        # Calculate update interval in seconds
        self.update_interval = 1.0 / max(update_frequency_hz, MIN_PLOT_FREQUENCY)
        self.last_update_time = time.time()
        self.pending_update = False  # Track if there are pending changes
        
        # Create 2D arrays for each threshold
        self.maps = {threshold: np.zeros((grid_y, grid_x), dtype=np.float64) 
                     for threshold in thresholds}

        # Cache total pixels for fast bounds checking
        self.total_pixels = grid_x * grid_y
        
        # Create figure and subplots
        num_plots = len(thresholds)
        self.fig, self.axes = plt.subplots(1, num_plots)
        if num_plots == 1:
            self.axes = [self.axes]
        
        self.fig.suptitle('Real-time STXM Map')
        self.images = {}
        
        self._rebuild_layout()
        self.fig.show()
        self.logger.info(f"Created STXM plotter with grid {grid_x}x{grid_y}, update frequency {update_frequency_hz:.2f} Hz")

    def _rebuild_layout(self) -> None:
        """Rebuild the subplot layout from current thresholds and maps."""
        self.fig.clf()
        num_plots = len(self.thresholds)
        self.fig.set_size_inches(5 * num_plots, 5, forward=True)
        self.axes = self.fig.subplots(1, num_plots)
        if num_plots == 1:
            self.axes = [self.axes]
        self.fig.suptitle('Real-time STXM Map')
        self.images = {}
        for ax, thr in zip(self.axes, self.thresholds):
            im = ax.imshow(self.maps[thr], cmap='viridis', origin='lower',
                           extent=[0, self.grid_x, 0, self.grid_y])
            ax.set_xlabel('X (pixels)')
            ax.set_ylabel('Y (pixels)')
            ax.set_title(f'Threshold {thr}')
            self.images[thr] = im
            plt.colorbar(im, ax=ax, label='Count')
        plt.tight_layout()
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()

    def add_threshold(self, threshold: str) -> None:
        """Add a new threshold panel dynamically without closing the window."""
        if threshold in self.thresholds:
            return

        self.thresholds.append(threshold)
        self.thresholds = sorted(self.thresholds)
        self.maps[threshold] = np.zeros((self.grid_y, self.grid_x), dtype=np.float64)

        # Rebuild layout in-place so the window persists and maps are preserved.
        self._rebuild_layout()
        self.logger.info(f"Added threshold {threshold} to STXM plotter")
    
    def _update_display(self) -> None:
        """Internal method to update display data and refresh canvas."""
        missing = [threshold for threshold in self.thresholds if threshold not in self.images]
        if missing:
            self.logger.warning(f"Missing plot images for thresholds {missing}; rebuilding layout")
            self._rebuild_layout()
        for threshold in self.thresholds:
            vmin = np.nanmin(self.maps[threshold])
            vmax = np.nanmax(self.maps[threshold])
            self.images[threshold].set_data(self.maps[threshold])
            self.images[threshold].set_clim(vmin, vmax)
        self.fig.canvas.draw()
        self.fig.canvas.flush_events()
    
    def update(self, threshold: str, image_id: Optional[int], value: int) -> bool:
        """Update a specific position in the map for a given threshold.
        
        Args:
            threshold: Threshold identifier
            image_id: Unique image index/ID that maps to grid position
            value: The value to plot at this grid position
        """
        if threshold not in self.maps:
            self.logger.warning(f"Threshold {threshold} not in maps")
            return False
        
        # Bounds check using total pixels cache
        if image_id is None or image_id < 0 or image_id >= self.total_pixels:
            self.logger.warning(f"Image ID {image_id} is out of range for grid {self.grid_x}x{self.grid_y}")
            return False

        # Calculate (x, y) from linear image_id
        x = image_id % self.grid_x
        y = image_id // self.grid_x
        
        # Update the map
        self.maps[threshold][y, x] = value
        self.frame_count += 1
        return True
    
    def refresh_display(self) -> bool:
        """Update the display with current map data if update interval has passed.
        
        Returns:
            bool: True if display was updated, False if still waiting for update interval
        """
        if self.update_every_n_frames > 0:
            if self.frame_count % self.update_every_n_frames != 0:
                self.pending_update = True
                return False
            self._update_display()
            self.last_update_time = time.time()
            self.pending_update = False
            return True

        current_time = time.time()
        time_since_update = current_time - self.last_update_time
        
        # Only refresh if enough time has passed or this is the first update
        if time_since_update >= self.update_interval:
            self._update_display()
            self.last_update_time = current_time
            self.pending_update = False
            return True
        else:
            # Mark that we have pending updates
            self.pending_update = True
            return False
    
    def force_refresh(self) -> None:
        """Force an immediate display update regardless of interval."""
        self._update_display()
        self.last_update_time = time.time()
        self.pending_update = False
    
    def close(self) -> None:
        """Close the plot window."""
        plt.close(self.fig)

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Start the main process with worker processes.')
    parser.add_argument('--hostname', type=str, default='localhost',
                        help='Hostname or IP address to connect to (default: localhost)')
    parser.add_argument('--port', type=int, default=31001,
                        help='Port number to connect to (default: 31001)')
    parser.add_argument('--num-workers', type=int, default=8,
                        help='Number of worker processes to spawn (default: 8)')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Enable verbose logging (debug mode)')
    parser.add_argument('--extra-debug', action='store_true',
                        help='Enable very verbose debug logging (per-message)')
    parser.add_argument('--log-summary-interval', type=int, default=100,
                        help='Number of frames between worker summary debug logs (default: 100)')
    parser.add_argument('--grid-x', type=int, default=52,
                        help='Number of X pixels in the STXM grid (default: 52)')
    parser.add_argument('--grid-y', type=int, default=52,
                        help='Number of Y pixels in the STXM grid (default: 52)')
    parser.add_argument('--plot', action='store_true',
                        help='Enable real-time plotting of STXM maps')
    parser.add_argument('--plot-frequency', type=float, default=1.0,
                        help='Plot update frequency in Hz (default: 1.0). Useful for high-speed acquisition.')
    parser.add_argument('--plot-refresh-every', type=int, default=0,
                        help='Refresh plot every N frames (default: 0 to use time-based refresh)')
    parser.add_argument('--debug', action='store_true',
                        help='Run in debug mode with simulated data (no ZMQ connection needed)')
    parser.add_argument('--debug-acq-rate', type=float, default=100.0,
                        help='Simulated acquisition rate in frames per second (default: 10.0)')
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    # Set the logging level based on the verbosity flags
    # `--extra-debug` implies debug as well
    log_level = logging.DEBUG if (args.verbose or args.extra_debug) else logging.INFO

    # Set up logging in the main process
    log_queue = Queue()
    setup_logging(log_queue=None, level=log_level)  # Pass the log level to setup_logging
    logger = logging.getLogger('main')

    # Start QueueListener to handle logs from workers
    listener = QueueListener(log_queue, *logging.getLogger().handlers)
    listener.start()

    endpoint = f"tcp://{args.hostname}:{args.port}"
    num_workers = args.num_workers  # Number of worker processes
    grid_x = args.grid_x
    grid_y = args.grid_y
    enable_plotting = args.plot
    plot_frequency = args.plot_frequency
    plot_refresh_every = args.plot_refresh_every
    debug_mode = args.debug
    debug_acq_rate = args.debug_acq_rate

    workers = []
    stop_event = Event()  # Create an Event to signal workers to stop
    results_queue = Queue()  # Queue for collecting results from workers
    plotter = None  # Will be initialized when we know the thresholds

    # In debug mode, don't start workers - generate simulated data instead
    if not debug_mode:
        for _ in range(num_workers):
            p = Process(
                target=worker,
                args=(
                    endpoint,
                    stop_event,
                    log_queue,
                    results_queue,
                    log_level,
                    args.extra_debug,
                    args.log_summary_interval,
                ),
            )
            p.start()
            workers.append(p)
            logger.info(f"Started {p.name}")
    else:
        logger.info("Running in DEBUG mode with simulated data")

    try:
        logger.info(f"Main process is running with {num_workers} workers. Press Ctrl+C to stop.")

        while True:  # Main loop to process multiple series
            collected_data: Dict[str, Dict[str, np.ndarray]] = {}
            start_data_saved = False
            end_data_saved = False
            run_timestamp = None
            total_frame_count = 0
            active_thresholds = set()
            total_pixels = grid_x * grid_y
            series_processing = True

            debug_data_generator = None
            if debug_mode:
                debug_data_generator = simulate_detector_data(
                    grid_x,
                    grid_y,
                    num_frames=grid_x * grid_y,
                    acquisition_rate=debug_acq_rate,
                )

            # Start a fresh figure for each series; keep prior scans open
            plotter = None

            while series_processing and not stop_event.is_set():
                try:
                    if debug_mode and debug_data_generator is not None:
                        try:
                            result = next(debug_data_generator)
                        except StopIteration:
                            logger.info("Debug simulation complete")
                            series_processing = False
                            break
                    else:
                        result = results_queue.get(timeout=0.1)

                    result_type = result.get('type', 'data')

                    if result_type == 'start':
                        if not start_data_saved:
                            start_data = result['data']
                            run_timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                            filename = f'{run_timestamp}_start_data.txt'
                            save_start_or_end_data(start_data, filename)
                            logger.info(f"Saved start message data to {filename}")
                            start_data_saved = True
                        else:
                            logger.debug("Start data already saved. Ignoring duplicate.")
                    elif result_type == 'end':
                        if not end_data_saved:
                            end_data = result['data']
                            if not run_timestamp:
                                run_timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                            filename = f'{run_timestamp}_end_data.txt'
                            save_start_or_end_data(end_data, filename)
                            logger.info(f"Saved end message data to {filename}")
                            end_data_saved = True
                        else:
                            logger.debug("End data already saved. Ignoring duplicate.")
                        series_processing = False
                    elif result_type == 'image' and debug_mode:
                        image_id = result.get('image_id')
                        timestamp = result.get('start_time')
                        for threshold, value in result['data'].items():
                            collect_data_point(
                                threshold,
                                image_id,
                                timestamp,
                                value,
                                collected_data,
                                total_pixels,
                                logger,
                            )
                            plotter = maybe_update_plot(
                                threshold,
                                image_id,
                                value,
                                active_thresholds,
                                plotter,
                                enable_plotting,
                                grid_x,
                                grid_y,
                                logger,
                                plot_frequency,
                                plot_refresh_every,
                            )
                        total_frame_count += 1
                    elif result_type == 'data':
                        threshold = result['threshold']
                        image_id = result.get('image_id')
                        timestamp = result.get('timestamp')
                        value = result['data']
                        collect_data_point(
                            threshold,
                            image_id,
                            timestamp,
                            value,
                            collected_data,
                            total_pixels,
                            logger,
                        )
                        plotter = maybe_update_plot(
                            threshold,
                            image_id,
                            value,
                            active_thresholds,
                            plotter,
                            enable_plotting,
                            grid_x,
                            grid_y,
                            logger,
                            plot_frequency,
                            plot_refresh_every,
                        )
                    elif result_type == 'frame_count':
                        total_frame_count += result['count']
                        logger.debug(
                            f"Received frame count {result['count']} from {result['worker_name']}."
                        )
                    else:
                        logger.warning(f"Unknown result type received: {result_type}")
                except Empty:
                    pass
                except Exception as e:
                    logger.error(f"Error collecting result: {e}", exc_info=True)

                if debug_mode:
                    time.sleep(DEBUG_SLEEP_INTERVAL)

            logger.info("Writing collected data to text files...")
            if plotter is not None and plotter.pending_update:
                plotter.force_refresh()

            if not run_timestamp:
                run_timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            save_collected_data(collected_data, run_timestamp, grid_x, grid_y, logger)

            logger.info(f"Total frames received and processed by all workers: {total_frame_count}")
            logger.info("Series processing completed. Waiting for the next series to start.")
            if debug_mode:
                prompt_next_debug_scan(logger)

    except KeyboardInterrupt:
        logger.info("Main process received KeyboardInterrupt. Signaling workers to stop...")
        stop_event.set()

    if plotter is not None:
        plotter.close()

    if not debug_mode:
        for p in workers:
            p.join()
            logger.info(f"{p.name} has terminated.")

    listener.stop()
    logger.info("Main process exiting.")
    sys.exit(0)


if __name__ == "__main__":
    main()
