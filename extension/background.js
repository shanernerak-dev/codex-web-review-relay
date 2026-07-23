"use strict";
const HOST_NAME = "dev.shanernerak.codex_web_review_relay";
const SCHEMA_VERSION = {major: 1, minor: 2};
const CAPABILITIES = ["relay-only-v1", "diagnostics-v1"];
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const DIAGNOSTIC_KEY = "reviewRelayDiagnosticsV1";
const DIAGNOSTIC_LIMIT = 256;
const SESSION_KEY = "relaySession";
const PENDING_LOSS_KEY = "relayPendingSessionLossV1";
const MAX_RECONNECT_ATTEMPTS = 5;
let port = null;
let armed = null;
let heartbeat = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let reconnectDisabled = false;
let restorePromise = null;
let sessionOperation = Promise.resolve();
function enqueueSessionOperation(operation) {
  const next = sessionOperation.then(operation, operation);
  sessionOperation = next.catch(() => {});
  return next;
}
const pending = new Map();
let diagnosticOperation = Promise.resolve();
let diagnosticSequence = 0;
function uuid() { return crypto.randomUUID(); }
function reconnectDelay(attempt) { return Math.min(8_000, 250 * (2 ** attempt)) + Math.floor(Math.random() * 125); }
function clearHeartbeat() { if (heartbeat !== null) clearInterval(heartbeat); heartbeat = null; }
function startHeartbeat() { clearHeartbeat(); heartbeat = setInterval(() => nativeRequest("HEARTBEAT", {sessionId: armed?.sessionId}).catch(() => {}), 10_000); }
function persistArmed() { if (armed) return chrome.storage.local.set({[SESSION_KEY]: {...armed}}); return Promise.resolve(); }
function rejectPending(error) { for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(error); } pending.clear(); }
function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => {
    const error = new Error(chrome.runtime.lastError?.message ?? "NATIVE_HOST_DISCONNECTED");
    rejectPending(error); port = null; clearHeartbeat();
    if (armed && !reconnectDisabled) scheduleReconnect();
  });
  return port;
}
function nativeRequest(type, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = uuid();
    const timer = setTimeout(() => { if (!pending.has(requestId)) return; pending.delete(requestId); reject(new Error("NATIVE_REQUEST_TIMEOUT")); }, 5_000);
    pending.set(requestId, {resolve, reject, timer});
    try { ensurePort().postMessage({schemaVersion: SCHEMA_VERSION, type, requestId, ...fields}); }
    catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
  });
}
function diagnostic(level, event, fields = {}, component = "extension-background") {
  diagnosticOperation = diagnosticOperation.then(async () => {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_KEY);
    const queue = Array.isArray(stored[DIAGNOSTIC_KEY]) ? stored[DIAGNOSTIC_KEY] : [];
    const sequence = diagnosticSequence++;
    queue.push({
      level, component, event, sessionId: armed?.sessionId, jobId: fields.job_id, details: fields,
      eventId: uuid(), sourceTimestamp: new Date().toISOString(), sequence,
      bindingGeneration: armed?.bindingGeneration, documentId: armed?.documentId, tabId: armed?.tabId,
    });
    await chrome.storage.local.set({[DIAGNOSTIC_KEY]: queue.slice(-DIAGNOSTIC_LIMIT)});
    await flushDiagnostics();
  }).catch(() => {});
}
async function flushDiagnostics() {
  const stored = await chrome.storage.local.get(DIAGNOSTIC_KEY);
  const queue = Array.isArray(stored[DIAGNOSTIC_KEY]) ? stored[DIAGNOSTIC_KEY] : [];
  let sent = 0;
  for (const item of queue) {
    try { await nativeRequest("DIAGNOSTIC_EVENT", item); sent += 1; }
    catch { break; }
  }
  if (sent > 0) await chrome.storage.local.set({[DIAGNOSTIC_KEY]: queue.slice(sent)});
}
async function onNativeMessage(message) {
  if (typeof message.responseToRequestId === "string" && pending.has(message.responseToRequestId)) {
    const request = pending.get(message.responseToRequestId); pending.delete(message.responseToRequestId); clearTimeout(request.timer);
    message.type === "ERROR" ? request.reject(new Error(message.errorCode ?? "NATIVE_ERROR")) : request.resolve(message); return;
  }
  if (!["DISPATCH_TRIGGER", "RECONCILE_TRIGGER"].includes(message.type) || !armed || message.sessionId !== armed.sessionId) return;
  diagnostic("info", "trigger_received", {job_id: message.jobId, message_type: message.type});
  armed.activeJobId = message.jobId;
  armed.state = "ACTIVE";
  await persistArmed();
  try {
    const page = await chrome.tabs.sendMessage(armed.tabId, {kind: "GET_PAGE_STATE"});
    if (!page?.ok || !page.adapterReady) throw new Error("PAGE_BINDING_DRIFT");
    if (page.conversationIdentity !== armed.conversationIdentity || page.documentId !== armed.documentId) throw new Error("PAGE_BINDING_DRIFT");
    const response = await chrome.tabs.sendMessage(armed.tabId, {
      kind: message.type, jobId: message.jobId, envelope: message.envelope, reviewMode: message.reviewMode,
      deadline: message.deadline, allowUnsentSend: message.allowUnsentSend,
      bindingGeneration: armed.bindingGeneration, documentId: armed.documentId,
    });
    if (!response?.ok) throw new Error(response?.errorCode ?? "CONTENT_DISPATCH_REJECTED");
    ensurePort().postMessage({schemaVersion: SCHEMA_VERSION, type: `${message.type}_ACCEPTED`, responseToRequestId: message.requestId, sessionId: armed.sessionId, jobId: message.jobId});
    diagnostic("info", "trigger_accepted", {job_id: message.jobId, message_type: message.type});
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_DISPATCH_ERROR";
    if (armed) { armed.lastError = errorCode; await persistArmed(); }
    diagnostic("error", "trigger_failed", {job_id: message.jobId, message_type: message.type, error_code: errorCode});
    await sendLifecycle("SEND_UNCERTAIN", message.jobId, errorCode);
  }
}
async function sendLifecycle(type, jobId, errorCode = null, assistantOutput = null) {
  if (!armed) throw new Error("SESSION_NOT_ARMED");
  const current = armed;
  if (type === "SESSION_LOST") {
    current.state = "INVALIDATING";
    try {
      await nativeRequest(type, {sessionId: current.sessionId, jobId, ...(errorCode ? {errorCode} : {})});
    } finally {
      await releaseBinding(current);
    }
    return;
  }
  diagnostic("info", "lifecycle_send", {job_id: jobId, message_type: type, ...(errorCode ? {error_code: errorCode} : {}), ...(assistantOutput !== null ? {length: assistantOutput.length} : {})});
  await nativeRequest(type, {sessionId: current.sessionId, jobId, ...(errorCode ? {errorCode} : {}), ...(assistantOutput !== null ? {assistantOutput} : {})});
  diagnostic("info", "lifecycle_acked", {job_id: jobId, message_type: type});
  if (["TURN_IDLE", "SEND_UNCERTAIN", "TURN_TIMEOUT"].includes(type) && armed?.sessionId === current.sessionId) {
    armed.activeJobId = null;
    armed.state = "ARMED";
    await persistArmed();
  }
}
async function validateSavedBinding(saved) {
  if (!saved?.manualArm || saved.expiresAt <= Date.now() || !Number.isInteger(saved.tabId)) throw new Error("SAVED_SESSION_INVALID");
  const page = await chrome.tabs.sendMessage(saved.tabId, {kind: "GET_PAGE_STATE"});
  if (!page?.ok || !page.adapterReady) throw new Error("PAGE_BINDING_DRIFT");
  if (typeof saved.conversationIdentity !== "string" || page.conversationIdentity !== saved.conversationIdentity) throw new Error("PAGE_BINDING_DRIFT");
  if (typeof saved.documentId !== "string" || page.documentId !== saved.documentId) throw new Error("PAGE_BINDING_DRIFT");
  return page;
}
async function rearmSaved(saved) {
  await validateSavedBinding(saved);
  const result = await nativeRequest("ARM_SESSION", {sessionId: saved.sessionId, extensionVersion: EXTENSION_VERSION, capabilities: CAPABILITIES});
  armed = {...saved, activeJobId: saved.activeJobId ?? null, state: saved.activeJobId ? "ACTIVE" : "ARMED", connection: "connected", lastError: null};
  reconnectAttempts = 0; reconnectDisabled = false; startHeartbeat();
  diagnosticOperation = diagnosticOperation.then(flushDiagnostics, flushDiagnostics).catch(() => {});
  return result;
}
function scheduleReconnect() {
  if (reconnectTimer !== null || reconnectDisabled || !armed) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) { armed.connection = "failed"; armed.lastError = "NATIVE_RECONNECT_EXHAUSTED"; return; }
  armed.connection = "reconnecting";
  const delay = reconnectDelay(reconnectAttempts++);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const snapshot = {...armed, manualArm: true};
    enqueueSessionOperation(() => rearmSaved(snapshot)).catch((error) => { if (armed) armed.lastError = error.message; try { port?.disconnect(); } catch {} port = null; scheduleReconnect(); });
  }, delay);
}
async function restoreSavedSession() {
  if (restorePromise) return restorePromise;
  restorePromise = enqueueSessionOperation(async () => {
    const saved = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
    if (!saved?.manualArm) return;
    armed = {...saved, activeJobId: saved.activeJobId ?? null, state: saved.activeJobId ? "ACTIVE" : "ARMED", connection: "reconnecting", lastError: null};
    try { await rearmSaved(saved); }
    catch (error) {
      if (error.message === "PAGE_BINDING_DRIFT" || error.message === "SAVED_SESSION_INVALID") await invalidateBinding(error.message);
      else { armed.lastError = error.message; scheduleReconnect(); }
    }
  });
  return restorePromise;
}
async function arm() {
  return enqueueSessionOperation(async () => {
    const saved = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
    const current = armed ?? (saved?.expiresAt > Date.now() ? saved : null);
    if (current?.activeJobId) throw new Error("ACTIVE_JOB_ARM_FORBIDDEN");
    if (current?.manualArm) throw new Error("SESSION_ALREADY_ARMED");
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) throw new Error("ACTIVE_TAB_NOT_CHATGPT");
    const state = await chrome.tabs.sendMessage(tab.id, {kind: "GET_PAGE_STATE"});
    if (!state?.ok || !state.adapterReady) throw new Error(state?.errorCode ?? "PAGE_ADAPTER_NOT_READY");
    if (typeof state.conversationIdentity !== "string") throw new Error("PAGE_IDENTITY_UNSUPPORTED");
    const sessionId = uuid();
    reconnectDisabled = false;
    const result = await nativeRequest("ARM_SESSION", {sessionId, extensionVersion: EXTENSION_VERSION, capabilities: CAPABILITIES});
    armed = {
      sessionId, tabId: tab.id, conversationIdentity: state.conversationIdentity,
      bindingGeneration: uuid(), documentId: state.documentId,
      activeJobId: null, state: "ARMED", manualArm: true, connection: "connected",
      lastError: null, expiresAt: Date.now() + 1_800_000,
    };
    reconnectAttempts = 0; startHeartbeat();
    await chrome.storage.local.set({[SESSION_KEY]: armed});
    diagnostic("info", "session_armed", {});
    return {sessionId, tabId: tab.id, leaseExpiresAt: result.leaseExpiresAt};
  });
}
async function releaseBinding(current = armed) {
  if (!current) return;
  if (armed?.sessionId === current.sessionId) armed = null;
  reconnectDisabled = true;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearHeartbeat();
  await chrome.storage.local.remove(SESSION_KEY);
  try { await nativeRequest("DISARM_SESSION", {sessionId: current.sessionId}); } catch {}
}
async function invalidateBinding(errorCode) {
  const current = armed;
  if (!current) return;
  armed = null;
  reconnectDisabled = true;
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearHeartbeat();
  await chrome.storage.local.remove(SESSION_KEY);
  if (current.activeJobId) {
    await chrome.storage.local.set({[PENDING_LOSS_KEY]: {
      sessionId: current.sessionId, jobId: current.activeJobId, errorCode,
      eventId: uuid(), sourceTimestamp: new Date().toISOString(),
    }});
    await deliverPendingSessionLoss();
  } else {
    try { await nativeRequest("DISARM_SESSION", {sessionId: current.sessionId}); } catch {}
  }
}
async function deliverPendingSessionLoss() {
  const pendingLoss = (await chrome.storage.local.get(PENDING_LOSS_KEY))[PENDING_LOSS_KEY];
  if (!pendingLoss?.sessionId || !pendingLoss?.jobId) return;
  try {
    await nativeRequest("SESSION_LOST", {sessionId: pendingLoss.sessionId, jobId: pendingLoss.jobId, errorCode: pendingLoss.errorCode});
    await nativeRequest("DISARM_SESSION", {sessionId: pendingLoss.sessionId});
    await chrome.storage.local.remove(PENDING_LOSS_KEY);
  } catch {
    setTimeout(() => { void deliverPendingSessionLoss(); }, 1_000);
  }
}
async function disarm() {
  return enqueueSessionOperation(async () => {
    const saved = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
    const current = armed ?? saved ?? null;
    if (current?.activeJobId) throw new Error("ACTIVE_JOB_DISARM_FORBIDDEN");
    reconnectDisabled = true; if (reconnectTimer !== null) clearTimeout(reconnectTimer); reconnectTimer = null; clearHeartbeat();
    armed = null; await chrome.storage.local.remove(SESSION_KEY);
    let disarmError = null;
    if (current?.sessionId) {
      try { await nativeRequest("DISARM_SESSION", {sessionId: current.sessionId}); }
      catch (error) { disarmError = error; }
    }
    port?.disconnect(); port = null; rejectPending(new Error("SESSION_DISARMED"));
    if (disarmError instanceof Error) throw disarmError;
    return {armed: false};
  });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.kind === "DIAGNOSTIC") {
    if (!armed || armed.state !== "ACTIVE" || sender?.tab?.id !== armed.tabId || message.jobId !== armed.activeJobId
      || message.bindingGeneration !== armed.bindingGeneration || message.documentId !== armed.documentId) {
      respond({ok: false, errorCode: "DIAGNOSTIC_SENDER_MISMATCH"});
      return;
    }
    diagnostic(message.level ?? "debug", message.event ?? "content_event", {...(message.details ?? {}), job_id: message.jobId}, "extension-content");
    respond({ok: true});
    return;
  }
  if (message.kind === "LIFECYCLE") {
    if (!armed) { respond({ok: false, errorCode: "SESSION_NOT_ARMED"}); return; }
    if (armed.state !== "ACTIVE" || !armed.activeJobId) { respond({ok: false, errorCode: "LIFECYCLE_JOB_NOT_ACTIVE"}); return; }
    if (sender?.tab?.id !== armed.tabId) { respond({ok: false, errorCode: "LIFECYCLE_SENDER_TAB_MISMATCH"}); return; }
    if (armed.activeJobId !== message.jobId) { respond({ok: false, errorCode: "LIFECYCLE_JOB_MISMATCH"}); return; }
    if (message.bindingGeneration !== armed.bindingGeneration || message.documentId !== armed.documentId) { respond({ok: false, errorCode: "LIFECYCLE_BINDING_MISMATCH"}); return; }
    diagnostic("info", "lifecycle_received", {job_id: message.jobId, message_type: message.type});
    sendLifecycle(message.type, message.jobId, message.errorCode, message.assistantOutput)
      .then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message}));
    return true;
  }
  if (message.kind === "POPUP_ARM") { arm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_DISARM") { disarm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_STATUS") respond({ok: true, state: armed ? {armed: true, sessionId: armed.sessionId, tabId: armed.tabId, activeJobId: armed.activeJobId, sessionState: armed.state, connection: armed.connection, lastError: armed.lastError} : {armed: false}});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (armed?.tabId !== tabId) return;
  void invalidateBinding("PAGE_CLOSED");
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (armed?.tabId !== tabId || (!changeInfo.url && changeInfo.status !== "complete")) return;
  if (changeInfo.url) {
    await invalidateBinding("PAGE_NAVIGATED_REARM_REQUIRED");
    return;
  }
  validateSavedBinding(armed).catch(async () => {
    await invalidateBinding("PAGE_BINDING_DRIFT");
  });
});
void restoreSavedSession();
void deliverPendingSessionLoss();
