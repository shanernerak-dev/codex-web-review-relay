(function () {
  "use strict";
  const adapter = globalThis.ReviewRelayDomAdapter;
  const PR_QUIET_IDLE_MS = 1_500;
  const PR_OUTPUT_STABILITY_MS = 1_500;
  const RELAY_ONLY_QUIET_IDLE_MS = 2_500;
  const RELAY_ONLY_OUTPUT_STABILITY_MS = 2_500;
  let active = null;
  function sendLifecycle(type, job, errorCode = null, assistantOutput = null) { return chrome.runtime.sendMessage({kind: "LIFECYCLE", type, jobId: job.jobId, errorCode, ...(assistantOutput !== null ? {assistantOutput} : {})}); }
  function requireLiveDeadline(message) { if (!Number.isFinite(Date.parse(message.deadline)) || Date.now() >= Date.parse(message.deadline)) throw new Error("MESSAGE_DEADLINE_EXPIRED"); }

  function monitor(message, state, userAcked = false, assistantStarted = false) {
    const job = {jobId: message.jobId, deadline: Date.parse(message.deadline)};
    const relayOnly = message.reviewMode === "relay-only";
    const quietIdleMs = relayOnly ? RELAY_ONLY_QUIET_IDLE_MS : PR_QUIET_IDLE_MS;
    const outputStabilityMs = relayOnly ? RELAY_ONLY_OUTPUT_STABILITY_MS : PR_OUTPUT_STABILITY_MS;
    active = job;
    let settled = false;
    let inspectRunning = false;
    let inspectPending = false;
    let observedGenerating = false;
    let assistantStartedAt = 0;
    let candidateOutput = "";
    let candidateOutputSince = 0;
    let assistantNode = state.assistant ?? null;
    let lastMutationAt = Date.now();
    const finish = () => { if (settled) return; settled = true; observer.disconnect(); clearInterval(timer); clearInterval(pollTimer); active = null; };
    const inspect = async () => {
      if (settled) return;
      if (inspectRunning) { inspectPending = true; return; }
      inspectRunning = true;
      try {
        do {
          inspectPending = false;
          if (!userAcked && adapter.newTurn(document, state.baseline, "user", message.envelope)) { await sendLifecycle("USER_TURN_ACKED", job); userAcked = true; }
          const observedAssistant = userAcked ? adapter.newTurn(document, state.baseline, "assistant") : null;
          if (observedAssistant) assistantNode = observedAssistant;
          if (userAcked && !assistantStarted && assistantNode) { await sendLifecycle("ASSISTANT_STARTED", job); assistantStarted = true; assistantStartedAt = Date.now(); }
          if (assistantStarted && adapter.isGenerating(document)) observedGenerating = true;
          const now = Date.now();
          const generating = adapter.isGenerating(document);
          if (assistantStarted && generating) observedGenerating = true;
          const responseIdle = typeof adapter.isResponseIdle === "function"
            ? adapter.isResponseIdle(document)
            : adapter.isIdle(document);
          if (assistantStarted && !generating && responseIdle) {
            const output = adapter.rawTurnText(document, assistantNode);
            if (output !== candidateOutput) {
              candidateOutput = output;
              candidateOutputSince = now;
            }
            const quiet = now - Math.max(lastMutationAt, assistantStartedAt) >= quietIdleMs;
            const stable = candidateOutput.length > 0 && now - candidateOutputSince >= outputStabilityMs;
            const completedEvidence = typeof adapter.isAssistantComplete === "function" && adapter.isAssistantComplete(document, assistantNode);
            const completionObserved = relayOnly ? completedEvidence : (observedGenerating || now - assistantStartedAt >= outputStabilityMs);
            if (quiet && stable && completionObserved) { await sendLifecycle("TURN_IDLE", job, null, candidateOutput); finish(); }
          }
        } while (inspectPending && !settled);
      } catch (error) { await sendLifecycle(userAcked ? "SESSION_LOST" : "SEND_UNCERTAIN", job, error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"); finish(); }
      finally { inspectRunning = false; }
    };
    const observer = new MutationObserver(() => {
      lastMutationAt = Date.now();
      void inspect();
    });
    observer.observe(document.documentElement, {childList: true, subtree: true, characterData: true});
    const timer = setInterval(() => {
      if (Date.now() < job.deadline || settled) return;
      void sendLifecycle(userAcked ? "TURN_TIMEOUT" : "SEND_UNCERTAIN", job).finally(finish);
    }, 250);
    const pollTimer = setInterval(() => { void inspect(); }, 250);
    void inspect();
  }

  async function startDispatch(message) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    requireLiveDeadline(message);
    adapter.pageSupported(location);
    monitor(message, await adapter.dispatch(document, message.envelope));
  }

  async function startReconcile(message) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    requireLiveDeadline(message);
    adapter.pageSupported(location);
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
      if (message.kind === "GET_PAGE_STATE") { adapter.pageSupported(location); respond({ok: true, adapterReady: true}); }
      else if (message.kind === "DISPATCH_TRIGGER") { startDispatch(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else if (message.kind === "RECONCILE_TRIGGER") { startReconcile(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else respond({ok: false, errorCode: "CONTENT_MESSAGE_UNSUPPORTED"});
    } catch (error) { respond({ok: false, errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_ERROR"}); }
  });
})();
