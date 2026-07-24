from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from release_asset_lib import (
    CHECKSUM_FILE,
    EXTENSION_ASSET,
    EXTENSION_FILES,
    NATIVE_ASSET,
    PRODUCT_VERSION,
    RUNTIME_PACKAGE,
    validate_dist,
)

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


def copy_file(root: Path, staging: Path, relative: str) -> None:
    source = root / relative
    destination = staging / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"ASSET_SOURCE_INVALID:{relative}")
    shutil.copyfile(source, destination)


def write_deterministic_zip(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for file in sorted(path for path in source.rglob("*") if path.is_file()):
            name = file.relative_to(source).as_posix()
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 0
            info.external_attr = 0o100644 << 16
            archive.writestr(info, file.read_bytes())


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix="release-staging-", dir=DIST) as temporary:
        staging = Path(temporary)
        extension_stage = staging / "extension"
        native_stage = staging / "native"
        for relative in sorted(EXTENSION_FILES):
            copy_file(ROOT / "extension", extension_stage, relative)
        for relative in [
            "native-host/launcher.cs.template", "scripts/install-native-host.ps1",
            "scripts/register-native-host.ps1", "scripts/tools/relay_export_helper.py",
            "contracts/mcp-tools.schema.json", "LICENSE", "INSTALL.md", "MIGRATION.md",
        ]:
            copy_file(ROOT, native_stage, relative)
        for source in sorted((ROOT / "src").rglob("*")):
            if source.is_file():
                relative = source.relative_to(ROOT).as_posix()
                copy_file(ROOT, native_stage, relative)
        package_path = native_stage / "package.json"
        package_path.write_text(json.dumps(RUNTIME_PACKAGE, indent=2) + "\n", encoding="utf-8", newline="\n")
        write_deterministic_zip(extension_stage, DIST / EXTENSION_ASSET)
        write_deterministic_zip(native_stage, DIST / NATIVE_ASSET)
        lines = [
            f"{__import__('release_asset_lib').sha256(DIST / name)}  {name}"
            for name in sorted((EXTENSION_ASSET, NATIVE_ASSET))
        ]
        (DIST / CHECKSUM_FILE).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    validate_dist(ROOT, DIST)
    print(json.dumps({"version": PRODUCT_VERSION, "dist": str(DIST), "assets": sorted(path.name for path in DIST.iterdir())}))


if __name__ == "__main__":
    main()
