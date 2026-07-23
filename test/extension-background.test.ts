import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

type Listener = (...args: any[]) => any;

function event() {
  const listeners: Listener[] = [];
  return {
    listeners,
    addListener(listener: Listener) { listeners.push(listener); },
    emit(...args: any[]) { return Promise.all(listeners.map((listener) => listener(...args))); },
  };
}

function port(diagnosticResponse: (message: any) => any = (message) => ({
  schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: message.requestId,
  persisted: true, disposition: "appended",
})) {
  return {messages: [] as any[], onMessage: event(), onDisconnect: event(), postMessage(message: any) {
    this.messages.push(message);
    if (message.type === "DIAGNOSTIC_EVENT") queueMicrotask(() => void this.onMessage.emit(diagnosticResponse(message)));
  }, disconnect() { void this.onDisconnect.emit(); }};
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("TEST_WAIT_TIMEOUT");
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
}

function harness() {
  const runtimeMessages = event();
  const tabRemoved = event();
  const tabUpdated = event();
  const ports: ReturnType<typeof port>[] = [];
  const storage = new Map<string, any>();
  let diagnosticResponse = (message: any) => ({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: message.requestId,
    persisted: true, disposition: "appended",
  });
  let conversationIdentity = "https://chatgpt.com/c/conversation-a";
  const documentId = "document-a";
  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({version: "0.2.1"}),
      connectNative: () => { const created = port((message) => diagnosticResponse(message)); ports.push(created); return created; },
      onMessage: runtimeMessages,
    },
    storage: {local: {
      async get(key: string) { return {[key]: storage.get(key)}; },
      async set(value: Record<string, any>) { for (const [key, entry] of Object.entries(value)) storage.set(key, entry); },
      async remove(key: string) { storage.delete(key); },
    }},
    tabs: {
      async query() { return [{id: 7, url: conversationIdentity}]; },
      async sendMessage(_tabId: number, message: any) {
        if (message.kind === "GET_PAGE_STATE") return {ok: true, adapterReady: true, conversationIdentity, documentId};
        if (message.kind === "DISPATCH_TRIGGER" || message.kind === "RECONCILE_TRIGGER") return {ok: true};
        throw new Error("UNSUPPORTED_TEST_TAB_MESSAGE");
      },
      onRemoved: tabRemoved,
      onUpdated: tabUpdated,
    },
  };
  const unrefInterval = (callback: (...args: any[]) => void, delay?: number) => {
    const handle = setInterval(callback, delay);
    handle.unref();
    return handle;
  };
  const context = vm.createContext({chrome, crypto: webcrypto, TextEncoder, Error, Promise, Math, Date, queueMicrotask, setTimeout, clearTimeout, setInterval: unrefInterval, clearInterval});
  vm.runInContext(readFileSync(resolve("extension/background.js"), "utf8"), context, {filename: "background.js"});

  async function runtime(message: any, senderTabId: number | null = message.kind === "LIFECYCLE" ? 7 : null): Promise<any> {
    if (message.kind === "LIFECYCLE" || message.kind === "DIAGNOSTIC") {
      const saved = storage.get("relaySession");
      message = {...message, bindingGeneration: message.bindingGeneration ?? saved?.bindingGeneration, documentId: message.documentId ?? saved?.documentId};
    }
    const listener = runtimeMessages.listeners[0];
    return new Promise((resolveResponse, rejectResponse) => {
      let responded = false;
      const respond = (value: any) => { responded = true; resolveResponse(value); };
      try {
        const sender = senderTabId === null ? {} : {tab: {id: senderTabId}};
        const asynchronous = listener(message, sender, respond);
        if (asynchronous !== true && !responded) resolveResponse(undefined);
      } catch (error) { rejectResponse(error); }
    });
  }

  function respondTo(target: ReturnType<typeof port>, request: any, type: string, extra: Record<string, any> = {}) {
    void target.onMessage.emit({schemaVersion: {major: 1, minor: 0}, type, responseToRequestId: request.requestId, ...extra});
  }

  return {
    ports, runtime, tabUpdated,
    setConversation(value: string) { conversationIdentity = value; },
    setDiagnosticResponse(value: (message: any) => any) { diagnosticResponse = value; },
    diagnosticQueue() { return storage.get("reviewRelayDiagnosticsV1") ?? []; },
    pendingTerminal() { return storage.get("relayPendingTerminalLifecycleV1") ?? null; },
    respondTo,
  };
}

test("extension waits for lifecycle ACK, acknowledges dispatch receipt and recovers only the armed binding", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const firstPort = h.ports[0];
  const armRequest = firstPort.messages.find((message) => message.type === "ARM_SESSION");
  assert.equal(Array.from(armRequest.capabilities).join(","), "relay-only-v1,diagnostics-v1");
  assert.equal(armRequest.schemaVersion.major, 1);
  assert.equal(armRequest.schemaVersion.minor, 3);
  h.respondTo(firstPort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await armResult).ok, true);
  const duplicateArm = await h.runtime({kind: "POPUP_ARM"});
  assert.equal(duplicateArm.ok, false);
  assert.equal(duplicateArm.error, "SESSION_ALREADY_ARMED");

  await firstPort.onMessage.emit({
    schemaVersion: {major: 1, minor: 0}, type: "DISPATCH_TRIGGER", requestId: "dispatch-1",
    sessionId: armRequest.sessionId, jobId: "job-1", envelope: "Path: x", ownershipGeneration: 1, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  assert.ok(firstPort.messages.some((message) => message.type === "DISPATCH_TRIGGER_ACCEPTED" && message.responseToRequestId === "dispatch-1"));

  let lifecycleSettled = false;
  const lifecycle = h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "job-1", ownershipGeneration: 1, assistantOutput: "formal verdict output"}).then((value) => { lifecycleSettled = true; return value; });
  await waitFor(() => firstPort.messages.some((message) => message.type === "TURN_IDLE"));
  assert.equal(lifecycleSettled, false);
  const idleRequest = firstPort.messages.find((message) => message.type === "TURN_IDLE");
  assert.equal(idleRequest.assistantOutput, "formal verdict output");
  assert.equal(h.pendingTerminal().type, "TURN_IDLE");
  h.respondTo(firstPort, idleRequest, "EVENT_ACK", {jobId: "job-1", phase: "TURN_IDLE"});
  assert.equal((await lifecycle).ok, true);
  assert.equal(h.pendingTerminal(), null);
  assert.equal((await h.runtime({kind: "POPUP_STATUS"})).state.activeJobId, null);

  await firstPort.onDisconnect.emit();
  await waitFor(() => h.ports.length === 2, 2_000);
  const secondPort = h.ports[1];
  await waitFor(() => secondPort.messages.some((message) => message.type === "ARM_SESSION"));
  const rearm = secondPort.messages.find((message) => message.type === "ARM_SESSION");
  assert.equal(rearm.sessionId, armRequest.sessionId);
  h.respondTo(secondPort, rearm, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await waitFor(async () => (await h.runtime({kind: "POPUP_STATUS"})).state.connection === "connected");

  const disarmResult = h.runtime({kind: "POPUP_DISARM"});
  await waitFor(() => secondPort.messages.some((message) => message.type === "DISARM_SESSION"));
  const disarm = secondPort.messages.find((message) => message.type === "DISARM_SESSION");
  h.respondTo(secondPort, disarm, "SESSION_DISARMED");
  assert.equal((await disarmResult).ok, true);
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  assert.equal(h.ports.length, 2);
});

test("disarm clears the native session even when the extension port is disconnected", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const firstPort = h.ports[0];
  const armRequest = firstPort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(firstPort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await armResult).ok, true);

  await firstPort.onDisconnect.emit();
  const disarmResult = h.runtime({kind: "POPUP_DISARM"});
  await waitFor(() => h.ports.length === 2 && h.ports[1].messages.some((message) => message.type === "DISARM_SESSION"));
  const disarm = h.ports[1].messages.find((message) => message.type === "DISARM_SESSION");
  assert.equal(disarm.sessionId, armRequest.sessionId);
  h.respondTo(h.ports[1], disarm, "SESSION_DISARMED");
  assert.equal((await disarmResult).ok, true);

  const rearmResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 3 && h.ports[2].messages.some((message) => message.type === "ARM_SESSION"));
  const replacementArm = h.ports[2].messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(h.ports[2], replacementArm, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await rearmResult).ok, true);
});

test("disarm refuses to clear a session while a review job is active", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;

  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 0}, type: "DISPATCH_TRIGGER", requestId: "dispatch-active",
    sessionId: armRequest.sessionId, jobId: "job-active", envelope: "Path: x", deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  await waitFor(() => nativePort.messages.some((message) => message.type === "DISPATCH_TRIGGER_ACCEPTED"));

  const disarm = await h.runtime({kind: "POPUP_DISARM"});
  assert.equal(disarm.ok, false);
  assert.equal(disarm.error, "ACTIVE_JOB_DISARM_FORBIDDEN");
  assert.equal(nativePort.messages.some((message) => message.type === "DISARM_SESSION"), false);
  assert.equal((await h.runtime({kind: "POPUP_STATUS"})).state.activeJobId, "job-active");

  const staleDiagnostic = await h.runtime({
    kind: "DIAGNOSTIC", level: "info", event: "user_turn_observed", jobId: "job-active",
    bindingGeneration: "stale-binding", documentId: "document-a", details: {},
  });
  assert.equal(staleDiagnostic.ok, false);
  assert.equal(staleDiagnostic.errorCode, "DIAGNOSTIC_SENDER_MISMATCH");

  const armAgain = await h.runtime({kind: "POPUP_ARM"});
  assert.equal(armAgain.ok, false);
  assert.equal(armAgain.error, "ACTIVE_JOB_ARM_FORBIDDEN");
  assert.equal(nativePort.messages.filter((message) => message.type === "ARM_SESSION").length, 1);

  const wrongTab = await h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "job-active", assistantOutput: "ignored"}, 99);
  assert.equal(wrongTab.ok, false);
  assert.equal(wrongTab.errorCode, "LIFECYCLE_SENDER_TAB_MISMATCH");
  const wrongJob = await h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "other-job", assistantOutput: "ignored"});
  assert.equal(wrongJob.ok, false);
  assert.equal(wrongJob.errorCode, "LIFECYCLE_JOB_MISMATCH");
});

test("same-tab navigation atomically rejects the old monitor and requires manual Arm", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;

  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 0}, type: "DISPATCH_TRIGGER", requestId: "dispatch-navigation",
    sessionId: armRequest.sessionId, jobId: "job-navigation", envelope: "Path: x", deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  await waitFor(() => nativePort.messages.some((message) => message.type === "DISPATCH_TRIGGER_ACCEPTED"));

  h.setConversation("https://chatgpt.com/c/conversation-b");
  const navigation = h.tabUpdated.emit(7, {status: "complete", url: "https://chatgpt.com/c/conversation-b"});
  await waitFor(() => nativePort.messages.some((message) => message.type === "SESSION_LOST" && message.jobId === "job-navigation"));
  const status = await h.runtime({kind: "POPUP_STATUS"});
  assert.equal(status.state.armed, false);
  const staleLifecycle = await h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "job-navigation", assistantOutput: "stale"});
  assert.equal(staleLifecycle.ok, false);
  assert.equal(staleLifecycle.errorCode, "SESSION_NOT_ARMED");

  const lost = nativePort.messages.find((message) => message.type === "SESSION_LOST" && message.jobId === "job-navigation");
  h.respondTo(nativePort, lost, "EVENT_ACK", {jobId: "job-navigation", phase: "SESSION_LOST"});
  await waitFor(() => nativePort.messages.some((message) => message.type === "DISARM_SESSION"));
  const invalidatedDisarm = nativePort.messages.find((message) => message.type === "DISARM_SESSION");
  h.respondTo(nativePort, invalidatedDisarm, "SESSION_DISARMED");
  await navigation;

  const rearmResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => nativePort.messages.filter((message) => message.type === "ARM_SESSION").length === 2);
  const replacementPort = nativePort;
  const replacementArm = replacementPort.messages.find((message) => message.type === "ARM_SESSION" && message.sessionId !== armRequest.sessionId);
  h.respondTo(replacementPort, replacementArm, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await rearmResult).ok, true);

  const disarmResult = h.runtime({kind: "POPUP_DISARM"});
  await waitFor(() => replacementPort.messages.filter((message) => message.type === "DISARM_SESSION").length === 2);
  const disarm = replacementPort.messages.find((message) => message.type === "DISARM_SESSION" && message.sessionId === replacementArm.sessionId);
  h.respondTo(replacementPort, disarm, "SESSION_DISARMED");
  await disarmResult;
});

test("terminal reconcile mismatch releases the background active job", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;
  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 3}, type: "RECONCILE_TRIGGER", requestId: "reconcile-missing",
    sessionId: armRequest.sessionId, jobId: "job-missing", envelope: "Path: x",
    ownershipGeneration: 2, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  const lifecycle = h.runtime({kind: "LIFECYCLE", type: "RECONCILE_MISMATCH", jobId: "job-missing", ownershipGeneration: 2});
  await waitFor(() => nativePort.messages.some((message) => message.type === "RECONCILE_MISMATCH"));
  const mismatch = nativePort.messages.find((message) => message.type === "RECONCILE_MISMATCH");
  assert.equal(mismatch.ownershipGeneration, 2);
  h.respondTo(nativePort, mismatch, "EVENT_ACK", {jobId: "job-missing", phase: "MISMATCH"});
  assert.equal((await lifecycle).ok, true);
  assert.equal((await h.runtime({kind: "POPUP_STATUS"})).state.activeJobId, null);
});

test("background rejects a stale content ownership generation without rewriting it", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;
  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 3}, type: "RECONCILE_TRIGGER", requestId: "reconcile-generation",
    sessionId: armRequest.sessionId, jobId: "job-generation", envelope: "Path: x",
    ownershipGeneration: 2, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  const before = nativePort.messages.length;
  const stale = await h.runtime({kind: "LIFECYCLE", type: "TURN_TIMEOUT", jobId: "job-generation", ownershipGeneration: 1});
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, "LIFECYCLE_OWNERSHIP_MISMATCH");
  assert.equal(nativePort.messages.length, before);
});

test("background rejects stale-generation diagnostics", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;
  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 3}, type: "DISPATCH_TRIGGER", requestId: "dispatch-diagnostic-generation",
    sessionId: armRequest.sessionId, jobId: "job-diagnostic-generation", envelope: "Path: x",
    ownershipGeneration: 4, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  const stale = await h.runtime({
    kind: "DIAGNOSTIC", level: "info", event: "monitor_failed", jobId: "job-diagnostic-generation",
    ownershipGeneration: 3, details: {error_code: "TURN_BOUNDARY_UNHYDRATED"},
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.errorCode, "DIAGNOSTIC_SENDER_MISMATCH");
});

test("a fallback terminal cannot overwrite the durable authoritative terminal", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;
  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 3}, type: "DISPATCH_TRIGGER", requestId: "dispatch-terminal",
    sessionId: armRequest.sessionId, jobId: "job-terminal", envelope: "Path: x",
    ownershipGeneration: 5, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  const idlePromise = h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "job-terminal", ownershipGeneration: 5, assistantOutput: "formal verdict"});
  await waitFor(() => nativePort.messages.some((message) => message.type === "TURN_IDLE"));
  assert.equal(h.pendingTerminal().type, "TURN_IDLE");
  const fallbackPromise = h.runtime({kind: "LIFECYCLE", type: "TURN_TIMEOUT", jobId: "job-terminal", ownershipGeneration: 5});
  await waitFor(() => nativePort.messages.filter((message) => message.type === "TURN_IDLE").length === 2);
  assert.equal(h.pendingTerminal().type, "TURN_IDLE");
  assert.equal(nativePort.messages.some((message) => message.type === "TURN_TIMEOUT"), false);
  for (const request of nativePort.messages.filter((message) => message.type === "TURN_IDLE")) {
    h.respondTo(nativePort, request, "EVENT_ACK", {jobId: "job-terminal", phase: "TURN_IDLE"});
  }
  assert.equal((await idlePromise).ok, true);
  assert.equal((await fallbackPromise).ok, true);
  assert.equal(h.pendingTerminal(), null);
});

test("diagnostic queue is retained for a correlated ACK without persisted evidence", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;
  h.setDiagnosticResponse((message) => ({
    schemaVersion: {major: 1, minor: 3}, type: "DIAGNOSTIC_ACK", responseToRequestId: message.requestId,
    disposition: "appended",
  }));
  await nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 3}, type: "DISPATCH_TRIGGER", requestId: "dispatch-diag",
    sessionId: armRequest.sessionId, jobId: "job-diag", envelope: "Path: x",
    ownershipGeneration: 1, deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  await waitFor(() => h.diagnosticQueue().length > 0);
  assert.ok(h.diagnosticQueue().length > 0);
});
