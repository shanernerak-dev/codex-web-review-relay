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
  const lifecycleMessages: any[] = [];
  const calls = {dispatch: 0, resumeDraft: 0};
  let user = false;
  let assistant = false;
  let assistantOutputs = ["final review output"];
  let assistantComplete = false;
  let codeCopy = false;
  let generating = false;
  let turnIdleAckFailures = 0;
  const runtimeListeners: Array<(message: any, sender: any, respond: (value: any) => void) => boolean | void> = [];
  let observerCallback: (() => void) | null = null;
  class MutationObserver {
    constructor(callback: () => void) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const adapter = {
    pageSupported: () => true,
    dispatch: () => { calls.dispatch += 1; return {baseline: new Set()}; },
    resumeDraft: () => { calls.resumeDraft += 1; return {baseline: new Set()}; },
    reconcile: () => user
      ? {state: "user-present", user: {}, assistant: assistant ? {innerText: assistantOutputs.at(-1)} : null, assistants: assistant ? assistantOutputs.map((innerText) => ({innerText})) : [], baseline: new Set()}
      : {state: "missing", baseline: new Set()},
    newTurn: (_document: unknown, _baseline: Set<unknown>, role: string) => role === "user" ? (user ? {} : null) : (assistant ? {innerText: assistantOutputs.at(-1)} : null),
    assistantTurnsAfter: () => assistant ? assistantOutputs.map((innerText) => ({innerText})) : [],
    rawText: (node: any) => node?.innerText ?? "",
    rawTurnText: (_document: unknown, _node: any) => assistantOutputs.join("\n\n"),
    isAssistantComplete: () => assistantComplete && !codeCopy,
    isGenerating: () => generating,
    isResponseIdle: () => !generating,
    isIdle: () => { throw new Error("COMPOSER_NOT_REQUIRED_FOR_RESPONSE_IDLE"); },
  };
  const chrome = {
    runtime: {
      async sendMessage(message: any) {
        events.push(message.type);
        lifecycleMessages.push(message);
        if (ackDelayMs) await new Promise((resolveWait) => setTimeout(resolveWait, ackDelayMs));
        if (message.type === "TURN_IDLE" && turnIdleAckFailures > 0) { turnIdleAckFailures -= 1; return {ok: false, errorCode: "NATIVE_NOT_READY"}; }
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

  function dispatch(deadlineMs = 10_000, reviewMode = "pr-comment") {
    const response = new Promise<any>((resolveResponse) => {
      runtimeListeners[0]({
        kind: "DISPATCH_TRIGGER",
        jobId: "job-1",
        envelope: "Path: x",
        reviewMode,
        deadline: new Date(Date.now() + deadlineMs).toISOString(),
      }, {}, resolveResponse);
    });
    return response;
  }

  function reconcile(deadlineMs = 2_000) {
    return new Promise<any>((resolveResponse) => {
      runtimeListeners[0]({kind: "RECONCILE_TRIGGER", jobId: "job-1", envelope: "Path: x", reviewMode: "relay-only", allowUnsentSend: true, deadline: new Date(Date.now() + deadlineMs).toISOString()}, {}, resolveResponse);
    });
  }

  return {
    events,
    lifecycleMessages,
    calls,
    dispatch,
    reconcile,
    mutate() { observerCallback?.(); },
    setUser(value: boolean) { user = value; },
    setAssistant(value: boolean) { assistant = value; },
    setAssistantOutput(value: string) { assistantOutputs = [value]; },
    setAssistantOutputs(values: string[]) { assistantOutputs = [...values]; },
    setAssistantComplete(value: boolean) { assistantComplete = value; },
    setAssistantCodeCopy(value: boolean) { codeCopy = value; },
    setGenerating(value: boolean) { generating = value; },
    failNextTurnIdleAcks(value: number) { turnIdleAckFailures = value; },
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
  await waitFor(() => h.events.includes("TURN_IDLE"), 5_500);
  assert.equal(h.events.filter((entry) => entry === "USER_TURN_ACKED").length, 1);
  assert.equal(h.events.filter((entry) => entry === "ASSISTANT_STARTED").length, 1);
  assert.equal(h.events.filter((entry) => entry === "TURN_IDLE").length, 1);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "final review output");
});

test("content monitor waits for the complete stable output after a partial bubble", async () => {
  const h = harness();
  assert.equal((await h.dispatch()).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setGenerating(true);
  h.mutate();
  await waitFor(() => h.events.includes("ASSISTANT_STARTED"));
  h.setAssistantOutput("Stage");
  h.setGenerating(false);
  h.mutate();
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  assert.equal(h.events.includes("TURN_IDLE"), false);
  h.setAssistantOutput("Stage C Runtime Follow-up Round complete");
  h.setAssistantComplete(true);
  h.mutate();
  await waitFor(() => h.events.includes("TURN_IDLE"), 5_500);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "Stage C Runtime Follow-up Round complete");
});

test("relay-only monitor waits for a long response without requiring composer idle identity", async () => {
  const h = harness();
  assert.equal((await h.dispatch(10_000, "relay-only")).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setGenerating(true);
  h.mutate();
  await waitFor(() => h.events.includes("ASSISTANT_STARTED"));
  h.setAssistantOutput("A long formal verdict that is returned directly through assistant_output");
  h.setAssistantComplete(true);
  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("TURN_IDLE"), 7_000);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "A long formal verdict that is returned directly through assistant_output");
});

test("relay-only monitor does not terminalize a stable bubble before generation is observed", async () => {
  const h = harness();
  assert.equal((await h.dispatch(3_500, "relay-only")).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantOutput("partial formal verdict");
  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("ASSISTANT_STARTED"));
  await new Promise((resolveWait) => setTimeout(resolveWait, 3_000));
  assert.equal(h.events.includes("TURN_IDLE"), false);
  await waitFor(() => h.events.includes("TURN_TIMEOUT"), 1_000);
});

test("relay-only monitor can resume after a long stable partial bubble", async () => {
  const h = harness();
  assert.equal((await h.dispatch(9_000, "relay-only")).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantOutput("partial formal verdict");
  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("ASSISTANT_STARTED"));
  await new Promise((resolveWait) => setTimeout(resolveWait, 2_800));
  assert.equal(h.events.includes("TURN_IDLE"), false);
  h.setGenerating(true);
  h.mutate();
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  h.setAssistantOutput("complete formal verdict after a delayed generation phase");
  h.setAssistantComplete(true);
  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("TURN_IDLE"), 7_000);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "complete formal verdict after a delayed generation phase");
});

test("relay-only reconcile completes an already-complete assistant reply", async () => {
  const h = harness();
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantComplete(true);
  h.setAssistantOutput("complete reply recovered after reconnect");
  assert.equal((await h.reconcile(9_000)).ok, true);
  await waitFor(() => h.events.includes("TURN_IDLE"), 7_000);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "complete reply recovered after reconnect");
});

test("relay-only reconcile preserves every ordered assistant turn", async () => {
  const h = harness();
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantComplete(true);
  h.setAssistantOutputs(["analysis segment", "formal verdict segment"]);
  assert.equal((await h.reconcile(9_000)).ok, true);
  await waitFor(() => h.events.includes("TURN_IDLE"), 7_000);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "analysis segment\n\nformal verdict segment");
});

test("relay-only reconcile does not complete a partial assistant bubble without completion evidence", async () => {
  const h = harness();
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantComplete(false);
  h.setAssistantOutput("partial reply recovered after reconnect");
  assert.equal((await h.reconcile(1_200)).ok, true);
  await waitFor(() => h.events.includes("TURN_TIMEOUT"), 2_500);
  assert.equal(h.events.includes("TURN_IDLE"), false);
});

test("relay-only reconcile ignores a code-copy marker until turn completion evidence appears", async () => {
  const h = harness();
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantOutput("partial reply containing a code block");
  h.setAssistantComplete(true);
  h.setAssistantCodeCopy(true);
  assert.equal((await h.reconcile(1_200)).ok, true);
  await waitFor(() => h.events.includes("TURN_TIMEOUT"), 2_500);
  assert.equal(h.events.includes("TURN_IDLE"), false);
});

test("relay-only direct fast completion does not require an observed generating phase", async () => {
  const h = harness();
  assert.equal((await h.dispatch(9_000, "relay-only")).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantOutput("fast complete formal verdict");
  h.setAssistantComplete(true);
  h.setGenerating(false);
  h.mutate();
  await waitFor(() => h.events.includes("TURN_IDLE"), 7_000);
  assert.equal(h.lifecycleMessages.find((entry) => entry.type === "TURN_IDLE")?.assistantOutput, "fast complete formal verdict");
});

test("content monitor retries TURN_IDLE after a rejected native ACK", async () => {
  const h = harness();
  assert.equal((await h.dispatch(9_000, "relay-only")).ok, true);
  h.setUser(true);
  h.setAssistant(true);
  h.setAssistantOutput("formal verdict after retry");
  h.setAssistantComplete(true);
  h.failNextTurnIdleAcks(1);
  h.mutate();
  await waitFor(() => h.lifecycleMessages.filter((entry) => entry.type === "TURN_IDLE").length >= 2, 7_000);
  assert.equal(h.lifecycleMessages.filter((entry) => entry.type === "TURN_IDLE").at(-1)?.assistantOutput, "formal verdict after retry");
});

test("expired dispatch and recovery fail before any DOM write or click", async () => {
  const dispatchHarness = harness();
  const dispatchResult = await dispatchHarness.dispatch(-1);
  assert.equal(dispatchResult.ok, false);
  assert.equal(dispatchResult.errorCode, "MESSAGE_DEADLINE_EXPIRED");
  assert.equal(dispatchHarness.calls.dispatch, 0);

  const recoveryHarness = harness();
  const recoveryResult = await recoveryHarness.reconcile(-1);
  assert.equal(recoveryResult.ok, false);
  assert.equal(recoveryResult.errorCode, "MESSAGE_DEADLINE_EXPIRED");
  assert.equal(recoveryHarness.calls.resumeDraft, 0);
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
