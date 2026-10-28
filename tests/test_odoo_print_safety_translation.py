"""Protect two print safety error paths against English-only Odoo responses.

The complete extractor remains scripts/check-odoo-translations.py. These small
regressions tie dangerous RPC/binding validation failures to non-empty Arabic
customer-facing translations. No Odoo server is needed for this contract.
"""
from pathlib import Path
import re

import pytest

ROOT = Path(__file__).resolve().parents[1] / "odoo_addons" / "print_gateway"
CATALOG = ROOT / "i18n" / "ar.po"


@pytest.mark.parametrize("source,english", [
    ("models/print_router.py", "The print operation key is invalid."),
    ("models/binding.py", "A valid Gateway Runtime Printer must be selected."),
    ("models/print_job.py", "Printer identity is invalid. Select an exact Gateway Runtime Printer."),
    ("models/print_job.py", "Gateway admission is temporarily limited. The print request remains queued for safe retry."),
    ("models/runtime_assignment.py", "A valid exact Gateway runtime agent ID is required."),
])
def test_print_safety_error_exists_and_is_translated_to_arabic(source, english):
    original = (ROOT / source).read_text(encoding="utf-8")
    assert f'_("{english}")' in original, f"{source}: error must stay translatable"
    catalog = CATALOG.read_text(encoding="utf-8")
    # Use the exact untranslated ID; we must not accept a broad substring
    # or an empty/English msgstr when print admission has failed.
    escaped = re.escape(english)
    matches = re.findall(r'^msgid "' + escaped + r'"\nmsgstr "([^"\n]*)"$',
                         catalog, flags=re.MULTILINE)
    assert len(matches) == 1, f"Expected exactly one Arabic catalog entry for {english}"
    assert re.search(r"[\u0600-\u06ff]", matches[0]), f"Missing Arabic remedy for {english}"


def test_source_occurrence_and_retired_messages_match_current_print_contract():
    # The same exact-key rejection now lives in both the Odoo print router
    # and durable print job sender. PO extraction must index both locations
    # for correct runtime translation on either path.
    catalog = CATALOG.read_text(encoding="utf-8")
    target = 'msgid "The print operation key is invalid."'
    assert catalog.count(target) == 1
    source_header = catalog.split(target, 1)[0].rsplit("#. module: print_gateway", 1)[-1]
    assert "code:addons/print_gateway/models/print_router.py:0" in source_header
    assert "code:addons/print_gateway/models/print_job.py:0" in source_header
    obsolete = (
        "A Gateway Runtime Printer must be selected.",
        "Gateway is temporarily rate-limiting print submissions. The job was safely re-queued for retry.",
        "Printer is required.",
        "A non-empty Gateway runtime agent ID is required.",
    )
    for message in obsolete:
        assert f'msgid "{message}"' not in catalog
