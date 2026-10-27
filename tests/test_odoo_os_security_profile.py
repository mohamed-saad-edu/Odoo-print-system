"""Offline integrity and safe replacement gates; actual artifacts have separate evidence."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "docs/runtime-hardening"
SPEC = importlib.util.spec_from_file_location("os_security_profile", PROFILE / "apply-os-security-profile.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


@pytest.fixture
def installation(tmp_path, monkeypatch):
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    root = tmp_path / "rtlcss"
    target = root / "node_modules/source-map-js"
    target.mkdir(parents=True)
    (root / "package.json").write_text(json.dumps({"name": "rtlcss", "version": "4.3.0"}))
    (target / "package.json").write_text(json.dumps({"name": "source-map-js", "version": "1.2.1"}))
    (target / "old-only.js").write_text("original fixture")
    archive = artifacts / "source-map-js-1.2.2.tgz"
    manifest = tmp_path / "manifest.json"
    monkeypatch.setattr(MODULE, "MANIFEST", manifest)

    def package(extra=None, version="1.2.2"):
        files = {"package/package.json": json.dumps({"name": "source-map-js", "version": version}).encode(),
                 "package/lib/security.js": b"reviewed synthetic module"}
        with tarfile.open(archive, "w:gz") as output:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                output.addfile(member, io.BytesIO(data))
            if extra:
                output.addfile(extra, io.BytesIO(b"x" * extra.size))
        manifest.write_text(json.dumps({"artifacts": [{"filename": archive.name,
            "bytes": archive.stat().st_size, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}]}))
        return files

    expected = package()
    return artifacts, root, target, archive, package, expected


def test_replaces_exact_dependency_removes_stale_files_and_is_idempotent(installation):
    artifacts, root, target, _, _, expected = installation
    MODULE.install_source_map(artifacts, root)
    assert not (target / "old-only.js").exists()
    assert {str(p.relative_to(target)): p.read_bytes() for p in target.rglob("*") if p.is_file()} == {
        name.removeprefix("package/"): data for name, data in expected.items()}
    assert target.stat().st_mode & 0o777 == 0o755
    assert all(p.stat().st_mode & 0o777 == 0o644 for p in target.rglob("*") if p.is_file())
    MODULE.install_source_map(artifacts, root)


def test_checksum_tampering_fails_before_existing_dependency_changes(installation):
    artifacts, root, target, archive, _, _ = installation
    data = bytearray(archive.read_bytes())
    data[-1] ^= 1
    archive.write_bytes(data)
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        MODULE.install_source_map(artifacts, root)
    assert (target / "old-only.js").read_text() == "original fixture"


def test_symlink_artifact_is_refused(installation):
    artifacts, root, target, archive, _, _ = installation
    outside = archive.with_suffix(".outside")
    archive.rename(outside)
    archive.symlink_to(outside)
    with pytest.raises(ValueError, match="regular security artifact"):
        MODULE.install_source_map(artifacts, root)
    assert (target / "old-only.js").exists()


@pytest.mark.parametrize("component,version", [("rtlcss", "4.4.0"), ("source-map-js", "9.0.0")])
def test_unknown_parent_or_dependency_identity_is_refused(installation, component, version):
    artifacts, root, target, _, _, _ = installation
    file = (root if component == "rtlcss" else target) / "package.json"
    file.write_text(json.dumps({"name": component, "version": version}))
    with pytest.raises(ValueError, match="Unreviewed"):
        MODULE.install_source_map(artifacts, root)
    assert (target / "old-only.js").exists()


def test_existing_patched_version_requires_complete_reviewed_bytes(installation):
    artifacts, root, target, _, _, _ = installation
    MODULE.install_source_map(artifacts, root)
    (target / "lib/security.js").write_text("unexpected replacement")
    with pytest.raises(ValueError, match="differs from reviewed artifact"):
        MODULE.install_source_map(artifacts, root)


@pytest.mark.parametrize("kind", ["traversal", "symlink", "duplicate"])
def test_archive_unsafe_members_are_refused_without_extraction(installation, kind):
    artifacts, root, target, _, package, _ = installation
    member = tarfile.TarInfo({"traversal": "package/../../escaped", "symlink": "package/link", "duplicate": "package/package.json"}[kind])
    if kind == "symlink":
        member.type = tarfile.SYMTYPE
        member.linkname = "../../escaped"
    else:
        member.size = 1
    package(member)
    with pytest.raises(ValueError, match="Unexpected npm archive"):
        MODULE.install_source_map(artifacts, root)
    assert (target / "old-only.js").exists()
    assert not (root.parent / "escaped").exists()


def test_archive_package_version_must_match_reviewed_fix(installation):
    artifacts, root, target, _, package, _ = installation
    package(version="1.2.3")
    with pytest.raises(ValueError, match="Unreviewed source-map-js package identity"):
        MODULE.install_source_map(artifacts, root)
    assert (target / "old-only.js").exists()


def test_docker_download_pins_match_reviewed_artifact_manifest():
    manifest = json.loads((PROFILE / "os-security-artifacts.json").read_text())
    dockerfile = (ROOT / "Dockerfile.odoo-hardened").read_text()
    pins = re.findall(r"^ADD --checksum=sha256:([0-9a-f]{64}) (https://\S+) /os-security/(\S+)$", dockerfile, re.M)
    assert sorted(pins) == sorted((item["sha256"], item["url"], item["filename"]) for item in manifest["artifacts"])
    assert "dpkg -i /os-security/libssl3t64_3.0.13-0ubuntu3.16_amd64.deb" in dockerfile
    assert "verify-source-map-js-security.cjs" in dockerfile
    assert not re.search(r"(?:apt(?:-get)?\s+(?:update|install)|npm\s+install)", dockerfile)


def test_all_available_parent_security_fixes_have_exact_guarded_artifacts():
    # The 2026-10-24 parent scan and signed noble-security index identify these
    # installed packages with published fixes. Do not silently drop a group
    # when regenerating the immutable artifact profile.
    expected = {
        "curl", "libcares2", "libcurl4t64", "libbrotli1", "libexpat1", "libfreetype6",
        "libglib2.0-0t64", "libperl5.38t64", "libpng16-16t64", "libsqlite3-0",
        "libssl-dev", "libssl3t64", "libx11-6", "libx11-data", "libxml2",
        "openssl", "perl", "perl-base", "perl-modules-5.38", "python3-lxml",
        "python3-requests", "python3-urllib3", "zlib1g",
    }
    manifest = json.loads((PROFILE / "os-security-artifacts.json").read_text())
    packages = [entry for entry in manifest["artifacts"] if entry["filename"].endswith(".deb")]
    assert {entry["package"] for entry in packages} == expected
    dockerfile = (ROOT / "Dockerfile.odoo-hardened").read_text()
    for entry in packages:
        assert f'{entry["package"]}|{entry["previous_version"]}|{entry["version"]}' in dockerfile
        assert f'{entry["package"]}={entry["version"]}' in dockerfile
        assert f'/os-security/{entry["filename"]}' in dockerfile


def test_brotli_cve_fix_uses_reviewed_ubuntu_security_artifact_not_scanner_exemption():
    manifest = json.loads((PROFILE / "os-security-artifacts.json").read_text())
    brotli = next(item for item in manifest["artifacts"] if item.get("package") == "libbrotli1")
    assert brotli["version"] == "1.1.0-2ubuntu0.1"
    assert brotli["previous_version"] == "1.1.0-2build2"
    assert brotli["advisories"] == ["CVE-2026-111497"]
    assert brotli["bytes"] == 330968
    assert brotli["sha256"] == "70b188a86d81f30d7510aab30e25d638ed5037dded6691af1533952b71ac61de"
    assert brotli["url"].startswith("https://security.ubuntu.com/ubuntu/")
    docker = (ROOT / "Dockerfile.odoo-hardened").read_text()
    assert f'ADD --checksum=sha256:{brotli["sha256"]} {brotli["url"]} /os-security/{brotli["filename"]}' in docker
    assert f'libbrotli1|{brotli["previous_version"]}|{brotli["version"]}' in docker
    assert f'libbrotli1={brotli["version"]}' in docker
    assert f'/os-security/{brotli["filename"]}' in docker
