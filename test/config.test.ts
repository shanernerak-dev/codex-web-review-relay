import assert from "node:assert/strict";
import test from "node:test";
import { validateConfig } from "../src/config.ts";

function validConfig() {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: ["http://127.0.0.1:43127"],
    bearerTokenPath: "token", stateDbPath: "state.sqlite", repositoryRoot: "repo",
    pythonExecutable: "python", helperPath: "helper.py", nativeHostName: "dev.test.relay",
    extensionId: "a".repeat(32), requestWaitSliceMs: 300_000, turnDeadlineMs: 900_000,
  };
}

test("config separates bounded wait slice from hard turn deadline", () => {
  const config = validateConfig(validConfig());
  assert.equal(config.requestWaitSliceMs, 300_000);
  assert.equal(config.turnDeadlineMs, 900_000);
  assert.throws(() => validateConfig({...validConfig(), requestWaitSliceMs: 300_001}), /CONFIG_INVALID:requestWaitSliceMs/);
  assert.throws(() => validateConfig({...validConfig(), turnDeadlineMs: 1_800_001}), /CONFIG_INVALID:turnDeadlineMs/);
  assert.throws(() => validateConfig({...validConfig(), requestWaitSliceMs: 300_000, turnDeadlineMs: 299_999}), /CONFIG_INVALID:turnDeadlineMs/);
});

test("config rejects helper paths outside the repository-relative boundary", () => {
  for (const helperPath of ["../outside.py", "..\\outside.py", "C:\\outside.py", "\\\\server\\share\\helper.py", "/tmp/helper.py"]) {
    assert.throws(() => validateConfig({...validConfig(), helperPath}), /CONFIG_INVALID:helperPathBoundary/);
  }
  assert.equal(validateConfig({...validConfig(), helperPath: "scripts/tools/helper.py"}).helperPath, "scripts/tools/helper.py");
});
