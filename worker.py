# worker.py
import logging
from typing import Any
import zmq
import cbor2
from multiprocessing import current_process
import numpy as np
from processing import processFrame

from dectris.compression import decompress
from logging_setup import setup_logging

def decode_multi_dim_array(tag, column_major):
    dimensions, contents = tag.value
    if isinstance(contents, list):
        array = np.empty((len(contents),), dtype=object)
        array[:] = contents
    elif isinstance(contents, (np.ndarray, np.generic)):
        array = contents
    else:
        raise cbor2.CBORDecodeValueError("expected array or typed array")
    return array.reshape(dimensions, order="F" if column_major else "C")


def decode_typed_array(tag, dtype):
    if not isinstance(tag.value, bytes):
        raise cbor2.CBORDecodeValueError("expected byte string in typed array")
    return np.frombuffer(tag.value, dtype=dtype)


def decode_dectris_compression(tag):
    algorithm, elem_size, encoded = tag.value
    return decompress(encoded, algorithm, elem_size=elem_size)

# Map CBOR tags to dtype strings
_DTYPE_MAP = {
    64: "u1", 65: ">u2", 66: ">u4", 67: ">u8", 68: "u1",
    69: "<u2", 70: "<u4", 71: "<u8", 72: "i1", 73: ">i2",
    74: ">i4", 75: ">i8", 77: "<i2", 78: "<i4", 79: "<i8",
    80: ">f2", 81: ">f4", 82: ">f8", 83: ">f16", 84: "<f2",
    85: "<f4", 86: "<f8", 87: "<f16",
}

tag_decoders = {
    40: lambda tag: decode_multi_dim_array(tag, column_major=False),
    1040: lambda tag: decode_multi_dim_array(tag, column_major=True),
    56500: lambda tag: decode_dectris_compression(tag),
}

# Add typed array decoders for all dtype mappings
for tag, dtype in _DTYPE_MAP.items():
    tag_decoders[tag] = (lambda dtype: lambda tag: decode_typed_array(tag, dtype=dtype))(dtype)


def tag_hook(decoder, tag):
    tag_decoder = tag_decoders.get(tag.tag)
    return tag_decoder(tag) if tag_decoder else tag


def worker(
    endpoint: str,
    stop_event: Any,
    log_queue: Any,
    results_queue: Any,
    log_level: int = logging.INFO,
    extra_debug: bool = False,
    summary_interval: int = 100,
) -> None:
    # Set up logging in the worker process
    setup_logging(log_queue, level=log_level)
    logger = logging.getLogger('worker')

    context = zmq.Context()
    socket = context.socket(zmq.PULL)
    socket.connect(endpoint)
    socket.setsockopt(zmq.RCVTIMEO, 1000)  # Set receive timeout to 1000 ms
    worker_name = f"Receiver-{current_process().pid}"
    logger.info(f"{worker_name} connected to {endpoint}")

    frame_count = 0  # Initialize frame counter

    while not stop_event.is_set():
        try:
            message = socket.recv()
            message = cbor2.loads(message, tag_hook=tag_hook)

            # Conditional per-message debug logging
            if extra_debug:
                logger.debug(f"{worker_name} received MESSAGE[{message.get('type')}]")

            if message['type'] == 'image':
                frame_count += 1  # Increment frame count

                num_thresholds = len(message['data'])
                timestamp = message['start_time']
                image_id = message['image_id']  # Extract image_id

                # Ensure timestamp is a scalar
                if isinstance(timestamp, (tuple, list, np.ndarray)):
                    timestamp = timestamp[0]
                    if extra_debug:
                        logger.debug(f"{worker_name}: Adjusted timestamp to scalar: {timestamp}")

                # Periodic debug summary instead of per-image verbose logging
                if summary_interval > 0 and frame_count % summary_interval == 0:
                    logger.debug(
                        f"{worker_name}: processed {frame_count} images; current image {image_id} with {num_thresholds} thresholds"
                    )
                elif extra_debug:
                    # When extra_debug is enabled, log every image processed
                    logger.debug(f"{worker_name}: Working on image {image_id} with {num_thresholds} thresholds")

                for threshold, data in message['data'].items():
                    try:
                        result = processFrame(data)

                        if result is None:
                            # No valid pixels found; optionally log and continue
                            if extra_debug:
                                logger.debug(f"{worker_name}: No valid pixels for threshold {threshold}.")
                            continue  # Skip sending data to main process

                        # Send the result to the master process via results_queue
                        results_queue.put({
                            'type': 'data',
                            'threshold': threshold,
                            'image_id': image_id,
                            'timestamp': timestamp,
                            'data': result
                        })

                    except Exception as e:
                        logger.error(f"{worker_name}: Error processing threshold {threshold}: {e}")
                        continue

            elif message['type'] == 'start':
                logger.info(f"{worker_name} received start of series.")
                results_queue.put({'type': 'start', 'data': message})
                # Reset frame count for new series
                frame_count = 0

            elif message['type'] == 'end':
                logger.info(f"{worker_name} received end of series.")
                # Send the end data to the main process
                results_queue.put({'type': 'end', 'data': message})
                # Send the frame count for the completed series
                results_queue.put({'type': 'frame_count', 'worker_name': worker_name, 'count': frame_count})
                logger.info(f"{worker_name} processed {frame_count} frames in this series.")
                # Prepare for next series
                frame_count = 0  # Reset frame count for next series

            else:
                logger.info(f"{worker_name} received unknown message {message['type']}")

        except zmq.Again:
            # Timeout occurred, check the stop_event again
            continue
        except Exception as e:
            logger.error(f"{worker_name} encountered an error: {e}")

    # Before exiting, send any remaining frame count to the main process
    if frame_count > 0:
        results_queue.put({'type': 'frame_count', 'worker_name': worker_name, 'count': frame_count})
        logger.info(f"{worker_name} processed {frame_count} frames before exiting.")

    socket.close()
    context.term()
    logger.info(f"{worker_name} exiting...")
