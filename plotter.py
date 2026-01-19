import logging
import time
from typing import Optional

import matplotlib.pyplot as plt
import numpy as np

MIN_PLOT_FREQUENCY = 0.01  # Hz


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
        self.logger.info(
            f"Created STXM plotter with grid {grid_x}x{grid_y}, update frequency {update_frequency_hz:.2f} Hz"
        )

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
            im = ax.imshow(
                self.maps[thr],
                cmap='viridis',
                origin='lower',
                extent=[0, self.grid_x, 0, self.grid_y],
            )
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
        """Update a specific position in the map for a given threshold."""
        if threshold not in self.maps:
            self.logger.warning(f"Threshold {threshold} not in maps")
            return False

        # Bounds check using total pixels cache
        if image_id is None or image_id < 0 or image_id >= self.total_pixels:
            self.logger.warning(
                f"Image ID {image_id} is out of range for grid {self.grid_x}x{self.grid_y}"
            )
            return False

        x = image_id % self.grid_x
        y = image_id // self.grid_x
        self.maps[threshold][y, x] = value
        self.frame_count += 1
        return True

    def refresh_display(self) -> bool:
        """Update the display with current map data if update interval has passed."""
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
        if time_since_update >= self.update_interval:
            self._update_display()
            self.last_update_time = current_time
            self.pending_update = False
            return True

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
