(function () {
  "use strict";
  const adapter = globalThis.ReviewRelayDomAdapter;
  let active = null;
  function sendLifecycle(type, job) { return chrome.runtime.sendMessage({kind: "LIFECYCLE", type, jobId: job.jobId}); }

  function monitor(message, state, userAcked = false, assistantStarted = false) {
    const job = {jobId: message.jobId, deadline: Date.parse(message.deadline)};
    active = job;
    let settled = false;
    const finish = () => { if (settled) return; settled = true; observer.disconnect(); clearInterval(timer); active = null; };
    const inspect = async () => {
      if (settled) return;
      try {
        if (!userAcked && adapter.newTurn(document, state.baseline, "user", message.envelope)) { userAcked = true; await sendLifecycle("USER_TURN_ACKED", job); }
        if (userAcked && !assistantStarted && adapter.newTurn(document, state.baseline, "assistant")) { assistantStarted = true; await sendLifecycle("ASSISTANT_STARTED", job); }
        if (assistantStarted && adapter.isIdle(document)) { await sendLifecycle("TURN_IDLE", job); finish(); }
      } catch { await sendLifecycle(userAcked ? "SESSION_LOST" : "SEND_UNCERTAIN", job); finish(); }
    };
    const observer = new MutationObserver(() => { void inspect(); });
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    const timer = setInterval(() => {
      if (Date.now() < job.deadline || settled) return;
      void sendLifecycle(userAcked ? "TURN_TIMEOUT" : "SEND_UNCERTAIN", job).finally(finish);
    }, 250);
    void inspect();
  }

  function startDispatch(message) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    if (adapter.conversationIdentity(location) !== message.conversationIdentity) throw new Error("PAGE_IDENTITY_MISMATCH");
    monitor(message, adapter.dispatch(document, message.envelope));
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
      monitor(message, adapter.resumeDraft(document, message.envelope));
      return;
    }
    await sendLifecycle("RECONCILE_MISMATCH", {jobId: message.jobId});
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    try {
      if (message.kind === "GET_PAGE_STATE") respond({ok: true, conversationIdentity: adapter.conversationIdentity(location), adapterReady: true});
      else if (message.kind === "DISPATCH_TRIGGER") { startDispatch(message); respond({ok: true}); }
      else if (message.kind === "RECONCILE_TRIGGER") { startReconcile(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else respond({ok: false, errorCode: "CONTENT_MESSAGE_UNSUPPORTED"});
    } catch (error) { respond({ok: false, errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_ERROR"}); }
  });
})();
