import time
from typing import Any, Dict, Iterator, Optional

import numpy as np


def simulate_detector_data(
    grid_x: int,
    grid_y: int,
    num_frames: Optional[int] = None,
    acquisition_rate: float = 10.0,
) -> Iterator[Dict[str, Any]]:
    """Generator that yields simulated detector data for testing."""
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
        if values_buffer is None or image_id == 0:
            noise = np.random.normal(0, sqrt_base)
            values_buffer = np.maximum(0, base_values + noise).astype(np.uint32)
        value = int(values_buffer[image_id])

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

        image_id = (image_id + 1) % total_pixels
        frame_count += 1
        time.sleep(frame_interval)

    if num_frames is not None:
        yield {'type': 'end', 'data': {'frames': frame_count}}
