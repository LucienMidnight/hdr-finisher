async function setSdrMatch() {
  if (!state.session) return false;
  if (await syncGlobalEditState() === false) return false;
  const authored = state.editDocument?.source?.luminance?.sdr_rendition === "authored";
  let consent = false;
  if (authored) {
    consent = await window.HDRDialogs.confirm(
      "This source contains an authored SDR rendition. Match will replace it with an editable generated SDR rendition. Undo restores the authored grade.",
      { title: "Replace authored SDR rendition", confirmLabel: "Continue" },
    );
    if (!consent) return false;
  }
  setIndeterminatePreviewMessage("Matching HDR grade · analyzing settled HDR proxy");
  if (els.sdrMatchEntire) els.sdrMatchEntire.disabled = true;
  try {
    // Match explores its candidates on this page's GPU while the
    // request waits; the backend still owns the fit and its final CPU check.
    const candidateRenderer = state.renderingMode !== "cpu" && state.gpuPreview?.available
      ? (state.sdrMatchCandidateRenderer || "gpu") : "cpu";
    let matchFinished = false;
    const request = fetch(`/api/session/${state.session.session_id}/sdr-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.editRevision,
        authored_sdr_override_consent: consent,
        gpu_candidates: candidateRenderer !== "cpu",
        verify_gpu_candidates: candidateRenderer === "verify",
      }),
    }).finally(() => { matchFinished = true; });
    if (candidateRenderer !== "cpu") {
      void serveSdrMatchCandidates(state.session.session_id, state.editRevision, () => matchFinished);
    }
    const response = await request;
    const result = await safeJson(response);
    if (response.status === 409) {
      await refreshEditState();
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
    const previewLongEdge = state.currentView === "sdr"
      ? refinementProxyLongEdge()
      : settledProxyLongEdge();
    const previewTier = previewLongEdge >= refinementProxyLongEdge() ? "refinement" : "settled";
    if (state.denoise.sdr.enabled) await recalculateDenoise("sdr");
    const gpuOptions = {
      hideStatus: false,
      longEdge: previewLongEdge,
      allowInactive: state.currentView !== "sdr",
      tier: previewTier,
    };
    const previewDeferred = await presentMatchedSdrPreview(gpuOptions);
    if (previewDeferred) {
      syncDesktopDocumentState();
      status.post({ id: "match", severity: "info", message: "HDR grade matched to SDR · preview updating." });
      return true;
    }
    // Scopes describe the lane on screen. With HDR showing, an SDR scope
    // could only come from a whole-picture CPU grade that nothing displays;
    // switching to SDR measures it from the GPU picture instead.
    if (state.currentView === "sdr") {
      await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "sdr" });
    }
    if (state.compareLayout !== "single") {
      const other = state.currentView === "hdr" ? "sdr" : "hdr";
      await renderComparisonPreview(other, { force: true });
    }
    syncDesktopDocumentState();
    status.post({ id: "match", severity: "success", message: "HDR grade matched to SDR." });
    return true;
  } catch (error) {
    console.error(error);
    status.post({ id: "match", severity: "error", message: error.message });
    return false;
  } finally {
    hidePreviewMessage();
    renderLaneChrome();
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

/**
 * Render the candidates a running Match asks for on this page's GPU.
 *
 * The backend offers one recipe at a time and waits for its pixels. An empty
 * answer, or no answer, makes it run the whole fit on the CPU instead, so
 * nothing here needs to succeed for Match to finish.
 */
async function serveSdrMatchCandidates(sessionId, revision, finished) {
  const endpoint = `/api/session/${sessionId}/sdr-match/candidate`;
  const sourceSize = { width: state.session.source.width, height: state.session.source.height };
  let locals = [];
  let seen = false;
  const timings = state.sdrMatchCandidateTimings = [];
  while (!finished()) {
    let response;
    const polledAt = performance.now();
    try {
      response = await fetch(`${endpoint}?wait_ms=500`);
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
        headers: { "Content-Type": "application/octet-stream" },
        // Half-float RGB, as a Blob: the desktop shell uploads a Blob about
        // twice as fast as the same bytes in an ArrayBuffer.
        body: pixels ? new Blob([pixels]) : new ArrayBuffer(0),
      });
    } catch (_) {
      return;
    }
    if (!pixels) return;
    // How one candidate's time divides between waiting for the backend to ask,
    // rendering, reading back and returning the pixels.
    timings.push({ waitMs: receivedAt - polledAt, ...candidateTiming, totalMs: performance.now() - polledAt });
  }
}

async function presentMatchedSdrPreview(options) {
  const sessionId = state.session?.session_id;
  const generation = state.previewGeneration.sdr;
  const current = () => state.session?.session_id === sessionId
    && state.previewGeneration.sdr === generation;
  const presented = () => current()
    && state.acceptedPresentation?.lane === "sdr"
    && state.acceptedPresentation.generation === generation
    && state.acceptedPresentation.exact
    && state.acceptedPresentation.processedLongEdge === options.longEdge
    && state.acceptedPresentation.geometrySignature === geometrySignature();
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
      rendered = await renderGpuDraft("sdr", { ...options, allowInactive: state.currentView !== "sdr" });
    }
  }
  if (!current()) return true;
  if (!rendered) {
    if (transientGpuRefusal()) {
      // A second cancellation still has no CPU failure to recover from. Arm
      // real replacement work rather than claiming an exact frame is ready.
      debouncePreview("sdr");
      return true;
    }
    await renderPreviewForLane("sdr", state.currentView === "sdr", options.longEdge, {
      progressSteps: [20, 60, 90],
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
