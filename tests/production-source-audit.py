#!/usr/bin/env python3
"""Cross-language runtime source inventory: blockers versus manual dead-code leads.

Do not delete code solely on this report. Framework routes, Odoo registries,
reflection and external client protocols can be used without explicit imports.
"""
import argparse
import ast
import json
import re
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

ROOTS = ("src", "agent", "src-tauri/src", "odoo_addons/print_gateway", "scripts")
SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".mts", ".go", ".rs", ".py"}
IGNORED = {"node_modules", ".git", ".next", "target", "__pycache__", "vendor"}
FLAGS = {
    "todo_or_fixme": re.compile(r"\b(?:TODO|FIXME|HACK|XXX)\b"),
    "tls_bypass": re.compile(r"rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0|InsecureSkipVerify\s*:\s*true"),
    "retired_capture": re.compile(r"\b(?:CaptureTestDocument|TestCenter|e2e_capture_runs)\b|/api/e2e-capture", re.I),
}
IMPORTS = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]""")
CONVENTION = re.compile(r"(?:^src/app/|^src/desktop/main\.|^src/desktop/ui\.|^src/desktop/preview/main\.|^src/db/schema\.|^src/i18n/messages/)")


def scan(root: Path):
    errors, warnings, sources = [], [], {}
    counts = Counter()
    for area in ROOTS:
        directory = root / area
        if not directory.is_dir():
            errors.append({"path": area, "error": "missing expected source directory"})
            continue
        for path in directory.rglob("*"):
            if not path.is_file() or any(p in IGNORED for p in path.relative_to(directory).parts):
                continue
            rel = path.relative_to(root).as_posix()
            counts[area] += 1
            if path.suffix not in SUFFIXES:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
            sources[rel] = content
            for kind, pattern in FLAGS.items():
                for m in list(pattern.finditer(content))[:15]:
                    if kind == "retired_capture" and (
                        "/tests/" in rel or ".test." in rel or rel.endswith("_test.go")
                    ):
                        continue
                    warnings.append({"kind": kind, "path": rel, "line": content.count("\n", 0, m.start()) + 1})
            if path.suffix == ".py":
                try:
                    ast.parse(content, filename=rel)
                except SyntaxError as exc:
                    errors.append({"path": rel, "error": "Python syntax", "line": exc.lineno})

    # Include custom root entrypoints so their imports are not falsely marked unused.
    for root_file in ("server.ts", "proxy.ts", "vite.desktop.config.mts"):
        target = root / root_file
        if target.is_file():
            sources[root_file] = target.read_text(encoding="utf-8")
            counts["root_entrypoints"] += 1

    addon = root / "odoo_addons/print_gateway"
    manifest = addon / "__manifest__.py"
    if manifest.is_file():
        try:
            data = ast.literal_eval(ast.parse(manifest.read_text(encoding="utf-8")).body[0].value)
            refs = list(data.get("data", []))
            for asset_group in data.get("assets", {}).values():
                refs.extend(asset_group)
            for ref in refs:
                if not isinstance(ref, str) or "*" in ref:
                    continue
                target = root / "odoo_addons" / ref if ref.startswith("print_gateway/") else addon / ref
                if not target.is_file():
                    errors.append({"path": "__manifest__.py", "error": "missing asset", "asset": ref})
        except (SyntaxError, ValueError, AttributeError, IndexError) as exc:
            errors.append({"path": "__manifest__.py", "error": f"manifest invalid: {exc}"})

    for path in addon.rglob("*.xml"):
        if any(part in IGNORED for part in path.parts):
            continue
        try:
            ElementTree.parse(path)
        except ElementTree.ParseError as exc:
            errors.append({"path": path.relative_to(root).as_posix(), "error": f"XML syntax: {exc}"})

    for init in addon.rglob("__init__.py"):
        for line in init.read_text(encoding="utf-8").splitlines():
            match = re.match(r"\s*from\s+\.\s+import\s+(.*)", line)
            if not match:
                continue
            for item in match.group(1).split(","):
                name = item.strip().split(" as ")[0].strip()
                if re.fullmatch(r"[A-Za-z_]\w*", name):
                    if not (init.parent / (name + ".py")).exists() and not (init.parent / name / "__init__.py").exists():
                        errors.append({"path": init.relative_to(root).as_posix(), "error": "missing local module", "module": name})

    package_file = root / "package.json"
    if package_file.is_file():
        package = json.loads(package_file.read_text(encoding="utf-8"))
        combined = "\n".join(
            text for path, text in sources.items()
            if (path.startswith("src/") or path.startswith("scripts/"))
            and "/tests/" not in path and ".test." not in path
        )
        # Convention-only packages and tsx runtime CLI do not need imports.
        exceptions = {"next", "react", "react-dom", "tsx"}
        for dep in package.get("dependencies", {}):
            if dep not in exceptions and not re.search(
                r"(?<![\w/-])" + re.escape(dep) + r"""(?:/|['"])""", combined
            ):
                warnings.append({"kind": "unused_runtime_dependency_candidate", "path": "package.json", "package": dep})

    imported = set()
    for rel, content in sources.items():
        if "/tests/" in rel or ".test." in rel or rel.endswith("_test.go"):
            continue
        for match in IMPORTS.finditer(content):
            name = match.group(1)
            if not name.startswith("."):
                continue
            base = (root / rel).parent / name
            options = [base]
            options.extend(Path(str(base) + extension) for extension in (".ts", ".tsx", ".js", ".mjs", ".mts"))
            options.extend(base / ("index" + extension) for extension in (".ts", ".tsx", ".js"))
            for candidate in options:
                if candidate.is_file():
                    imported.add(candidate.resolve())

    for rel in sources:
        if not rel.startswith("src/") or not rel.endswith((".ts", ".tsx")) or CONVENTION.match(rel):
            continue
        if (root / rel).resolve() not in imported:
            warnings.append({"kind": "unreferenced_ts_file_candidate", "path": rel})

    return {
        "source_files_scanned": len(sources),
        "total_files_by_area": dict(sorted(counts.items())),
        "errors": errors,
        "candidate_counts": dict(sorted(Counter(x["kind"] for x in warnings).items())),
        "candidates": warnings,
        "limitations": "Candidates are not proof of unused code. Check dynamic imports, native commands, Odoo module registration and external clients before deletion.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = scan(args.root.resolve())
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Source audit:", report["source_files_scanned"], "source files;", report["total_files_by_area"])
    print("Structural blockers:", len(report["errors"]), "; candidates:", report["candidate_counts"])
    for entry in report["errors"][:30]:
        print("ERROR", json.dumps(entry))
    for entry in report["candidates"][:85]:
        print("CANDIDATE", json.dumps(entry))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
