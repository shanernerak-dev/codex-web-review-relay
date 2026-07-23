(function () {
  "use strict";
  const adapter = globalThis.ReviewRelayDomAdapter;
  const PR_QUIET_IDLE_MS = 1_500;
  const PR_OUTPUT_STABILITY_MS = 1_500;
  const RELAY_ONLY_QUIET_IDLE_MS = 2_500;
  const RELAY_ONLY_OUTPUT_STABILITY_MS = 2_500;
  const DOCUMENT_ID = crypto.randomUUID();
  let active = null;
  function diagnostic(level, event, job, details = {}) {
    const jobId = typeof job === "string" ? job : job?.jobId;
    const bindingGeneration = typeof job === "object" ? job?.bindingGeneration : undefined;
    void chrome.runtime.sendMessage({kind: "DIAGNOSTIC", level, event, jobId, details, bindingGeneration, documentId: DOCUMENT_ID}).catch(() => {});
  }
  async function sendLifecycle(type, job, errorCode = null, assistantOutput = null) {
    diagnostic("info", "lifecycle_requested", job, {message_type: type, ...(errorCode ? {error_code: errorCode} : {}), ...(assistantOutput !== null ? {length: assistantOutput.length} : {})});
    const response = await chrome.runtime.sendMessage({kind: "LIFECYCLE", type, jobId: job.jobId, errorCode, bindingGeneration: job.bindingGeneration, documentId: DOCUMENT_ID, ...(assistantOutput !== null ? {assistantOutput} : {})});
    if (response?.ok !== true) {
      diagnostic("error", "lifecycle_rejected", job, {message_type: type, error_code: response?.errorCode ?? response?.error ?? "LIFECYCLE_ACK_REJECTED"});
      throw new Error(response?.errorCode ?? response?.error ?? "LIFECYCLE_ACK_REJECTED");
    }
    diagnostic("info", "lifecycle_acked", job, {message_type: type});
    return response;
  }
  async function sendLifecycleUntilAck(type, job, errorCode = null, assistantOutput = null) {
    while (true) {
      try { return await sendLifecycle(type, job, errorCode, assistantOutput); }
      catch (error) {
        if (Date.now() >= job.deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  function requireLiveDeadline(message) { if (!Number.isFinite(Date.parse(message.deadline)) || Date.now() >= Date.parse(message.deadline)) throw new Error("MESSAGE_DEADLINE_EXPIRED"); }

  function monitor(message, state, userAcked = false, assistantStarted = false) {
    const job = {jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration};
    diagnostic("info", "monitor_started", job, {state: userAcked ? "reconcile" : "dispatch"});
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
    if (userNode) userAcked = true;
    let assistantNode = state.assistant ?? null;
    let assistantNodes = Array.isArray(state.assistants) ? state.assistants : (state.assistant ? [state.assistant] : []);
    let lastMutationAt = Date.now();
    const finish = () => { if (settled) return; settled = true; observer.disconnect(); clearInterval(timer); clearInterval(pollTimer); active = null; diagnostic("info", "monitor_finished", job); };
    const inspect = async () => {
      if (settled) return;
      if (inspectRunning) { inspectPending = true; return; }
      inspectRunning = true;
      try {
        do {
          inspectPending = false;
          if (!userAcked) {
            const observedUser = adapter.newTurn(document, state.baseline, "user", message.envelope);
            if (observedUser) { userNode = observedUser; diagnostic("info", "user_turn_observed", job); await sendLifecycle("USER_TURN_ACKED", job); userAcked = true; }
          }
          const observedAssistants = userAcked && userNode && typeof adapter.assistantTurnsAfter === "function"
            ? adapter.assistantTurnsAfter(document, userNode)
            : (userAcked && typeof adapter.newTurns === "function" ? adapter.newTurns(document, state.baseline, "assistant") : []);
          const observedAssistant = observedAssistants.length > 0
            ? observedAssistants[observedAssistants.length - 1]
            : (userAcked ? adapter.newTurn(document, state.baseline, "assistant") : null);
          if (observedAssistants.length > 0) assistantNodes = observedAssistants;
          if (observedAssistant) assistantNode = observedAssistant;
          if (userAcked && !assistantStarted && assistantNode) { diagnostic("info", "assistant_turn_observed", job, {count: assistantNodes.length || 1}); await sendLifecycle("ASSISTANT_STARTED", job); assistantStarted = true; assistantStartedAt = Date.now(); }
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
            diagnostic("trace", "completion_snapshot", job, {length: candidateOutput.length, generating, response_idle: responseIdle, quiet, stable, completion_observed: completionObserved});
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
        diagnostic("error", "monitor_failed", job, {error_code: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"});
        if (Date.now() < job.deadline) {
          setTimeout(() => { void inspect(); }, 250);
        } else {
          try { await sendLifecycle(userAcked ? "TURN_TIMEOUT" : "SEND_UNCERTAIN", job, error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_MONITOR_ERROR"); } catch {}
          finish();
        }
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

  async function runDispatch(message) {
    diagnostic("info", "dispatch_started", {jobId: message.jobId, bindingGeneration: message.bindingGeneration});
    try {
      const state = await adapter.dispatch(document, message.envelope);
      const job = {jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration};
      diagnostic("info", "user_turn_observed", job);
      await sendLifecycleUntilAck("USER_TURN_ACKED", job);
      monitor(message, state, true);
    } catch (error) {
      const evidence = typeof adapter.turnObservation === "function" ? adapter.turnObservation(document, null, message.envelope) : {};
      diagnostic("error", "dispatch_receipt_missing", {jobId: message.jobId, bindingGeneration: message.bindingGeneration}, {...evidence, error_code: error instanceof Error ? error.message.split(":", 1)[0] : "DISPATCH_FAILED"});
      throw error;
    }
  }

  async function runReconcile(message) {
    const observed = adapter.reconcile(document, message.envelope);
    if (observed.state === "user-present") {
      const job = {jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration};
      await sendLifecycle("USER_TURN_ACKED", job);
      if (observed.assistants?.length > 0 || observed.assistant) await sendLifecycle("ASSISTANT_STARTED", job);
      monitor(message, observed, true, Boolean(observed.assistants?.length > 0 || observed.assistant));
      return;
    }
    if (observed.state === "draft-unsent" && message.allowUnsentSend === true) {
      monitor(message, await adapter.resumeDraft(document, message.envelope));
      return;
    }
    await sendLifecycle("RECONCILE_MISMATCH", {
      jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration,
    });
    active = null;
  }

  function acceptTrigger(message, operation) {
    if (active) throw new Error("CONTENT_JOB_ALREADY_ACTIVE");
    requireLiveDeadline(message);
    adapter.pageSupported(location);
    active = {jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration, starting: true};
    void operation(message).catch(async (error) => {
      const job = {jobId: message.jobId, deadline: Date.parse(message.deadline), bindingGeneration: message.bindingGeneration};
      try { await sendLifecycle("SEND_UNCERTAIN", job, error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_TRIGGER_FAILED"); } catch {}
      if (active?.jobId === message.jobId) active = null;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    try {
      if (message.kind === "GET_PAGE_STATE") { adapter.pageSupported(location); respond({ok: true, adapterReady: true, conversationIdentity: `${location.origin}${location.pathname}`, documentId: DOCUMENT_ID}); }
      else if (message.kind === "DISPATCH_TRIGGER") { acceptTrigger(message, runDispatch); respond({ok: true}); }
      else if (message.kind === "RECONCILE_TRIGGER") { acceptTrigger(message, runReconcile); respond({ok: true}); }
      else respond({ok: false, errorCode: "CONTENT_MESSAGE_UNSUPPORTED"});
    } catch (error) { respond({ok: false, errorCode: error instanceof Error ? error.message.split(":", 1)[0] : "CONTENT_ERROR"}); }
  });
})();
