# processing.py
from typing import Optional

import numpy as np

def processFrame(data: np.ndarray) -> Optional[np.uint32]:
    """
    Processes a frame by finding all pixels with values < max of data type.

    Parameters:
        data (np.ndarray): A 2D NumPy array of unsigned integers representing the image data.

    Returns:
        np.uint32 or None: The summed mask value.
    """
    
    # Get the maximum value for the data type
    max_value = np.iinfo(data.dtype).max

    # Create a mask for pixels with values < max_value
    mask = (data < max_value)

    # Count of pixels meeting the criteria
    summed = np.sum(mask)

    result = summed.astype(np.uint32)

    # (Debug logging removed to reduce per-frame logging noise)

    # Return the result
    return result
