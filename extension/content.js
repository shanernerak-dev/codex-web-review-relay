(function () {
  "use strict";
  const adapter = globalThis.ReviewRelayDomAdapter;
  const PR_QUIET_IDLE_MS = 1_500;
  const PR_OUTPUT_STABILITY_MS = 1_500;
  const RELAY_ONLY_QUIET_IDLE_MS = 2_500;
  const RELAY_ONLY_OUTPUT_STABILITY_MS = 2_500;
  let active = null;
  function diagnostic(level, event, jobId, details = {}) {
    void chrome.runtime.sendMessage({kind: "DIAGNOSTIC", level, event, jobId, details}).catch(() => {});
  }
  async function sendLifecycle(type, job, errorCode = null, assistantOutput = null) {
    diagnostic("debug", "lifecycle_requested", job.jobId, {message_type: type, ...(errorCode ? {error_code: errorCode} : {}), ...(assistantOutput !== null ? {length: assistantOutput.length} : {})});
    const response = await chrome.runtime.sendMessage({kind: "LIFECYCLE", type, jobId: job.jobId, errorCode, ...(assistantOutput !== null ? {assistantOutput} : {})});
    if (response?.ok !== true) {
      diagnostic("error", "lifecycle_rejected", job.jobId, {message_type: type, error_code: response?.errorCode ?? response?.error ?? "LIFECYCLE_ACK_REJECTED"});
      throw new Error(response?.errorCode ?? response?.error ?? "LIFECYCLE_ACK_REJECTED");
    }
    diagnostic("debug", "lifecycle_acked", job.jobId, {message_type: type});
    return response;
  }
  function requireLiveDeadline(message) { if (!Number.isFinite(Date.parse(message.deadline)) || Date.now() >= Date.parse(message.deadline)) throw new Error("MESSAGE_DEADLINE_EXPIRED"); }

  function monitor(message, state, userAcked = false, assistantStarted = false) {
    const job = {jobId: message.jobId, deadline: Date.parse(message.deadline)};
    diagnostic("info", "monitor_started", job.jobId, {state: userAcked ? "reconcile" : "dispatch"});
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
    let nextIdleAttemptAt = 0;
    let idleSendPending = false;
    let userNode = state.user ?? null;
    let assistantNode = state.assistant ?? null;
    let assistantNodes = Array.isArray(state.assistants) ? state.assistants : (state.assistant ? [state.assistant] : []);
    let lastMutationAt = Date.now();
    const finish = () => { if (settled) return; settled = true; observer.disconnect(); clearInterval(timer); clearInterval(pollTimer); active = null; diagnostic("info", "monitor_finished", job.jobId); };
    const inspect = async () => {
      if (settled) return;
      if (inspectRunning) { inspectPending = true; return; }
      inspectRunning = true;
      try {
        do {
          inspectPending = false;
          if (!userAcked) {
            const observedUser = adapter.newTurn(document, state.baseline, "user", message.envelope);
            if (observedUser) { userNode = observedUser; diagnostic("info", "user_turn_observed", job.jobId); await sendLifecycle("USER_TURN_ACKED", job); userAcked = true; }
          }
          const observedAssistants = userAcked && userNode && typeof adapter.assistantTurnsAfter === "function"
            ? adapter.assistantTurnsAfter(document, userNode)
            : (userAcked && typeof adapter.newTurns === "function" ? adapter.newTurns(document, state.baseline, "assistant") : []);
          const observedAssistant = observedAssistants.length > 0
            ? observedAssistants[observedAssistants.length - 1]
            : (userAcked ? adapter.newTurn(document, state.baseline, "assistant") : null);
          if (observedAssistants.length > 0) assistantNodes = observedAssistants;
          if (observedAssistant) assistantNode = observedAssistant;
          if (userAcked && !assistantStarted && assistantNode) { diagnostic("info", "assistant_turn_observed", job.jobId, {count: assistantNodes.length || 1}); await sendLifecycle("ASSISTANT_STARTED", job); assistantStarted = true; assistantStartedAt = Date.now(); }
          if (assistantStarted && adapter.isGenerating(document)) observedGenerating = true;
          const now = Date.now();
          const generating = adapter.isGenerating(document);
          if (assistantStarted && generating) observedGenerating = true;
          const responseIdle = typeof adapter.isResponseIdle === "function"
            ? adapter.isResponseIdle(document)
            : adapter.isIdle(document);
          if (assistantStarted && !generating && responseIdle) {
            const output = adapter.rawTurnText(document, assistantNodes.length > 0 ? assistantNodes : assistantNode);
            if (output !== candidateOutput) {
              candidateOutput = output;
              candidateOutputSince = now;
            }
            const quiet = now - Math.max(lastMutationAt, assistantStartedAt) >= quietIdleMs;
            const stable = candidateOutput.length > 0 && now - candidateOutputSince >= outputStabilityMs;
            const completedEvidence = typeof adapter.isAssistantComplete === "function" && adapter.isAssistantComplete(document, assistantNodes.length > 0 ? assistantNodes : assistantNode);
            const completionObserved = relayOnly ? completedEvidence : (observedGenerating || now - assistantStartedAt >= outputStabilityMs);
            diagnostic("trace", "completion_snapshot", job.jobId, {length: candidateOutput.length, generating, response_idle: responseIdle, quiet, stable, completion_observed: completionObserved});
            if (quiet && stable && completionObserved && !idleSendPending && now >= nextIdleAttemptAt) {
              idleSendPending = true;
              try {
                await sendLifecycle("TURN_IDLE", job, null, candidateOutput);
                finish();
              } catch (error) {
                idleSendPending = false;
                nextIdleAttemptAt = Date.now() + 250;
                if (Date.now() >= job.deadline) throw error;
              }
            }
          }
        } while (inspectPending && !settled);
      } catch (error) {
        diagnostic("error", "monitor_failed", job.jobId, {error_code: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"});
        try { await sendLifecycle(userAcked ? "SESSION_LOST" : "SEND_UNCERTAIN", job, error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"); } catch {}
        finish();
      }
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
      if (observed.assistants?.length > 0 || observed.assistant) await sendLifecycle("ASSISTANT_STARTED", job);
      monitor(message, observed, true, Boolean(observed.assistants?.length > 0 || observed.assistant));
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
      if (message.kind === "GET_PAGE_STATE") { adapter.pageSupported(location); respond({ok: true, adapterReady: true, conversationIdentity: `${location.origin}${location.pathname}`}); }
      else if (message.kind === "DISPATCH_TRIGGER") { startDispatch(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else if (message.kind === "RECONCILE_TRIGGER") { startReconcile(message).then(() => respond({ok: true}), (error) => respond({ok: false, errorCode: error.message.split(":", 1)[0]})); return true; }
      else respond({ok: false, errorCode: "CONTENT_MESSAGE_UNSUPPORTED"});
    } catch (error) { respond({ok: false, errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_ERROR"}); }
  });
})();
