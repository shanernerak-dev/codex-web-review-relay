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
  getClientRects?(): ArrayLike<unknown>;
};

function node(input: Partial<NodeLike> = {}): NodeLike {
  return {
    getAttribute(name) { return name === "data-message-author-role" ? (this.role ?? null) : null; },
    focus() {}, dispatchEvent() {}, click() { this.clicked = (this.clicked ?? 0) + 1; },
    ...input,
  };
}

function fakeDocument(map: Map<string, NodeLike[]>) {
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
  const oldUser = node({role: "user", innerText: "old"});
  const newUser = node({role: "user", innerText: "envelope"});
  const assistant = node({role: "assistant", innerText: "working"});
  const send = node();
  const map = new Map<string, NodeLike[]>([["[data-message-author-role]", [oldUser]], ["[data-testid='send-button']", [send]], ["[data-testid='stop-button']", []]]);
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
  assert.equal(adapter.reconcile(document, "envelope").state, "missing");
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
