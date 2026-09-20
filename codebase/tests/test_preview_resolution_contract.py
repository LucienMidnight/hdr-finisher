from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"


def test_preview_resolution_contract_has_a_non_numeric_full_sentinel() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '@typedef {"1024"|"2048"|"4096"|"full"} PreviewResolution' in javascript
    assert 'new Set(["1024", "2048", "4096", "full"])' in javascript
    assert 'if (normalized === "full") return "Full";' in javascript
    assert 'if (normalized === "full") return Math.max(256, sourceEdge || 256);' in javascript

    target_body = javascript.split("function previewTargetLongEdge", 1)[1].split(
        "function previewResolutionDimensions", 1
    )[0]
    assert target_body.index('normalized === "full"') < target_body.index("Number(normalized)")


def test_preview_diagnostics_separate_requested_and_presented_identity() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "requestedTier: normalizedPreviewResolution()" in javascript
    assert "presentedTier: state.acceptedPresentation?.tier || null" in javascript
    assert "presentedGeneration: state.acceptedPresentation?.generation ?? null" in javascript
    assert "currentGeneration: state.previewGeneration[state.currentView]" in javascript
    assert "previewDimensions: previewResolutionDimensions()" in javascript


def test_full_is_offered_publicly_and_cpu_full_requests_bounded_strips() -> None:
    """Full ships in the markup, not behind a query flag.

    It was gated on bounded source transport and tiled execution passing their
    release gates. Both are closed -- every preview module tiles and the source
    is streamed in bounded chunks -- so Full is an ordinary choice now, offered
    in both selectors that present the same setting. The engineering flag that
    used to install it is gone rather than left behind gating nothing.
    """
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    preview_selector = html.split('id="preview-resolution"', 1)[1].split("</select>", 1)[0]
    settings_selector = html.split('id="settings-preview-resolution"', 1)[1].split("</select>", 1)[0]
    assert '<option value="full">Full</option>' in preview_selector
    assert '<option value="full">Full</option>' in settings_selector
    # Full is last, below 4K, because the list reads smallest to largest.
    assert preview_selector.index('value="4096"') < preview_selector.index('value="full"')
    assert settings_selector.index('value="4096"') < settings_selector.index('value="full"')
    assert "engineeringFullPreview" not in javascript
    assert "Full · Engineering" not in javascript
    assert 'normalizedPreviewResolution(value) === "full" ? "strips" : "whole"' in javascript
    assert javascript.count("execution: previewExecutionForTier()") == 2



def test_gpu_memory_budget_reaches_the_renderer_and_never_gates_a_tier() -> None:
    """Phase 2: the budget decides Direct versus Tiled, not what the menu offers.

    PRD 4.2 is explicit that the budget "never decides whether a resolution
    option is visible", so this pins both halves: the preference is plumbed into
    the renderer, and nothing in that path touches the resolution selector.
    """
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    apply_budget = javascript[javascript.index("function applyGpuMemoryBudget(") : javascript.index("function previewExecutionMode(")]

    assert "state.gpuPreview?.setMemoryBudget?.(setting)" in apply_budget
    assert "state.gpuPreview?.clearAllocationBackoff?.()" in apply_budget
    assert "previewResolution" not in apply_budget
    assert "applyPreviewResolution" not in apply_budget

    # The renderer receives the stored budget even when it is constructed after
    # preferences have already loaded.
    init = javascript[javascript.index("async function initializeGpuPreview()") : javascript.index("function clearLegacyUiPreferences()")]
    assert 'state.gpuPreview.setMemoryBudget(state.gpuMemoryBudget ?? "auto")' in init

    # No code path disables or hides the preview-resolution selector.
    assert "previewResolution.disabled" not in javascript
    assert "els.previewResolution?.setAttribute(\"disabled\"" not in javascript


def test_execution_mode_is_tracked_separately_from_the_tier() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    mode = javascript[javascript.index("function previewExecutionMode(") : javascript.index("function previewExecutionLabel(")]

    assert '"direct-cpu"' in mode
    assert '"tiled-gpu"' in mode
    assert '"direct-gpu"' in mode
    assert 'lastRenderPlan?.decision?.mode === "tiled"' in mode
    # Execution never reads or writes the selected resolution.
    assert "previewResolution" not in mode


def test_render_plan_admission_never_expresses_an_unavailable_tier() -> None:
    javascript = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")
    plan = javascript[javascript.index("function buildRenderPlan(") : javascript.index("class HDRWebGPUPreview")]

    # The budget still decides when nothing overrides it.
    assert 'violations.length ? "tiled" : "direct"' in plan
    # A diagnostic override may force Tiled, which is always safe, and may force
    # Direct only where admission would have allowed it anyway -- so it can make
    # admission more conservative but never less. A switch in the settings panel
    # has no business overriding the memory guard.
    assert 'options.executionOverride === "tiled" ? "tiled"' in plan
    assert 'options.executionOverride === "direct" && violations.length === 0 ? "direct"' in plan
    # A decision can only choose an execution strategy. Whatever the override
    # asks for, there is still no branch that could report a resolution as
    # unavailable: every arm of it yields "tiled" or "direct".
    assert '"unavailable"' not in plan
    # Read the decision's mode expression and check every literal it can yield.
    decision = plan[plan.index("decision: {"):]
    expression = decision[decision.index("mode:"):decision.index("overridden:")]
    yielded = {token for token in expression.split('"')[1::2]}
    assert yielded <= {"tiled", "direct"}, yielded
    assert "maxTextureDimension2D" in plan
    assert "retained-presentation-overlap" in plan
    assert "contingency-margin" in plan


def test_backend_preflight_reports_host_constraints_without_deciding_gpu_viability() -> None:
    backend = (FRONTEND.parent / "backend" / "hdr_finisher" / "resource_preflight.py").read_text(encoding="utf-8")
    estimate = backend[backend.index("def estimate_preview_resources(") : backend.index("def estimate_resources(")]

    assert "decides_gpu_viability" in backend
    assert "advisories.append(" in estimate
    # The megapixel guideline and the unmeasurable-memory case advise; only the
    # hard request bound and measured host memory can refuse.
    guarded = estimate[estimate.index("reason = \"\"") : estimate.index("if pixels > FULL_PREVIEW_MAX_PIXELS:")]
    assert "FULL_PREVIEW_MAX_DIMENSION" in guarded
    assert "safely_available is not None and estimated > safely_available" in guarded
    assert "FULL_PREVIEW_MAX_PIXELS" not in guarded


def test_a_render_in_flight_is_not_superseded_outside_a_gesture() -> None:
    """A settled render has already paid for its source upload and its
    highlight-peak measurement by the time a later frame could replace it.

    Outside a gesture there is no responsiveness to win by starting a second
    render, so the interactive frame and the refinement pass both stand down.
    During a gesture latest-wins still applies, which is what the
    `interacting` check preserves.
    """
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    wrapper = javascript[javascript.index("function renderGpuDraft(lane = state.currentView, options = {})"):
                         javascript.index("async function renderGpuDraftInner(")]
    assert "state.gpuDraftInFlight = pending;" in wrapper
    assert "if (state.gpuDraftInFlight === pending) state.gpuDraftInFlight = null;" in wrapper

    scheduler = javascript[javascript.index("function initializePreviewScheduler()"):
                           javascript.index("function observeScopeSize()")]
    assert "if (!state.previewScheduler?.interacting && state.gpuDraftInFlight) return false;" in scheduler

    refine = javascript[javascript.index("async function refinePreview(lane, task = {})"):
                        javascript.index("function displayedLongEdge()")]
    assert "await state.gpuDraftInFlight.catch(() => null);" in refine


def test_a_declined_render_records_why() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu = (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8")

    assert 'return refuse("gpu-not-eligible");' in javascript
    assert 'return refuse("superseded-during-render");' in javascript
    assert "refuseRender(reason)" in webgpu
    assert 'this.refuseRender("peak:newer-render-started")' in webgpu
