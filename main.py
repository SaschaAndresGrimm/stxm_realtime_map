# main.py
import sys
import time
import logging
from typing import Dict
from multiprocessing import Process, Event, Queue
from queue import Empty
from worker import worker  # Import the worker function
import argparse
from logging.handlers import QueueListener
from logging_setup import setup_logging
from datetime import datetime  # Import datetime for timestamp

from data_collection import collect_data_point, maybe_update_plot
from io_utils import prompt_next_debug_scan, save_collected_data, save_start_or_end_data
from simulation import simulate_detector_data

DEBUG_SLEEP_INTERVAL = 0.001  # seconds

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
