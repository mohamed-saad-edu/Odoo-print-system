"""Exercise generic HTTP 429 handling through the production submission loop."""
import datetime

import pytest

from test_kitchen_durable_outcomes import ValidationError, fixture, reply


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


@pytest.mark.parametrize("entitlement", ["max_jobs_per_minute", "max_concurrent_jobs"])
def test_gateway_typed_technical_job_limits_are_safe_to_retry(entitlement):
    # The Gateway rejects these inside admission locks, before inserting
    # print jobs. A bounded retry can resume without manufacturing paper.
    response = reply(429, {
        "code": "TENANT_ENTITLEMENT_EXCEEDED",
        "entitlement": entitlement,
        "limit": 3, "used": 3,
        "upgradeRequired": False, "retryable": True,
    })
    _router, job, _cursor, sent, _order = fixture(response)
    prior_key = job.idempotency_key
    job._action_submit_trusted()
    assert job.status == "queued"
    assert job.gateway_job_id is False
    assert job.next_retry_at
    assert job.idempotency_key == prior_key
    assert len(sent) == 1


@pytest.mark.parametrize("response_body", [
    {"code": "TENANT_ENTITLEMENT_EXCEEDED", "entitlement": "max_agents",
     "limit": 3, "used": 3, "upgradeRequired": False, "retryable": True},
    {"code": "TENANT_ENTITLEMENT_EXCEEDED", "entitlement": "max_jobs_per_minute",
     "limit": 3, "used": 3, "upgradeRequired": False, "retryable": False},
    {"code": "TENANT_ENTITLEMENT_EXCEEDED", "entitlement": "max_jobs_per_minute",
     "limit": 3, "used": 3, "upgradeRequired": "false", "retryable": True},
])
def test_inconsistent_technical_entitlement_429_is_ambiguous(response_body):
    response = reply(429, response_body)
    _router, job, _cursor, sent, _order = fixture(response)
    job._action_submit_trusted()
    assert job.status == "unknown"
    assert job.gateway_job_id is False
    assert job.next_retry_at is False
    assert job.last_error.startswith("UNKNOWN_SUBMISSION_OUTCOME:")
    assert len(sent) == 1


@pytest.mark.parametrize('body', [
    {}, {'code': 'INTERNAL_ERROR'}, {'error': 'upstream response interrupted'},
])
def test_unclassified_rate_limit_does_not_automatically_replay(body):
    """An HTTP status alone cannot prove that upstream admitted zero jobs.

    Preserve safe automatic backoff only for the Gateway's explicit
    RATE_LIMIT_EXCEEDED pre-admission signal, not an untyped intermediary 429.
    """
    response = reply(429, body)
    response.headers['Retry-After'] = '60'
    _router, job, _cursor, sent, _order = fixture(response)
    original_key = job.idempotency_key
    job._action_submit_trusted()
    assert job.status == 'unknown'
    assert job.next_retry_at is False
    assert job.last_error.startswith('UNKNOWN_SUBMISSION_OUTCOME:')
    assert job.physical_outcome == 'unknown'
    assert job.idempotency_key == original_key
    assert len(sent) == 1


@pytest.mark.parametrize('status,body', [
    (429, {}),
    (500, {'code': 'INTERNAL_ERROR'}),
    (503, {}),
    (201, {}),  # HTTP accepted, but the Gateway operation identity is missing.
])
def test_interactive_ambiguous_response_cannot_be_reclassified_as_failed(status, body):
    response = reply(status, body)
    _router, job, _cursor, sent, _order = fixture(response)
    original_key = job.idempotency_key
    with pytest.raises(ValidationError, match='unknown'):
        job._action_submit_trusted(raise_on_failure=True)
    # The operator-facing ValidationError is not another print failure:
    # it cannot run the generic deterministic-exception branch and turn an
    # uncertain outcome into definitely not printed.
    assert job.status == 'unknown'
    assert job.last_error.startswith('UNKNOWN_SUBMISSION_OUTCOME:')
    assert job.next_retry_at is False
    assert job.physical_outcome == 'unknown'
    assert job.idempotency_key == original_key
    assert len(sent) == 1
