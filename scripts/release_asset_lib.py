from __future__ import annotations

import hashlib
import json
import os
import stat
import zipfile
from pathlib import Path, PurePosixPath

PRODUCT_VERSION = "0.3.0"
EXTENSION_ASSET = f"codex-web-review-relay-extension-v{PRODUCT_VERSION}.zip"
NATIVE_ASSET = f"codex-web-review-relay-native-host-windows-v{PRODUCT_VERSION}.zip"
CHECKSUM_FILE = "SHA256SUMS.txt"
EXTENSION_ID = "kkdijpckhlminpolkllmmkldlljakfem"
NATIVE_HOST_NAME = "dev.shanernerak.codex_web_review_relay"
EXTENSION_FILES = {
    "manifest.json", "background.js", "content.js", "dom-adapter.js", "popup.html", "popup.js",
}
NATIVE_FIXED_FILES = {
    "contracts/mcp-tools.schema.json", "native-host/launcher.cs.template",
    "scripts/install-native-host.ps1", "scripts/register-native-host.ps1",
    "scripts/tools/relay_export_helper.py", "package.json", "LICENSE", "INSTALL.md", "MIGRATION.md",
}
RUNTIME_PACKAGE = {
    "name": "codex-web-review-relay-native-host",
    "version": PRODUCT_VERSION,
    "private": True,
    "type": "module",
    "engines": {"node": ">=24"},
}


def is_reparse_or_symlink(path: Path) -> bool:
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode):
        return True
    return bool(getattr(info, "st_file_attributes", 0) & 0x400)


def assert_regular_file(path: Path) -> None:
    if is_reparse_or_symlink(path) or not path.is_file():
        raise ValueError(f"ASSET_SOURCE_NOT_REGULAR:{path}")


def source_files(root: Path, relative_root: str) -> list[tuple[Path, str]]:
    base = root / relative_root
    if not base.is_dir() or is_reparse_or_symlink(base):
        raise ValueError(f"ASSET_SOURCE_DIRECTORY_INVALID:{relative_root}")
    files: list[tuple[Path, str]] = []
    for path in sorted(base.rglob("*")):
        if path.is_dir():
            if is_reparse_or_symlink(path):
                raise ValueError(f"ASSET_SOURCE_DIRECTORY_INVALID:{path}")
            continue
        assert_regular_file(path)
        files.append((path, (Path(relative_root) / path.relative_to(base)).as_posix()))
    return files


def native_allowlist(root: Path) -> set[str]:
    return NATIVE_FIXED_FILES | {name for _, name in source_files(root, "src")}


def zip_inventory(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for name in names:
            pure = PurePosixPath(name)
            if name.startswith("/") or "\\" in name or ".." in pure.parts or pure == PurePosixPath("."):
                raise ValueError(f"ZIP_PATH_INVALID:{name}")
            info = archive.getinfo(name)
            if info.is_dir() or (info.create_system == 3 and ((info.external_attr >> 16) & stat.S_IFMT) == stat.S_IFLNK):
                raise ValueError(f"ZIP_LINK_OR_DIRECTORY:{name}")
        if len(set(names)) != len(names):
            raise ValueError("ZIP_DUPLICATE_PATH")
        return names


def extension_id_from_key(key: str) -> str:
    digest = hashlib.sha256(__import__("base64").b64decode(key)).digest()[:16]
    return "".join(chr(ord("a") + (byte >> 4)) + chr(ord("a") + (byte & 0x0F)) for byte in digest)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_dist(root: Path, dist: Path) -> dict[str, str]:
    extension = dist / EXTENSION_ASSET
    native = dist / NATIVE_ASSET
    sums = dist / CHECKSUM_FILE
    for path in (extension, native, sums):
        if not path.is_file() or is_reparse_or_symlink(path):
            raise ValueError(f"RELEASE_ASSET_MISSING:{path.name}")

    extension_names = set(zip_inventory(extension))
    if extension_names != EXTENSION_FILES:
        raise ValueError(f"EXTENSION_INVENTORY_MISMATCH:{sorted(extension_names)}")
    with zipfile.ZipFile(extension) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        source_manifest = json.loads((root / "extension" / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("version") != PRODUCT_VERSION:
            raise ValueError("EXTENSION_VERSION_MISMATCH")
        if manifest.get("key") != source_manifest.get("key"):
            raise ValueError("EXTENSION_KEY_CHANGED")
        if extension_id_from_key(manifest["key"]) != EXTENSION_ID:
            raise ValueError("EXTENSION_ID_DERIVATION_MISMATCH")
        background = archive.read("background.js").decode("utf-8")
        if NATIVE_HOST_NAME not in background:
            raise ValueError("EXTENSION_NATIVE_HOST_NAME_MISMATCH")

    native_names = set(zip_inventory(native))
    expected_native = native_allowlist(root)
    if native_names != expected_native:
        raise ValueError(f"NATIVE_INVENTORY_MISMATCH:{sorted(native_names ^ expected_native)}")
    with zipfile.ZipFile(native) as archive:
        runtime_package = json.loads(archive.read("package.json"))
        if runtime_package != RUNTIME_PACKAGE:
            raise ValueError("RUNTIME_PACKAGE_MISMATCH")
        installer = archive.read("scripts/install-native-host.ps1").decode("utf-8")
        if "Join-Path $runtimeRoot 'src\\cli.ts'" not in installer or "repositoryRoot" in installer or "helperPath" in installer:
            raise ValueError("INSTALLER_CONTRACT_MISMATCH")

    machine_paths = {
        str(root.resolve()).replace("\\", "/").lower().encode("utf-8"),
        str(root.resolve()).lower().encode("utf-8"),
    }
    producer_markers = (b"david-ja/single-crystal-stress", b"single-crystal-stress")
    for asset in (extension, native):
        with zipfile.ZipFile(asset) as archive:
            for name in archive.namelist():
                lower_name = name.lower()
                if any(part in {".git", "node_modules"} for part in PurePosixPath(lower_name).parts):
                    raise ValueError(f"ASSET_HYGIENE_DEVELOPMENT_PATH:{name}")
                if lower_name.endswith((".sqlite", ".sqlite-shm", ".sqlite-wal", ".log", ".jsonl")) or "bearer-token" in lower_name:
                    raise ValueError(f"ASSET_HYGIENE_RUNTIME_STATE:{name}")
                content = archive.read(name).lower()
                if any(marker in content for marker in machine_paths):
                    raise ValueError(f"ASSET_HYGIENE_MACHINE_PATH:{name}")
                if any(marker in content for marker in producer_markers):
                    raise ValueError(f"ASSET_HYGIENE_PRODUCER_PATH:{name}")

    lines = sums.read_text(encoding="utf-8").splitlines()
    expected_lines = [f"{sha256(path)}  {path.name}" for path in (extension, native)]
    if lines != expected_lines:
        raise ValueError("CHECKSUMS_MISMATCH")
    return {extension.name: sha256(extension), native.name: sha256(native)}
