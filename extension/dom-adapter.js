(function (scope) {
  "use strict";
  const COMPOSER_SELECTORS = ["#prompt-textarea", "[contenteditable='true'][data-lexical-editor='true']"];
  const SEND_SELECTOR = "[data-testid='send-button']";
  const STOP_SELECTOR = "[data-testid='stop-button']";
  const TURN_SELECTOR = "[data-message-author-role]";
  function normalizedText(node) {
    const value = typeof node.value === "string" ? node.value : (node.innerText ?? node.textContent ?? "");
    return String(value).replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n")
      .split("\n").map((line) => line.trim()).filter((line) => line.length > 0).join("\n");
  }
  function rawText(node) { return String(node?.innerText ?? node?.textContent ?? "").replace(/\r\n?/g, "\n").trim(); }
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
  function pageSupported(location) {
    if (location.origin !== "https://chatgpt.com" || !/(^|\/)c\/[0-9a-z-]+(?:$|\/)/i.test(location.pathname)) throw new Error("PAGE_IDENTITY_UNSUPPORTED");
    return true;
  }
  function composer(document) { return unique(document, COMPOSER_SELECTORS, "COMPOSER_IDENTITY_MISMATCH"); }
  function sendButton(document) { const button = unique(document, [SEND_SELECTOR], "SEND_BUTTON_IDENTITY_MISMATCH"); if (button.disabled || button.getAttribute?.("aria-disabled") === "true") throw new Error("SEND_BUTTON_DISABLED"); return button; }
  async function writeComposer(document, node, text) {
    node.focus?.();
    if (typeof node.value === "string") { node.value = text; node.dispatchEvent?.(new Event("input", {bubbles: true})); }
    else {
      const selection = document.defaultView?.getSelection?.() ?? globalThis.getSelection?.();
      const range = document.createRange?.();
      if (selection && range) {
        range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range);
      }
      if (!document.execCommand?.("insertText", false, text)) {
        node.textContent = text;
        node.dispatchEvent?.(new InputEvent("input", {bubbles: true, inputType: "insertText", data: text}));
      }
    }
    return await waitFor(document, () => {
      const current = composer(document);
      return normalizedText(current) === text.trim() ? current : null;
    }, "COMPOSER_READBACK_MISMATCH");
  }
  function snapshotTurns(document) {
    const snapshot = new Set(Array.from(document.querySelectorAll(TURN_SELECTOR)));
    snapshot.turnIdentities = new Set(Array.from(snapshot).map(stableTurnIdentity).filter((identity) => typeof identity === "string"));
    snapshot.unstableTurns = new Set(Array.from(snapshot).filter((node) => typeof stableTurnIdentity(node) !== "string"));
    snapshot.unstableTurnCount = Array.from(snapshot).filter((node) => typeof stableTurnIdentity(node) !== "string").length;
    return snapshot;
  }
  function turns(document) { return Array.from(document.querySelectorAll(TURN_SELECTOR)); }
  function stableTurnIdentity(node) {
    const containers = [
      node?.closest?.("[data-turn-id]") ?? null,
      node?.closest?.("[data-message-id]") ?? null,
      node?.closest?.("[data-testid^='conversation-turn-']") ?? null,
      node?.closest?.("[data-testid='conversation-turn']") ?? null,
    ].filter(Boolean);
    for (const container of containers) {
      const turnId = container.getAttribute?.("data-turn-id");
      if (turnId) return `turn-id:${turnId}`;
      const messageId = container.getAttribute?.("data-message-id");
      if (messageId) return `message-id:${messageId}`;
      const testId = container.getAttribute?.("data-testid");
      if (testId && testId !== "conversation-turn") return `testid:${testId}`;
      const elementId = container.getAttribute?.("id");
      if (elementId) return `id:${elementId}`;
    }
    // A generic conversation-turn has no cross-render stable key. Keep its node
    // identity for the current DOM pass, but do not pretend it survives a rerender.
    return node?.closest?.("[data-testid='conversation-turn']") ?? null;
  }
  function oneAssistantTurn(matches) {
    if (matches.length <= 1) return matches[0] ?? null;
    const identities = matches.map(stableTurnIdentity);
    if (identities[0] !== null && identities.every((identity) => identity === identities[0])) return matches[matches.length - 1];
    throw new Error("TURN_IDENTITY_AMBIGUOUS:assistant");
  }
  function rawTurnText(document, node) {
    if (Array.isArray(node)) {
      const seen = [];
      return node.filter((candidate) => {
        const identity = stableTurnIdentity(candidate);
        if (identity !== null && seen.some((prior) => prior === identity)) return false;
        seen.push(identity);
        return true;
      }).map((candidate) => rawTurnText(document, candidate)).filter((text) => text.length > 0).join("\n\n").trim();
    }
    const identity = stableTurnIdentity(node);
    if (identity === null) return rawText(node);
    const parts = Array.from(document.querySelectorAll(TURN_SELECTOR))
      .filter((candidate) => candidate.getAttribute("data-message-author-role") === "assistant" && stableTurnIdentity(candidate) === identity)
      .map(rawText)
      .filter((text) => text.length > 0);
    return (parts.length > 0 ? parts.join("\n\n") : rawText(node)).trim();
  }
  function turnContainer(node) {
    return node?.closest?.("[data-turn-id]")
      ?? node?.closest?.("[data-testid^='conversation-turn-']")
      ?? node?.closest?.("[data-testid='conversation-turn']")
      ?? node;
  }
  function isAssistantComplete(document, node) {
    if (Array.isArray(node)) {
      const seen = [];
      const uniqueNodes = node.filter((candidate) => {
        const identity = stableTurnIdentity(candidate);
        if (identity !== null && seen.some((prior) => prior === identity)) return false;
        seen.push(identity);
        return true;
      });
      return uniqueNodes.length > 0 && uniqueNodes.every((candidate) => isAssistantComplete(document, candidate));
    }
    const container = turnContainer(node);
    if (!container?.querySelector) return false;
    if (container.querySelector("[data-testid='copy-turn-action-button'], [data-testid='copy-message-button']")) return true;
    const copyButton = container.querySelector("button[aria-label='Copy'], button[aria-label='复制']");
    if (!copyButton) return false;
    return !copyButton.closest?.("pre, code, [data-testid*='code'], [class*='code']");
  }
  function isBaselineTurn(node, baseline) {
    if (baseline?.has?.(node)) return true;
    const identity = stableTurnIdentity(node);
    return typeof identity === "string" && baseline?.turnIdentities?.has?.(identity) === true;
  }
  function assertUnstableBaselineRetained(document, baseline) {
    if (!baseline?.unstableTurns || baseline.unstableTurns.size === 0) return;
    const current = new Set(Array.from(document.querySelectorAll(TURN_SELECTOR)));
    if (Array.from(baseline.unstableTurns).some((node) => !current.has(node))) throw new Error("TURN_IDENTITY_UNSTABLE");
  }
  function newTurns(document, baseline, role, exactText) {
    const records = [];
    for (const node of Array.from(document.querySelectorAll(TURN_SELECTOR))) {
      if (isBaselineTurn(node, baseline) || node.getAttribute("data-message-author-role") !== role) continue;
      if (exactText !== undefined && normalizedText(node) !== exactText.trim()) continue;
      const identity = stableTurnIdentity(node);
      if (typeof identity !== "string") assertUnstableBaselineRetained(document, baseline);
      const record = identity === null ? null : records.find((candidate) => candidate.identity === identity);
      if (record) record.nodes.push(node);
      else records.push({identity, nodes: [node]});
    }
    return records.map((record) => record.nodes[record.nodes.length - 1]);
  }
  function findAnchoredTurnIndex(all, anchor) {
    const direct = all.indexOf(anchor);
    if (direct >= 0) return direct;
    const identity = stableTurnIdentity(anchor);
    if (typeof identity !== "string") throw new Error("TURN_IDENTITY_UNSTABLE");
    const matches = all.map(stableTurnIdentity).reduce((indexes, candidate, index) => candidate === identity ? [...indexes, index] : indexes, []);
    if (matches.length !== 1) throw new Error("TURN_ANCHOR_AMBIGUOUS");
    return matches[0];
  }
  function groupedAssistantTurns(nodes) {
    const records = [];
    for (const node of nodes) {
      if (node.getAttribute("data-message-author-role") !== "assistant") continue;
      const identity = stableTurnIdentity(node);
      const record = identity === null ? null : records.find((candidate) => candidate.identity === identity);
      if (record) record.nodes.push(node);
      else records.push({identity, nodes: [node]});
    }
    return records.map((record) => record.nodes[record.nodes.length - 1]);
  }
  function assistantTurnsAfter(document, userAnchor) {
    const all = turns(document);
    const index = findAnchoredTurnIndex(all, userAnchor);
    const tail = all.slice(index + 1);
    const nextUser = tail.findIndex((node) => node.getAttribute("data-message-author-role") === "user");
    return groupedAssistantTurns(nextUser >= 0 ? tail.slice(0, nextUser) : tail);
  }
  function newTurn(document, baseline, role, exactText) {
    const matches = Array.from(document.querySelectorAll(TURN_SELECTOR)).filter((node) => !isBaselineTurn(node, baseline) && node.getAttribute("data-message-author-role") === role && (exactText === undefined || normalizedText(node) === exactText.trim()));
    if (matches.some((node) => typeof stableTurnIdentity(node) !== "string")) assertUnstableBaselineRetained(document, baseline);
    if (role === "assistant") return oneAssistantTurn(matches);
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
    const user = await waitFor(document, () => newTurn(document, state.baseline, "user", envelope), "SEND_CLICK_RECEIPT_MISSING", 10_000);
    return {...state, button, user};
  }
  async function dispatch(document, envelope) {
    const baseline = snapshotTurns(document);
    const input = await writeComposer(document, composer(document), envelope);
    return clickAndConfirm(document, {baseline, input}, envelope);
  }
  function reconcile(document, envelope) {
    const all = turns(document);
    const users = all.filter((node) => node.getAttribute("data-message-author-role") === "user" && normalizedText(node) === envelope.trim());
    if (users.length > 1) throw new Error("RECONCILE_USER_TURN_AMBIGUOUS");
    if (users.length === 1) {
      const assistants = assistantTurnsAfter(document, users[0]);
      return {state: "user-present", user: users[0], assistant: assistants.at(-1) ?? null, assistants, baseline: snapshotTurns(document)};
    }
    let draftExact = false;
    try { draftExact = normalizedText(composer(document)) === envelope.trim(); } catch {}
    return {state: draftExact ? "draft-unsent" : "missing", baseline: snapshotTurns(document)};
  }
  async function resumeDraft(document, envelope) {
    const input = composer(document);
    if (normalizedText(input) !== envelope.trim()) throw new Error("RECONCILE_DRAFT_MISMATCH");
    const baseline = snapshotTurns(document);
    return clickAndConfirm(document, {baseline, input}, envelope);
  }
  function isGenerating(document) { return document.querySelectorAll(STOP_SELECTOR).length === 1; }
  function isResponseIdle(document) { return document.querySelectorAll(STOP_SELECTOR).length === 0; }
  function isIdle(document) {
    if (!isResponseIdle(document)) return false;
    try { composer(document); return true; }
    catch { return false; }
  }
  function turnObservation(document, baseline, envelope) {
    const all = turns(document);
    const candidates = all.filter((node) => node.getAttribute("data-message-author-role") === "user");
    const exact = candidates.filter((node) => normalizedText(node) === envelope.trim());
    return {candidate_count: candidates.length, exact_match_count: exact.length, baseline_count: baseline?.size ?? 0};
  }
  scope.ReviewRelayDomAdapter = {pageSupported, composer, sendButton, normalizedText, rawText, rawTurnText, isAssistantComplete, writeComposer, snapshotTurns, newTurn, newTurns, assistantTurnsAfter, turns, turnObservation, dispatch, reconcile, resumeDraft, isGenerating, isResponseIdle, isIdle};
})(globalThis);
