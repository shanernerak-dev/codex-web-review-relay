import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { encodeNativeMessage, NativeMessageDecoder } from "../src/native-framing.ts";
import { NATIVE_SCHEMA_VERSION } from "../src/native-protocol.ts";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_PORT_UNAVAILABLE");
  await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  return address.port;
}

test("native host correlates per-frame errors and exposes MCP only after a valid ARM", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-cli-"));
  const port = await unusedPort();
  const token = "t".repeat(64);
  const tokenPath = join(root, "token.txt");
  const configPath = join(root, "relay.json");
  writeFileSync(tokenPath, token, "utf8");
  writeFileSync(configPath, JSON.stringify({
    listenHost: "127.0.0.1",
    listenPort: port,
    allowedOrigins: ["chrome-extension://" + "a".repeat(32)],
    bearerTokenPath: tokenPath,
    stateDbPath: join(root, "state.sqlite"),
    repositoryRoot: root,
    pythonExecutable: "python",
    helperPath: "helper.py",
    nativeHostName: "dev.test.relay",
    extensionId: "a".repeat(32),
    requestWaitSliceMs: 10_000,
    turnDeadlineMs: 300_000,
  }), "utf8");

  const child = spawn(process.execPath, ["--experimental-strip-types", resolve("src/cli.ts"), "native-host", "--config", configPath], {
    cwd: resolve("."), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  try {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, {headers: {authorization: `Bearer ${token}`}}));

    const decoder = new NativeMessageDecoder();
    const responses: Record<string, unknown>[] = [];
    const received = new Promise<void>((resolveReceived, rejectReceived) => {
      const timer = setTimeout(() => rejectReceived(new Error("NATIVE_TEST_TIMEOUT")), 5_000);
      child.stdout.on("data", (chunk: Buffer) => {
        for (const value of decoder.push(chunk)) responses.push(value as Record<string, unknown>);
        if (responses.length >= 2) { clearTimeout(timer); resolveReceived(); }
      });
      child.once("error", rejectReceived);
    });
    child.stdin.write(Buffer.concat([
      encodeNativeMessage({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "bad", sessionId: "session-1"}),
      encodeNativeMessage({schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "good", sessionId: "session-1", extensionVersion: "0.1.0"}),
    ]));
    await received;
    assert.equal(responses[0].type, "ERROR");
    assert.equal(responses[0].responseToRequestId, "bad");
    assert.equal(responses[1].type, "SESSION_ARMED");
    assert.equal(responses[1].responseToRequestId, "good");

    const health = await fetch(`http://127.0.0.1:${port}/health`, {headers: {authorization: `Bearer ${token}`}});
    assert.equal(health.status, 200);
  } finally {
    child.stdin.end();
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 1_000)),
    ]);
    if (child.exitCode === null) child.kill();
    rmSync(root, {recursive: true, force: true});
  }
});
