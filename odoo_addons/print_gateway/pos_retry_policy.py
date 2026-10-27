# -*- coding: utf-8 -*-
"""Decide whether an unsubmitted POS ticket is too old to print automatically.

This policy only applies before Gateway admission. Never cancel a job that
already has a Gateway id, because its physical outcome may be uncertain.
"""

from datetime import datetime, timedelta, timezone

MAX_AUTO_POS_AGE_SECONDS = 30 * 60
_POS_SOURCE_MODELS = frozenset(("pos.order", "pos.session"))
_POS_DOCUMENT_TYPES = frozenset(("receipt", "kitchen"))


def _utc_naive(value):
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def is_stale_pos_operation(source_model, document_type, created_at, now_utc, *, gateway_job_id=None):
    """Require a fresh, explicit operator action for old POS receipt/kitchen jobs.

    Only a never-accepted POS outbox row can be parked. Other documents still
    follow the durable retry policy; already-admitted jobs require status
    reconciliation, never a second automatic submission.
    """
    if gateway_job_id or str(source_model or "").strip().lower() not in _POS_SOURCE_MODELS:
        return False
    if str(document_type or "").strip().lower() not in _POS_DOCUMENT_TYPES:
        return False
    created = _utc_naive(created_at)
    now = _utc_naive(now_utc)
    if created is None or now is None:
        return True  # Missing timing evidence must not authorize a delayed POS ticket.
    return now - created >= timedelta(seconds=MAX_AUTO_POS_AGE_SECONDS)
