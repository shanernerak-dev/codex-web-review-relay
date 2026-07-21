import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RelayConfig } from "../src/config.ts";
import { JobStore } from "../src/job-store.ts";
import { createRelayServer, listen, MCP_PROTOCOL_VERSION } from "../src/server.ts";
import type { ReviewTransportService } from "../src/review-transport.ts";

test("localhost MCP server enforces auth, origin and protocol version", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-relay-server-"));
  const store = new JobStore(join(root, "state.sqlite"));
  const token = "t".repeat(48);
  const config = {
    listenHost: "127.0.0.1",
    listenPort: 0,
    allowedOrigins: ["http://127.0.0.1:43127"],
    bearerTokenPath: "unused",
    stateDbPath: "unused",
    repositoryRoot: "unused",
    pythonExecutable: "python",
    helperPath: "unused",
    nativeHostName: "dev.test.relay",
    extensionId: "a".repeat(32),
    requestDeadlineMs: 300_000,
  } as RelayConfig;
  const transport = {
    async requestReview(handoffPath: string) { return {job_id: "job-1", handoff_path: handoffPath, phase: "TURN_IDLE"}; },
    async getStatus(input: object) { return {job_id: "job-1", phase: "TURN_IDLE", lookup: input}; },
  } as unknown as ReviewTransportService;
  const server = createRelayServer(config, token, store, transport);
  const address = await listen(server, config);
  const base = `http://127.0.0.1:${address.port}`;
  const unauthorized = await fetch(`${base}/health`);
  assert.equal(unauthorized.status, 401);
  const forbidden = await fetch(`${base}/health`, {
    headers: {authorization: `Bearer ${token}`, origin: "https://example.invalid"},
  });
  assert.equal(forbidden.status, 403);
  const health = await fetch(`${base}/health`, {headers: {authorization: `Bearer ${token}`}});
  assert.equal(health.status, 200);

  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  const initialized = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: MCP_PROTOCOL_VERSION}}),
  });
  assert.equal(initialized.status, 200);
  assert.equal((await initialized.json()).result.protocolVersion, MCP_PROTOCOL_VERSION);

  const missingVersion = await fetch(`${base}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({jsonrpc: "2.0", id: 2, method: "tools/list"}),
  });
  assert.equal(missingVersion.status, 400);
  const tools = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {...headers, "mcp-protocol-version": MCP_PROTOCOL_VERSION},
    body: JSON.stringify({jsonrpc: "2.0", id: 3, method: "tools/list"}),
  });
  assert.equal(tools.status, 200);
  assert.deepEqual((await tools.json()).result.tools.map((tool: {name: string}) => tool.name), [
    "request_review", "get_review_transport_status",
  ]);
  const call = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {...headers, "mcp-protocol-version": MCP_PROTOCOL_VERSION},
    body: JSON.stringify({jsonrpc: "2.0", id: 4, method: "tools/call", params: {name: "request_review", arguments: {handoff_path: ".agent/review_handoffs/pr-41/stage-c-delivery/round-01-review-request.md"}}}),
  });
  const callBody = await call.json();
  assert.equal(callBody.result.isError, false);
  assert.equal(callBody.result.structuredContent.phase, "TURN_IDLE");
  const invalidCall = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {...headers, "mcp-protocol-version": MCP_PROTOCOL_VERSION},
    body: JSON.stringify({jsonrpc: "2.0", id: 5, method: "tools/call", params: {name: "request_review", arguments: {handoff_path: "x", extra: true}}}),
  });
  assert.equal((await invalidCall.json()).result.structuredContent.error_code, "REQUEST_REVIEW_INPUT_INVALID");
  const get = await fetch(`${base}/mcp`, {headers: {authorization: `Bearer ${token}`, accept: "text/event-stream"}});
  assert.equal(get.status, 405);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(root, {recursive: true, force: true});
});
