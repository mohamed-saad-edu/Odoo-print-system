#!/usr/bin/env python3
"""Restore unchanged USER-PROVIDED font assets from the verified original V5 ZIP.

The distributed source bundle contains no font binaries. This utility does not
fetch anything or trust external sources: it accepts only the exact original
font bytes recorded by SHA-256 from the uploaded V5 baseline, never overwrites
a different existing file, and requires an explicit local operator invocation.
"""
import argparse
import hashlib
from pathlib import Path
import stat
from zipfile import ZipFile

SOURCE_ROOT = Path(__file__).resolve().parents[1]
# SHA-256 of original font binaries in the user-uploaded V5 source archive.
EXPECTED_SHA256 = {
    'odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-400.ttf': '6f611412270a132bbac838da9259d4c68569b4175f3b3b8fa3fa36a30b56dab9',
    'odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-500.ttf': 'b8363ab9f733dfa4f8e96b8b2102c24b5cf4110fb96d1d3d9a9412f6fb49cf74',
    'odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-600.ttf': '597bd5502e5997be4414e4c9c88834b30ff3784250c84f20bce2b20e53ebd467',
    'odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-700.ttf': '691e0c891a38637ae6bbdb69700f8042cb0724a137bee615068ffdb92244f61f',
    'odoo_addons/print_gateway/static/fonts/ibm-plex-sans-variable.ttf': '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3',
    'src/app/fonts/ibm-plex-sans-arabic-400.ttf': '6f611412270a132bbac838da9259d4c68569b4175f3b3b8fa3fa36a30b56dab9',
    'src/app/fonts/ibm-plex-sans-arabic-400.woff2': '4c9e895eee8c24f6a575aa77dd2a32a97ab1a9a2fe424557794924353fe693cf',
    'src/app/fonts/ibm-plex-sans-arabic-500.ttf': 'b8363ab9f733dfa4f8e96b8b2102c24b5cf4110fb96d1d3d9a9412f6fb49cf74',
    'src/app/fonts/ibm-plex-sans-arabic-500.woff2': 'b74f212ef22b8eb8d095da8c50a17d8c244c7454817828e8c4e3d03257dcafb0',
    'src/app/fonts/ibm-plex-sans-arabic-600.ttf': '597bd5502e5997be4414e4c9c88834b30ff3784250c84f20bce2b20e53ebd467',
    'src/app/fonts/ibm-plex-sans-arabic-600.woff2': '1d3be56cf7b70a085b3ac4eeccbbc5d729d59ba09304aca9b1a4e412416db699',
    'src/app/fonts/ibm-plex-sans-arabic-700.ttf': '691e0c891a38637ae6bbdb69700f8042cb0724a137bee615068ffdb92244f61f',
    'src/app/fonts/ibm-plex-sans-arabic-700.woff2': 'e8ce9f2937f477acbce9184797f11c4b76bd5500e0e2951b4c3c248cfa816f96',
    'src/app/fonts/ibm-plex-sans-variable.ttf': '3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3',
    'src/app/fonts/ibm-plex-sans-variable.woff2': '4aea8c49bb04155bced7cdea9ed0ed86b5a45da94b2ca54065ac9cb4098efcdb',
}


def restore_original_fonts(archive_path: Path, destination: Path = SOURCE_ROOT):
    if not archive_path.is_file():
        raise ValueError("The original uploaded V5 source ZIP is required")
    restored = 0
    with ZipFile(archive_path) as archive:
        for relpath, expected_digest in EXPECTED_SHA256.items():
            member = "Yaseir/" + relpath
            info = archive.getinfo(member)
            if (info.external_attr >> 16) and stat.S_ISLNK(info.external_attr >> 16):
                raise ValueError("Original archive contains a disallowed symlink")
            if info.file_size > 32 * 1024 * 1024:
                raise ValueError("Original archive contains an oversized asset")
            data = archive.read(member)
            if hashlib.sha256(data).hexdigest() != expected_digest:
                raise ValueError("Original archive asset checksum mismatch")
            target = (destination / relpath).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Asset path escapes project root")
            if target.exists():
                if not target.is_file() or target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != expected_digest:
                    raise ValueError("Refusing to overwrite a different existing file")
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as handle:
                handle.write(data)
            restored += 1
    return restored


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_zip", type=Path, help="Path to your original uploaded V5 source ZIP")
    args = parser.parse_args()
    count = restore_original_fonts(args.original_zip)
    print(f"Restored {count} unchanged verified original font assets")


if __name__ == "__main__":
    main()
