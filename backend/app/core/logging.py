from __future__ import annotations

import logging
import os

from .request_context import get_request_id


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def configure_logging() -> None:
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s",
        force=True,
    )
    request_id_filter = _RequestIdFilter()
    root = logging.getLogger()
    for handler in root.handlers:
        handler.addFilter(request_id_filter)

