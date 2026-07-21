(function () {
  "use strict";
  const adapter = globalThis.ReviewRelayDomAdapter;
  let active = null;
  function sendLifecycle(type, job, errorCode = null) { return chrome.runtime.sendMessage({kind: "LIFECYCLE", type, jobId: job.jobId, errorCode}); }

  function monitor(message, state, userAcked = false, assistantStarted = false) {
    const job = {jobId: message.jobId, deadline: Date.parse(message.deadline)};
    active = job;
    let settled = false;
    let inspectRunning = false;
    let inspectPending = false;
    let observedGenerating = false;
    let assistantStartedAt = 0;
    let lastMutationAt = Date.now();
    let quietTimer = null;
    const finish = () => { if (settled) return; settled = true; observer.disconnect(); clearInterval(timer); if (quietTimer !== null) clearTimeout(quietTimer); active = null; };
    const inspect = async () => {
      if (settled) return;
      if (inspectRunning) { inspectPending = true; return; }
      inspectRunning = true;
      try {
        do {
          inspectPending = false;
          if (!userAcked && adapter.newTurn(document, state.baseline, "user", message.envelope)) { await sendLifecycle("USER_TURN_ACKED", job); userAcked = true; }
          if (userAcked && !assistantStarted && adapter.newTurn(document, state.baseline, "assistant")) { await sendLifecycle("ASSISTANT_STARTED", job); assistantStarted = true; assistantStartedAt = Date.now(); }
          if (assistantStarted && adapter.isGenerating(document)) observedGenerating = true;
          const quiet = Date.now() - Math.max(lastMutationAt, assistantStartedAt) >= 750;
          if (assistantStarted && !adapter.isGenerating(document) && adapter.isIdle(document) && quiet) { await sendLifecycle("TURN_IDLE", job); finish(); }
        } while (inspectPending && !settled);
      } catch (error) { await sendLifecycle(userAcked ? "SESSION_LOST" : "SEND_UNCERTAIN", job, error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"); finish(); }
      finally { inspectRunning = false; }
    };
    const observer = new MutationObserver(() => {
      lastMutationAt = Date.now();
      if (quietTimer !== null) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { void inspect(); }, 775);
      void inspect();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    const timer = setInterval(() => {
      if (Date.now() < job.deadline || settled) return;
      void sendLifecycle(userAcked ? "TURN_TIMEOUT" : "SEND_UNCERTAIN", job).finally(finish);
    }, 250);
    void inspect();
  }

  async function startDispatch(message) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    if (adapter.conversationIdentity(location) !== message.conversationIdentity) throw new Error("PAGE_IDENTITY_MISMATCH");
    monitor(message, await adapter.dispatch(document, message.envelope));
  }

  async function startReconcile(message) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    if (adapter.conversationIdentity(location) !== message.conversationIdentity) throw new Error("PAGE_IDENTITY_MISMATCH");
    const observed = adapter.reconcile(document, message.envelope);
    if (observed.state === "user-present") {
      const job = {jobId: message.jobId, deadline: Date.parse(message.deadline)};
      await sendLifecycle("USER_TURN_ACKED", job);
      if (observed.assistant) await sendLifecycle("ASSISTANT_STARTED", job);
      monitor(message, observed, true, Boolean(observed.assistant));
      return;
    }
    if (observed.state === "draft-unsent" && message.allowUnsentSend === true) {
      monitor(message, await adapter.resumeDraft(document, message.envelope));
      return;
    }
    await sendLifecycle("RECONCILE_MISMATCH", {jobId: message.jobId});
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    try {
      if (message.kind === "GET_PAGE_STATE") respond({ok: true, conversationIdentity: adapter.conversationIdentity(location), adapterReady: true});
      else if (message.kind === "DISPATCH_TRIGGER") { startDispatch(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else if (message.kind === "RECONCILE_TRIGGER") { startReconcile(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else respond({ok: false, errorCode: "CONTENT_MESSAGE_UNSUPPORTED"});
    } catch (error) { respond({ok: false, errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_ERROR"}); }
  });
})();
