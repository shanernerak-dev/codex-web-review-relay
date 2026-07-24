import assert from "node:assert/strict";
import { copyFileSync, createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveHandoffLocation, runRelayExport } from "../src/repo-adapter.ts";
import type { RelayConfig } from "../src/config.ts";

function config(root: string, exporterPath: string): RelayConfig {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: [],
    bearerTokenPath: join(root, "token"), stateDbPath: join(root, "state.sqlite"),
    pythonExecutable: "python", exporterPath,
    nativeHostName: "dev.test.relay", extensionId: "a".repeat(32),
    requestWaitSliceMs: 1_000, turnDeadlineMs: 300_000,
  };
}

function git(repo: string, ...args: string[]): void { execFileSync("git", ["-C", repo, ...args], {stdio: "ignore"}); }

test("repo adapter resolves the current repository and trusted exporter", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-adapter-test-"));
  const repo = join(root, "repo");
  const handoff = join(repo, ".agent", "review_handoffs", "pr-2", "main", "round-01-review-fix.md");
  mkdirSync(join(repo, ".agent", "review_handoffs", "pr-2", "main"), {recursive: true});
  const scopeHash = createHash("sha256").update('["scope"]').digest("hex");
  const payload = {
    schema_version: {major: 1, minor: 0}, repository: "example/relay", target_pr: 2,
    handoff_path: ".agent/review_handoffs/pr-2/main/round-01-review-fix.md", handoff_sha256: "a".repeat(64),
    full_ref: "refs/heads/main", reviewed_head: "b".repeat(40), review_stream: "main", effective_round: 1,
    package_kind: "review-fix", normalized_scope: ["scope"], scope_sha256: scopeHash,
  };
  mkdirSync(join(root, "trusted"), {recursive: true});
  const exporter = join(root, "trusted", "relay_export_helper.py");
  copyFileSync(join(process.cwd(), "scripts", "tools", "relay_export_helper.py"), exporter);
  writeFileSync(handoff, "handoff\n", "utf8");
  git(repo, "init"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "config", "user.name", "Test");
  git(repo, "remote", "add", "origin", "https://github.com/example/relay.git"); git(repo, "add", "."); git(repo, "commit", "-m", "test");
  // The helper output is replaced by a tiny trusted test exporter after Git identity resolution.
  writeFileSync(exporter, `import json\nprint(json.dumps(${JSON.stringify(payload)}))\n`, "utf8");
  try {
    const relay = await runRelayExport(config(root, exporter), handoff);
    assert.equal(relay.package_kind, "review-fix");
    const location = await resolveHandoffLocation(handoff);
    assert.equal(location.repository, "example/relay");
    assert.equal(location.handoffPath, payload.handoff_path);
    await assert.rejects(runRelayExport(config(root, join(root, "outside.py")), handoff), /EXPORTER_PATH_INVALID/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
