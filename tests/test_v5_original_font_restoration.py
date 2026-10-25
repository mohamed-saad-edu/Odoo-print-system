"""No downloaded fonts needed: exercise the safe original-asset restore helper."""
import hashlib
import importlib.util
from pathlib import Path
from zipfile import ZipFile

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/restore_v5_original_font_assets.py'


def loader():
    spec = importlib.util.spec_from_file_location('v5_original_font_restore', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_restore_only_exact_user_supplied_asset_from_zip(tmp_path, monkeypatch):
    module = loader()
    expected = b'fixture asset, not a font'
    monkeypatch.setattr(module, 'EXPECTED_SHA256', {'original.ttf': hashlib.sha256(expected).hexdigest()})
    archive = tmp_path / 'original.zip'
    with ZipFile(archive, 'w') as z:
        z.writestr('Yaseir/original.ttf', expected)
    destination = tmp_path / 'source'
    assert module.restore_original_fonts(archive, destination) == 1
    assert (destination / 'original.ttf').read_bytes() == expected
    assert module.restore_original_fonts(archive, destination) == 0
    (destination / 'original.ttf').write_bytes(b'altered')
    with pytest.raises(ValueError, match='Refusing'):
        module.restore_original_fonts(archive, destination)


def test_restore_rejects_archive_mismatch_before_writing(tmp_path, monkeypatch):
    module = loader()
    monkeypatch.setattr(module, 'EXPECTED_SHA256', {'original.ttf': '0' * 64})
    archive = tmp_path / 'original.zip'
    with ZipFile(archive, 'w') as z:
        z.writestr('Yaseir/original.ttf', b'other')
    destination = tmp_path / 'source'
    with pytest.raises(ValueError, match='checksum mismatch'):
        module.restore_original_fonts(archive, destination)
    assert not (destination / 'original.ttf').exists()
