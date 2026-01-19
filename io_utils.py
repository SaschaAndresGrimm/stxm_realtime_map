from typing import Any, Dict

import logging
import numpy as np
import pprint


def save_start_or_end_data(data: Dict[str, Any], filename: str) -> None:
    """Save the start or end metadata to disk."""
    with open(filename, 'w') as f:
        f.write(pprint.pformat(data))


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
