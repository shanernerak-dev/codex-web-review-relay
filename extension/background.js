"use strict";
const HOST_NAME = "dev.shanernerak.codex_web_review_relay";
const SCHEMA_VERSION = {major: 1, minor: 0};
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const SESSION_KEY = "relaySession";
const MAX_RECONNECT_ATTEMPTS = 5;
let port = null;
let armed = null;
let heartbeat = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let reconnectDisabled = false;
let restorePromise = null;
const pending = new Map();
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
async function onNativeMessage(message) {
  if (typeof message.responseToRequestId === "string" && pending.has(message.responseToRequestId)) {
    const request = pending.get(message.responseToRequestId); pending.delete(message.responseToRequestId); clearTimeout(request.timer);
    message.type === "ERROR" ? request.reject(new Error(message.errorCode ?? "NATIVE_ERROR")) : request.resolve(message); return;
  }
  if (!["DISPATCH_TRIGGER", "RECONCILE_TRIGGER"].includes(message.type) || !armed || message.sessionId !== armed.sessionId) return;
  armed.activeJobId = message.jobId;
  await persistArmed();
  try {
    const page = await chrome.tabs.sendMessage(armed.tabId, {kind: "GET_PAGE_STATE"});
    if (!page?.ok || !page.adapterReady) throw new Error("PAGE_BINDING_DRIFT");
    const response = await chrome.tabs.sendMessage(armed.tabId, {kind: message.type, jobId: message.jobId, envelope: message.envelope, deadline: message.deadline, allowUnsentSend: message.allowUnsentSend});
    if (!response?.ok) throw new Error(response?.errorCode ?? "CONTENT_DISPATCH_REJECTED");
    ensurePort().postMessage({schemaVersion: SCHEMA_VERSION, type: `${message.type}_ACCEPTED`, responseToRequestId: message.requestId, sessionId: armed.sessionId, jobId: message.jobId});
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_DISPATCH_ERROR";
    if (armed) { armed.lastError = errorCode; await persistArmed(); }
    await sendLifecycle("SEND_UNCERTAIN", message.jobId, errorCode);
  }
}
async function sendLifecycle(type, jobId, errorCode = null) {
  if (!armed) throw new Error("SESSION_NOT_ARMED");
  await nativeRequest(type, {sessionId: armed.sessionId, jobId, ...(errorCode ? {errorCode} : {})});
  if (["TURN_IDLE", "SESSION_LOST", "SEND_UNCERTAIN", "TURN_TIMEOUT"].includes(type)) { armed.activeJobId = null; await persistArmed(); }
}
async function validateSavedBinding(saved) {
  if (!saved?.manualArm || saved.expiresAt <= Date.now() || !Number.isInteger(saved.tabId)) throw new Error("SAVED_SESSION_INVALID");
  const page = await chrome.tabs.sendMessage(saved.tabId, {kind: "GET_PAGE_STATE"});
  if (!page?.ok || !page.adapterReady) throw new Error("PAGE_BINDING_DRIFT");
  return page;
}
async function rearmSaved(saved) {
  await validateSavedBinding(saved);
  const result = await nativeRequest("ARM_SESSION", {sessionId: saved.sessionId, extensionVersion: EXTENSION_VERSION});
  armed = {...saved, activeJobId: saved.activeJobId ?? null, bindingValid: true, connection: "connected", lastError: null};
  reconnectAttempts = 0; reconnectDisabled = false; startHeartbeat();
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
    rearmSaved(snapshot).catch((error) => { if (armed) armed.lastError = error.message; try { port?.disconnect(); } catch {} port = null; scheduleReconnect(); });
  }, delay);
}
async function restoreSavedSession() {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const saved = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
    if (!saved?.manualArm) return;
    armed = {...saved, activeJobId: saved.activeJobId ?? null, bindingValid: true, connection: "reconnecting", lastError: null};
    try { await rearmSaved(saved); }
    catch (error) { armed.lastError = error.message; scheduleReconnect(); }
  })();
  return restorePromise;
}
async function arm() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) throw new Error("ACTIVE_TAB_NOT_CHATGPT");
  const state = await chrome.tabs.sendMessage(tab.id, {kind: "GET_PAGE_STATE"});
  if (!state?.ok || !state.adapterReady) throw new Error(state?.errorCode ?? "PAGE_ADAPTER_NOT_READY");
  const saved = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  const sessionId = saved?.tabId === tab.id && saved?.expiresAt > Date.now() ? saved.sessionId : uuid();
  reconnectDisabled = false;
  const result = await nativeRequest("ARM_SESSION", {sessionId, extensionVersion: EXTENSION_VERSION});
  armed = {sessionId, tabId: tab.id, activeJobId: null, manualArm: true, bindingValid: true, connection: "connected", lastError: null, expiresAt: Date.now() + 1_800_000};
  reconnectAttempts = 0; startHeartbeat();
  await chrome.storage.local.set({[SESSION_KEY]: armed});
  return {sessionId, tabId: tab.id, leaseExpiresAt: result.leaseExpiresAt};
}
async function disarm() {
  reconnectDisabled = true; if (reconnectTimer !== null) clearTimeout(reconnectTimer); reconnectTimer = null; clearHeartbeat();
  const current = armed; armed = null; await chrome.storage.local.remove(SESSION_KEY);
  if (current && port) await nativeRequest("DISARM_SESSION", {sessionId: current.sessionId}).catch(() => {});
  port?.disconnect(); port = null; rejectPending(new Error("SESSION_DISARMED")); return {armed: false};
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.kind === "LIFECYCLE") { sendLifecycle(message.type, message.jobId, message.errorCode).then(() => respond({ok: true}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_ARM") { arm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_DISARM") { disarm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_STATUS") respond({ok: true, state: armed ? {armed: true, sessionId: armed.sessionId, tabId: armed.tabId, activeJobId: armed.activeJobId, connection: armed.connection, bindingValid: armed.bindingValid, lastError: armed.lastError} : {armed: false}});
});
chrome.tabs.onRemoved.addListener((tabId) => { if (armed?.tabId === tabId && armed.activeJobId) sendLifecycle("SESSION_LOST", armed.activeJobId).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (armed?.tabId !== tabId || (!changeInfo.url && changeInfo.status !== "complete")) return;
  if (changeInfo.url) {
    const jobId = armed?.activeJobId; if (armed) { armed.bindingValid = false; armed.lastError = "PAGE_NAVIGATED_REARM_REQUIRED"; }
    if (jobId) sendLifecycle("SESSION_LOST", jobId).catch(() => {});
    return;
  }
  validateSavedBinding(armed).catch(async () => {
    const jobId = armed?.activeJobId; if (armed) { armed.bindingValid = false; armed.lastError = "PAGE_BINDING_DRIFT"; }
    if (jobId) await sendLifecycle("SESSION_LOST", jobId).catch(() => {});
  });
});
void restoreSavedSession();
