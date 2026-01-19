# logging_setup.py
import logging
import sys
from logging.handlers import QueueHandler

def setup_logging(log_queue=None, level=logging.INFO):
    logger = logging.getLogger()
    logger.setLevel(level)

    # Remove all handlers associated with the root logger object
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(processName)s - %(name)s - %(levelname)s - %(message)s'
    )

    if log_queue is not None:
        # In worker processes, add QueueHandler to send logs to the main process
        queue_handler = QueueHandler(log_queue)
        queue_handler.setLevel(level)
        logger.addHandler(queue_handler)
    else:
        # In main process, add console handler and file handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

        file_handler = logging.FileHandler('stxm_map_debug.log')
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)