import { readFileSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { JobCoordinator } from "./job-coordinator.ts";
import { JobStore } from "./job-store.ts";
import { NativeMessageDecoder, encodeNativeMessage } from "./native-framing.ts";
import { NativeBridge, NATIVE_SCHEMA_VERSION } from "./native-protocol.ts";
import { createRelayServer, listen } from "./server.ts";
import { ReviewTransportService } from "./review-transport.ts";

function configArgument(): string {
  const index = process.argv.indexOf("--config");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--config is required");
  return process.argv[index + 1];
}

async function nativeHost(): Promise<void> {
  const config = loadConfig(configArgument());
  const token = readFileSync(config.bearerTokenPath, "utf8").trim();
  const store = new JobStore(config.stateDbPath);
  const coordinator = new JobCoordinator(store);
  const bridge = new NativeBridge(coordinator);
  const writeNative = (message: Record<string, unknown>) => {
    process.stdout.write(encodeNativeMessage(message));
  };
  const transport = new ReviewTransportService(config, store, coordinator, bridge, writeNative);
  const server = createRelayServer(config, token, store, transport);
  let listenPromise: Promise<void> | null = null;
  const ensureListening = () => {
    if (!listenPromise) listenPromise = listen(server, config).then((address) => {
      process.stderr.write(`review relay listening on ${address.host}:${address.port}\n`);
    });
    return listenPromise;
  };
  const decoder = new NativeMessageDecoder();
  let inbound = Promise.resolve();
  const handleMessage = async (message: unknown) => {
    const record = message !== null && typeof message === "object" && !Array.isArray(message) ? message as Record<string, unknown> : {};
    try {
      const response = bridge.handleInbound(message);
      if (record.type === "ARM_SESSION") await ensureListening();
      if (response) writeNative(response);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "NATIVE_HOST_ERROR";
      if (record.type === "ARM_SESSION" && typeof record.sessionId === "string") store.disarmSession(record.sessionId);
      writeNative({
        schemaVersion: NATIVE_SCHEMA_VERSION,
        type: "ERROR",
        responseToRequestId: typeof record.requestId === "string" ? record.requestId : undefined,
        errorCode: detail.split(":", 1)[0],
        message: detail,
      });
    }
  };
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) inbound = inbound.then(() => handleMessage(message));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "NATIVE_HOST_ERROR";
      writeNative({
        schemaVersion: NATIVE_SCHEMA_VERSION,
        type: "ERROR",
        errorCode: detail.split(":", 1)[0],
        message: detail,
      });
    }
  });
  const shutdown = () => {
    const finish = () => { store.close(); process.exit(0); };
    if (server.listening) server.close(finish); else finish();
  };
  process.stdin.once("end", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const command = process.argv[2];
if (command === "native-host") {
  await nativeHost();
} else {
  throw new Error("usage: cli.ts native-host --config <path>");
}
