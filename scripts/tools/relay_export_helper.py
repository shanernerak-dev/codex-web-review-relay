#!/usr/bin/env python3
"""Minimal relay-export helper for the companion repository.

Usage:
    python relay_export_helper.py relay-export <handoff_path>

Validates the handoff file, computes hashes, and outputs a relay-export JSON
to stdout.  Exits non-zero with a stable error code on any failure.
"""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

HANDOFF_PATTERN = re.compile(
    r"^\.agent/review_handoffs/"
    r"pr-(?P<pr>[1-9][0-9]*)/"
    r"(?P<stream>[a-z0-9][a-z0-9-]*)/"
    r"round-(?P<round>0[1-9]|[1-9][0-9]+)-"
    r"(?P<kind>review-request|review-fix|evidence-amendment|human-decision)"
    r"\.md$"
)

SCOPE_PATTERN = re.compile(
    r"^Review scope:\s*(.+)$", re.MULTILINE
)


def fail(code: str) -> None:
    print(code, file=sys.stderr)
    sys.exit(1)


def git(*args: str, cwd: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        fail(f"GIT_ERROR:{result.stderr.strip()[:200]}")
    return result.stdout.strip()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_json(obj: object) -> str:
    return json.dumps(obj, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != "relay-export":
        fail("USAGE_ERROR")

    handoff_path = sys.argv[2].replace("\\", "/")
    repo_root = str(Path(__file__).resolve().parent.parent.parent)

    # 1. Validate path pattern
    m = HANDOFF_PATTERN.match(handoff_path)
    if not m:
        fail("HANDOFF_PATH_INVALID")

    pr_number = int(m.group("pr"))
    stream = m.group("stream")
    round_num = int(m.group("round"))
    kind = m.group("kind")

    # 2. Verify file exists and is tracked
    abs_path = Path(repo_root) / handoff_path
    if not abs_path.is_file():
        fail("HANDOFF_NOT_FOUND")

    tracked = git("ls-files", "--error-unmatch", handoff_path, cwd=repo_root)
    if not tracked:
        fail("HANDOFF_NOT_TRACKED")

    # 3. Verify worktree matches HEAD (no uncommitted changes)
    diff = subprocess.run(
        ["git", "diff", "--quiet", "HEAD", "--", handoff_path],
        cwd=repo_root,
        capture_output=True,
    )
    if diff.returncode != 0:
        fail("HANDOFF_DIRTY_WORKTREE")

    # 4. Read file content and compute hash
    content = abs_path.read_text(encoding="utf-8")
    handoff_sha = sha256_text(content)

    # 5. Extract scope from handoff body
    scope_match = SCOPE_PATTERN.search(content)
    if scope_match:
        scope_raw = scope_match.group(1).strip()
        normalized_scope = [s.strip() for s in scope_raw.split(",") if s.strip()]
    else:
        normalized_scope = ["README documentation review"]

    if not normalized_scope:
        fail("SCOPE_EMPTY")

    scope_sha = sha256_text(canonical_json(normalized_scope))

    # 6. Get git metadata
    head_sha = git("rev-parse", "HEAD", cwd=repo_root)
    branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=repo_root)
    if branch == "HEAD":
        fail("DETACHED_HEAD")
    full_ref = f"refs/heads/{branch}"

    # 7. Determine repository slug from remote
    remote_url = git("remote", "get-url", "origin", cwd=repo_root)
    slug_match = re.search(r"[:/]([^/]+/[^/]+?)(?:\.git)?$", remote_url)
    if not slug_match:
        fail("REMOTE_SLUG_INVALID")
    repository = slug_match.group(1)

    # 8. Output relay-export JSON
    export = {
        "schema_version": {"major": 1, "minor": 0},
        "repository": repository,
        "target_pr": pr_number,
        "handoff_path": handoff_path,
        "handoff_sha256": handoff_sha,
        "full_ref": full_ref,
        "reviewed_head": head_sha,
        "review_stream": stream,
        "effective_round": round_num,
        "package_kind": kind,
        "normalized_scope": normalized_scope,
        "scope_sha256": scope_sha,
    }
    print(json.dumps(export, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
