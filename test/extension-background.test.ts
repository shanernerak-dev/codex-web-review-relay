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

function port() {
  return {messages: [] as any[], onMessage: event(), onDisconnect: event(), postMessage(message: any) { this.messages.push(message); }, disconnect() { void this.onDisconnect.emit(); }};
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
  let conversationIdentity = "https://chatgpt.com/c/conversation-a";
  const chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({version: "0.1.0"}),
      connectNative: () => { const created = port(); ports.push(created); return created; },
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
        if (message.kind === "GET_PAGE_STATE") return {ok: true, adapterReady: true, conversationIdentity};
        if (message.kind === "DISPATCH_TRIGGER" || message.kind === "RECONCILE_TRIGGER") return {ok: true};
        throw new Error("UNSUPPORTED_TEST_TAB_MESSAGE");
      },
      onRemoved: tabRemoved,
      onUpdated: tabUpdated,
    },
  };
  const context = vm.createContext({chrome, crypto: webcrypto, TextEncoder, Error, Promise, Math, Date, setTimeout, clearTimeout, setInterval, clearInterval});
  vm.runInContext(readFileSync(resolve("extension/background.js"), "utf8"), context, {filename: "background.js"});

  async function runtime(message: any): Promise<any> {
    const listener = runtimeMessages.listeners[0];
    return new Promise((resolveResponse, rejectResponse) => {
      let responded = false;
      const respond = (value: any) => { responded = true; resolveResponse(value); };
      try {
        const asynchronous = listener(message, {}, respond);
        if (asynchronous !== true && !responded) resolveResponse(undefined);
      } catch (error) { rejectResponse(error); }
    });
  }

  function respondTo(target: ReturnType<typeof port>, request: any, type: string, extra: Record<string, any> = {}) {
    void target.onMessage.emit({schemaVersion: {major: 1, minor: 0}, type, responseToRequestId: request.requestId, ...extra});
  }

  return {ports, runtime, tabUpdated, setConversation(value: string) { conversationIdentity = value; }, respondTo};
}

test("extension waits for lifecycle ACK, acknowledges dispatch receipt and recovers only the armed binding", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const firstPort = h.ports[0];
  const armRequest = firstPort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(firstPort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await armResult).ok, true);

  await firstPort.onMessage.emit({
    schemaVersion: {major: 1, minor: 0}, type: "DISPATCH_TRIGGER", requestId: "dispatch-1",
    sessionId: armRequest.sessionId, jobId: "job-1", envelope: "Path: x", deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  assert.ok(firstPort.messages.some((message) => message.type === "DISPATCH_TRIGGER_ACCEPTED" && message.responseToRequestId === "dispatch-1"));

  let lifecycleSettled = false;
  const lifecycle = h.runtime({kind: "LIFECYCLE", type: "TURN_IDLE", jobId: "job-1", assistantOutput: "formal verdict output"}).then((value) => { lifecycleSettled = true; return value; });
  await waitFor(() => firstPort.messages.some((message) => message.type === "TURN_IDLE"));
  assert.equal(lifecycleSettled, false);
  const idleRequest = firstPort.messages.find((message) => message.type === "TURN_IDLE");
  assert.equal(idleRequest.assistantOutput, "formal verdict output");
  h.respondTo(firstPort, idleRequest, "EVENT_ACK", {jobId: "job-1", phase: "TURN_IDLE"});
  assert.equal((await lifecycle).ok, true);
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

test("same-tab conversation navigation invalidates the armed binding", async () => {
  const h = harness();
  const armResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 1 && h.ports[0].messages.some((message) => message.type === "ARM_SESSION"));
  const nativePort = h.ports[0];
  const armRequest = nativePort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(nativePort, armRequest, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  await armResult;

  h.setConversation("https://chatgpt.com/c/conversation-b");
  await h.tabUpdated.emit(7, {status: "complete", url: "https://chatgpt.com/c/conversation-b"});
  await waitFor(async () => (await h.runtime({kind: "POPUP_STATUS"})).state.bindingValid === false);
  const status = await h.runtime({kind: "POPUP_STATUS"});
  assert.equal(status.state.lastError, "PAGE_NAVIGATED_REARM_REQUIRED");

  const rejectedDispatch = nativePort.onMessage.emit({
    schemaVersion: {major: 1, minor: 0}, type: "RECONCILE_TRIGGER", requestId: "reconcile-invalid",
    sessionId: armRequest.sessionId, jobId: "job-invalid", envelope: "Path: x", deadline: new Date(Date.now() + 10_000).toISOString(),
  });
  await waitFor(() => nativePort.messages.some((message) => message.type === "SEND_UNCERTAIN" && message.errorCode === "MANUAL_REARM_REQUIRED"));
  assert.equal(nativePort.messages.some((message) => message.type === "RECONCILE_TRIGGER_ACCEPTED" && message.responseToRequestId === "reconcile-invalid"), false);
  const uncertain = nativePort.messages.find((message) => message.type === "SEND_UNCERTAIN" && message.errorCode === "MANUAL_REARM_REQUIRED");
  h.respondTo(nativePort, uncertain, "EVENT_ACK", {jobId: "job-invalid", phase: "SEND_UNCERTAIN"});
  await rejectedDispatch;

  await nativePort.onDisconnect.emit();
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  assert.equal(h.ports.length, 1);

  const rearmResult = h.runtime({kind: "POPUP_ARM"});
  await waitFor(() => h.ports.length === 2 && h.ports[1].messages.some((message) => message.type === "ARM_SESSION"));
  const replacementPort = h.ports[1];
  const replacementArm = replacementPort.messages.find((message) => message.type === "ARM_SESSION");
  h.respondTo(replacementPort, replacementArm, "SESSION_ARMED", {leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()});
  assert.equal((await rearmResult).ok, true);

  const disarmResult = h.runtime({kind: "POPUP_DISARM"});
  await waitFor(() => replacementPort.messages.some((message) => message.type === "DISARM_SESSION"));
  const disarm = replacementPort.messages.find((message) => message.type === "DISARM_SESSION");
  h.respondTo(replacementPort, disarm, "SESSION_DISARMED");
  await disarmResult;
});
