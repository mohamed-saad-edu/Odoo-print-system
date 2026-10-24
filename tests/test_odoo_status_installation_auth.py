"""Production status-poll methods must authenticate the saved installation.

Real proof validation runs against synthetic external enrollment mappings;
only ORM I/O, HTTP responses and cron clocks use the existing test boundary.
"""
import json
from types import MethodType, SimpleNamespace

import pytest

from test_f010_report_binding_identity import production_methods
from test_odoo_status_cron_budget import StatusCron
from test_s06_versioned_keys import impl as identity_module

INSTALLATION_A = '00000000-0000-4000-8000-000000000001'
INSTALLATION_B = '00000000-0000-4000-8000-000000000002'
PROOFS = {INSTALLATION_A: 'a' * 43, INSTALLATION_B: 'b' * 43}
HeaderMethods = production_methods('print_job.py', ['_gateway_headers_for_job'])


class InstallationStatusCron(StatusCron):
    def before_http(self, method, url, kwargs, cost):
        assert self.seconds > 0
        assert not self.pending_write
        assert kwargs['allow_redirects'] is False
        self.calls.append((method, url, kwargs))
        self.seconds -= cost


def enrollment(cron, tmp_path, monkeypatch, identities, proofs=PROOFS):
    identity = identity_module()
    monkeypatch.setenv('YASEIR_ODOO_INSTALLATION_PROOFS', json.dumps(proofs))
    monkeypatch.delenv('YASEIR_ODOO_INSTALLATION_PROOF', raising=False)
    monkeypatch.setitem(HeaderMethods._gateway_headers_for_job.__globals__, 'deployment_proof',
        lambda installation, database, origin, company_id=None:
            identity.deployment_proof(installation, database, origin, tmp_path, company_id))
    cron.env.cr.dbname = 'fixture'
    cron.config.company_id = SimpleNamespace(id=7)
    for job, installation in zip(cron.jobs.values(), identities):
        job.gateway_idempotency_version = 2 if installation else 1
        job.gateway_installation_id = installation
        job._gateway_headers_for_job = MethodType(HeaderMethods._gateway_headers_for_job, job)


def test_batch_status_never_combines_distinct_installations_or_legacy_work(tmp_path, monkeypatch):
    cron = InstallationStatusCron(monkeypatch, count=4, bulk_status=200)
    enrollment(cron, tmp_path, monkeypatch, [INSTALLATION_A, INSTALLATION_A, INSTALLATION_B, None])
    assert cron.cron_sync_status() == 4
    batches = [kwargs for method, _url, kwargs in cron.calls if method == 'POST']
    assert len(batches) == 3, 'One credential-bearing batch is required per saved installation/version'
    expected = [(['gw-1', 'gw-2'], INSTALLATION_A), (['gw-3'], INSTALLATION_B), (['gw-4'], None)]
    for batch, (job_ids, installation) in zip(batches, expected):
        assert batch['json']['jobIds'] == job_ids
        headers = batch['headers']
        assert headers['Authorization'] == 'Bearer scoped-fixture'
        if installation:
            assert headers['X-Yaseir-Odoo-Idempotency-Version'] == '2'
            assert headers['X-Yaseir-Odoo-Installation'] == installation
            assert headers['X-Yaseir-Odoo-Proof'] == PROOFS[installation]
        else:
            assert headers == {'Authorization': 'Bearer scoped-fixture'}


def test_missing_v2_proof_never_falls_back_to_headerless_batch_or_get(tmp_path, monkeypatch):
    cron = InstallationStatusCron(monkeypatch, count=1, bulk_status=200)
    enrollment(cron, tmp_path, monkeypatch, [INSTALLATION_A], proofs={})
    cron.cron_sync_status()
    assert cron.calls == [], 'An inaccessible installation proof must block all remote status reads'
    assert cron.jobs[1].status == 'claimed'
    assert cron.jobs[1].last_status_polled_at is not None


@pytest.mark.parametrize('ambiguous', [False, True])
def test_manual_known_and_ambiguous_reads_use_saved_proof(tmp_path, monkeypatch, ambiguous):
    cron = InstallationStatusCron(monkeypatch, count=1, ambiguous=ambiguous)
    enrollment(cron, tmp_path, monkeypatch, [INSTALLATION_A])
    cron.jobs[1].action_sync_status()
    assert len(cron.calls) == 1
    method, _url, request = cron.calls[0]
    assert method == 'GET'
    assert request['headers']['X-Yaseir-Odoo-Installation'] == INSTALLATION_A
    assert request['headers']['X-Yaseir-Odoo-Proof'] == PROOFS[INSTALLATION_A]
