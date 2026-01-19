import logging
from typing import Dict, Optional

import numpy as np

from plotter import RealtimeSTXMPlotter


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
    plotter: Optional[RealtimeSTXMPlotter],
    enable_plotting: bool,
    grid_x: int,
    grid_y: int,
    logger: logging.Logger,
    plot_frequency: float,
    plot_refresh_every: int,
) -> Optional[RealtimeSTXMPlotter]:
    """Update plotter state for a single data point."""
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
