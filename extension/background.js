"use strict";
const HOST_NAME = "dev.shanernerak.codex_web_review_relay";
const SCHEMA_VERSION = {major: 1, minor: 0};
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
let port = null;
let armed = null;
let heartbeat = null;
const pending = new Map();
function uuid() { return crypto.randomUUID(); }
async function identityHash(value) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), (entry) => entry.toString(16).padStart(2, "0")).join(""); }
function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => { const error = chrome.runtime.lastError?.message ?? "NATIVE_HOST_DISCONNECTED"; for (const {reject} of pending.values()) reject(new Error(error)); pending.clear(); port = null; clearInterval(heartbeat); heartbeat = null; armed = null; });
  return port;
}
function nativeRequest(type, fields = {}) {
  return new Promise((resolve, reject) => {
    const requestId = uuid(); pending.set(requestId, {resolve, reject}); ensurePort().postMessage({schemaVersion: SCHEMA_VERSION, type, requestId, ...fields});
    setTimeout(() => { if (!pending.has(requestId)) return; pending.delete(requestId); reject(new Error("NATIVE_REQUEST_TIMEOUT")); }, 5_000);
  });
}
async function onNativeMessage(message) {
  if (typeof message.responseToRequestId === "string" && pending.has(message.responseToRequestId)) { const request = pending.get(message.responseToRequestId); pending.delete(message.responseToRequestId); message.type === "ERROR" ? request.reject(new Error(message.errorCode ?? "NATIVE_ERROR")) : request.resolve(message); return; }
  if (!["DISPATCH_TRIGGER", "RECONCILE_TRIGGER"].includes(message.type) || !armed || message.sessionId !== armed.sessionId) return;
  armed.activeJobId = message.jobId;
  try {
    const response = await chrome.tabs.sendMessage(armed.tabId, {kind: message.type, jobId: message.jobId, envelope: message.envelope, deadline: message.deadline, conversationIdentity: armed.conversationIdentity, allowUnsentSend: message.allowUnsentSend});
    if (!response?.ok) await sendLifecycle("SEND_UNCERTAIN", message.jobId);
  } catch {
    await sendLifecycle("SEND_UNCERTAIN", message.jobId);
  }
}
async function sendLifecycle(type, jobId) {
  if (!armed) throw new Error("SESSION_NOT_ARMED");
  ensurePort().postMessage({schemaVersion: SCHEMA_VERSION, type, requestId: uuid(), sessionId: armed.sessionId, jobId});
  if (["TURN_IDLE", "SESSION_LOST", "SEND_UNCERTAIN", "TURN_TIMEOUT"].includes(type)) armed.activeJobId = null;
}
async function arm() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) throw new Error("ACTIVE_TAB_NOT_CHATGPT");
  const state = await chrome.tabs.sendMessage(tab.id, {kind: "GET_PAGE_STATE"});
  if (!state?.ok || !state.adapterReady) throw new Error(state?.errorCode ?? "PAGE_ADAPTER_NOT_READY");
  const conversationIdentity = state.conversationIdentity; const conversationIdentityHash = await identityHash(conversationIdentity);
  const saved = (await chrome.storage.session.get("relaySession")).relaySession;
  const sessionId = saved?.conversationIdentityHash === conversationIdentityHash && saved?.expiresAt > Date.now() ? saved.sessionId : uuid();
  const result = await nativeRequest("ARM_SESSION", {sessionId, conversationIdentity: conversationIdentityHash, extensionVersion: EXTENSION_VERSION});
  armed = {sessionId, conversationIdentity, conversationIdentityHash, tabId: tab.id, activeJobId: null}; clearInterval(heartbeat); heartbeat = setInterval(() => nativeRequest("HEARTBEAT", {sessionId}).catch(() => {}), 10_000);
  await chrome.storage.session.set({relaySession: {sessionId, conversationIdentity, conversationIdentityHash, tabId: tab.id, expiresAt: Date.now() + 1_800_000}});
  return {sessionId, conversationIdentityHash, tabId: tab.id, leaseExpiresAt: result.leaseExpiresAt};
}
async function disarm() { if (!armed) { await chrome.storage.session.remove("relaySession"); return {armed: false}; } await nativeRequest("DISARM_SESSION", {sessionId: armed.sessionId}); clearInterval(heartbeat); heartbeat = null; armed = null; await chrome.storage.session.remove("relaySession"); port?.disconnect(); port = null; return {armed: false}; }
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.kind === "LIFECYCLE") { sendLifecycle(message.type, message.jobId).then(() => respond({ok: true}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_ARM") { arm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_DISARM") { disarm().then((state) => respond({ok: true, state}), (error) => respond({ok: false, error: error.message})); return true; }
  if (message.kind === "POPUP_STATUS") respond({ok: true, state: armed ? {armed: true, sessionId: armed.sessionId, conversationIdentityHash: armed.conversationIdentityHash, tabId: armed.tabId, activeJobId: armed.activeJobId} : {armed: false}});
});
chrome.tabs.onRemoved.addListener((tabId) => { if (armed?.tabId === tabId && armed.activeJobId) sendLifecycle("SESSION_LOST", armed.activeJobId).catch(() => {}); });
