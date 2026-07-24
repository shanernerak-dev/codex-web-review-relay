import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runRelayExport } from "../src/repo-adapter.ts";
import type { RelayConfig } from "../src/config.ts";

function config(repositoryRoot: string, helperPath: string): RelayConfig {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: [],
    bearerTokenPath: join(repositoryRoot, "token"), stateDbPath: join(repositoryRoot, "state.sqlite"),
    repositoryRoot, pythonExecutable: "python", helperPath,
    nativeHostName: "dev.test.relay", extensionId: "a".repeat(32),
    requestWaitSliceMs: 1_000, turnDeadlineMs: 300_000,
  };
}

test("repo adapter runs a nested helper and rejects repository escapes", async () => {
  const root = mkdtempSync(join(tmpdir(), "relay-adapter-test-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "scripts", "tools"), {recursive: true});
  const scopeHash = createHash("sha256").update('["scope"]').digest("hex");
  const payload = {
    schema_version: {major: 1, minor: 0}, repository: "example/relay", target_pr: 2,
    handoff_path: ".agent/review_handoffs/pr-2/main/round-01-review-fix.md",
    handoff_sha256: "a".repeat(64), full_ref: "refs/heads/main", reviewed_head: "b".repeat(40),
    review_stream: "main", effective_round: 1, package_kind: "review-fix",
    normalized_scope: ["scope"], scope_sha256: scopeHash,
  };
  writeFileSync(join(repo, "scripts", "tools", "helper.py"), `import json\nprint(json.dumps(${JSON.stringify(payload)}))\n`, "utf8");
  writeFileSync(join(root, "outside.py"), "print('{}')\n", "utf8");
  try {
    const relay = await runRelayExport(config(repo, "scripts/tools/helper.py"), "handoff.md");
    assert.equal(relay.package_kind, "review-fix");
    await assert.rejects(runRelayExport(config(repo, "../outside.py"), "handoff.md"), /RELAY_HELPER_PATH_ESCAPE/);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
