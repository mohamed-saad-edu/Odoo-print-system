"""Exercise generic HTTP 429 handling through the production submission loop."""
import datetime

import pytest

from test_kitchen_durable_outcomes import fixture, reply


@pytest.mark.parametrize('attempts', [25, 100])
def test_persistent_rate_limit_parks_same_operation_instead_of_retrying_every_minute(attempts):
    response = reply(429, {'code': 'RATE_LIMIT_EXCEEDED'})
    response.headers['Retry-After'] = '5'
    _router, job, _cursor, sent, _order = fixture(response)
    job.attempts = attempts
    original_key = job.idempotency_key
    job._action_submit_trusted()
    assert job.status == 'queued'
    assert job.attempts == attempts, 'Persistent throttling must stop increasing attempts past the retry budget'
    assert job.next_retry_at == datetime.datetime(2026, 10, 10)
    assert 'GATEWAY_RATE_LIMITED' in job.last_error
    assert job.idempotency_key == original_key
    assert len(sent) == 1


def test_transient_rate_limit_respects_retry_after_and_preserves_operation():
    response = reply(429, {'code': 'RATE_LIMIT_EXCEEDED'})
    response.headers['Retry-After'] = '120'
    _router, job, _cursor, sent, _order = fixture(response)
    original_key = job.idempotency_key
    job._action_submit_trusted()
    assert job.status == 'queued'
    assert job.attempts == 1
    assert job.next_retry_at == datetime.datetime(2026, 10, 9, 0, 2)
    assert job.idempotency_key == original_key
    assert len(sent) == 1
