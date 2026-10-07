from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

from hdr_finisher.main import app


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def _webgpu_source() -> str:
    return "\n".join((
        (FRONTEND / "webgpu-preview.js").read_text(encoding="utf-8"),
        (FRONTEND / "webgpu-shaders.js").read_text(encoding="utf-8"),
    ))


def test_viewer_exposes_icon_comparison_layouts_with_active_lane_scopes() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    webgpu = _webgpu_source()

    for layout in ["single", "split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]:
        assert f'data-compare-layout="{layout}"' in html
    assert html.count('class="tool-button compare-mode-button') == 5
    assert html.count('<svg viewBox="0 0 20 16"') == 5
    assert 'id="comparison-canvas"' in html
    assert 'id="comparison-image"' in html
    assert 'id="compare-button"' in html and "A/B" not in html
    assert 'id="compare-status"' not in html
    # Four group boundaries, plus one between each of Overlays, Preview and
    # Frame -- they open separate tools, not one grouped control.
    assert html.count('class="viewer-tool-divider"') == 6
    divider = '<span class="viewer-tool-divider" aria-hidden="true">|</span>'
    for toggle in ("preview-toggle", "frame-toggle"):
        assert html.split(f'<button id="{toggle}"')[0].rstrip().endswith(divider)
    assert 'class="zoom-presets" role="group" aria-label="Zoom presets"' in html
    assert 'state.compareLayout = "single"' in javascript
    assert 'els.compareStatus' not in javascript
    assert 'refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })' in javascript
    switch_lane = javascript[
        javascript.index("async function switchLane(lane)"):
        javascript.index("function renderLaneChrome()")
    ]
    assert switch_lane.index("await previewTask;") < switch_lane.index('refreshScopes(scopeLongEdge("settled")')
    assert "state.acceptedPresentation?.lane === lane" in javascript
    assert "renderComparisonPreview(other, { force: true })" in javascript
    assert "state.gpuPreview.renderTo(" in javascript
    assert "async renderTo(canvas" in webgpu
    assert '.preview-stage[data-compare-layout="split-vertical"]' in css
    assert '.preview-stage[data-compare-layout="side-vertical"]' in css
    assert ".tool-button.compare-mode-button" in css
    # The zoom readout has to hold four digits plus the percent sign.
    assert "--zoom-value-width: calc(6ch + 20px);" in css
    assert "flex: 0 0 var(--zoom-value-width);" in css
    assert "width: clamp(120px, 13vw, 190px);" in css
    assert ".viewer-tool-divider" in css
    assert ".zoom-presets" in css

def test_startup_is_ephemeral_and_all_grade_groups_begin_collapsed() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    proofing = (FRONTEND / "proofing-ui.js").read_text(encoding="utf-8")

    group_sections = re.findall(r'<section class="control-group[^"]*"[^>]*>', html)
    group_toggles = re.findall(r'<button class="group-toggle"[^>]*aria-expanded="([^"]+)"', html)
    assert group_sections and all("collapsed" in section for section in group_sections)
    assert len(group_toggles) == len(group_sections)
    assert set(group_toggles) == {"false"}
    assert "localStorage.setItem" not in javascript
    assert "localStorage.getItem" not in javascript
    assert "localStorage" not in proofing

def test_local_adjustments_use_group_and_folder_hierarchy_with_locked_tool_assignment() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'class="control-group collapsed local-adjustments-group"' in html
    assert 'id="grade-mode-global"' not in html
    assert 'class="lane-folder-shell"' in html
    assert html.count('role="tablist"') >= 2
    assert 'class="local-lane-folder"' in html
    assert 'class="local-stack-surface"' in html
    assert 'aria-pressed="false" title="Select Gradient for a new adjustment"' in html
    assert "function updateLocalToolState()" in javascript
    assert "function beginPendingLocalAdjustment()" in javascript
    assert "async function assignToolToPending(type)" in javascript
    assert 'subtitle = pending ? "Pick a tool"' in javascript
    assert 'addMask.textContent = "Create sub-mask"' in javascript
    assert '["subtract", "Subtract"]' in javascript
    assert 'if (!state.editDocument) await refreshEditState();' in javascript
    assert 'button.disabled = toolLocked;' in javascript
    assert 'const toolLocked = Boolean(assignedType && !state.pendingLocalAdjustment && !state.pendingSubMask);' in javascript
    assert 'return parentMaskExpression(local.mask);' in javascript
    assert 'drawMaskExpression(context, editorExpression, x, y, { ...drawOptions, renderPhase: "gizmo", skipBrush: true });' in javascript
    assert '.local-tool-strip button.active:disabled' in css
    assert 'els.localEraser.disabled = !brushSelected;' in javascript
    assert 'if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");' in javascript
    assert 'body[data-grade-mode="local"] #grade-workflow-panel > :not(.grade-header):not(.local-adjustments-group)' not in css
    assert 'if (response.status === 409)' in javascript
    assert 'response = await requestScope(state.editRevision);' in javascript
    assert ".lane-folder-shell > .lane-switch button.active" in css
    assert ".geometry-tool-strip" in css

def test_path_mask_exposes_draft_bezier_and_independent_feather_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    mask_expression = (FRONTEND / "mask-expression.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="local-mask-overlay" class="local-mask-overlay" tabindex="0"' in html
    for contract in [
        'feather_mode: "outer_boundary"',
        "feather_softness: 0",
        'feather_nodes: []',
    ]:
        assert contract in mask_expression
    for contract in [
        "function finishLocalPathDraft()",
        "function splitPathSegment(nodes, segmentIndex, t = 0.5)",
        "function materializeFeatherNodes(leaf)",
        "function validFeatherGeometry(innerNodes, outerNodes)",
        "function handlePathCanvasKeydown(event)",
        "function hideLocalMaskOverlayForGradePreview()",
        "state.localPathCreatePendingId === local.id",
        'state.localPathEditMode === "feather" || !state.localPathDraft',
    ]:
        assert contract in javascript
    assert '.path-edit-mode' in css
    assert '.path-node-mode' in css
    assert 'matchMedia("(prefers-reduced-motion: reduce)")' in javascript
    assert 'name: "feather_softness"' in javascript

def test_local_mask_authoring_uses_bidirectional_authoritative_geometry_mapping() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    geometry_math = (FRONTEND / "geometry-math.js").read_text(encoding="utf-8")

    assert 'fetch(`/api/session/${state.session.session_id}/geometry-map`' in javascript
    assert "projectivePoint(coordinateMap.outputToSource, point)" in javascript
    assert "projectivePoint(coordinateMap.sourceToOutput, point)" in javascript
    assert "applySourceGeometryCanvasTransform(context, imageRect, rect, coordinateMap.sourceToOutput)" in javascript
    assert "projectMaskExpressionToOutput(editorExpression, coordinateMap.sourceToOutput)" in javascript
    assert "const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]" in geometry_math
    assert 'if (state.gradeMode === "local") void ensureGeometryCoordinateMap();' in javascript
    assert 'renderPhase: "mask"' in javascript
    assert 'renderPhase: "gizmo"' in javascript
    assert 'gesture?.type === "luminance_sample"' in javascript

def test_perspective_module_is_numbered_fourth_and_exposes_draft_guided_tools() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert html.index('data-group="geometry"') < html.index('data-group="perspective"') < html.index('class="lane-folder-shell"')
    assert 'id="perspective-vertical-tool"' in html
    assert 'id="perspective-horizontal-tool"' in html
    assert 'id="perspective-apply"' in html and 'id="perspective-cancel"' in html
    assert '.control-group[data-group="perspective"] > .control-group-header::before { content: "04"; }' in css
    assert '.control-group[data-group="vignette"] > .control-group-header::before { content: "17"; }' in css
    assert "function openPerspectiveMode()" in javascript
    assert "function closePerspectiveMode(commit, { saved = false } = {})" in javascript
    assert 'transient_adjustments: true' in javascript
    assert '/perspective-solve`' in javascript

def test_frontend_assets_use_the_application_version_for_cache_busting() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    # Every served asset carries the cache-busting token. Asserted over
    # whatever the markup references rather than against a hand-counted
    # total, which needed editing whenever a file was added and never
    # checked the file that was added.
    referenced = re.findall(r'(?:src|href)="(/static/[^"?]+\.(?:js|css))(\?[^"]*)?"', html)
    assert referenced, "No /static assets are referenced at all."
    unversioned = [path for path, query in referenced
                   if query != "?v=__HDR_FINISHER_ASSET_VERSION__"]
    assert not unversioned, f"Assets served without a cache-busting version: {unversioned}"
    assert "/static/app-dialog.js" in [path for path, _ in referenced]
    assert '/static/app.js?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/desktop-chrome.js?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/styles.css?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/preview-scheduler.js?v=__HDR_FINISHER_ASSET_VERSION__' in html
    assert '/static/tile-scheduler.js?v=__HDR_FINISHER_ASSET_VERSION__' in html

def test_macos_uses_the_native_application_menu_without_renderer_duplicates() -> None:
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")
    chrome = (FRONTEND / "desktop-chrome.js").read_text(encoding="utf-8")
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    assert "platform: process.platform" in preload
    assert 'desktop.platform === "darwin"' in chrome
    assert "menuBar.hidden = true" in chrome
    assert 'Menu.setApplicationMenu(Menu.buildFromTemplate(template))' in main
    assert main.index("buildMenu();", main.index("mainWindow = new BrowserWindow")) < main.index("mainWindow.once(\"ready-to-show\"")

def test_local_adjustment_rows_use_theme_tokens_for_readable_text_and_icons() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    assert ".local-adjustment-list li + li {\n  border-top: 1px solid var(--local-stack-border);" in css
    assert ".local-adjustment-copy small {\n  color: var(--body);" in css
    assert ".local-adjustment-list .local-adjustment-menu-button {" in css
    assert "color: var(--local-icon-color);" in css
    select_rule = css.split(".local-adjustment-list .local-adjustment-select {", 2)[2].split("}", 1)[0]
    assert "color: var(--local-button-text);" in select_rule

def test_local_adjustment_stack_grows_to_a_scrollable_cap() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    stack_rule = css.split(".local-adjustments-group .local-stack-surface {", 1)[1].split("}", 1)[0]
    list_rule = css.split(".local-adjustments-group .local-adjustment-list {", 1)[1].split("}", 1)[0]

    assert "height: auto;" in stack_rule
    assert "min-height: 72px;" in stack_rule
    assert "max-height: 220px;" in stack_rule
    assert "overflow-y: auto;" in stack_rule
    assert "scrollbar-gutter: auto;" in stack_rule
    assert "min-height: 0;" in list_rule

def test_local_adjustment_menus_float_outside_the_stack_scroller() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    menu_rule = css.split(".local-adjustment-menu {", 1)[1].split("}", 1)[0]

    assert "position: fixed;" in menu_rule
    assert "z-index: 1000;" in menu_rule
    assert "function positionLocalAdjustmentMenu(menu, anchor)" in javascript
    assert "anchorRect.bottom + gap" in javascript
    assert "anchorRect.top - menuRect.height - gap" in javascript

def test_manual_interpretation_action_reveals_the_source_rail() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    reveal_rail = javascript[javascript.index("function revealSourceRail()") : javascript.index("function closeCompactSourceRail")]
    open_manual = javascript[javascript.index("function openManualInterpretation()") : javascript.index("function renderInterpretationGate")]

    assert "state.compactSourceOpen = true" in reveal_rail
    assert "state.wideSourceCollapsed = false" in reveal_rail
    assert "applyResponsiveWorkspaceState();" in reveal_rail
    assert "revealSourceRail();" in open_manual
    assert 'els.interpretationMode.value = "manual";' in open_manual
    assert "els.interpretationColorSpace.focus();" in open_manual

def test_export_action_remains_in_normal_scroll_flow() -> None:
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    sheet_actions = css[css.index(".export-sheet .sheet-actions {") : css.index(".export-sheet .sheet-actions .button-primary")]
    assert "position: sticky" not in sheet_actions
    assert "bottom: 0" not in sheet_actions
    assert "display: grid" in sheet_actions

def test_modified_status_uses_only_the_group_dot_without_text_counts() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert "`${count} Mod`" not in javascript
    assert 'curvesModified ? "Mod" : ""' not in javascript
    assert 'els.gradeModifiedSummary.textContent = ""' in javascript
    assert 'output.textContent = ""' in javascript
    assert ".group-toggle span {" in css
    assert ".control-group.modified .group-toggle span::after" in css

def test_adjustment_group_presets_are_scoped_persistent_and_available_in_headers() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

    assert 'id="group-preset-dialog"' in html
    assert 'id="group-preset-list"' in html
    assert 'id="group-preset-name"' in html
    assert 'id="film-reference-model"' not in html
    assert 'button.textContent = "Preset"' in javascript
    assert "function groupPresetPaths(groupId)" in javascript
    assert "function builtInGroupPresets(context)" in javascript
    assert 'kind.textContent = "Built-in"' in javascript
    assert "if (!preset.builtIn)" in javascript
    assert "const FILM_LOOK_PRESET_RECIPE_VERSION = 2" in javascript
    start = javascript.index("const FILM_LOOK_PRESETS")
    presets = javascript[start:javascript.index("\n]);", start)]
    assert "image_softness" not in presets and "microcontrast" not in presets
    assert "function completeFilmLookRecipe(values)" in javascript
    assert 'name: "Clean Cinema"' in javascript
    assert 'name: "Soft Color Negative"' in javascript
    assert 'name: "Dense Print"' in javascript
    assert 'name: "High-Speed Texture"' in javascript
    assert "return FILM_LOOK_PRESETS.map((preset)" in javascript
    assert "recipeVersion: preset.recipeVersion" in javascript
    assert 'data-section-path="current.film_look_section_enabled"' in html
    assert "function applyFilmLookPreset" not in javascript
    assert "context.paths.forEach((path)" in javascript
    assert "sectionPathForGroup" not in javascript[javascript.index("function applyGroupPreset"):javascript.index("function laneCurvesModified")]
    assert ".group-preset { order: 2;" in css
    assert ".control-group-header:has(.group-preset) {" in css
    assert "grid-template-columns: minmax(0, 1fr) 54px 44px 26px;" in css
    assert ".group-preset { grid-column: 2;" in css
    assert ".group-reset { grid-column: 3;" in css
    assert ".section-bypass { grid-column: 4;" in css
    assert 'path.join(library, "Grading")' in main
    assert '"hdr-denoise", "sdr-denoise"' in main
    assert 'schemaVersion: 1, ...preset' in main
    assert "return { groupId, name, recipeVersion, values }" in main
    assert 'listGradingPresets: (groupId)' in preload
    assert 'saveGradingPreset: (preset)' in preload
    assert 'deleteGradingPreset: (presetId)' in preload

def test_waveform_detail_profiles_raise_default_quality_with_performance_fallback() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "waveformRequestResolution(tier)" in javascript
    assert 'const DEFAULT_SCOPE_QUALITY = "detailed"' in javascript
    assert 'id="scope-detail"' in html
    assert '<option value="performance">Performance</option>' in html
    assert '<option value="detailed" selected>Detailed</option>' in html
    assert '<option value="reference">Reference</option>' in html
    assert "columns: Math.round(clamp(width / 2, 320, 384))" in javascript
    assert 'bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128' in javascript
    assert 'clamp(width * 0.75, 512, 768)' in javascript
    assert 'bins: tier === "interactive" ? 96 : 256' in javascript
    assert 'clamp(width, 768, 1024)' in javascript
    assert 'bins: tier === "interactive" ? 128 : 384' in javascript
    assert '&channels=${requestedChannels}' in javascript
    assert "smoothedWaveformPopulation(row, columnIndex, horizontalSpread)" in javascript
    assert "performance: { densityGain: 1.35, horizontalSpread: 1" in javascript
    assert "detailed: { densityGain: 1.9, horizontalSpread: 2" in javascript
    assert "reference: { densityGain: 2.15, horizontalSpread: 3" in javascript
    assert "1: { weights: [1, 2, 1], total: 4 }" in javascript
    assert "2: { weights: [1, 4, 6, 4, 1], total: 16 }" in javascript
    assert "3: { weights: [1, 6, 15, 20, 15, 6, 1], total: 64 }" in javascript
    assert "1 - Math.exp(-densityGain * Math.pow(density, 0.72))" in javascript

def test_detail_uses_numbered_module_header_and_sharpen_targeting_hierarchy() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert '>Detail <span class="module-modified-marker" aria-hidden="true"></span></button>' in html
    assert '.control-group[data-group="black-and-white"] > .control-group-header::before { content: "13"; }' in css
    assert '.control-group[data-group="detail"] > .control-group-header::before { content: "15"; }' in css
    assert '.control-group[data-group="film-look"] > .control-group-header::before { content: "16"; }' in css
    assert '.control-group[data-group="vignette"] > .control-group-header::before { content: "17"; }' in css
    assert 'data-control-path="current.detail.sharpen_amount"' in html
    assert '<div class="slider-group-relationship">Targeting</div>' in html
    assert 'class="control-row compact-subrail" data-control-path="current.detail.sharpen_radius_px"' in html
    assert 'class="control-row compact-subrail" data-control-path="current.detail.sharpen_threshold"' in html

def test_vectorscope_uses_display_signal_targets_in_cpu_and_gpu_paths() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scope_analysis = (FRONTEND / "scope-analysis.js").read_text(encoding="utf-8")
    scopes = (ROOT / "backend" / "hdr_finisher" / "scopes.py").read_text(encoding="utf-8")

    assert "acescg_to_linear_bt2020(working_rgb)" in scopes
    assert "signal_rgb = _scope_pq_oetf(normalized_nits)" in scopes
    assert "signal_rgb = _scope_srgb_oetf(linear_srgb)" in scopes
    assert "0.5 + (signal_rgb[..., 2] - signal_luma)" in scopes
    assert "0.5 + 0.5 * (signal_rgb" not in scopes
    assert "vectorscopeTransferLut(hdr, referenceWhite)" in scope_analysis
    assert "1.0260187082 * workingR - 0.0221655448 * workingG" in scope_analysis
    assert "const [kr, kg, kb] = hdr ? [0.2627, 0.6780, 0.0593]" in scope_analysis
    assert "0.5 + (b - y) / (2 * (1 - kb))" in scope_analysis
    assert "0.5 + 0.5 * (b - y)" not in scope_analysis
    assert "const normalizationPeak = robustScopePopulationPeak(grid)" in scope_analysis
    assert "function renderScopeControlAvailability()" in javascript
    assert 'els.scopeChannelMode?.classList.toggle("hidden", technical || vectorscope)' in javascript
    assert 'const rangeRelevant = !technical && !vectorscope && state.currentView === "hdr"' in javascript

def test_scope_region_is_an_optional_remappable_post_geometry_scope_tool() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scope_analysis = (FRONTEND / "scope-analysis.js").read_text(encoding="utf-8")
    shell = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="scope-region-toggle"' in html
    assert 'aria-label="Toggle Scope Region (Shift+R)"' in html
    assert 'class="scope-region-icon-frame"' in html
    assert 'id="scope-region-overlay" class="scope-region-overlay hidden"' in html
    assert html.count('data-scope-region-handle=') == 5
    assert 'id="scope-region-badge"' in html
    assert '"view.scopeRegion": "Shift+R"' in shell
    assert 'id: "view.scopeRegion"' in javascript
    assert "scope_region: scopeRegion" in javascript
    assert "function scopeAnalysisBounds" in scope_analysis
    assert "function beginScopeRegionDrag" in javascript
    assert "function handleScopeRegionKeydown" in javascript
    assert "var(--curve-selected-ring)" in css
    assert "var(--curve-selected)" in css
    assert "var(--accent)" in css

def test_denoise_phase_zero_selector_remains_lazy_and_outside_the_base_shader() -> None:
    preview = _webgpu_source()
    app_script = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "this.denoiseSourceSelector = null;" in preview
    assert "this.denoiseCounters = this.emptyDenoiseCounters();" in preview
    assert 'let sourceProxy = this.selectedDenoiseSource(proxy);' in preview
    assert "makeBindGroup(sourceProxy.texture.createView()" in preview
    assert "denoiseEnabled" not in preview
    assert 'analysisCalls: 0' in preview
    assert 'resolveCalls: 0' in preview
    assert 'denoiseTextures: (this.denoiseSourceSelector?.resolved ? 1 : 0)' in preview
    assert "prepareDenoiseSelectorSeam" in app_script
    assert "selectDenoiseSelectorSeam" in app_script

def test_denoise_setup_fetches_a_model_and_resolve_is_reconstruction_only() -> None:
    preview = _webgpu_source()
    app_script = (FRONTEND / "app.js").read_text(encoding="utf-8")

    # One method. The wavelet method's analysis, shader and identity are gone.
    for removed in ("compact-haar-residual-v1", "ensureDenoisePipelines", "alignedDenoiseTiles"):
        assert removed not in preview
    assert "analyzeDenoiseProxy(sessionId, lane, adjustments, longEdge, editRevision = 0, sourceIdentity = \"source\", controls = {})" in preview
    # Reconstruction has a bounded destination and a shared encoder, so
    # a tiled generation can rebuild one tile at a time into a tile-sized
    # texture and still submit once. The whole-frame signature is still the
    # default: omitting both is the interactive drag path, unchanged.
    assert "resolveDenoiseProxy(controls = {}, { region = null, destination = null, encoder: sharedEncoder = null, source = null } = {})" in preview
    assert 'const weights = ["amount", "luminance", "colorNoise", "detailRecovery"]' in preview
    assert 'recordStage("denoise-analysis"' in preview
    assert 'recordStage("denoise-resolve"' in preview
    assert 'recordStage("denoise-resolve", { state: "error"' in preview
    assert "paramBuffer?.destroy();" in preview

    # The reconstruction-only contract, asserted on behaviour rather than on the
    # shape of a cleanup block: resolve must never reach for the analysis
    # pipeline, however the two are arranged.
    resolve_body = preview[preview.index("async resolveDenoiseProxy("):preview.index("async prepareDenoiseSelectorSeam(")]
    assert "pipelines.analysis" not in resolve_body, "reconstruction must not dispatch analysis"
    assert "analysisDispatches" not in resolve_body, "reconstruction must not count an analysis dispatch"
    assert "if (candidateIsNew) candidate.texture.destroy();" in preview
    assert "longEdge = retainedOriginal.longEdge;" not in preview
    assert 'recalculateDenoise(lane, { longEdge, renderAfter: false })' in app_script
    assert 'denoiseSelector.identity === proxy.identity' in preview
    assert "cancelDenoiseProcessing({ selectOriginal = true } = {})" in preview
    assert "runtime.generation += 1;" in app_script
    assert "analyzeDenoiseWavelet" not in app_script
    assert "resolveDenoiseWavelet" not in app_script

def test_denoise_exposes_one_method_and_its_live_controls() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    app_script = (FRONTEND / "app.js").read_text(encoding="utf-8")

    for control_id in ("denoise-amount", "denoise-luminance", "denoise-color", "denoise-detail"):
        assert f'id="{control_id}" type="range"' in html
    assert 'id="denoise-recalculate" class="button-secondary"' in html
    assert 'id="denoise-bypass" class="section-bypass text-button bypassed"' in html
    assert 'data-reset-group="denoise"' in html
    assert 'id="denoise-enabled"' not in html
    assert 'id="denoise-ab"' not in html
    # One method: no selector, and none of the removed wavelet method's controls.
    for removed in ("denoise-algorithm", "denoise-method", "denoise-levels", "denoise-threshold",
                    "denoise-luma-sigma", "denoise-chroma-sigma"):
        assert f'id="{removed}"' not in html
    assert '>Denoise <span class="module-modified-marker" aria-hidden="true"></span></button>' in html
    assert html.index('id="raw-settings-section"') < html.index('data-group="denoise"') < html.index('id="local-adjustments-group"')
    assert "defaultDenoiseDocument" in app_script
    assert 'id: "built-in:default"' in app_script
    assert 'group === "denoise"' in app_script
    assert 'queueEditCommand("set_denoise_settings"' in app_script
    assert "updateDenoiseAnalysisPreset" not in app_script
    assert "updateCustomDenoiseAnalysis" not in app_script
    # The live controls still reach the renderer's reconstruction, but through
    # the coalescing queue rather than one call per input event.
    assert "state.gpuPreview?.resolveDenoiseProxy?.(controls, region ? { region } : {})" in app_script
    assert "denoiseInputQueue().submit(" in app_script
    assert "state.gpuPreview.analyzeDenoiseProxy" in app_script
    assert "updateRangeVisual(input)" in app_script
    assert "refinementProxyLongEdge()," in app_script
    assert "denoiseDocumentSessionId" in app_script
    assert "evictDenoiseCache" in app_script


def test_black_and_white_presets_are_allowed_and_slider_only() -> None:
    app_script = (FRONTEND / "app.js").read_text(encoding="utf-8")
    desktop_script = (DESKTOP / "main.js").read_text(encoding="utf-8")

    for group_id in ("hdr-black-and-white", "sdr-black-and-white"):
        assert f'"{group_id}"' in desktop_script

    preset_block = app_script[
        app_script.index("const BLACK_AND_WHITE_PRESETS"):
        app_script.index("const defaultGeometry")
    ]
    for slider in ("reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas"):
        assert f"{slider}:" in preset_block
    assert "section_enabled" not in preset_block
    assert "enabled" not in preset_block
    assert 'values: { [`${context.lane}.black_and_white`]' in app_script
    assert "built-ins change only the visible sliders; on/off is unchanged." in app_script
