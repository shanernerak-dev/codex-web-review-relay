(function (scope) {
  "use strict";
  const COMPOSER_SELECTORS = ["#prompt-textarea", "[contenteditable='true'][data-lexical-editor='true']"];
  const SEND_SELECTOR = "[data-testid='send-button']";
  const STOP_SELECTOR = "[data-testid='stop-button']";
  const TURN_SELECTOR = "[data-message-author-role]";
  function normalizedText(node) { const value = typeof node.value === "string" ? node.value : (node.innerText ?? node.textContent ?? ""); return String(value).replace(/\r\n/g, "\n").trim(); }
  function unique(document, selectors, code) {
    const nodes = [];
    for (const selector of selectors) for (const node of document.querySelectorAll(selector)) if (!nodes.includes(node)) nodes.push(node);
    const visible = nodes.filter((node) => {
      if (typeof node.getClientRects === "function") return node.getClientRects().length > 0;
      if (typeof node.getBoundingClientRect === "function") { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }
      return true;
    });
    if (visible.length !== 1) throw new Error(`${code}:${visible.length}`);
    return visible[0];
  }
  function conversationIdentity(location) {
    if (location.origin !== "https://chatgpt.com" || !/(^|\/)c\/[0-9a-z-]+(?:$|\/)/i.test(location.pathname)) throw new Error("PAGE_IDENTITY_UNSUPPORTED");
    return `${location.origin}${location.pathname}`;
  }
  function composer(document) { return unique(document, COMPOSER_SELECTORS, "COMPOSER_IDENTITY_MISMATCH"); }
  function sendButton(document) { const button = unique(document, [SEND_SELECTOR], "SEND_BUTTON_IDENTITY_MISMATCH"); if (button.disabled || button.getAttribute?.("aria-disabled") === "true") throw new Error("SEND_BUTTON_DISABLED"); return button; }
  function writeComposer(document, node, text) {
    node.focus?.();
    if (typeof node.value === "string") { node.value = text; node.dispatchEvent?.(new Event("input", {bubbles: true})); }
    else { document.execCommand?.("selectAll", false); if (!document.execCommand?.("insertText", false, text)) { node.textContent = text; node.dispatchEvent?.(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text})); } }
    if (normalizedText(node) !== text.trim()) throw new Error("COMPOSER_READBACK_MISMATCH");
  }
  function snapshotTurns(document) { return new Set(Array.from(document.querySelectorAll(TURN_SELECTOR))); }
  function turns(document) { return Array.from(document.querySelectorAll(TURN_SELECTOR)); }
  function newTurn(document, baseline, role, exactText) {
    const matches = Array.from(document.querySelectorAll(TURN_SELECTOR)).filter((node) => !baseline.has(node) && node.getAttribute("data-message-author-role") === role && (exactText === undefined || normalizedText(node) === exactText.trim()));
    if (matches.length > 1) throw new Error(`TURN_IDENTITY_AMBIGUOUS:${role}`);
    return matches[0] ?? null;
  }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  async function waitFor(document, predicate, errorCode, timeoutMs = 2_500) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try { const value = predicate(); if (value) return value; }
      catch (error) { lastError = error; }
      await sleep(25);
    }
    if (lastError instanceof Error && !String(lastError.message).startsWith("SEND_BUTTON_DISABLED")) throw lastError;
    throw new Error(errorCode);
  }
  async function clickAndConfirm(document, state, envelope) {
    const button = await waitFor(document, () => sendButton(document), "SEND_BUTTON_ENABLE_TIMEOUT");
    button.click();
    await waitFor(document, () => {
      if (normalizedText(state.input) === "") return true;
      if (isGenerating(document)) return true;
      return Boolean(newTurn(document, state.baseline, "user", envelope));
    }, "SEND_CLICK_RECEIPT_MISSING");
    return {...state, button};
  }
  async function dispatch(document, envelope) {
    const baseline = snapshotTurns(document);
    const input = composer(document);
    writeComposer(document, input, envelope);
    return clickAndConfirm(document, {baseline, input}, envelope);
  }
  function reconcile(document, envelope) {
    const all = turns(document);
    const users = all.filter((node) => node.getAttribute("data-message-author-role") === "user" && normalizedText(node) === envelope.trim());
    if (users.length > 1) throw new Error("RECONCILE_USER_TURN_AMBIGUOUS");
    if (users.length === 1) {
      const index = all.indexOf(users[0]);
      const assistant = all.slice(index + 1).find((node) => node.getAttribute("data-message-author-role") === "assistant") ?? null;
      return {state: "user-present", user: users[0], assistant, baseline: new Set(all)};
    }
    let draftExact = false;
    try { draftExact = normalizedText(composer(document)) === envelope.trim(); } catch {}
    return {state: draftExact ? "draft-unsent" : "missing", baseline: new Set(all)};
  }
  async function resumeDraft(document, envelope) {
    const input = composer(document);
    if (normalizedText(input) !== envelope.trim()) throw new Error("RECONCILE_DRAFT_MISMATCH");
    const baseline = snapshotTurns(document);
    return clickAndConfirm(document, {baseline, input}, envelope);
  }
  function isGenerating(document) { return document.querySelectorAll(STOP_SELECTOR).length === 1; }
  function isIdle(document) { return document.querySelectorAll(STOP_SELECTOR).length === 0 && document.querySelectorAll(SEND_SELECTOR).length === 1; }
  scope.ReviewRelayDomAdapter = {conversationIdentity, composer, sendButton, normalizedText, writeComposer, snapshotTurns, newTurn, turns, dispatch, reconcile, resumeDraft, isGenerating, isIdle};
})(globalThis);
