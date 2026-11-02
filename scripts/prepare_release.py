#!/usr/bin/env python3
"""Bump the P2Talk integration manifest before creating the release tag.

Usage: python scripts/prepare_release.py --version 1.2.0

Only standard-library modules are used so the release workflow needs no extra
Python dependencies. Intentionally allows the same version when publishing an
initial release or recovering after the manifest commit was already pushed.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

DOMAIN = "p2talk_google_cast"
MANIFEST = Path("custom_components") / DOMAIN / "manifest.json"
VERSION_PATTERN = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


def parse_version(value: str) -> tuple[int, int, int]:
    """Accept only unprefixed x.y.z SemVer release versions."""
    match = VERSION_PATTERN.fullmatch(value)
    if match is None:
        raise ValueError(
            "Version must be x.y.z (e.g. 1.2.0), without v prefix or suffix"
        )
    return tuple(int(part) for part in match.groups())


def prepare_manifest(manifest_path: Path, new_version: str) -> bool:
    """Validate and update the manifest, returning True if it changed."""
    requested = parse_version(new_version)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if manifest.get("domain") != DOMAIN:
        raise ValueError(f"Unexpected integration domain: {manifest.get('domain')!r}")
    old_version = manifest.get("version")
    if not isinstance(old_version, str):
        raise ValueError("manifest.json must contain a string version")
    current = parse_version(old_version)
    if requested < current:
        raise ValueError(f"Refusing downgrade: {old_version} -> {new_version}")
    if requested == current:
        print(f"manifest.json already at version {new_version}; no change needed")
        return False

    manifest["version"] = new_version
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Updated manifest.json: {old_version} -> {new_version}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="Release version, e.g. 1.2.0")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    args = parser.parse_args()
    try:
        prepare_manifest(args.manifest, args.version)
    except (ValueError, FileNotFoundError, json.JSONDecodeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
