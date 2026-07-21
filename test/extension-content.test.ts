import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("TEST_WAIT_TIMEOUT");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function harness(ackDelayMs = 0) {
  const events: string[] = [];
  let user = false;
  let assistant = false;
  let generating = false;
  const runtimeListeners: Array<(message: any, sender: any, respond: (value: any) => void) => boolean | void> = [];
  let observerCallback: (() => void) | null = null;
  class MutationObserver {
    constructor(callback: () => void) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const adapter = {
    pageSupported: () => true,
    dispatch: () => ({baseline: new Set()}),
    resumeDraft: () => ({baseline: new Set()}),
    reconcile: () => ({state: "missing", baseline: new Set()}),
    newTurn: (_document: unknown, _baseline: Set<unknown>, role: string) => role === "user" ? (user ? {} : null) : (assistant ? {} : null),
    isGenerating: () => generating,
    isIdle: () => !generating,
  };
  const chrome = {
    runtime: {
      async sendMessage(message: any) {
        events.push(message.type);
        if (ackDelayMs) await new Promise((resolveWait) => setTimeout(resolveWait, ackDelayMs));
        return {ok: true};
      },
      onMessage: {addListener(listener: any) { runtimeListeners.push(listener); }},
    },
  };
  const context = vm.createContext({
    chrome,
    MutationObserver,
    ReviewRelayDomAdapter: adapter,
    globalThis: null,
    document: {documentElement: {}},
    location: {origin: "https://chatgpt.com", pathname: "/c/conversation-a"},
    Date,
    Promise,
    Error,
    Set,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  context.globalThis = context;
  vm.runInContext(readFileSync(resolve("extension/content.js"), "utf8"), context, {filename: "content.js"});

  function dispatch(deadlineMs = 2_000) {
    const response = new Promise<any>((resolveResponse) => {
      runtimeListeners[0]({
        kind: "DISPATCH_TRIGGER",
        jobId: "job-1",
        envelope: "Path: x",
        deadline: new Date(Date.now() + deadlineMs).toISOString(),
      }, {}, resolveResponse);
    });
    return response;
  }

  return {
    events,
    dispatch,
    mutate() { observerCallback?.(); },
    setUser(value: boolean) { user = value; },
    setAssistant(value: boolean) { assistant = value; },
    setGenerating(value: boolean) { generating = value; },
  };
}

test("content monitor serializes reentrant mutations and waits for streaming-to-quiet idle", async () => {
  const h = harness(25);
  assert.equal((await h.dispatch()).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.mutate(); h.mutate(); h.mutate();
  await waitFor(() => h.events.includes("ASSISTANT_STARTED"));
  h.setGenerating(true);
  h.mutate();
  await new Promise((resolveWait) => setTimeout(resolveWait, 850));
  assert.equal(h.events.includes("TURN_IDLE"), false);

  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("TURN_IDLE"), 1_500);
  assert.equal(h.events.filter((entry) => entry === "USER_TURN_ACKED").length, 1);
  assert.equal(h.events.filter((entry) => entry === "ASSISTANT_STARTED").length, 1);
  assert.equal(h.events.filter((entry) => entry === "TURN_IDLE").length, 1);
});

test("content monitor reports a bounded timeout after the exact user turn", async () => {
  const h = harness();
  assert.equal((await h.dispatch(100)).ok, true);
  h.setUser(true);
  h.mutate();
  await waitFor(() => h.events.includes("USER_TURN_ACKED"));
  await waitFor(() => h.events.includes("TURN_TIMEOUT"), 1_000);
  assert.equal(h.events.includes("TURN_IDLE"), false);
});
