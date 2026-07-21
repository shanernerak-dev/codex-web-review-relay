import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { NativeMessageDecoder, encodeNativeMessage } from "../src/native-framing.ts";
import { NATIVE_SCHEMA_VERSION } from "../src/native-protocol.ts";

const index = process.argv.indexOf("--launcher");
if (index < 0 || !process.argv[index + 1]) throw new Error("--launcher is required");
const launcher = process.argv[index + 1];
const child = spawn(launcher, [], {stdio: ["pipe", "pipe", "pipe"], windowsHide: true});
const decoder = new NativeMessageDecoder();
const messages: Record<string, unknown>[] = [];
let stderr = "";
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4_000); });
child.stdout.on("data", (chunk) => messages.push(...decoder.push(chunk) as Record<string, unknown>[]));

async function waitFor(type: string, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find((message) => message.type === type);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`SMOKE_TIMEOUT:${type}:${stderr}`);
}

const sessionId = randomUUID();
child.stdin.write(encodeNativeMessage({
  schemaVersion: NATIVE_SCHEMA_VERSION, type: "ARM_SESSION", requestId: "smoke-arm",
  sessionId, extensionVersion: "0.1.0",
}));
const armed = await waitFor("SESSION_ARMED");
if (armed.responseToRequestId !== "smoke-arm") throw new Error("SMOKE_ARM_CORRELATION_FAILED");
child.stdin.write(encodeNativeMessage({
  schemaVersion: NATIVE_SCHEMA_VERSION, type: "DISARM_SESSION", requestId: "smoke-disarm", sessionId,
}));
const disarmed = await waitFor("SESSION_DISARMED");
if (disarmed.responseToRequestId !== "smoke-disarm") throw new Error("SMOKE_DISARM_CORRELATION_FAILED");
child.stdin.end();
await new Promise<void>((resolve, reject) => {
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`SMOKE_HOST_EXIT:${code}:${stderr}`)));
  child.once("error", reject);
});
console.log(JSON.stringify({native_host_smoke: true, schema_version: NATIVE_SCHEMA_VERSION}));
