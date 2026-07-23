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
    const outerTurn = node?.closest?.("[data-turn-id]")
      ?? node?.closest?.("[data-testid^='conversation-turn-']")
      ?? node?.closest?.("[data-testid='conversation-turn']")
      ?? null;
    const containers = outerTurn ? [outerTurn] : [node?.closest?.("[data-message-id]") ?? null].filter(Boolean);
    for (const container of containers) {
      const turnId = container.getAttribute?.("data-turn-id");
      if (turnId) return `turn-id:${turnId}`;
      const testId = container.getAttribute?.("data-testid");
      if (testId && testId !== "conversation-turn") return `testid:${testId}`;
      const elementId = container.getAttribute?.("id");
      if (elementId) return `id:${elementId}`;
      if (!outerTurn) {
        const messageId = container.getAttribute?.("data-message-id");
        if (messageId) return `message-id:${messageId}`;
      }
    }
    // A generic conversation-turn has no cross-render stable key. Keep its node
    // identity for the current DOM pass, but do not pretend it survives a rerender.
    return outerTurn?.getAttribute?.("data-testid") === "conversation-turn" ? outerTurn : null;
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
      const identity = stableTurnIdentity(node);
      if (typeof identity !== "string") assertUnstableBaselineRetained(document, baseline);
      const record = identity === null ? null : records.find((candidate) => candidate.identity === identity);
      if (record) record.nodes.push(node);
      else records.push({identity, nodes: [node]});
    }
    return records.filter((record) => exactText === undefined || normalizedGroupedText(record.nodes) === exactText.trim())
      .map((record) => record.nodes[record.nodes.length - 1]);
  }
  function normalizedGroupedText(nodes) {
    return nodes.map(normalizedText).filter((text) => text.length > 0).join("\n").trim();
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
    const matches = newTurns(document, baseline, role, exactText);
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
    const user = await waitFor(document, () => newTurn(document, state.baseline, "user", envelope), "SEND_CLICK_RECEIPT_MISSING", 60_000);
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
    const records = [];
    for (const node of candidates) {
      const identity = stableTurnIdentity(node);
      const record = identity === null ? null : records.find((candidate) => candidate.identity === identity);
      if (record) record.nodes.push(node); else records.push({identity, nodes: [node]});
    }
    const exact = records.filter((record) => normalizedGroupedText(record.nodes) === envelope.trim());
    return {candidate_count: candidates.length, count: records.length, exact_match_count: exact.length, baseline_count: baseline?.size ?? 0};
  }
  function messageIdentity(node, withinTurn) {
    const messageId = node?.getAttribute?.("data-message-id");
    if (messageId) return `message-id:${messageId}`;
    const elementId = node?.getAttribute?.("id");
    if (elementId) return `id:${elementId}`;
    return `within:${withinTurn}`;
  }
  function messageContentNode(node, role) {
    if (!node?.querySelector) return node;
    if (role === "user") return node.querySelector(".whitespace-pre-wrap");
    return node.querySelector(".markdown.prose") ?? node.querySelector(".markdown");
  }
  function turnShells(document) {
    return Array.from(document.querySelectorAll("[data-testid^='conversation-turn-'], [data-testid='conversation-turn']"));
  }
  function mergeObservedOrder(previous, observed) {
    const merged = previous.slice();
    if (merged.length === 0) return observed.slice();
    for (let index = 0; index < observed.length; index += 1) {
      const key = observed[index];
      if (merged.includes(key)) continue;
      const nextKnown = observed.slice(index + 1).find((candidate) => merged.includes(candidate));
      if (nextKnown !== undefined) {
        merged.splice(merged.indexOf(nextKnown), 0, key);
        continue;
      }
      const previousKnown = observed.slice(0, index).reverse().find((candidate) => merged.includes(candidate));
      if (previousKnown !== undefined) merged.splice(merged.lastIndexOf(previousKnown) + 1, 0, key);
      else merged.push(key);
    }
    return merged;
  }
  function createTurnTracker(document, captureBaseline = true) {
    const tracker = {records: new Map(), order: [], baselineKeys: new Set(), unstableBaselineNodes: new Set()};
    harvestTurnTracker(document, tracker);
    if (captureBaseline) {
      for (const key of tracker.order) tracker.baselineKeys.add(key);
      for (const record of tracker.records.values()) {
        if (typeof record.identity !== "string") for (const fragment of record.fragments.values()) tracker.unstableBaselineNodes.add(fragment.node);
      }
    }
    return tracker;
  }
  function harvestTurnTracker(document, tracker) {
    const pass = [];
    const passByKey = new Map();
    const observedOrder = [];
    for (const shell of turnShells(document)) {
      const identity = stableTurnIdentity(shell);
      const key = identity !== null ? identity : shell;
      if (!observedOrder.includes(key)) observedOrder.push(key);
      if (!tracker.records.has(key)) {
        tracker.records.set(key, {key, identity, role: null, fragments: new Map(), nodes: [], shell});
      } else {
        tracker.records.get(key).shell = shell;
      }
    }
    for (const node of turns(document)) {
      const role = node.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") continue;
      const identity = stableTurnIdentity(node);
      const key = identity !== null ? identity : node;
      let group = passByKey.get(key);
      if (!group) {
        group = {key, identity, role, nodes: []};
        passByKey.set(key, group);
        pass.push(group);
        if (!observedOrder.includes(key)) observedOrder.push(key);
      } else if (group.role !== role) {
        throw new Error("TURN_ROLE_AMBIGUOUS");
      }
      group.nodes.push(node);
    }
    if (tracker.unstableBaselineNodes.size > 0) {
      const currentNodes = new Set(turns(document));
      if (Array.from(tracker.unstableBaselineNodes).some((node) => !currentNodes.has(node))) throw new Error("TURN_IDENTITY_UNSTABLE");
    }
    const nextOrder = [];
    for (const group of pass) {
      let record = tracker.records.get(group.key);
      if (!record) {
        record = {key: group.key, identity: group.identity, role: group.role, fragments: new Map(), nodes: []};
        tracker.records.set(group.key, record);
      }
      record.role = group.role;
      record.nodes = group.nodes.slice();
      const liveFragmentKeys = new Set();
      group.nodes.forEach((node, index) => {
        const fragmentKey = messageIdentity(node, index);
        const contentNode = messageContentNode(node, group.role);
        if (!contentNode) return;
        liveFragmentKeys.add(fragmentKey);
        record.fragments.set(fragmentKey, {
          key: fragmentKey,
          node,
          contentNode,
          normalized: normalizedText(contentNode),
          raw: rawText(contentNode),
          index,
        });
      });
      for (const [fragmentKey, fragment] of record.fragments) {
        if (liveFragmentKeys.has(fragmentKey)) continue;
        if (record.identity === null || fragmentKey.startsWith("within:")) record.fragments.delete(fragmentKey);
        else fragment.detached = true;
      }
      nextOrder.push(group.key);
    }
    tracker.order = mergeObservedOrder(tracker.order, observedOrder.length > 0 ? observedOrder : nextOrder);
    return tracker;
  }
  function orderedFragments(record) {
    return Array.from(record?.fragments?.values?.() ?? []).sort((a, b) => a.index - b.index);
  }
  function turnRecordText(record, raw = false) {
    return orderedFragments(record).map((fragment) => raw ? fragment.raw : fragment.normalized)
      .filter((text) => text.length > 0).join(raw ? "\n\n" : "\n").trim();
  }
  function findTrackedUserTurn(document, tracker, envelope, includeBaseline = false) {
    harvestTurnTracker(document, tracker);
    const matches = tracker.order.map((key) => tracker.records.get(key))
      .filter((record) => record?.role === "user")
      .filter((record) => includeBaseline || !tracker.baselineKeys.has(record.key))
      .filter((record) => turnRecordText(record) === envelope.trim());
    if (matches.length > 1) throw new Error("TURN_IDENTITY_AMBIGUOUS:user");
    return matches[0] ?? null;
  }
  function trackedAssistantTurnsAfter(document, tracker, userRecord) {
    harvestTurnTracker(document, tracker);
    const index = tracker.order.indexOf(userRecord?.key);
    if (index < 0) throw new Error("TURN_ANCHOR_AMBIGUOUS");
    const out = [];
    for (const key of tracker.order.slice(index + 1)) {
      const record = tracker.records.get(key);
      if (!record) continue;
      if (record.role === "user") break;
      if (record.role === null) throw new Error("TURN_BOUNDARY_UNHYDRATED");
      if (record.role === "assistant") out.push(record);
    }
    return out;
  }
  function trackedAssistantComplete(document, record) {
    const nodes = record?.nodes ?? orderedFragments(record).map((fragment) => fragment.node).filter(Boolean);
    return nodes.length > 0 && isAssistantComplete(document, nodes);
  }
  async function dispatchTracked(document, envelope) {
    const tracker = createTurnTracker(document, true);
    const input = await writeComposer(document, composer(document), envelope);
    const button = await waitFor(document, () => sendButton(document), "SEND_BUTTON_ENABLE_TIMEOUT");
    button.click();
    try {
      const userRecord = await waitFor(document, () => findTrackedUserTurn(document, tracker, envelope), "SEND_CLICK_RECEIPT_MISSING", 60_000);
      return {tracker, input, button, userRecord};
    } catch (error) {
      if (error && typeof error === "object") error.turnTracker = tracker;
      throw error;
    }
  }
  function reconcileTracked(document, envelope) {
    const tracker = createTurnTracker(document, false);
    const userRecord = findTrackedUserTurn(document, tracker, envelope, true);
    if (userRecord) {
      const assistantRecords = trackedAssistantTurnsAfter(document, tracker, userRecord);
      return {state: "user-present", tracker, userRecord, assistantRecords};
    }
    let draftExact = false;
    try { draftExact = normalizedText(composer(document)) === envelope.trim(); } catch {}
    return {state: draftExact ? "draft-unsent" : "missing", tracker};
  }
  async function resumeDraftTracked(document, envelope) {
    const input = composer(document);
    if (normalizedText(input) !== envelope.trim()) throw new Error("RECONCILE_DRAFT_MISMATCH");
    const tracker = createTurnTracker(document, true);
    const button = await waitFor(document, () => sendButton(document), "SEND_BUTTON_ENABLE_TIMEOUT");
    button.click();
    const userRecord = await waitFor(document, () => findTrackedUserTurn(document, tracker, envelope), "SEND_CLICK_RECEIPT_MISSING", 60_000);
    return {tracker, input, button, userRecord};
  }
  function trackedTurnObservation(document, tracker, envelope) {
    try { harvestTurnTracker(document, tracker); } catch {}
    const records = tracker ? tracker.order.map((key) => tracker.records.get(key)).filter(Boolean) : [];
    const users = records.filter((record) => record.role === "user");
    const exact = users.filter((record) => turnRecordText(record) === envelope.trim());
    const candidates = [];
    users.forEach((record) => {
      const turnIndex = tracker.order.indexOf(record.key);
      const fragments = orderedFragments(record);
      if (fragments.length === 0) candidates.push({
        turnKey: typeof record.identity === "string" ? record.identity : `generic-turn:${turnIndex}`,
        fragmentKey: "record:no-fragment",
        role: record.role,
        turnIndex,
        fragmentIndex: 0,
        fragmentCount: 0,
        canonical: "",
        contentObserved: false,
        fragmentExtracted: false,
        classification: tracker?.baselineKeys?.has(record.key) ? "baseline" : "new",
      });
      fragments.forEach((fragment, fragmentIndex) => candidates.push({
        turnKey: typeof record.identity === "string" ? record.identity : `generic-turn:${turnIndex}`,
        fragmentKey: fragment.key,
        role: record.role,
        turnIndex,
        fragmentIndex,
        fragmentCount: fragments.length,
        canonical: fragment.normalized,
        contentObserved: true,
        fragmentExtracted: true,
        classification: tracker?.baselineKeys?.has(record.key) ? "baseline" : "new",
      }));
    });
    return {
      candidate_count: users.reduce((sum, record) => sum + record.nodes.length, 0),
      count: users.length,
      exact_match_count: exact.length,
      baseline_count: tracker?.baselineKeys?.size ?? 0,
      candidates,
    };
  }
  scope.ReviewRelayDomAdapter = {
    pageSupported, composer, sendButton, normalizedText, rawText, rawTurnText, isAssistantComplete,
    writeComposer, snapshotTurns, newTurn, newTurns, assistantTurnsAfter, turns, turnObservation,
    dispatch, reconcile, resumeDraft, isGenerating, isResponseIdle, isIdle,
    createTurnTracker, harvestTurnTracker, turnRecordText, findTrackedUserTurn,
    trackedAssistantTurnsAfter, trackedAssistantComplete, dispatchTracked, reconcileTracked,
    resumeDraftTracked, trackedTurnObservation,
  };
})(globalThis);
