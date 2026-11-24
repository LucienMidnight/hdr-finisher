function linkedSdrCreativeSignature(sdr) {
  return stablePreviewJson(Object.fromEntries(Object.entries(sdr || {}).filter(([key]) =>
    !key.startsWith("highlight_compression_") && !["linked_to_hdr", "output_exposure", "highlight_section_enabled"].includes(key))));
}

function renderLinkedSdrState() {
  if (state.localSdrUnlinkPending && state.localSdrUnlinkPending.sessionId !== state.session?.session_id) state.localSdrUnlinkPending = null;
  const linked = Boolean(state.adjustments?.sdr?.linked_to_hdr);
  if (els.sdrMatchEntireStatus && linked) els.sdrMatchEntireStatus.textContent = "Linked to HDR · HDR edits update SDR live. SDR creative edits unlink.";
  else if (els.sdrMatchEntireStatus && state.linkedSdrCreativeSnapshot) els.sdrMatchEntireStatus.textContent = "Independent SDR · Match SDR to try linking again.";
  const actions = els.sdrMatchEntireActions;
  if (!actions) return;
  actions.dataset.matched = String(Boolean(state.editDocument?.sdr_match?.materialized_status));
  if (linked) els.sdrMatchEntireStatus?.setAttribute("data-tooltip", "Uses HDR tone, colour, local adjustments and Film Look. SDR output exposure and Highlight Compression stay separate. Editing other SDR controls unlinks this photo.");
  else els.sdrMatchEntireStatus?.removeAttribute("data-tooltip");
  let controls = document.getElementById("sdr-link-controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.id = "sdr-link-controls";
    controls.className = "sdr-link-controls";
    const unlink = document.createElement("button");
    unlink.id = "sdr-unlink";
    unlink.type = "button";
    unlink.className = "button-secondary";
    unlink.textContent = "Unlink";
    unlink.setAttribute("data-tooltip", "Returns to the independent SDR grade. Match SDR tries to link again. Undo restores the link.");
    unlink.addEventListener("click", () => {
      state.adjustments.sdr.linked_to_hdr = false;
      invalidatePreview("sdr"); debouncePreview("sdr"); renderLaneChrome();
      void syncGlobalEditState();
    });
    const label = document.createElement("label");
    label.textContent = "SDR output exposure ";
    const input = document.createElement("input");
    input.id = "sdr-output-exposure";
    input.type = "number"; input.min = "-5"; input.max = "5"; input.step = "0.1";
    input.setAttribute("aria-label", "SDR output exposure in stops");
    input.setAttribute("data-tooltip", "Changes SDR brightness after the shared HDR Film Look. Keeps this photo linked.");
    input.addEventListener("change", () => commitAdjustmentValue("sdr.output_exposure", Number(input.value), { manual: true }));
    label.append(input); controls.append(unlink, label); actions.append(controls);
  }
  controls.classList.toggle("hidden", !linked);
  controls.querySelector("input").value = String(state.adjustments?.sdr?.output_exposure || 0);
  if (linked && !state.linkedSdrCreativeSnapshot) {
    state.linkedSdrCreativeSnapshot = linkedSdrCreativeSignature(state.adjustments.sdr);
    state.linkedSdrLocalSnapshot = new Map((state.editDocument?.local_adjustments || []).map(local => [local.id, stablePreviewJson(local.sdr_grade)]));
  } else if (!linked) {
    state.linkedSdrCreativeSnapshot = null;
    state.linkedSdrLocalSnapshot = null;
  }
}

function unlinkSdrCreativeDraft() {
  if (state.adjustments?.sdr?.linked_to_hdr && state.linkedSdrCreativeSnapshot
    && linkedSdrCreativeSignature(state.adjustments.sdr) !== state.linkedSdrCreativeSnapshot) {
    state.adjustments.sdr.linked_to_hdr = false;
    renderLinkedSdrState();
  }
}

async function setSdrMatch() {
  if (!state.session) return false;
  const diagnostics = globalThis.HDRDiagnostics;
  const action = diagnostics?.start("match", "match_sdr", gradeDiagnosticPhoto());
  try {
    const matched = await setSdrMatchWithDiagnostics(action);
    action?.finish(matched ? "success" : "cancelled", matched ? {} : { route: "refused", reason: "match_cancelled" });
    return matched;
  } catch (error) {
    action?.finish("error", { level: "error", route: "refused", reason: "match_failed" });
    throw error;
  }
}

async function setSdrMatchWithDiagnostics(action) {
  const sessionId = state.session.session_id;
  const isCurrent = () => state.session?.session_id === sessionId;
  if (await syncGlobalEditState() === false || !isCurrent()) return false;
  const protectedLocals = (state.editDocument?.local_adjustments || []).filter(local => local.sdr_match
    || stablePreviewJson(local.sdr_grade) !== stablePreviewJson(defaultLocalGrade("sdr")));
  if (protectedLocals.length) {
    const confirmed = await window.HDRDialogs.confirm(
      "Whole-picture Match replaces every SDR local, including individually matched or edited adjustments. Undo restores them.",
      { title: "Replace SDR local adjustments", confirmLabel: "Replace SDR locals" },
    );
    if (!confirmed || !isCurrent()) return false;
  }
  const authored = state.editDocument?.source?.luminance?.sdr_rendition === "authored";
  let consent = false;
  if (authored) {
    consent = await window.HDRDialogs.confirm(
      "This source contains an authored SDR rendition. Match will replace it with an editable generated SDR rendition. Undo restores the authored grade.",
      { title: "Replace authored SDR rendition", confirmLabel: "Continue" },
    );
    if (!consent || !isCurrent()) return false;
  }
  setIndeterminatePreviewMessage("Matching HDR grade · analyzing settled HDR proxy");
  if (els.sdrMatchEntire) els.sdrMatchEntire.disabled = true;
  try {
    // Match explores its candidates on this page's GPU while the
    // request waits; the backend still owns the fit and its final CPU check.
    const candidateRenderer = state.renderingMode !== "cpu" && state.gpuPreview?.available
      ? (state.sdrMatchCandidateRenderer || "gpu") : "cpu";
    globalThis.HDRDiagnostics?.event("match", "candidate_route", {
      route: candidateRenderer === "cpu" ? "cpu" : "gpu",
      reason: candidateRenderer === "cpu"
        ? (state.renderingMode === "cpu" ? "user_selected_cpu" : state.gpuPreview?.available ? "cpu_candidates_selected" : "gpu_unavailable")
        : "gpu_candidates_requested",
    }, action);
    let matchFinished = false;
    const request = fetch(`/api/session/${sessionId}/sdr-match`, {
      method: "POST",
      headers: globalThis.HDRDiagnostics?.headers(action, { "Content-Type": "application/json" }) ?? { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.editRevision,
        authored_sdr_override_consent: consent,
        gpu_candidates: candidateRenderer !== "cpu",
        verify_gpu_candidates: candidateRenderer === "verify",
      }),
    }).finally(() => { matchFinished = true; });
    if (candidateRenderer !== "cpu") {
      void serveSdrMatchCandidates(sessionId, state.editRevision, () => matchFinished || !isCurrent(), action);
    }
    const response = await request;
    const result = await safeJson(response);
    if (!isCurrent()) return false;
    if (response.status === 409) {
      await refreshEditState();
      if (!isCurrent()) return false;
      throw new Error(result?.detail?.message || "The grade changed while Match was analyzing it. Try again.");
    }
    if (!response.ok) throw new Error(responseErrorMessage(result, "SDR Match failed."));
    state.editRevision = result.revision;
    state.editDocument = result.document;
    recordAcknowledgedLocals(result.document);
    state.adjustments = result.document.global_adjustments;
    loadDenoiseDocument(state.editDocument);
    state.documentDirty = Boolean(result.dirty);
    // Match only changes the SDR rendition. Preserve the already-presented HDR
    // lane, especially in side-by-side mode, instead of blanking both panes.
    state.previewControllers.sdr?.abort();
    state.previewControllers.sdr = null;
    if (state.previewCache.sdr?.url) URL.revokeObjectURL(state.previewCache.sdr.url);
    state.previewCache.sdr = null;
    state.gpuPreparedLane.sdr = false;
    invalidatePreview("sdr", { markDirty: false });
    renderLaneChrome();
    renderLocalAdjustments();
    // A Match action is already a discrete, blocking operation. When SDR is
    // visible, render the selected preview tier directly instead of presenting
    // the bounded settled proxy and leaving 2K/4K to the idle refiner.
    if (state.currentView === "sdr") {
      const previewDeferred = await presentMatchedSdrPreview({
        hideStatus: false,
        longEdge: refinementProxyLongEdge(),
        tier: "refinement",
      });
      if (!isCurrent()) return false;
      if (previewDeferred && state.currentView === "sdr") {
        syncDesktopDocumentState();
        status.post({ id: "match", severity: "info", message: "HDR grade matched to SDR · preview updating." });
        return true;
      }
      if (state.currentView === "sdr") {
        await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "sdr" });
      }
    }
    if (!isCurrent()) return false;
    if (state.compareLayout !== "single") {
      const other = state.currentView === "hdr" ? "sdr" : "hdr";
      await renderComparisonPreview(other, { force: true });
    } else if (state.currentView === "hdr") {
      prepareInactivePreview();
    }
    if (!isCurrent()) return false;
    syncDesktopDocumentState();
    const reason = result.document.sdr_match?.link_fallback_reason;
    const message = state.adjustments.sdr.linked_to_hdr ? "SDR linked to HDR."
      : reason ? `Matched independently. This photo couldn’t be linked because ${reason}.` : "HDR grade matched to SDR.";
    status.post({ id: "match", severity: "success", message });
    return true;
  } catch (error) {
    if (!isCurrent()) return false;
    action?.finish("error", { level: "error", route: "refused", reason: "match_failed" });
    console.error(error);
    status.post({ id: "match", severity: "error", message: error.message });
    return false;
  } finally {
    if (isCurrent()) {
      hidePreviewMessage();
      renderLaneChrome();
    }
  }
}

/**
 * Put one rendition back to the state it had when the file was imported: its
 * grade, its Denoise and its side of every local adjustment. One undo step.
 */
async function revertRendition(lane) {
  if (!state.session) return false;
  const applied = await queueEditCommand("revert_rendition", { lane });
  if (applied) {
    syncDesktopDocumentState();
    status.post({ id: "edit", severity: "success", message: `${lane.toUpperCase()} rendition reverted to its original state.` });
  }
  return applied;
}

function renderLocalSdrMatch(local, pendingSelected = false) {
  const actions = document.getElementById("local-sdr-match-actions");
  if (!actions) return;
  actions.classList.toggle("hidden", state.currentView !== "sdr" || !local || pendingSelected);
  const button = document.getElementById("local-sdr-match");
  button.disabled = !state.session || !local || unusedLocal(local) || Boolean(state.localSdrMatchBusy);
  button.textContent = state.localSdrMatchBusy ? "Matching…" : "Match SDR";
  const explanation = state.adjustments?.sdr?.linked_to_hdr
    ? "Fits this adjustment in independent SDR. A changed result unlinks this photo; no change keeps the link. The mask stays unchanged."
    : "Matches this adjustment only. Global grade and mask stay unchanged.";
  document.getElementById("local-sdr-match-explanation").textContent = explanation;
  button.setAttribute("data-tooltip", explanation);
  button.setAttribute("aria-label", `Match SDR for ${local?.name || "selected adjustment"}`);
  document.getElementById("local-sdr-match-parent").textContent = local?.name || "";
  const indicator = document.getElementById("local-sdr-match-status");
  indicator.dataset.outdated = String(Boolean(local?.sdr_match?.out_of_date));
  indicator.textContent = state.adjustments?.sdr?.linked_to_hdr
    ? "Linked to HDR · SDR local edits unlink this photo."
    : local?.sdr_match?.out_of_date
    ? "Out of date · grade, mask or stack changed. Match again to update."
    : local?.sdr_match ? "Individually matched to SDR" : "";
}

async function matchSelectedLocalSdr() {
  if (!state.session || state.localSdrMatchBusy) return false;
  const sessionId = state.session.session_id;
  const targetId = selectedLocal()?.id;
  if (!targetId || unusedLocal()) return false;
  const diagnostics = globalThis.HDRDiagnostics;
  const action = diagnostics?.start("match", "match_local_sdr", gradeDiagnosticPhoto());
  const current = () => state.session?.session_id === sessionId;
  const panel = document.getElementById("grade-workflow-panel");
  const wasInert = panel?.inert;
  if (panel) panel.inert = true;
  state.localSdrMatchBusy = true;
  renderLocalSdrMatch(selectedLocal());
  try {
    if (await syncGlobalEditState() === false || !current()) return false;
    if (state.editCommandQueue && await state.editCommandQueue === false) return false;
    if (!current()) return false;
    const response = await fetch(`/api/session/${sessionId}/local/${encodeURIComponent(targetId)}/sdr-match`, {
      method: "POST",
      headers: diagnostics?.headers(action, { "Content-Type": "application/json" }) ?? { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: state.editRevision }),
    });
    const result = await safeJson(response);
    if (!current()) return false;
    if (!response.ok) {
      if (response.status === 409) await refreshEditState();
      if (!current()) return false;
      throw new Error(responseErrorMessage(result, "Local SDR Match failed. Previous settings are unchanged."));
    }
    await refreshEditState();
    if (!current()) return false;
    if (result.changed) {
      invalidatePreview("sdr", { markDirty: false });
      debouncePreview("sdr");
      syncDesktopDocumentState();
    }
    status.post({ id: "match", severity: result.changed ? "success" : "info", message: result.message });
    action?.finish("success", { changed: Boolean(result.changed) });
    return Boolean(result.changed);
  } catch (error) {
    if (current()) action?.finish("error", { level: "error", route: "refused", reason: "match_failed" });
    if (current()) status.post({ id: "match", severity: "attention", message: error.message });
    return false;
  } finally {
    action?.finish("cancelled", { route: "refused", reason: "match_cancelled" });
    if (panel) panel.inert = wasInert;
    state.localSdrMatchBusy = false;
    if (current()) renderLocalSdrMatch(selectedLocal());
  }
}

/**
 * Render the candidates a running Match asks for on this page's GPU.
 *
 * The backend offers one recipe at a time and waits for its pixels. An empty
 * answer, or no answer, makes it run the whole fit on the CPU instead, so
 * nothing here needs to succeed for Match to finish.
 */
async function serveSdrMatchCandidates(sessionId, revision, finished, action) {
  const endpoint = `/api/session/${sessionId}/sdr-match/candidate`;
  const sourceSize = { width: state.session.source.width, height: state.session.source.height };
  let locals = [];
  let seen = false;
  const timings = state.sdrMatchCandidateTimings = [];
  while (!finished()) {
    let response;
    const polledAt = performance.now();
    try {
      response = await fetch(`${endpoint}?wait_ms=500`, { headers: globalThis.HDRDiagnostics?.headers(action) });
    } catch (_) {
      return;
    }
    if (response.status === 204) {
      // No bridge yet (the Match request has not reached the backend) or no
      // longer (it finished, or fell back to the CPU).
      if (response.headers.get("X-Match-Active") !== "1") {
        if (seen) return;
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      } else {
        seen = true;
      }
      continue;
    }
    if (!response.ok) return;
    seen = true;
    const job = await response.json();
    const receivedAt = performance.now();
    if (job.local_adjustments) locals = job.local_adjustments;
    let pixels = null;
    let candidateTiming = null;
    let anchor = "";
    try {
      const candidate = state.session?.session_id === sessionId
        ? await state.gpuPreview.renderMatchCandidate(
          sessionId, job.adjustments, sampleCurvePoints, locals, revision, projectReferenceWhiteNits(),
          sourceSize, job.long_edge, { width: job.width, height: job.height },
        )
        : null;
      pixels = candidate?.pixels || null;
      candidateTiming = candidate ? { renderMs: candidate.renderMs, readbackMs: candidate.readbackMs } : null;
      if (Number.isFinite(candidate?.anchor)) anchor = `&anchor=${candidate.anchor}`;
    } catch (error) {
      console.warn("Match candidate could not be rendered on the GPU", error);
    }
    try {
      await fetch(`${endpoint}/${job.job_id}?width=${job.width}&height=${job.height}${anchor}`, {
        method: "POST",
        headers: globalThis.HDRDiagnostics?.headers(action, { "Content-Type": "application/octet-stream" }) ?? { "Content-Type": "application/octet-stream" },
        // Half-float RGB, as a Blob: the desktop shell uploads a Blob about
        // twice as fast as the same bytes in an ArrayBuffer.
        body: pixels ? new Blob([pixels]) : new ArrayBuffer(0),
      });
    } catch (_) {
      return;
    }
    if (!pixels) {
      globalThis.HDRDiagnostics?.event("match", "candidate_fallback", {
        level: "warn", route: "cpu", reason: "gpu_candidate_unavailable",
      }, action);
      return;
    }
    // How one candidate's time divides between waiting for the backend to ask,
    // rendering, reading back and returning the pixels.
    timings.push({ waitMs: receivedAt - polledAt, ...candidateTiming, totalMs: performance.now() - polledAt });
  }
}

async function presentMatchedSdrPreview(options) {
  const sessionId = state.session?.session_id;
  const generation = state.previewGeneration.sdr;
  const current = () => state.session?.session_id === sessionId
    && state.previewGeneration.sdr === generation && state.currentView === "sdr";
  const presented = () => current()
    && state.acceptedPresentation?.lane === "sdr"
    && state.acceptedPresentation.generation === generation
    && state.acceptedPresentation.exact
    && state.acceptedPresentation.processedLongEdge === options.longEdge
    && state.acceptedPresentation.geometrySignature === geometrySignature();
  if (!current()) return true;
  if (presented()) return false;
  let rendered = await renderGpuDraft("sdr", options);
  // Peak/mask work can supersede the first presentation after Match. As in
  // settlePreview, drain pending work and retry once before choosing CPU.
  if (!rendered && transientGpuRefusal() && current()) {
    const edits = state.editCommandQueue;
    const editsReady = !edits || await edits !== false;
    const pending = state.gpuDraftInFlight;
    if (pending) await pending.catch(() => null);
    if (presented()) return false;
    if (editsReady && current()) {
      rendered = await renderGpuDraft("sdr", options);
    }
  }
  if (!current()) return true;
  if (!rendered) {
    if (previewSourceCapacityRefused()) return true;
    if (transientGpuRefusal()) {
      // A second cancellation still has no CPU failure to recover from. Arm
      // real replacement work rather than claiming an exact frame is ready.
      debouncePreview("sdr");
      return true;
    }
    await renderPreviewForLane("sdr", true, options.longEdge, {
      progressSteps: [20, 60, 90],
      denoiseFallback: state.denoise?.sdr?.enabled,
    });
  }
  return false;
}

/**
 * JSON with object keys sorted, so two documents with the same values compare
 * equal whatever order the backend wrote their keys in.
 */
/**
 * Remember the spatial mask of every local as the backend acknowledged it.
 *
 * The local-mask endpoint rasterizes the committed document, but the GPU
 * caches masks under the identity of the leaf it is rendering, which can be
 * newer (a Feather drag commits only on release). Mask paths match the
 * backend's dot-separated child indexes.
 */
