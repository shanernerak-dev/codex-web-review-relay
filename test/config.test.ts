import assert from "node:assert/strict";
import test from "node:test";
import { validateConfig } from "../src/config.ts";

function validConfig() {
  return {
    listenHost: "127.0.0.1", listenPort: 43127, allowedOrigins: ["http://127.0.0.1:43127"],
    bearerTokenPath: "token", stateDbPath: "state.sqlite", pythonExecutable: "python", exporterPath: "C:\\relay\\relay_export_helper.py", trustedInstallRoot: "C:\\relay", nativeHostName: "dev.test.relay",
    extensionId: "a".repeat(32), requestWaitSliceMs: 300_000, turnDeadlineMs: 900_000,
  };
}

test("config separates bounded wait slice from hard turn deadline", () => {
  const config = validateConfig(validConfig());
  assert.equal(config.requestWaitSliceMs, 300_000);
  assert.equal(config.turnDeadlineMs, 900_000);
  assert.equal(config.diagnosticLogPath, "state.sqlite.events.jsonl");
  assert.equal(config.diagnosticLogLevel, "info");
  assert.throws(() => validateConfig({...validConfig(), requestWaitSliceMs: 300_001}), /CONFIG_INVALID:requestWaitSliceMs/);
  assert.throws(() => validateConfig({...validConfig(), turnDeadlineMs: 1_800_001}), /CONFIG_INVALID:turnDeadlineMs/);
  assert.throws(() => validateConfig({...validConfig(), requestWaitSliceMs: 300_000, turnDeadlineMs: 299_999}), /CONFIG_INVALID:turnDeadlineMs/);
});

test("config validates diagnostic logging controls", () => {
  assert.equal(validateConfig({...validConfig(), diagnosticLogLevel: "trace"}).diagnosticLogLevel, "trace");
  assert.throws(() => validateConfig({...validConfig(), diagnosticLogLevel: "verbose"}), /CONFIG_INVALID:diagnosticLogLevel/);
  assert.throws(() => validateConfig({...validConfig(), diagnosticLogMaxBytes: 100}), /CONFIG_INVALID:diagnosticLogMaxBytes/);
  assert.throws(() => validateConfig({...validConfig(), diagnosticLogRetainedFiles: 0}), /CONFIG_INVALID:diagnosticLogRetainedFiles/);
});

test("config rejects invalid exporter paths", () => {
  for (const exporterPath of ["../outside.py", "..\\outside.py", "relative\\outside.py"]) {
    assert.throws(() => validateConfig({...validConfig(), exporterPath}), /CONFIG_INVALID:exporterPath/);
  }
  assert.equal(validateConfig({...validConfig(), exporterPath: "C:\\relay\\relay_export_helper.py"}).exporterPath, "C:\\relay\\relay_export_helper.py");
});
