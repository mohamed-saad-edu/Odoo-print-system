"""Exercise real outbox scheduler decisions with deterministic storage failures.

Production cron method runs unchanged; ORM/storage and elapsed scheduler budget
are controlled. Native PostgreSQL/Odoo verification is recorded separately.
"""
from contextlib import contextmanager

import pytest

from test_f010_report_binding_identity import production_methods

Production = production_methods('print_job.py', ['cron_submit_pending'])


class SubmissionCron(Production):
    def __init__(self, *, failed_ids=(), seconds=30, fail_in_caller_transaction=False):
        self.failed_ids = set(failed_ids)
        self.seconds = seconds
        self.fail_in_caller_transaction = fail_in_caller_transaction
        self.attempted = []
        self.submitted = []
        self.savepoints = 0
        self.rollbacks = 0
        self.commits = []
        self.aborted = False
        self.authorized = True
        owner = self

        class Cursor:
            def execute(self, query, params):
                assert not owner.aborted
                assert "status = 'queued'" in query
                assert 'next_retry_at' in query and 'LIMIT 25' in query

            def fetchall(self):
                return [(1,), (2,), (3,)]

            @contextmanager
            def savepoint(self):
                assert not owner.aborted
                owner.savepoints += 1
                try:
                    yield
                except Exception:
                    owner.rollbacks += 1
                    owner.aborted = False
                    raise
                finally:
                    owner.savepoints -= 1

        class Scheduler:
            def _commit_progress(self, processed=0, *, remaining=None):
                assert not owner.aborted, 'An aborted item must not poison cron progress'
                assert owner.savepoints == 0, 'Commit must be outside every savepoint'
                owner.commits.append((processed, remaining))
                return max(0, owner.seconds)

        class Environment:
            cr = Cursor()
            def __getitem__(self, name):
                assert name == 'ir.cron'
                return Scheduler()

        class Job:
            def __init__(self, pk):
                self.id = pk
            def action_submit(self):
                assert not owner.aborted, 'Later healthy jobs require a usable transaction'
                owner.attempted.append(self.id)
                owner.seconds -= 5
                if self.id in owner.failed_ids:
                    owner.aborted = owner.fail_in_caller_transaction
                    raise RuntimeError('Synthetic submission-lease database lock failure')
                owner.submitted.append(self.id)

        self.env = Environment()
        self.jobs = [Job(pk) for pk in (1, 2, 3)]

    def _require_cron_runner(self):
        if not self.authorized:
            raise PermissionError('Scheduler authority required')

    def browse(self, ids):
        return [job for job in self.jobs if job.id in ids]


@pytest.mark.parametrize('aborted', [False, True])
def test_one_submission_failure_does_not_abort_later_durable_jobs(aborted, caplog):
    cron = SubmissionCron(failed_ids=[1], fail_in_caller_transaction=aborted)
    assert cron.cron_submit_pending() == 3
    assert cron.attempted == [1, 2, 3]
    assert cron.submitted == [2, 3]
    assert cron.rollbacks == 1
    assert sum(processed for processed, _ in cron.commits) == 3
    assert '1' in caplog.text and 'submission' in caplog.text.lower()
    assert not cron.aborted and cron.savepoints == 0


def test_failure_consuming_budget_yields_without_trying_another_job():
    cron = SubmissionCron(failed_ids=[1], seconds=5)
    assert cron.cron_submit_pending() == 1
    assert cron.attempted == [1]
    assert cron.submitted == []
    assert cron.commits == [(0, 3), (1, None)]


def test_zero_initial_budget_and_denied_authority_never_attempt_submission():
    cron = SubmissionCron(seconds=0)
    assert cron.cron_submit_pending() == 0
    assert cron.attempted == []
    cron.authorized = False
    with pytest.raises(PermissionError):
        cron.cron_submit_pending()
    assert cron.attempted == []


def test_normal_due_batch_submits_every_job_and_commits_between_jobs():
    cron = SubmissionCron()
    assert cron.cron_submit_pending() == 3
    assert cron.submitted == [1, 2, 3]
    assert sum(processed for processed, _ in cron.commits) == 3
