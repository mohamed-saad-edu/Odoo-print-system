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
