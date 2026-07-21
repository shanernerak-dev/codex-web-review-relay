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

test("DOM adapter requires exact page, composer and send identities", () => {
  assert.equal(adapter.conversationIdentity({origin: "https://chatgpt.com", pathname: "/c/abc-123"}), "https://chatgpt.com/c/abc-123");
  assert.throws(() => adapter.conversationIdentity({origin: "https://example.com", pathname: "/c/abc"}), /PAGE_IDENTITY_UNSUPPORTED/);
  const input = node({value: ""});
  const button = node();
  const map = new Map<string, NodeLike[]>([["#prompt-textarea", [input]], ["[contenteditable='true'][data-lexical-editor='true']", []], ["[data-testid='send-button']", [button]], ["[data-message-author-role]", []]]);
  const document = fakeDocument(map);
  const state = adapter.dispatch(document, "Path: example");
  assert.equal(input.value, "Path: example");
  assert.equal(button.clicked, 1);
  assert.equal(state.baseline.size, 0);
  map.set("[data-testid='send-button']", [button, node()]);
  assert.throws(() => adapter.sendButton(document), /SEND_BUTTON_IDENTITY_MISMATCH/);
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

test("DOM adapter reconciles existing user turn or one exact unsent draft", () => {
  const input = node({value: "envelope"});
  const send = node();
  const user = node({role: "user", innerText: "envelope"});
  const assistant = node({role: "assistant", innerText: "done"});
  const map = new Map<string, NodeLike[]>([["#prompt-textarea", [input]], ["[contenteditable='true'][data-lexical-editor='true']", []], ["[data-testid='send-button']", [send]], ["[data-message-author-role]", [user, assistant]]]);
  const document = fakeDocument(map);
  const present = adapter.reconcile(document, "envelope");
  assert.equal(present.state, "user-present");
  assert.equal(present.assistant, assistant);
  map.set("[data-message-author-role]", []);
  assert.equal(adapter.reconcile(document, "envelope").state, "draft-unsent");
  adapter.resumeDraft(document, "envelope");
  assert.equal(send.clicked, 1);
  input.value = "different";
  assert.equal(adapter.reconcile(document, "envelope").state, "missing");
});
