"""F026 DOC01-05: operational documentation agrees with shipping code contracts.
Source-only checks; no migration, printer, Windows or gateway command is executed.
"""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]

def read(rel): return (ROOT/rel).read_text(encoding='utf-8')

def test_migration_inventory_matches_current_journal():
    journal=json.loads(read('drizzle/meta/_journal.json'))['entries']
    sql=sorted((ROOT/'drizzle').glob('*.sql'))
    # Enforce a one-to-one ordered mapping between the immutable migration
    # journal and the SQL files, including new forward-only migrations.
    tags=[entry['tag'] for entry in journal]
    assert tags==[path.stem for path in sql]
    assert len(journal)==len(sql)==97
    assert journal[96]['tag']=='0096_retire_limited_workspace_roles'
    assert journal[84]['tag']=='0084_printer_cloud_sharing'
    assert journal[85]['tag']=='0085_odoo_installation_idempotency'
    assert journal[86]['tag']=='0086_printer_identity_and_api_key_deletion'
    assert journal[87]['tag']=='0087_odoo_auto_enrollment'
    assert journal[88]['tag']=='0088_retire_e2e_capture'
    assert journal[89]['tag']=='0089_invitation_verification_binding'
    assert journal[90]['tag']=='0090_platform_mfa_sessions'
    assert journal[91]['tag']=='0091_workspace_session_security'
    assert journal[92]['tag']=='0092_workspace_mfa'
    assert '| 0082 | 1 |' in read('MIGRATION.md')
    assert '| 0083 | 1 |' in read('MIGRATION.md')
    assert '| 0084 | 1 |' in read('MIGRATION.md')
    assert '| 0085 | 1 |' in read('MIGRATION.md')
    assert '| 0086 | 1 |' in read('MIGRATION.md')
    assert '| 0087 | 1 |' in read('MIGRATION.md')
    assert '| 0088 | 1 |' in read('MIGRATION.md')
    assert '| 0089 | 1 |' in read('MIGRATION.md')
    assert '| 0090 | 1 |' in read('MIGRATION.md')
    assert '| 0091 | 1 |' in read('MIGRATION.md')
    assert '| 0092 | 1 |' in read('MIGRATION.md')
    assert '| 0093 | 1 |' in read('MIGRATION.md')
    assert journal[93]['tag']=='0093_password_only_authentication'
    assert journal[94]['tag']=='0094_printer_operational_verification'
    assert '| 0094 | 1 |' in read('MIGRATION.md')
    assert '**Total**: 97 forward-only SQL migrations (0000–0096)' in read('MIGRATION.md')
    sharing=read('drizzle/0084_printer_cloud_sharing.sql')
    assert '"shared_with_gateway" boolean NOT NULL DEFAULT true' in sharing
    assert '"shared_with_gateway_version" text' in sharing
    assert '"printers_sharing_version_check"' in sharing
    assert "'^[1-9][0-9]{0,18}$'" in sharing and '9223372036854775807' in sharing

def test_adr_targets_are_not_presented_as_measured_guarantees():
    content=read('ADR.md')
    assert '100% reliable job delivery' not in content
    assert 'easily handles 1,000+ print jobs per second' not in content
    assert 'Sub-100ms real-time delivery during normal operation.' not in content
    assert '15MB RAM footprint' not in content
    assert 'not a production benchmark' in content

def test_recovery_script_never_targets_processes_by_image_name_or_unauthenticated_api():
    content=read('docs/WINDOWS_SERVICE_RECOVERY.md')
    assert 'Get-Process YaseirAgent' not in content
    assert 'Get-CimInstance Win32_Service' in content
    assert 'Get-CimInstance Win32_Process' in content
    assert 'ExecutablePath' in content and 'CreationDate' in content
    assert 'Invoke-RestMethod "http://localhost:3000/api/agents/health' not in content
    assert 'agents.read' in content

def test_first_run_auth_cookie_and_unknown_heartbeat_are_truthful():
    source=read('SERVER_FIRST_RUN.md')
    assert '`cust_session` HttpOnly cookie' in source
    assert '`cust_refresh`' in source
    assert '`__Host-cust_session`' in source
    assert '`__Host-cust_refresh`' in source
    assert 'A stale heartbeat is treated as offline.' not in source
    assert 'unknown' in source

def test_document_diagnostic_pdf_supported_for_spooler_and_ipp():
    source=read('TROUBLESHOOTING.md')
    assert 'Spooler and IPP printers are document transports that require driver-rendered content.' not in source
    assert 'generated PDF test ticket' in source
    assert 'Real document/report' in source

def test_first_run_verify_email_documents_password_setup_redirect():
    source=read('SERVER_FIRST_RUN.md')
    sec9=source[source.index('## 9. Email verification'):source.index('## 10. First workspace setup')]
    assert '/reset-password?token=...&setup=1' in sec9
    assert 'requiresPasswordSetup' in sec9
    assert '20-minute' in sec9
    assert 'creates a customer/manager session cookie' not in sec9


def test_manual_subscription_migration_registered():
    import json
    journal=json.loads((ROOT/"drizzle/meta/_journal.json").read_text())["entries"]
    assert journal[95]["tag"]=="0095_manual_subscriptions"
