import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { safeEqual } from "./canonical.ts";
import type { RelayConfig } from "./config.ts";
import type { JobStore } from "./job-store.ts";

export const MCP_PROTOCOL_VERSION = "2025-11-25";
const MAX_BODY_BYTES = 1_048_576;
const contract = JSON.parse(
  readFileSync(new URL("../contracts/mcp-tools.schema.json", import.meta.url), "utf8"),
) as {tools: unknown[]};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {"content-type": "application/json; charset=utf-8"});
  response.end(JSON.stringify(body));
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): unknown {
  return {jsonrpc: "2.0", id: id ?? null, error: {code, message, ...(data === undefined ? {} : {data})}};
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJsonBody(request: IncomingMessage): Promise<JsonRpcRequest> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    throw new Error("JSON_RPC_INVALID");
  }
  return value as JsonRpcRequest;
}

export function createRelayServer(config: RelayConfig, bearerToken: string, store: JobStore): Server {
  if (config.listenHost !== "127.0.0.1" && config.listenHost !== "::1") {
    throw new Error("LISTEN_HOST_NOT_LOOPBACK");
  }
  if (bearerToken.length < 32) throw new Error("BEARER_TOKEN_TOO_SHORT");

  return createServer(async (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) {
      sendJson(response, 403, {error: "REMOTE_ADDRESS_FORBIDDEN"});
      return;
    }
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      sendJson(response, 403, jsonRpcError(null, -32003, "Origin forbidden"));
      return;
    }
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Bearer ") || !safeEqual(authorization.slice(7), bearerToken)) {
      response.setHeader("www-authenticate", "Bearer");
      sendJson(response, 401, {error: "AUTHENTICATION_REQUIRED"});
      return;
    }

    if (request.url === "/health" && request.method === "GET") {
      const activeJob = store.getActiveJob();
      const activeSession = store.getActiveSession();
      sendJson(response, 200, {
        status: "ok",
        schema_version: {major: 1, minor: 0},
        mcp_protocol_version: MCP_PROTOCOL_VERSION,
        active_job: activeJob ? {job_id: activeJob.job_id, phase: activeJob.phase} : null,
        active_session: activeSession ? {session_id: activeSession.session_id, lease_expires_at: activeSession.lease_expires_at} : null,
      });
      return;
    }
    if (request.url !== "/mcp") {
      sendJson(response, 404, {error: "NOT_FOUND"});
      return;
    }
    if (request.method === "GET") {
      response.writeHead(405, {allow: "POST, GET"});
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, {allow: "POST, GET"});
      response.end();
      return;
    }
    const accept = request.headers.accept ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
      sendJson(response, 406, jsonRpcError(null, -32004, "Accept must include application/json and text/event-stream"));
      return;
    }

    let message: JsonRpcRequest;
    try {
      message = await readJsonBody(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "INVALID_REQUEST";
      sendJson(response, detail === "REQUEST_TOO_LARGE" ? 413 : 400, jsonRpcError(null, -32700, detail));
      return;
    }

    if (message.method === "notifications/initialized") {
      response.writeHead(202);
      response.end();
      return;
    }
    if (message.method === "initialize") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {tools: {listChanged: false}},
          serverInfo: {name: "single-crystal-review-relay", version: "0.1.0"},
          instructions: "Stage B host core only; browser dispatch remains disabled until Stage C authorization.",
        },
      });
      return;
    }

    const protocolVersion = request.headers["mcp-protocol-version"];
    if (protocolVersion !== MCP_PROTOCOL_VERSION) {
      sendJson(response, 400, jsonRpcError(message.id, -32602, "Unsupported protocol version", {supported: [MCP_PROTOCOL_VERSION]}));
      return;
    }
    if (message.method === "ping") {
      sendJson(response, 200, {jsonrpc: "2.0", id: message.id ?? null, result: {}});
      return;
    }
    if (message.method === "tools/list") {
      sendJson(response, 200, {jsonrpc: "2.0", id: message.id ?? null, result: {tools: contract.tools}});
      return;
    }
    if (message.method === "tools/call") {
      sendJson(response, 200, {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          content: [{type: "text", text: "STAGE_C_NOT_IMPLEMENTED: transport dispatch is intentionally disabled"}],
          isError: true,
        },
      });
      return;
    }
    sendJson(response, 200, jsonRpcError(message.id, -32601, "Method not found"));
  });
}

export async function listen(server: Server, config: RelayConfig): Promise<{host: string; port: number}> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listenPort, config.listenHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SERVER_ADDRESS_UNAVAILABLE");
  return {host: address.address, port: address.port};
}
