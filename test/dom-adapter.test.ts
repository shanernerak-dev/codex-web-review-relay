import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

type NodeLike = {
  value?: string;
  innerText?: string;
  textContent?: string;
  disabled?: boolean;
  clicked?: number;
  role?: string;
  getAttribute(name: string): string | null;
  focus(): void;
  dispatchEvent(): void;
  click(): void;
  querySelector?(selector: string): NodeLike | null;
  getClientRects?(): ArrayLike<unknown>;
  closest?(selector: string): NodeLike | null;
};

function node(input: Partial<NodeLike> = {}): NodeLike {
  return {
    getAttribute(name) { return name === "data-message-author-role" ? (this.role ?? null) : null; },
    focus() {}, dispatchEvent() {}, click() { this.clicked = (this.clicked ?? 0) + 1; },
    ...input,
  };
}

function fakeDocument(map: Map<string, NodeLike[]>) {
  for (const button of map.get("[data-testid='send-button']") ?? []) {
    if ((button as NodeLike & {receiptWrapped?: boolean}).receiptWrapped) continue;
    const original = button.click.bind(button);
    button.click = () => {
      const composer = [...(map.get("#prompt-textarea") ?? []), ...(map.get("[contenteditable='true'][data-lexical-editor='true']") ?? [])]
        .find((candidate) => Boolean(candidate.value ?? candidate.innerText ?? candidate.textContent))
        ?? (map.get("#prompt-textarea") ?? map.get("[contenteditable='true'][data-lexical-editor='true']") ?? [])[0];
      const text = composer?.value ?? composer?.innerText ?? composer?.textContent ?? "";
      original();
      if (text) {
        let turnNodes = map.get("[data-message-author-role]");
        if (!turnNodes) { turnNodes = []; map.set("[data-message-author-role]", turnNodes); }
        turnNodes.push(node({role: "user", innerText: text}));
      }
    };
    (button as NodeLike & {receiptWrapped?: boolean}).receiptWrapped = true;
  }
  return {
    querySelectorAll(selector: string) { return map.get(selector) ?? []; },
    execCommand() { return false; },
  };
}

await import("../extension/dom-adapter.js");
const adapter = (globalThis as unknown as {ReviewRelayDomAdapter: Record<string, (...args: any[]) => any>}).ReviewRelayDomAdapter;

test("manifest public key freezes the expected unpacked extension ID", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
  const observed = Array.from(digest).map((value) => String.fromCharCode(97 + (value >> 4), 97 + (value & 15))).join("");
  assert.equal(observed, "kkdijpckhlminpolkllmmkldlljakfem");
});

test("DOM adapter canonicalizes Lexical block whitespace without changing field text", () => {
  const lexical = node({innerText: " Path: x\n\nfull Ref:\u00a0refs/heads/topic \r\n\nReviewed head: abc "});
  assert.equal(adapter.normalizedText(lexical), "Path: x\nfull Ref: refs/heads/topic\nReviewed head: abc");
});

test("DOM adapter requires exact page, composer and send identities", async () => {
  assert.equal(adapter.pageSupported({origin: "https://chatgpt.com", pathname: "/c/abc-123"}), true);
  assert.equal(adapter.pageSupported({origin: "https://chatgpt.com", pathname: "/g/project/c/abc-123"}), true);
  assert.throws(() => adapter.pageSupported({origin: "https://example.com", pathname: "/c/abc"}), /PAGE_IDENTITY_UNSUPPORTED/);
  const input = node({value: ""});
  const button = node({click() { this.clicked = (this.clicked ?? 0) + 1; input.value = ""; }});
  const map = new Map<string, NodeLike[]>([["#prompt-textarea", [input]], ["[contenteditable='true'][data-lexical-editor='true']", []], ["[data-testid='send-button']", [button]], ["[data-message-author-role]", []]]);
  const document = fakeDocument(map);
  const state = await adapter.dispatch(document, "Path: example");
  assert.equal(input.value, "");
  assert.equal(button.clicked, 1);
  assert.equal(state.baseline.size, 0);
  map.set("[data-testid='send-button']", [button, node()]);
  assert.throws(() => adapter.sendButton(document), /SEND_BUTTON_IDENTITY_MISMATCH/);
});

test("DOM adapter fills the composer before waiting for the send button", async () => {
  const button = node({disabled: true, click() { this.clicked = (this.clicked ?? 0) + 1; input.value = ""; }});
  const input = node({value: "", dispatchEvent() { button.disabled = false; }});
  const map = new Map<string, NodeLike[]>([
    ["#prompt-textarea", [input]],
    ["[contenteditable='true'][data-lexical-editor='true']", []],
    ["[data-testid='send-button']", [button]],
    ["[data-message-author-role]", []],
  ]);
  await adapter.dispatch(fakeDocument(map), "envelope");
  assert.equal(button.clicked, 1);
  assert.equal(input.value, "");
});

test("DOM adapter scopes Lexical selection to the composer before insertText", async () => {
  const calls: string[] = [];
  const input = node({textContent: "", focus() { calls.push("focus"); }});
  const button = node({disabled: true, click() { this.clicked = (this.clicked ?? 0) + 1; input.textContent = ""; }});
  const map = new Map<string, NodeLike[]>([
    ["#prompt-textarea", []],
    ["[contenteditable='true'][data-lexical-editor='true']", [input]],
    ["[data-testid='send-button']", [button]],
    ["[data-message-author-role]", []],
  ]);
  const document = {
    ...fakeDocument(map),
    defaultView: {getSelection: () => ({removeAllRanges() { calls.push("clear"); }, addRange() { calls.push("add"); }})},
    createRange: () => ({selectNodeContents(target: NodeLike) { assert.equal(target, input); calls.push("scope"); }}),
    execCommand(command: string, _ui: boolean, value?: string) {
      assert.equal(command, "insertText"); input.textContent = value; button.disabled = false; calls.push("insert"); return true;
    },
  };
  await adapter.dispatch(document, "envelope");
  assert.deepEqual(calls.slice(0, 5), ["focus", "scope", "clear", "add", "insert"]);
  assert.equal(button.clicked, 1);
});

test("DOM adapter reads back the current composer after Lexical replaces the node", async () => {
  const staleInput = node({textContent: ""});
  const currentInput = node({textContent: "envelope"});
  const button = node({disabled: true, click() { this.clicked = (this.clicked ?? 0) + 1; currentInput.textContent = ""; }});
  const map = new Map<string, NodeLike[]>([
    ["#prompt-textarea", []],
    ["[contenteditable='true'][data-lexical-editor='true']", [staleInput]],
    ["[data-testid='send-button']", [button]],
    ["[data-message-author-role]", []],
  ]);
  const document = {
    ...fakeDocument(map),
    execCommand(command: string) {
      assert.equal(command, "insertText");
      map.set("[contenteditable='true'][data-lexical-editor='true']", [currentInput]);
      button.disabled = false;
      return true;
    },
  };
  await adapter.dispatch(document, "envelope");
  assert.equal(staleInput.textContent, "");
  assert.equal(button.clicked, 1);
});

test("DOM adapter matches only new exact user turn then assistant idle", () => {
  const stable = (role: string, id: string, text: string) => node({
    role,
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-id") return id;
      if (name === "data-message-author-role") return role;
      return null;
    },
    closest(selector) { return selector === "[data-message-id]" ? this : null; },
  });
  const oldUser = stable("user", "old-user", "old");
  const newUser = stable("user", "new-user", "envelope");
  const assistant = stable("assistant", "assistant", "working");
  const send = node();
  const input = node({value: ""});
  const map = new Map<string, NodeLike[]>([["#prompt-textarea", [input]], ["[contenteditable='true'][data-lexical-editor='true']", []], ["[data-message-author-role]", [oldUser]], ["[data-testid='send-button']", [send]], ["[data-testid='stop-button']", []]]);
  const document = fakeDocument(map);
  const baseline = adapter.snapshotTurns(document);
  map.set("[data-message-author-role]", [oldUser, newUser, assistant]);
  assert.equal(adapter.newTurn(document, baseline, "user", "envelope"), newUser);
  assert.equal(adapter.newTurn(document, baseline, "assistant"), assistant);
  assert.equal(adapter.isIdle(document), true);
  map.set("[data-testid='stop-button']", [node()]);
  assert.equal(adapter.isGenerating(document), true);
  assert.equal(adapter.isIdle(document), false);
});

test("DOM adapter keeps the last assistant message when one stable turn has multiple bubbles", () => {
  const turn = node({
    getAttribute(name) { return name === "data-turn-id" ? "turn-a" : null; },
  });
  const inTurn = (text: string) => node({
    role: "assistant",
    innerText: text,
    closest(selector) { return selector === "[data-turn-id]" ? turn : null; },
  });
  const firstBubble = inTurn("reasoning summary");
  const finalBubble = inTurn("final review output");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [firstBubble, finalBubble]]]);
  const document = fakeDocument(map);
  assert.equal(adapter.newTurn(document, new Set(), "assistant"), finalBubble);
  assert.equal(adapter.rawTurnText(document, finalBubble), "reasoning summary\n\nfinal review output");
});

test("DOM adapter matches one user turn split across multiple DOM bubbles", () => {
  const turn = node({getAttribute(name) { return name === "data-turn-id" ? "user-turn" : null; }});
  const fragment = (text: string) => node({
    role: "user", innerText: text,
    closest(selector) { return selector === "[data-turn-id]" ? turn : null; },
  });
  const first = fragment("Path: x");
  const second = fragment("full Ref: refs/heads/topic");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [first, second]]]);
  const document = fakeDocument(map);
  assert.equal(adapter.newTurn(document, new Set(), "user", "Path: x\nfull Ref: refs/heads/topic"), second);
  assert.deepEqual(adapter.turnObservation(document, new Set(), "Path: x\nfull Ref: refs/heads/topic"), {
    candidate_count: 2, count: 1, exact_match_count: 1, baseline_count: 0,
  });
});

test("DOM adapter treats data-message-id as the stable turn identity across node replacement", () => {
  const turnNode = (text: string) => node({
    role: "assistant",
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-id") return "message-a";
      if (name === "data-message-author-role") return "assistant";
      return null;
    },
    closest(selector) { return selector === "[data-message-id]" ? this : null; },
  });
  const first = turnNode("partial");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [first]]]);
  const baseline = adapter.snapshotTurns(fakeDocument(map));
  const replacement = turnNode("complete");
  map.set("[data-message-author-role]", [replacement]);
  assert.equal(adapter.newTurn(fakeDocument(map), baseline, "assistant"), null);
  assert.equal(adapter.rawTurnText(fakeDocument(map), replacement), "complete");
});

test("DOM adapter preserves the order of multiple new assistant turns", () => {
  const turnNode = (id: string, text: string) => node({
    role: "assistant",
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-id") return id;
      if (name === "data-message-author-role") return "assistant";
      return null;
    },
    closest(selector) { return selector === "[data-message-id]" ? this : null; },
  });
  const first = turnNode("message-a", "first assistant turn");
  const second = turnNode("message-b", "second assistant turn");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [first, second]]]);
  const document = fakeDocument(map);
  const captured = adapter.newTurns(document, new Set(), "assistant");
  assert.deepEqual(captured, [first, second]);
  assert.equal(adapter.rawTurnText(document, captured), "first assistant turn\n\nsecond assistant turn");
});

test("DOM adapter rejects assistant candidates from distinct stable turns", () => {
  const inTurn = (turnId: string) => {
    const turn = node({getAttribute(name) { return name === "data-turn-id" ? turnId : null; }});
    return node({role: "assistant", innerText: turnId, closest(selector) { return selector === "[data-turn-id]" ? turn : null; }});
  };
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [inTurn("turn-a"), inTurn("turn-b")]]]);
  assert.throws(() => adapter.newTurn(fakeDocument(map), new Set(), "assistant"), /TURN_IDENTITY_AMBIGUOUS/);
});

test("DOM adapter groups generic conversation-turn bubbles only by container identity", () => {
  const genericTurn = () => node({getAttribute(name) { return name === "data-testid" ? "conversation-turn" : null; }});
  const inGenericTurn = (turn: NodeLike, text: string) => node({
    role: "assistant",
    innerText: text,
    closest(selector) { return selector === "[data-testid='conversation-turn']" ? turn : null; },
  });
  const sameTurn = genericTurn();
  const first = inGenericTurn(sameTurn, "reasoning");
  const final = inGenericTurn(sameTurn, "final");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [first, final]]]);
  assert.equal(adapter.newTurn(fakeDocument(map), new Set(), "assistant"), final);
  map.set("[data-message-author-role]", [first, inGenericTurn(genericTurn(), "other turn")]);
  assert.throws(() => adapter.newTurn(fakeDocument(map), new Set(), "assistant"), /TURN_IDENTITY_AMBIGUOUS/);
});

test("DOM adapter recognizes completed turns when the empty composer has no send button", () => {
  const input = node({value: ""});
  const map = new Map<string, NodeLike[]>([
    ["#prompt-textarea", [input]],
    ["[contenteditable='true'][data-lexical-editor='true']", []],
    ["[data-testid='send-button']", []],
    ["[data-testid='stop-button']", []],
  ]);
  const document = fakeDocument(map);
  assert.equal(adapter.isIdle(document), true);
  map.set("[data-testid='stop-button']", [node()]);
  assert.equal(adapter.isIdle(document), false);
});

test("DOM adapter uses a copy action inside the assistant turn as completion evidence", () => {
  const copy = node();
  const turn = node({
    querySelector(selector) {
      return selector.includes("button[aria-label='Copy']") ? copy : null;
    },
  });
  const assistant = node({closest(selector) { return selector === "[data-testid='conversation-turn']" ? turn : null; }});
  const document = fakeDocument(new Map());
  assert.equal(adapter.isAssistantComplete(document, assistant), true);
  const incomplete = node({closest(selector) { return selector === "[data-testid='conversation-turn']" ? node() : null; }});
  assert.equal(adapter.isAssistantComplete(document, incomplete), false);
});

test("DOM adapter ignores code-block copy controls as turn completion evidence", () => {
  const codeCopy = node({closest() { return node(); }});
  const turn = node({
    querySelector(selector) {
      return selector.includes("button[aria-label='Copy']") ? codeCopy : null;
    },
  });
  const assistant = node({closest(selector) { return selector === "[data-testid='conversation-turn']" ? turn : null; }});
  assert.equal(adapter.isAssistantComplete(fakeDocument(new Map()), assistant), false);
});

test("DOM adapter reconciles existing user turn or one exact unsent draft", async () => {
  const input = node({value: "envelope"});
  const send = node({click() { this.clicked = (this.clicked ?? 0) + 1; input.value = ""; }});
  const user = node({role: "user", innerText: "envelope"});
  const assistant = node({role: "assistant", innerText: "done"});
  const map = new Map<string, NodeLike[]>([["#prompt-textarea", [input]], ["[contenteditable='true'][data-lexical-editor='true']", []], ["[data-testid='send-button']", [send]], ["[data-message-author-role]", [user, assistant]]]);
  const document = fakeDocument(map);
  const present = adapter.reconcile(document, "envelope");
  assert.equal(present.state, "user-present");
  assert.equal(present.assistant, assistant);
  map.set("[data-message-author-role]", []);
  assert.equal(adapter.reconcile(document, "envelope").state, "draft-unsent");
  await adapter.resumeDraft(document, "envelope");
  assert.equal(send.clicked, 1);
  input.value = "different";
  assert.equal(adapter.reconcile(document, "envelope").state, "user-present");
});

test("DOM adapter reconciles every ordered assistant turn before the next user", () => {
  const stable = (role: string, id: string, text: string) => node({
    role,
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-id") return id;
      if (name === "data-message-author-role") return role;
      return null;
    },
    closest(selector) { return selector === "[data-message-id]" ? this : null; },
  });
  const user = stable("user", "user-target", "envelope");
  const first = stable("assistant", "assistant-a", "analysis");
  const second = stable("assistant", "assistant-b", "formal verdict");
  const nextUser = stable("user", "user-next", "unrelated follow-up");
  const contamination = stable("assistant", "assistant-c", "must not be captured");
  const map = new Map<string, NodeLike[]>([
    ["[data-message-author-role]", [user, first, second, nextUser, contamination]],
    ["#prompt-textarea", [node({value: ""})]],
    ["[contenteditable='true'][data-lexical-editor='true']", []],
  ]);
  const document = fakeDocument(map);
  const observed = adapter.reconcile(document, "envelope");
  assert.deepEqual(observed.assistants, [first, second]);
  assert.equal(observed.assistant, second);
  assert.equal(adapter.rawTurnText(document, observed.assistants), "analysis\n\nformal verdict");
  assert.equal(observed.baseline.turnIdentities.has("message-id:assistant-a"), true);
});

test("DOM adapter keeps a stable reconcile anchor across DOM replacement", () => {
  const stable = (role: string, id: string, text: string) => node({
    role,
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-id") return id;
      if (name === "data-message-author-role") return role;
      return null;
    },
    closest(selector) { return selector === "[data-message-id]" ? this : null; },
  });
  const user = stable("user", "user-target", "envelope");
  const partial = stable("assistant", "assistant-target", "partial");
  const map = new Map<string, NodeLike[]>([
    ["[data-message-author-role]", [user, partial]],
    ["#prompt-textarea", [node({value: ""})]],
    ["[contenteditable='true'][data-lexical-editor='true']", []],
  ]);
  const document = fakeDocument(map);
  const observed = adapter.reconcile(document, "envelope");
  const rerenderedUser = stable("user", "user-target", "envelope");
  const complete = stable("assistant", "assistant-target", "complete");
  map.set("[data-message-author-role]", [rerenderedUser, complete]);
  assert.deepEqual(adapter.newTurns(document, observed.baseline, "assistant"), []);
  assert.deepEqual(adapter.assistantTurnsAfter(document, observed.user), [complete]);
  assert.equal(adapter.rawTurnText(document, observed.assistants), "complete");
});

test("DOM adapter fails closed when an unstable generic turn is replaced", () => {
  const genericTurn = () => node({getAttribute(name) { return name === "data-testid" ? "conversation-turn" : null; }});
  const bubble = (turn: NodeLike, text: string) => node({
    role: "assistant",
    innerText: text,
    closest(selector) { return selector === "[data-testid='conversation-turn']" ? turn : null; },
  });
  const first = bubble(genericTurn(), "old assistant");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [first]]]);
  const baseline = adapter.snapshotTurns(fakeDocument(map));
  map.set("[data-message-author-role]", [bubble(genericTurn(), "rerendered assistant")]);
  assert.throws(() => adapter.newTurns(fakeDocument(map), baseline, "assistant"), /TURN_IDENTITY_UNSTABLE/);
  assert.throws(() => adapter.newTurn(fakeDocument(map), baseline, "assistant"), /TURN_IDENTITY_UNSTABLE/);
});

test("DOM adapter accepts a new unstable turn when every unstable baseline node is retained", () => {
  const genericTurn = () => node({getAttribute(name) { return name === "data-testid" ? "conversation-turn" : null; }});
  const bubble = (turn: NodeLike, role: string, text: string) => node({
    role, innerText: text,
    closest(selector) { return selector === "[data-testid='conversation-turn']" ? turn : null; },
  });
  const old = bubble(genericTurn(), "assistant", "old");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [old]]]);
  const document = fakeDocument(map);
  const baseline = adapter.snapshotTurns(document);
  const appended = bubble(genericTurn(), "assistant", "new");
  map.set("[data-message-author-role]", [old, appended]);
  assert.deepEqual(adapter.newTurns(document, baseline, "assistant"), [appended]);
});

test("DOM adapter does not merge turns through an arbitrary shared ancestor id", () => {
  const shared = node({getAttribute(name) { return name === "id" ? "conversation-root" : null; }});
  const bubble = (text: string) => node({
    role: "assistant",
    innerText: text,
    closest(selector) { return selector === "[id]" ? shared : null; },
  });
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [bubble("first"), bubble("second")]]]);
  assert.throws(() => adapter.newTurn(fakeDocument(map), new Set(), "assistant"), /TURN_IDENTITY_AMBIGUOUS/);
});

test("DOM adapter ignores hidden duplicate controls but rejects two visible controls", async () => {
  const visibleInput = node({value: "", getClientRects: () => [{}]});
  const hiddenInput = node({value: "", getClientRects: () => []});
  const visibleSend = node({getClientRects: () => [{}], click() { this.clicked = (this.clicked ?? 0) + 1; visibleInput.value = ""; }});
  const hiddenSend = node({getClientRects: () => []});
  const map = new Map<string, NodeLike[]>([
    ["#prompt-textarea", [visibleInput, hiddenInput]],
    ["[contenteditable='true'][data-lexical-editor='true']", []],
    ["[data-testid='send-button']", [visibleSend, hiddenSend]],
    ["[data-message-author-role]", []],
  ]);
  const document = fakeDocument(map);
  await adapter.dispatch(document, "envelope");
  assert.equal(visibleInput.value, "");
  map.set("#prompt-textarea", [visibleInput, node({value: "", getClientRects: () => [{}]})]);
  assert.throws(() => adapter.composer(document), /COMPOSER_IDENTITY_MISMATCH/);
});

test("turn tracker reconstructs one user turn from ordered message fragments", () => {
  const turnContainer = node({
    getAttribute(name) { return name === "data-turn-id" ? "user-turn-target" : null; },
  });
  const fragment = (messageId: string, text: string) => node({
    role: "user",
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return "user";
      if (name === "data-message-id") return messageId;
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? turnContainer : null; },
  });
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", []]]);
  const document = fakeDocument(map);
  const tracker = adapter.createTurnTracker(document);
  map.set("[data-message-author-role]", [
    fragment("user-fragment-a", "Path: example"),
    fragment("user-fragment-b", "Reviewed head: abc"),
  ]);
  const record = adapter.findTrackedUserTurn(document, tracker, "Path: example\nReviewed head: abc");
  assert.equal(record.identity, "turn-id:user-turn-target");
  assert.equal(adapter.turnRecordText(record), "Path: example\nReviewed head: abc");
});

test("turn tracker reads user content instead of role-node action labels", () => {
  const turnContainer = node({getAttribute(name) { return name === "data-turn-id" ? "user-turn-content" : null; }});
  const content = node({innerText: "Path: example\nReviewed head: abc"});
  const roleNode = node({
    role: "user",
    innerText: "Path: example\nReviewed head: abc\nEdit message",
    getAttribute(name) {
      if (name === "data-message-author-role") return "user";
      if (name === "data-message-id") return "user-message-content";
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? turnContainer : null; },
    querySelector(selector) { return selector === ".whitespace-pre-wrap" ? content : null; },
  });
  const document = fakeDocument(new Map([["[data-message-author-role]", [roleNode]]]));
  const tracker = adapter.createTurnTracker(document, false);
  const record = adapter.findTrackedUserTurn(document, tracker, "Path: example\nReviewed head: abc", true);
  assert.equal(record.identity, "turn-id:user-turn-content");
});

test("turn tracker harvests hydrated fragments across passes and preserves document order", () => {
  const userTurn = node({getAttribute(name) { return name === "data-turn-id" ? "user-turn" : null; }});
  const assistantTurn = node({getAttribute(name) { return name === "data-turn-id" ? "assistant-turn" : null; }});
  const fragment = (turn: NodeLike, role: string, messageId: string, text: string) => node({
    role,
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return role;
      if (name === "data-message-id") return messageId;
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? turn : null; },
  });
  const user = fragment(userTurn, "user", "user-message", "envelope");
  const first = fragment(assistantTurn, "assistant", "assistant-a", "analysis");
  const second = fragment(assistantTurn, "assistant", "assistant-b", "formal verdict");
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [user]]]);
  const document = fakeDocument(map);
  const tracker = adapter.createTurnTracker(document, false);
  const target = adapter.findTrackedUserTurn(document, tracker, "envelope", true);
  map.set("[data-message-author-role]", [user, first]);
  assert.deepEqual(adapter.trackedAssistantTurnsAfter(document, tracker, target).map((record: any) => adapter.turnRecordText(record, true)), ["analysis"]);
  map.set("[data-message-author-role]", [user, second]);
  const assistants = adapter.trackedAssistantTurnsAfter(document, tracker, target);
  assert.equal(assistants.length, 1);
  assert.equal(adapter.turnRecordText(assistants[0], true), "analysis\n\nformal verdict");
});

test("turn tracker updates a stable message after DOM replacement instead of duplicating it", () => {
  const turnContainer = node({getAttribute(name) { return name === "data-turn-id" ? "assistant-turn" : null; }});
  const assistant = (text: string) => node({
    role: "assistant",
    innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return "assistant";
      if (name === "data-message-id") return "assistant-message";
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? turnContainer : null; },
  });
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [assistant("partial")]]]);
  const document = fakeDocument(map);
  const tracker = adapter.createTurnTracker(document, false);
  const record = tracker.records.get("turn-id:assistant-turn");
  assert.equal(adapter.turnRecordText(record, true), "partial");
  map.set("[data-message-author-role]", [assistant("complete formal verdict")]);
  adapter.harvestTurnTracker(document, tracker);
  assert.equal(adapter.turnRecordText(record, true), "complete formal verdict");
  assert.equal(record.fragments.size, 1);
});

test("turn tracker groups fragments by one generic conversation-turn container", () => {
  const container = node({
    getAttribute(name) { return name === "data-testid" ? "conversation-turn" : null; },
    closest(selector) { return selector === "[data-testid='conversation-turn']" ? this : null; },
  });
  const fragment = (messageId: string, text: string) => node({
    role: "assistant", innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return "assistant";
      if (name === "data-message-id") return messageId;
      return null;
    },
    closest(selector) { return selector === "[data-testid='conversation-turn']" ? container : null; },
  });
  const selector = "[data-turn-id], [data-testid^='conversation-turn-'], [data-testid='conversation-turn'], [id^='conversation-turn-']";
  const document = fakeDocument(new Map([
    ["[data-message-author-role]", [fragment("a", "analysis"), fragment("b", "verdict")]],
    [selector, [container]],
  ]));
  const tracker = adapter.createTurnTracker(document, false);
  assert.equal(tracker.records.size, 1);
  assert.equal(adapter.turnRecordText(tracker.records.get(container), true), "analysis\n\nverdict");
});

test("turn tracker preserves skeleton order while the target user is virtualized", () => {
  const shell = (id: string) => node({
    getAttribute(name) {
      if (name === "data-turn-id") return id;
      if (name === "data-testid") return `conversation-turn-${id}`;
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" || selector === "[data-testid^='conversation-turn-']" ? this : null; },
  });
  const userShell = shell("user");
  const assistantShell = shell("assistant");
  const roleNode = (container: NodeLike, role: string, messageId: string, text: string) => node({
    role, innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return role;
      if (name === "data-message-id") return messageId;
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? container : null; },
  });
  const user = roleNode(userShell, "user", "user-message", "envelope");
  const assistant = roleNode(assistantShell, "assistant", "assistant-message", "verdict");
  const selector = "[data-turn-id], [data-testid^='conversation-turn-'], [data-testid='conversation-turn'], [id^='conversation-turn-']";
  const map = new Map<string, NodeLike[]>([
    [selector, [userShell, assistantShell]],
    ["[data-message-author-role]", [user, assistant]],
  ]);
  const document = fakeDocument(map);
  const tracker = adapter.createTurnTracker(document, false);
  const target = adapter.findTrackedUserTurn(document, tracker, "envelope", true);
  map.set("[data-message-author-role]", [assistant]);
  assert.deepEqual(adapter.trackedAssistantTurnsAfter(document, tracker, target).map((record: any) => adapter.turnRecordText(record, true)), ["verdict"]);
  assert.deepEqual(tracker.order, ["turn-id:user", "turn-id:assistant"]);
});

test("turn tracker waits for strict content selectors instead of reading action labels", () => {
  const container = node({getAttribute(name) { return name === "data-turn-id" ? "strict-user" : null; }});
  const roleNode = node({
    role: "user", innerText: "envelope\nEdit message",
    getAttribute(name) {
      if (name === "data-message-author-role") return "user";
      if (name === "data-message-id") return "strict-message";
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? container : null; },
    querySelector() { return null; },
  });
  const document = fakeDocument(new Map([["[data-message-author-role]", [roleNode]]]));
  const tracker = adapter.createTurnTracker(document, false);
  assert.equal(adapter.findTrackedUserTurn(document, tracker, "envelope", true), null);
  assert.equal(adapter.turnRecordText(tracker.records.get("turn-id:strict-user"), true), "");
});

test("turn tracker extracts assistant markdown without action or code-copy labels", () => {
  const container = node({getAttribute(name) { return name === "data-turn-id" ? "strict-assistant" : null; }});
  const markdown = node({innerText: "Verdict: PASS\n\n```js\nconst value = 1;\n```"});
  const roleNode = node({
    role: "assistant", innerText: "Verdict: PASS\nCopy code\nCopy\nShare",
    getAttribute(name) {
      if (name === "data-message-author-role") return "assistant";
      if (name === "data-message-id") return "strict-assistant-message";
      return null;
    },
    closest(selector) { return selector === "[data-turn-id]" ? container : null; },
    querySelector(selector) { return selector === ".markdown.prose" ? markdown : null; },
  });
  const document = fakeDocument(new Map([["[data-message-author-role]", [roleNode]]]));
  const tracker = adapter.createTurnTracker(document, false);
  assert.equal(adapter.turnRecordText(tracker.records.get("turn-id:strict-assistant"), true), "Verdict: PASS\n\n```js\nconst value = 1;\n```");
});

test("turn tracker keeps outer turn identity separate from inner message identities", () => {
  const shell = node({
    getAttribute(name) { return name === "data-testid" ? "conversation-turn-42" : null; },
    closest(selector) { return selector === "[data-testid^='conversation-turn-']" ? this : null; },
  });
  const fragment = (messageId: string, text: string) => node({
    role: "assistant", innerText: text,
    getAttribute(name) {
      if (name === "data-message-author-role") return "assistant";
      if (name === "data-message-id") return messageId;
      return null;
    },
    closest(selector) {
      if (selector === "[data-testid^='conversation-turn-']") return shell;
      if (selector === "[data-message-id]") return this;
      return null;
    },
  });
  const selector = "[data-turn-id], [data-testid^='conversation-turn-'], [data-testid='conversation-turn'], [id^='conversation-turn-']";
  const document = fakeDocument(new Map([
    [selector, [shell]],
    ["[data-message-author-role]", [fragment("message-a", "analysis"), fragment("message-b", "verdict")]],
  ]));
  const tracker = adapter.createTurnTracker(document, false);
  assert.deepEqual(tracker.order, ["testid:conversation-turn-42"]);
  assert.equal(adapter.turnRecordText(tracker.records.get("testid:conversation-turn-42"), true), "analysis\n\nverdict");
});

test("turn tracker never crosses an unhydrated next-turn shell", () => {
  const shell = (id: string) => node({
    getAttribute(name) {
      if (name === "data-testid") return `conversation-turn-${id}`;
      return null;
    },
    closest(selector) { return selector === "[data-testid^='conversation-turn-']" ? this : null; },
  });
  const targetShell = shell("target");
  const assistantShell = shell("assistant");
  const unknownShell = shell("unknown");
  const historicalShell = shell("historical");
  const roleNode = (container: NodeLike, role: string, text: string) => node({
    role, innerText: text,
    getAttribute(name) { return name === "data-message-author-role" ? role : null; },
    closest(selector) { return selector === "[data-testid^='conversation-turn-']" ? container : null; },
  });
  const user = roleNode(targetShell, "user", "envelope");
  const assistant = roleNode(assistantShell, "assistant", "current verdict");
  const historical = roleNode(historicalShell, "assistant", "historical verdict");
  const selector = "[data-turn-id], [data-testid^='conversation-turn-'], [data-testid='conversation-turn'], [id^='conversation-turn-']";
  const document = fakeDocument(new Map([
    [selector, [targetShell, assistantShell, unknownShell, historicalShell]],
    ["[data-message-author-role]", [user, assistant, historical]],
  ]));
  const tracker = adapter.createTurnTracker(document, false);
  const target = adapter.findTrackedUserTurn(document, tracker, "envelope", true);
  assert.throws(() => adapter.trackedAssistantTurnsAfter(document, tracker, target), /TURN_BOUNDARY_UNHYDRATED/);
});

test("turn tracker treats data-turn-id and approved DOM id shells as unhydrated boundaries", () => {
  const selector = "[data-turn-id], [data-testid^='conversation-turn-'], [data-testid='conversation-turn'], [id^='conversation-turn-']";
  for (const kind of ["data-turn-id", "id"]) {
    const shell = (value: string) => node({
      getAttribute(name) { return name === kind ? value : null; },
      closest(query) {
        if (kind === "data-turn-id" && query === "[data-turn-id]") return this;
        if (kind === "id" && query === "[id^='conversation-turn-']") return this;
        return null;
      },
    });
    const userShell = shell(kind === "id" ? "conversation-turn-user" : "user");
    const unknownShell = shell(kind === "id" ? "conversation-turn-unknown" : "unknown");
    const historicalShell = shell(kind === "id" ? "conversation-turn-history" : "history");
    const roleNode = (container: NodeLike, role: string, text: string) => node({
      role, innerText: text,
      getAttribute(name) { return name === "data-message-author-role" ? role : null; },
      closest(query) {
        if (kind === "data-turn-id" && query === "[data-turn-id]") return container;
        if (kind === "id" && query === "[id^='conversation-turn-']") return container;
        return null;
      },
    });
    const user = roleNode(userShell, "user", "envelope");
    const historical = roleNode(historicalShell, "assistant", "historical verdict");
    const document = fakeDocument(new Map([
      [selector, [userShell, unknownShell, historicalShell]],
      ["[data-message-author-role]", [user, historical]],
    ]));
    const tracker = adapter.createTurnTracker(document, false);
    const target = adapter.findTrackedUserTurn(document, tracker, "envelope", true);
    assert.throws(() => adapter.trackedAssistantTurnsAfter(document, tracker, target), /TURN_BOUNDARY_UNHYDRATED/);
  }
});
