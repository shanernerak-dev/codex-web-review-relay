import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const HANDOFF = ".agent/review_handoffs/pr-2/main/round-01-review-fix.md";
const HELPER_SOURCE = resolve("scripts/tools/relay_export_helper.py");

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=relay-test", "-c", "user.email=relay-test@example.invalid", ...args], {
    cwd: root,
    stdio: "pipe",
  });
}

function validHandoff(): string {
  return [
    "# Review Request",
    "",
    "Package kind: `review-fix`",
    "Review stream: `main`",
    "Effective round: `1`",
    "Target PR: `#2`",
    "Review scope: helper contract",
    "",
  ].join("\n");
}

function createRepo(content: string | Buffer, commit = true): string {
  const root = mkdtempSync(join(tmpdir(), "relay-helper-test-"));
  mkdirSync(join(root, ".agent", "review_handoffs", "pr-2", "main"), {recursive: true});
  mkdirSync(join(root, "scripts", "tools"), {recursive: true});
  copyFileSync(HELPER_SOURCE, join(root, "scripts", "tools", "relay_export_helper.py"));
  writeFileSync(join(root, HANDOFF), content, "utf8");
  git(root, "init", "-q");
  git(root, "config", "core.autocrlf", "false");
  git(root, "remote", "add", "origin", "https://github.com/example/relay.git");
  if (commit) {
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "fixture");
  }
  return root;
}

function runHelper(root: string, path = HANDOFF) {
  return spawnSync("python", [join(root, "scripts", "tools", "relay_export_helper.py"), "relay-export", path], {
    cwd: root,
    encoding: "utf8",
  });
}

function withRepo<T>(content: string, fn: (root: string) => T): T {
  const root = createRepo(content);
  try {
    return fn(root);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

test("generic relay-export helper validates all identity headers and scope", () => {
  withRepo(validHandoff(), (root) => {
    const result = runHelper(root);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.target_pr, 2);
    assert.equal(payload.review_stream, "main");
    assert.equal(payload.effective_round, 1);
    assert.equal(payload.package_kind, "review-fix");
    assert.deepEqual(payload.normalized_scope, ["helper contract"]);
  });
});

test("generic relay-export helper rejects missing or duplicate stable headers", () => {
  const fields = ["Package kind", "Review stream", "Effective round", "Target PR", "Review scope"];
  for (const field of fields) {
    const content = validHandoff().replace(new RegExp(`^${field}:.*\\n`, "m"), "");
    withRepo(content, (root) => assert.equal(runHelper(root).stderr.trim(), "HANDOFF_HEADER_INVALID"));
  }
  withRepo(validHandoff().replace("Review stream: `main`", "Review stream: `main`\nReview stream: `main`"), (root) => {
    assert.equal(runHelper(root).stderr.trim(), "HANDOFF_HEADER_INVALID");
  });
});

test("generic relay-export helper rejects path/header mismatches and empty scope", () => {
  const cases = [
    ["Target PR: `#3`", "HANDOFF_PATH_HEADER_MISMATCH"],
    ["Review stream: `other`", "HANDOFF_PATH_HEADER_MISMATCH"],
    ["Effective round: `2`", "HANDOFF_PATH_HEADER_MISMATCH"],
    ["Package kind: `review-request`", "HANDOFF_PATH_HEADER_MISMATCH"],
    ["Review scope: ", "HANDOFF_HEADER_INVALID"],
  ] as const;
  for (const [replacement, expected] of cases) {
    const field = replacement.split(":")[0];
    const content = validHandoff().replace(new RegExp(`^${field}:.*$`, "m"), replacement);
    withRepo(content, (root) => assert.equal(runHelper(root).stderr.trim(), expected));
  }
});

test("generic relay-export helper fails closed for untracked, dirty, blob-mismatched, and detached states", () => {
  withRepo(validHandoff(), (root) => {
    const untracked = ".agent/review_handoffs/pr-2/main/round-02-review-fix.md";
    writeFileSync(join(root, untracked), validHandoff().replace("round-01", "round-02"), "utf8");
    assert.equal(runHelper(root, untracked).stderr.trim(), "HANDOFF_NOT_TRACKED");
  });
  withRepo(validHandoff(), (root) => {
    writeFileSync(join(root, HANDOFF), validHandoff() + "dirty\n", "utf8");
    assert.equal(runHelper(root).stderr.trim(), "HANDOFF_DIRTY_WORKTREE");
  });
  withRepo(validHandoff(), (root) => {
    writeFileSync(join(root, HANDOFF), validHandoff() + "blob\n", "utf8");
    git(root, "update-index", "--assume-unchanged", "--", HANDOFF);
    assert.equal(runHelper(root).stderr.trim(), "HANDOFF_BLOB_MISMATCH");
  });
  withRepo(validHandoff(), (root) => {
    git(root, "checkout", "--detach", "-q", "HEAD");
    assert.equal(runHelper(root).stderr.trim(), "DETACHED_HEAD");
  });
});

test("generic relay-export helper hashes committed CRLF bytes and rejects invalid UTF-8 stably", () => {
  const crlf = Buffer.from(validHandoff().replaceAll("\n", "\r\n"), "utf8");
  withRepo(crlf, (root) => {
    const result = runHelper(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).handoff_sha256, createHash("sha256").update(readFileSync(join(root, HANDOFF))).digest("hex"));
  });
  const invalid = Buffer.concat([Buffer.from(validHandoff(), "utf8"), Buffer.from([0xff])]);
  withRepo(invalid, (root) => {
    const result = runHelper(root);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), "HANDOFF_ENCODING_INVALID");
    assert.equal(result.stdout, "");
  });
});
