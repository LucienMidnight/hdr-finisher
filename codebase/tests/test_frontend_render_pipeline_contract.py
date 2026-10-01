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


def test_webgpu_pipeline_preserves_cpu_section_order_and_lane_specific_exposure_bands() -> None:
    shader = _webgpu_source()
    # The packed parameter layout currently occupies indices 0..159. Keep the
    # contract aligned with the actual highest shader index so stale padding
    # does not masquerade as a pipeline-order regression.
    # 160 and 161 carry the tile origin for tiled execution; Direct leaves
    # them at zero, so every index below keeps its meaning. 166 carries
    # Denoise's Show noise view flag; 167-174 describe the Clarity map; 175 is
    # the grain film type and 176 the grain seed's high half. 186-189 state
    # the frame rectangle a soft or whole-frame mask texture covers.
    assert "const PARAM_COUNT = 190" in shader
    assert "const MASK_RECT_INDEX = 186" in shader
    # BW-01: Black & White runs straight after Color in every lane and path,
    # and before the SDR highlight stage on both SDR paths.
    assert "let scene = sceneColor(hdrContrast(hdrBase(source)));" in shader
    assert "let balanced = blackAndWhite(scene, guide);" in shader
    assert "fn sdrScenePrefix(source: vec3f) -> vec3f {" in shader and "return sceneColor(rgb);" in shader
    assert "let grey = blackAndWhite(scene, guide);" in shader
    assert "acescgToSrgb(grey) * ((100.0 / 203.0) / 0.18)" in shader
    assert "toneMap(grey)" in shader
    assert "rgb = acescgToSrgb(blackAndWhite(srgbToAcescg(rgb), srgbToAcescg(guide)));" in shader
    # Each pixel's colour comes from the source around it, only with a slider set.
    assert "blackAndWhiteGuideSource = blackAndWhiteLatticeMean(sourceTexture, coordinate, validTileDimensions());" in shader
    assert "guideSource = peakBlackAndWhiteLatticeMean(peakSource, vec2i(id.xy), vec2i(dimensions));" in shader
    assert "return peakAcescgToSrgb(peakBlackAndWhite(scene, guide)) * ((100.0 / 203.0) / 0.18);" in shader
    assert "rgb = peakAcescgToSrgb(peakBlackAndWhite(peakSrgbToAcescg(rgb), peakSrgbToAcescg(guide)));" in shader
    assert "const GRAIN_FILM_TYPE_INDEX = 175" in shader
    assert "const GRAIN_SEED_HIGH_INDEX = 176" in shader
    assert "const CLARITY_MAP_SCALE_INDEX = 167" in shader
    assert "const CLARITY_MAP_ORIGIN_Y_INDEX = 171" in shader
    assert "const NOISE_VIEW_INDEX = 166" in shader
    assert "const NOISE_VIEW_INDEX: u32 = 166u;" in shader
    assert "const TILE_ORIGIN_X_INDEX = 160" in shader
    assert "const TILE_ORIGIN_Y_INDEX = 161" in shader
    assert "params[TILE_ORIGIN_X_INDEX] = 0;" in shader
    assert "let tileOrigin = vec2i(i32(p[160]), i32(p[161]));" in shader
    assert "params[153] = Math.min(3, Math.max(0.3, Number(detail.sharpen_radius_px)" in shader
    assert "params[154] = Math.min(1, Math.max(0, Number(detail.sharpen_threshold)" in shader
    assert "params[156] = grainSectionEnabled ? 1 : 0" in shader
    assert "params[157] = grainSectionEnabled ? (grain.look_strength ?? 100) / 100 : 0" in shader
    assert "params[158] = film.grain_view_map ? 1 : 0" in shader
    assert "params[159] = sdrHighlightV2 ? 1 : 0" in shader
    assert "p[156] > 0.5 && p[157] > 0.0" in shader
    assert "detailHorizontalFragmentMain" in shader
    assert "detailVerticalFragmentMain" in shader
    assert "detailCompositeFragmentMain" in shader
    assert "localDetailHorizontalFragmentMain" in shader
    assert "localDetailVerticalFragmentMain" in shader
    assert "localDetailCompositeFragmentMain" in shader
    assert "localDetailMixFragmentMain" in shader
    assert "let scene = sceneColor(hdrContrast(hdrBase(source)))" in shader
    assert "let balanced = blackAndWhite(scene, guide)" in shader
    assert "let equalized = toneEqualizer(balanced)" in shader
    assert "let primaries = hdrPrimaries(equalized)" in shader
    # Film Look resolves into its own target so the output limiter can anchor on
    # the finished picture instead of predicting it from the source, and so the
    # composite and scope passes agree by construction rather than by mirroring.
    assert "fn finishFragmentMain(" in shader
    assert "return vec4f(applyFilmLook(coordinate), 1.0);" in shader
    assert shader.count("applyFilmLook(coordinate)") == 1
    assert "applyOutputHighlights(finishedAt(coordinate))" in shader
    assert "entryPoint: \"finishFragmentMain\"" in shader
    # The four grading textures still exist; the tiled route creates them
    # through the allocation guard so an OOM backs off to Tiled execution.
    assert 'finishTexture: guard(createTexture, "grading-finish")' in shader
    # The limiter is a single final-output stage: one shoulder call site per lane,
    # each followed by the ceiling that makes the target a delivery guarantee.
    assert shader.count("hdrPeakFit(hdrSoftCeiling(") == 1
    assert shader.count("sdrPeakFit(sdrSoftCeiling(") == 2
    assert "fn clipToOutputTarget(input: vec3f) -> vec3f" in shader
    assert "if (p[0] > 0.5) { return clipToOutputTarget(hdrPeakFit(hdrSoftCeiling(input))); }" in shader
    assert "if (p[159] > 0.5) { return clipToOutputTarget(input); }" in shader
    # Sharpening excursions must stay bounded, or the anchor above measures
    # ringing instead of picture.
    assert "const SHARPEN_HALO_ALLOWANCE_EV: f32 = 0.25;" in shader
    assert "const DETAIL_LUMA_FLOOR: f32 = 0.0001;" in shader
    assert shader.count("min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV)") == 2
    assert "0.12 * (extrema.y - extrema.x);" not in shader
    assert "sdrReferenceColor(sdrContrast(toneEqualizer(highlightRecovery(rgb))))" in shader
    assert "toneMap(grey)" in shader
    assert "sdrPrimaries(sdrContrast(toneEqualizer(highlightRecovery(toneMap(grey)))))" in shader
    assert "let y = max(select(lumaSrgb(input), lumaAces(input), p[0] > 0.5), 0.0)" in shader
    assert "retoneMapSdrReference(rgb)" in shader
    assert "let displayReferenceWhite = 100.0 / 203.0" in shader
    assert "if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }" in shader
    assert "if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }" in shader
    assert "log2(value / 0.18) / log2(100.0)" in shader
    assert "let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr)" in shader
    assert "let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr)" in shader
    assert "rgb = curveEncode(rgb, hdr)" in shader
    assert "let targetLevel = max(p[73], start + 0.0018)" in shader
    assert "let target =" not in shader
    assert "let softness = clamp(p[3] / 100.0, 0.0, 1.0)" in shader
    assert 'branch.highlight_compression_mode === "peak_fit" ? 1' in shader
    assert 'branch.highlight_compression_mode === "clip" ? 3' in shader
    assert 'branch.highlight_compression_color_handling === "smooth_rolloff" ? 2' in shader
    assert 'branch.highlight_compression_color_handling === "path_to_white"' in shader
    assert "fn hdrPeakFit(input: vec3f) -> vec3f" in shader
    assert "fn peakFitChannel(" in shader
    assert "fn hdrSoftCeiling(input: vec3f) -> vec3f" in shader
    assert "fn sdrPeakFit(input: vec3f) -> vec3f" in shader
    assert "fn sdrSoftCeiling(input: vec3f) -> vec3f" in shader
    assert "acescgToSrgb(grey) * ((100.0 / 203.0) / 0.18)" in shader
    assert "let transport = acescgToBt2020(input)" in shader
    assert "return mix(input, bt2020ToAcescg(mappedTransport), peakFitActivation)" in shader
    assert "(mappedRgb - vec3f(targetValue)) * (1.0 - progress)" in shader
    assert "let requiredRatio = clamp(" in shader
    assert "let targetValue = exp2(effectiveStartStop + stopSpan * mapped)" in shader
    assert 'entryPoint: "baseFragmentMain"' in shader
    assert 'entryPoint: "filmResponseFragmentMain"' in shader
    assert 'entryPoint: "fragmentMain"' in shader
    assert "filmResponse(textureLoad(sourceTexture" in shader
    assert "spatialExtractFragmentMain" in shader
    assert "fn applyColorGrading" in shader
    assert "srgbEncode(sourceY)" in shader
    assert "srgbEncode(vec3f(sourceY))" not in shader
    assert "fn applyVignette" in shader

def test_advanced_finishing_controls_are_wired_to_the_editor_and_export_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    script = (FRONTEND / "app.js").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    shader = _webgpu_source()
    assert 'data-group="geometry"' in html
    assert 'id="crop-guide"' in html
    assert 'id="crop-grid-density"' in html
    assert 'id="crop-tool-toggle" class="geometry-tool-crop"' in html
    assert 'id="rotate-tool-toggle" class="geometry-tool-rotate"' in html
    assert 'id="crop-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="rotate-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="straighten-grid-overlay" class="straighten-grid-overlay hidden"' in html
    assert html.index('id="crop-tool-toggle"') > html.index('data-group="geometry"')
    assert "updateStraightenInteractive" in script and "clearInteractiveStraightenPreview" in script
    assert "showStraightenGrid" in script and "hideStraightenGrid" in script
    assert "cropEditBaseCrop" in script
    assert "cropAuthoringFrameAspect" in script
    assert 'data-group="color-grading"' in html
    assert 'id="color-grading-match-hdr"' in html
    assert 'data-group="vignette"' in html
    assert 'id="vignette-center-handle"' in html
    assert "vignetteCenterGesture" in script
    assert "grabOffsetX" in script and "grabOffsetY" in script
    assert "globalEditGeneration" in script and "preserveNewerGlobalEdit" in script
    assert "globalEditSyncPending" in script
    assert 'id="export-sharpening"' in html
    assert 'id="export-resize-mode"' in html
    assert 'method: "edge_aware_multiscale"' in script
    assert 'const guides = ["none", "thirds", "golden", "grid", "x", "diagonals"]' in script
    assert "Â" not in html and "Ã" not in html
    assert "Â" not in script and "Ã" not in script
    assert "90&deg;" in html and "8&times;8" in html
    assert "\\u00b0" in script and "\\u00d7" in script
    assert ".color-wheel-pad::before" in css
    assert "inset: 4px" in css
    assert "inset 0 0 0 50px #7778" not in css
    for wheel in ["shadows", "midtones", "highlights"]:
        assert f'max="360" step="1" value="0" data-path="current.color_grading.{wheel}.hue"' in html
        assert f'max="100" step="1" value="0" data-path="current.color_grading.{wheel}.saturation"' in html
    assert "/color_grading\\..+\\.(hue|saturation)$/" in script
    assert "spatialBlurHorizontalFragmentMain" in shader
    assert "spatialBlurVerticalFragmentMain" in shader
    # The spatial kernel walks whole texels out to ceil(radius). A tap count
    # fixed independently of the radius is the echo defect: the spacing then
    # grows with the frame and the separable passes print a grid of copies of
    # every highlight instead of blurring it.
    assert "fn spatialGaussianAxis(direction: vec2f, coordinate: vec2f, radius: f32)" in shader
    assert "let extent = i32(floor(max(radius, 0.0)))" in shader
    # Taps are addressed by texel index. Sampling them through the linear
    # sampler divides by the texture's size, which is not the frame's size on
    # a tile, and the rounding difference costs byte-exact Direct/Tiled parity.
    assert "fn loadSpatialTexel(texel: vec2i)" in shader
    assert "total += (loadSpatialTexel(base + step * index) + loadSpatialTexel(base - step * index)) * weight" in shader
    assert "normalized * bloomRadius" not in shader
    assert "normalized * halationRadius" not in shader
    assert "let diffusionDelta = spatial.rgb - qualified" in shader
    assert "let edgeProtection = smoothRange(0.025, 0.20, relativeDetail)" in shader
    assert "(1.0 - edgeProtection)" in shader
    assert "chroma = p[104] * (1.0 - 0.8 * smoothRange(0.88, 1.0, signal))" in shader
    assert "rgb *= exp2(grain * amount)" in shader
    assert "if (p[158] > 0.5) { rgb = vec3f(filmLumaFromSignal(0.5)); }" in shader

def test_film_look_panel_exposes_cinema_controls_and_branch_matching() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert html.index('data-group="film-look"') > html.index('data-group="curves"')
    assert 'id="film-reference-model"' not in html
    for label in ["Clean Cinema", "Soft Color Negative", "Dense Print", "High-Speed Texture"]:
        assert label in javascript
    assert "builtInGroupPresets" in javascript
    assert "if (!preset.builtIn)" in javascript
    for path in [
        "print_strength", "color_density", "grain_amount", "grain_shadow_response",
        "grain_midtone_response", "grain_highlight_response", "halation_amount",
        "bloom_amount", "grain_film_format",
        "grain_capture_geometry", "grain_custom_width_mm", "grain_custom_height_mm",
        "grain_view_map", "halation_view_map",
        "red_response", "green_response", "blue_response",
        "highlight_desaturation", "shadow_desaturation", "grain_film_type",
    ]:
        assert f'data-path="current.film_look.{path}"' in html
    # NEXT-01 #2: Softness and Microcontrast are Detail controls now.
    for path in ("image_softness", "microcontrast", "image_structure_enabled"):
        assert f'data-path="current.film_look.{path}"' not in html
    assert 'data-path="current.detail.softness"' in html
    assert 'data-path="current.detail.microcontrast"' in html
    assert "fn grainLayerNoise" in _webgpu_source()
    shader = _webgpu_source()
    assert "halationEdgeSource" in shader
    assert "center * smoothRange(0.004, 0.12, relativeEdge)" in shader
    assert "let edgeRadius = clamp(halationRadius / 4, 1, 16)" in shader
    assert "rgb * bloomMask * bloomMask" in shader
    assert "let edgeProtection = smoothRange(0.025, 0.20, relativeDetail)" in shader
    assert "Physical Extent" in html
    assert "Optical Spread" in html
    assert "% 35mm gate" in javascript
    assert "% output diag" in javascript
    assert "exp2(0.55 * p[81] * p[79])" not in shader
    assert "mapped -= p[82] * p[79]" not in shader
    assert "mapped -= p[83] * p[79]" not in shader
    assert "if (p[108] < 1.0)" in shader
    assert "if (p[100] > 0.5 && p[108] < 1.0)" not in shader
    assert "detailActive || localDetailActive" in shader
    assert 'spatialATexture: spatialActive ? guard(createSpatialTexture, "spatial-a") : null' in shader
    assert "current?.width === width && current?.height === height && current.spatialActive === spatialActive" not in shader
    assert "if (spatialActive && (!current.spatialATexture || !current.spatialBTexture))" in shader
    assert '"grading-spatial-intermediates"' in shader
    assert "const fallbackSpatialView = sourceProxy.texture.createView();" in shader
    assert "const fallbackSpatialView = intermediate.filmTexture.createView();" not in shader
    assert "let structureBlur = filmBlur(coordinate, 0.06);\n      if (p[97] > 0.5)" not in shader
    assert "if (p[97] > 0.5 && (abs(p[98]) > 0.000001 || abs(p[99]) > 0.000001))" in shader
    assert "fn filmPixelsPerMm(dimensions: vec2f) -> f32" in shader
    # Halation is a film-plane distance, and the spatial grid is anchored
    # to the frame, so the pixels-per-mm it scales by is the frame's at quarter
    # resolution rather than whatever texture the blur happens to run in.
    assert "filmPixelsPerMm(frameSpatial) * halationRadiusMm" in shader
    assert "fn frameSpatialDimensions() -> vec2f" in shader
    assert "filmPhysicalBlur(coordinate, 0.04 + 0.08 * resolutionLoss, 32)" in shader
    # Bloom stays output-relative and halation stays film-plane -- the change is
    # only which extent they are relative to.
    assert "let blurCap = 256.0 / spatialScale();" in shader
    assert "clamp(length(frameSpatial) * max(p[95], 0.0) / 100.0, 0.25, blurCap)" in shader
    assert "clamp(filmPixelsPerMm(frameSpatial) * halationRadiusMm, 0.25, blurCap)" in shader
    assert "length(frameSpatial) * max(p[88], 0.0) / 100.0" not in shader
    assert "filmBlur(coordinate, 0.06, 24)" in shader
    assert "let canonicalTintSrgb = mix(vec3f(warmY), warm" in shader
    assert "select(canonicalTintSrgb, srgbToAcescg(canonicalTintSrgb), p[0] > 0.5)" in shader
    assert "let tint = mix(vec3f(warmY), warm" not in shader
    assert "let toeKnee = 0.18 * log(1.0 + exp((0.45 - mapped) / 0.18))" in shader
    assert "let shoulderKnee = 0.18 * log(1.0 + exp((mapped - 0.55) / 0.18))" in shader
    assert "let channelResponse = vec3f(p[143], p[144], p[145]) * p[79]" in shader
    assert "let highlightGuard = 1.0 - 0.65 * smoothRange(0.88, 1.12, responseSignal)" in shader
    assert "shadowWeight * p[147] + highlightWeight * p[146]" in shader
    assert "smoothRange(0.50, 0.82, responseSignal)" in shader
    assert "smoothRange(0.62, 1.0, responseSignal)" in shader
    assert 'data-film-grain-custom hidden' in html
    assert 'id="film-look-match-hdr"' in html
    assert "state.adjustments.sdr.film_look = JSON.parse(JSON.stringify(state.adjustments.hdr.film_look))" in javascript
    assert "const topLevelEnabled = state.adjustments.sdr.film_look_section_enabled" in javascript
    assert "film_grain_seed: 271828" in javascript

def test_rgb_primary_purity_slider_zeroes_align_with_hue_centers() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    for lane in ["hdr", "sdr"]:
        for primary in ["red", "green", "blue"]:
            assert f'id="{lane}-{primary}-purity" type="range" min="-95" max="95"' in html

def test_interactive_preview_scheduler_and_quality_preference_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    scope_analysis = (FRONTEND / "scope-analysis.js").read_text(encoding="utf-8")
    scope_readback = (FRONTEND / "scope-readback.js").read_text(encoding="utf-8")
    source_transport = (FRONTEND / "source-transport.js").read_text(encoding="utf-8")
    webgpu = _webgpu_source()
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    # One opt-in replaces the
    # Responsive / Balanced / Precise menu; full detail is the default.
    assert 'id="preview-latency"' not in html
    assert '<input id="preview-faster-dragging" type="checkbox">' in html
    assert '<span>Faster dragging</span>' in html
    assert html.count('title="For slower computers: shows a softer image while you drag, sharp again when you let go. Exports are unaffected."') == 2
    assert html.index('id="overlay-toggle"') < html.index('id="overlay-popover"') < html.index('id="preview-faster-dragging"')
    assert "fasterDragging: false," in javascript
    assert 'return state.fasterDragging ? "balanced" : "precise";' in javascript
    assert "armSettle(this.current, 0);" in scheduler
    assert ".toolbar-preview-resolution::after" in css
    assert "overflow-wrap: anywhere;" in css
    assert "white-space: normal;" in css
    assert 'id="scope-freshness"' in html and 'aria-live="polite"' in html
    assert '/static/preview-scheduler.js' in html
    assert 'const DEFAULT_PREVIEW_RESOLUTION = "1024"' in javascript
    assert "function previewTargetLongEdge" in javascript
    assert 'new Set(["1024", "2048", "4096", "full"])' in javascript
    assert "function fullPreviewSafety" not in javascript
    assert "preview-raw" in javascript
    assert 'tier: "interactive"' in scheduler
    assert "requestAnimationFrame" in scheduler
    assert "cancelIdleWork" in scheduler
    assert 'await this.callbacks.onSettle?.({ ...task, tier: "settled" });' in scheduler
    assert 'await this.callbacks.onRefine?.({ ...task, tier: "refinement" });' in scheduler
    assert "await Promise.all([" not in scheduler[scheduler.index("armSettle(task)"):scheduler.index("cancelIdleWork()")]
    assert "rgba16f" in source_transport and "X-Pixel-Format" in source_transport
    assert "this.paramBuffer" in webgpu and "this.curveBuffer" in webgpu
    assert "this.curveSampleCache" in webgpu
    assert "Settled WebGPU authoring preview" in javascript
    gpu_scope_eligibility = javascript[
        javascript.index("function gpuScopeEligible"):
        javascript.index("async function runGpuScopeRequest")
    ]
    assert "defaultGeometry" not in gpu_scope_eligibility
    assert "renderer.scopeSources.get(canvas) !== source" in scope_readback
    assert "analysis.sessionId !== request.sessionId" in javascript
    assert "analysis.sourceSerial !== accepted?.sourceSerial" in javascript
    assert "analysis.applicationGeneration !== accepted?.generation" in javascript
    assert 'state.acceptedPresentation?.transport === "WebGPU"' in javascript
    assert "state.acceptedPresentation?.generation === state.previewGeneration[lane]" in javascript
    assert "return enqueueGpuScopeRequest(request);" in javascript
    assert "state.pendingGpuScopeRequest?.resolve(false);" in javascript
    assert "const sortedLuma = lumaValues.sort();" in scope_analysis
    assert "Array.from(lumaValues).sort" not in scope_analysis
    assert "this.resourceGeneration" in webgpu
    assert "this.destroyAfterActiveRenders" in webgpu
    assert "settledScopeFragmentMain" in webgpu
    assert "full-cell maximum" in webgpu
    assert "cellPeaks" in scope_readback
    assert "peakReductionMain" in webgpu
    assert "measureToneAdjustedPeak" in webgpu
    # Interactive frames never wait for the whole-image reduction: they carry
    # the last real measurement and the skipped one is scheduled afterwards.
    assert 'const interactive = sourceOptions?.tier === "interactive";' in webgpu
    assert "scheduleHighlightMeasurement(anchor, sourceProxy, params, lane, used)" in webgpu
    assert 'hdrfinisher:highlight-anchor-measured' in javascript
    render_to = webgpu[webgpu.index("async renderTo(canvas"):webgpu.index("async analyzeDenoiseProxy")]
    # Resizing a visible canvas clears its presented frame, so the peak
    # measurement must complete before the resize. The resize itself happens
    # inside the presentation gate, and the submit follows it with nothing
    # awaited: presentation is one critical section, so a resized, cleared
    # canvas is never left on screen while work is pending. A settled draft that
    # loses its race returns false, and the scheduler answers that with a full
    # CPU preview, which the user sees as a black flash. Any future move to
    # anchor on the finished picture has to schedule a refinement rather than
    # await here.
    assert render_to.index("await this.resolveHighlightAnchor") < render_to.index(
        "if (canvas.width !== proxy.width) canvas.width = proxy.width;"
    )
    presentation = render_to[render_to.index("if (canvas.width !== proxy.width) canvas.width = proxy.width;"):]
    presentation = presentation[:presentation.index("this.device.queue.submit")]
    assert "await" not in presentation
    # The tiled helper is awaited for its validation result, but it encodes and
    # submits synchronously before its first await. Thus the caller cannot expose
    # a resized, cleared canvas while tiled work is pending either.
    tiled_encoder = webgpu[
        webgpu.index("async encodeTiledGeneration"):
        webgpu.index("refuseRender(reason)")
    ]
    assert tiled_encoder.index("this.device.queue.submit") < tiled_encoder.index("await this.device.popErrorScope")
    assert "tier," in javascript[javascript.index("const sourceOptions = {"):javascript.index("try {", javascript.index("const sourceOptions = {"))]

def test_electron_preview_correctness_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    webgpu_javascript = _webgpu_source()
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

    assert 'id="preview-quality-status"' in html and 'aria-live="polite"' in html
    assert 'document.addEventListener("drop"' in javascript
    assert 'document.addEventListener(eventName' in javascript
    assert 'desktop.resolveDroppedFile(file)' in javascript
    assert "Windows shell integrations and catalog applications" in javascript
    assert 'await importByteFile(file, "import another source")' in javascript
    assert 'if (!await confirmUnsavedTransition(actionLabel)) return false;' in javascript
    assert 'const nativeOverwriteApproved = ["win32", "darwin", "linux"].includes(process.platform)' in main
    assert "Boolean(nativeOverwrite)" in javascript
    assert 'id="rotate-apply"' in html and 'id="rotate-cancel"' in html
    assert "function gpuPreviewEligible(lane = state.currentView)" in javascript
    assert "state.gpuPreview?.adapterInfo?.fallback" in javascript
    assert "isFallbackAdapter" in webgpu_javascript
    gpu_eligibility = javascript[
        javascript.index("function gpuPreviewEligible(lane = state.currentView)"):
        javascript.index("function gpuPreviewSourceOptions")
    ]
    assert "sdr_match" not in gpu_eligibility
    assert "function gpuPreviewSourceOptions" in javascript
    assert "gpuPreviewSourceOptions(lane)" in javascript
    sdr_match_action = javascript[
        javascript.index("async function setSdrMatch(action)"):
        javascript.index("function queueEditCommand")
    ]
    assert 'state.currentView === "sdr"\n      ? refinementProxyLongEdge()' in sdr_match_action
    assert 'longEdge: previewLongEdge' in sdr_match_action
    assert 'tier: previewTier' in sdr_match_action
    assert 'await presentMatchedSdrPreview(gpuOptions)' in sdr_match_action
    match_presentation = javascript[
        javascript.index("async function presentMatchedSdrPreview(options)"):
        javascript.index("function recordAcknowledgedLocals")
    ]
    assert 'renderPreviewForLane("sdr", state.currentView === "sdr", options.longEdge' in match_presentation
    assert "sourceOptions?.identity" in _webgpu_source()
    assert "sourceOptions?.inheritedGrain" in _webgpu_source()
    assert "defaultGeometry" not in gpu_eligibility
    assert "geometrySignature" not in gpu_eligibility
    assert "cached.geometrySignature === geometrySignature()" in javascript
    assert "authoritative?.geometrySignature === geometrySignature()" in javascript
    assert "geometry_signature=${encodeURIComponent(requestedGeometrySignature)}" in javascript
    assert "state.comparisonRenderedGeometry === signature" in javascript
    assert 'renderGpuDraft(lane, { longEdge: targetLongEdge, tier: "refinement" })' in javascript
    assert 'renderPreviewForLane(lane, true, targetLongEdge, { showProgress: false })' in javascript
    assert "function closeRotateMode(commit)" in javascript
    assert "function requestRotateGeometryDraft(signature)" not in javascript
    assert "if (state.rotateDraftGeometry) closeRotateMode(false);" in javascript
    assert 'els.rotateApply?.addEventListener("click", () => closeRotateMode(true))' in javascript
    close_rotate = javascript[javascript.index("function closeRotateMode(commit)"):javascript.index("function renderCropOptions()")]
    assert 'invalidatePreview("hdr")' in close_rotate and 'invalidatePreview("sdr")' in close_rotate
    assert "state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()" in javascript
    close_crop = javascript[javascript.index("function closeCropMode(commit)"):javascript.index("function renderGeometryToolState()")]
    assert "state.geometryTransformHandoffSignature = geometrySignature();" in close_crop
    # renderGpuDraft is now a thin wrapper that submits intent to the
    # coordinator; the body it used to name lives in renderGpuDraftInner.
    gpu_draft = javascript[javascript.index("async function renderGpuDraftInner("):javascript.index("function gpuLumaMaskOverlayOptions")]
    assert "requestedGeometrySignature === geometrySignature()" in gpu_draft
    # The coordinator token supplies generation currency; the app-domain guards
    # the token cannot know stay here.
    assert "isCurrent: () => (typeof request.isCurrent === \"function\" ? request.isCurrent() : true)" in gpu_draft
    assert "&& generation === state.previewGeneration[lane]" in gpu_draft
    assert "&& requestedGeometrySignature === geometrySignature()" in gpu_draft
    assert "&& (allowInactive || lane === state.currentView)" in gpu_draft
    # A live GPU scope does not wait for a backend save, and never
    # submits beside a drag frame.
    assert 'const liveGpuScope = tier === "interactive" && gpuScopeEligible(lane);' in javascript
    assert 'if (tier === "interactive" && state.previewScheduler?.frameInFlight) {' in javascript
    # A softer drag frame still on the GPU at release never reaches the canvas.
    assert '&& !(request.coarse && request.reason === "drag-coarse" && !state.previewScheduler?.interacting),' in gpu_draft
    webgpu = _webgpu_source()
    assert "sourceOptions?.isCurrent?.() === false" in webgpu
    # A deferred render is classified as superseded, so it returns without
    # recording a failure and without disabling the device.
    assert "state.gpuFailurePolicy.record(error, { superseded: Boolean(error?.recoverable) })" in gpu_draft
    assert 'if (verdict.kind === "superseded")' in gpu_draft
    clear_straighten = javascript[
        javascript.index("function clearInteractiveStraightenPreview()"):
        javascript.index("function rotateGeometry(delta)")
    ]
    assert "if (state.rotateDraftGeometry)" in clear_straighten
    assert "renderRotateDraftTransform();" in clear_straighten
    assert 'preview?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`)' in javascript
    rotate_draft = javascript[
        javascript.index("function renderRotateDraftTransform("):
        javascript.index("function applySourceOverlayGeometryTransform")
    ]
    assert "function renderRotateDraftTransform({ reflow = false } = {})" in rotate_draft
    assert "if (reflow) applyZoomGeometry();" in rotate_draft
    assert "renderRotateDraftTransform({ reflow: true });" in javascript
    assert 'const transactionOwnedControl = control.dataset.path === "shared.geometry.straighten_angle";' in javascript
    assert "if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;" in javascript
    begin_straighten = javascript[
        javascript.index("function beginStraightenGesture("):
        javascript.index("function updateStraightenInteractive(")
    ]
    assert "state.previewScheduler?.cancel();" in begin_straighten
    assert "window.clearTimeout(state.settleTimer);" in begin_straighten
    assert 'label: "Rendering Mode"' in main
    assert all(label in main for label in ("Auto (Recommended)", "GPU Preferred", "CPU Compatibility"))
    assert "const activeBackend = backend;" in main
    assert 'activeBackend.authoringSecret' in main
    assert 'details.requestHeaders["X-HDR-Finisher-Token"] = backend.authoringSecret' not in main
    assert 'setRenderingMode: (mode)' in preload
    assert 'writeClipboardText: (value)' in preload
    assert 'resolveDroppedFile: async (file)' in preload
    assert 'webUtils.getPathForFile(file)' in preload
    assert 'await desktop.resolveDroppedFile(file)' in javascript
    assert 'desktop.resolveDroppedFiles(files)' not in javascript
    assert 'handle("desktop:write-clipboard-text"' in main
    assert "clipboard.writeText(value)" in main
    assert "var highlightMask = smoothRange" in _webgpu_source()

def test_preview_viewport_keeps_a_stable_aspect_across_interactive_and_settled_tiers() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    clear_preview_cache = javascript[
        javascript.index("function clearPreviewCache()"):
        javascript.index("function cacheReady")
    ]
    zoom_geometry = javascript[
        javascript.index("function applyZoomGeometry()"):
        javascript.index("function updateZoomReadout()")
    ]

    assert "state.zoomReferenceFrame = null" in clear_preview_cache
    assert "aspect: renderedAspect" in zoom_geometry
    assert "state.zoomReferenceFrame.geometrySignature === geometrySignature" in zoom_geometry
    assert "? state.zoomReferenceFrame.aspect" in zoom_geometry
    assert "const referenceAspect = renderedAspect;" not in zoom_geometry

def test_export_format_dropdown_does_not_claim_a_provisional_or_alternative_ranking() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "Mainstream alternative" not in html
    assert "Provisional default" not in html
    assert '<option value="avif_gain_map">AVIF + gain map</option>' in html
    assert '<option value="jpeg_ultrahdr" selected>JPEG Ultra HDR</option>' in html
    assert 'avif_gain_map: "avif_gain_map_encoder"' in javascript
    assert 'jpeg_ultrahdr: "ultrahdr_encoder"' in javascript

def test_manual_source_interpretation_status_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert 'session.source.interpretation_mode === "manual"' in javascript
    assert "Manual source interpretation applied: ${colorSpace} primaries + ${transfer} transfer + ${reference}." in javascript
    assert 'id="interpretation-linear-reference"' in html
    assert 'value="diffuse_white_1_0">1.0 = diffuse white (Affinity)' in html
    assert "els.sourceSettingsNote.textContent = sourceInterpretationStatus(session);" in javascript
    assert "if (session.source.interpretation_mode === \"manual\") return sourceInterpretationStatus(session);" in javascript

def test_developed_camera_raw_distinguishes_source_profile_from_working_space() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert 'if (isDevelopedRawSession(session)) return "auto";' in javascript
    assert "Camera-native RAW developed through its camera profile into the ACEScg working space." in javascript
    assert 'return "Auto: camera-native RAW profile → ACEScg working";' in javascript
    assert "els.interpretationMode.disabled = developedRaw;" in javascript

def test_desktop_source_open_handoffs_surface_failures() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    bridge_handler = javascript[
        javascript.index("desktop.onOpenRequest((selection)"):
        javascript.index("await desktop.rendererReady();")
    ]
    assert "openDesktopSelection(selection).catch((error)" in bridge_handler
    assert 'showUploadError(error?.message || "Could not open that source image.");' in bridge_handler

    browser_handler = javascript[
        javascript.index("async function confirmMediaBrowserSelection()"):
        javascript.index("function sanitizeProjectFilename")
    ]
    assert "await openDesktopSelection({ kind: \"source\", ...selection });" in browser_handler
    assert 'showUploadError(error?.message || "Could not open that source image.");' in browser_handler

def test_project_open_shows_immediate_loading_feedback() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    status = javascript[javascript.index("function beginProjectOpenStatus(") : javascript.index("function sourcePixelFrameDimensions(")]
    project_open = javascript[javascript.index("async function openProjectFromPath(") : javascript.index("async function saveProjectToPath(")]

    assert 'id: "project-open"' in status
    assert 'severity: "progress"' in status
    assert "`Opening project · ${label}" in status
    assert "els.projectOpen.disabled = true;" in project_open
    assert project_open.index("beginProjectOpenStatus(") < project_open.index("window.requestAnimationFrame(resolve)")

def test_phase_one_local_influence_and_latest_generation_contract() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    mask_loader = (FRONTEND / "mask-loader.js").read_text(encoding="utf-8")
    scheduler = (FRONTEND / "preview-scheduler.js").read_text(encoding="utf-8")
    webgpu = _webgpu_source()

    assert 'const influenceOnly = name === "mask_opacity"' in javascript
    assert "scheduleLocalPreview();" in javascript
    assert "bindLocalPreviewInteraction(input);" in javascript
    assert "active.controller?.abort();" in javascript
    assert "window.setTimeout(flushAuthoritativeLocalMaskDraft, 90)" in javascript
    assert "Math.min(1600, settledProxyLongEdge())" in javascript
    assert "signature !== JSON.stringify(selected?.mask)" in javascript
    assert "currentMaskMatch" in javascript
    assert "local_adjustments: requestLocals" in javascript
    assert "local_adjustments: state.localPreviewDirty" in javascript
    assert 'conflict?.detail === "Stale scope request dropped."' in javascript
    assert "generation !== state.scopeGeneration" in javascript
    assert "Math.max(state.scopeGeneration + 1, generation ?? 0)" in javascript
    assert "preserveLocalDraft: state.localPreviewDirty" in javascript
    assert "const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));" in javascript
    assert "JSON.parse(JSON.stringify(localAdjustments()))" in javascript
    assert "recordStaleResult" in scheduler
    assert "gpuMaskIdentity(expression)" in webgpu
    assert "p[1] * p[13]" in webgpu
    assert "spatial_only=true${pathQuery}" in mask_loader
    gpu_eligibility = javascript[
        javascript.index("function gpuPreviewEligible(lane = state.currentView)"):
        javascript.index("function gpuPreviewSourceOptions")
    ]
    assert "supportsLocalAdjustments" in gpu_eligibility
    local_support = webgpu[
        webgpu.index("function gpuLocalSupported"):
        webgpu.index("function activeGpuLocals")
    ]
    assert "curveSetNeutral(grade)" in local_support
    assert "detail.texture_amount" not in local_support
    assert "grading.balance" in local_support and "grading.blending" in local_support
    assert "grading.shadows, grading.midtones, grading.highlights" in local_support
    render_to = webgpu[
        webgpu.index("async renderTo(canvas"):
        webgpu.index("selectedDenoiseSource(originalProxy)")
    ]
    assert render_to.index("const activeLocals = activeGpuLocals") < render_to.index("this.loadProxy(")

def test_webgpu_local_detail_uses_ordered_gpu_chain_and_scaled_parameters() -> None:
    webgpu = _webgpu_source()

    params = webgpu[webgpu.index("function buildLocalParams"):webgpu.index("function gpuMaskInfluenceOpacity")]
    assert "new Float32Array(PARAM_COUNT)" in params
    assert "values[14] = (Number(detail.texture_amount) || 0) / 100" in params
    assert "values[15] = (Number(detail.clarity_amount) || 0) / 125" in params
    assert "values[17] = Math.min(2, Math.max(0, (Number(detail.sharpen_amount) || 0) / 100))" in params
    assert "(Number(detail.sharpen_threshold) || 0) / 100" in params
    assert "values[20] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1))" in params

    render = webgpu[webgpu.index("for (let index = 0; index < activeLocals.length"):webgpu.index("const responseBindGroup")]
    ordered_tokens = [
        "pipelines.localCandidate",
        "pipelines.localDetailHorizontal",
        "pipelines.localDetailVertical",
        "pipelines.localDetailComposite",
        "pipelines.localDetailMix",
    ]
    assert [render.index(token) for token in ordered_tokens] == sorted(render.index(token) for token in ordered_tokens)
    assert "intermediate.detailATexture" in render and "intermediate.detailBTexture" in render
    assert "masks[index].texture.createView()" in render
    assert "intermediate.detailATexture.createView(),\n            )" in render

    support = webgpu[webgpu.index("function gpuLocalSupported"):webgpu.index("function activeGpuLocals")]
    assert "texture_amount" not in support
    assert "clarity_amount" not in support
    assert "sharpen_amount" not in support

def test_export_waits_for_pending_edits_and_formats_structured_errors() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));" in javascript
    assert "const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();" in javascript
    assert 'responseErrorMessage(payload, "Export failed.")' in javascript
    assert 'responseErrorMessage(payload, "Could not open that folder.")' in javascript

def test_phase_two_gpu_luma_retained_mask_contract() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")
    source_transport = (FRONTEND / "source-transport.js").read_text(encoding="utf-8")
    webgpu = _webgpu_source()

    assert 'sessionId, "hdr", longEdge, geometrySignature, editRevision, "source", { signal, isCurrent }' in webgpu
    assert "geometry_signature=${encodeURIComponent(geometrySignature)}" in source_transport
    assert "acceptedGeometry !== geometrySignature" in source_transport
    assert "${sessionId}:${longEdge}:${geometrySignature}" in webgpu
    assert 'entryPoint: "sceneLuminanceFragmentMain"' not in webgpu
    assert 'this.createMaskPipeline("sceneLuminanceFragmentMain")' in webgpu
    assert 'this.createMaskPipeline("lumaQualificationFragmentMain")' in webgpu
    assert 'this.createMaskPipeline("maskRefinementFragmentMain")' in webgpu
    assert "gpuLumaBaseIdentity(local.mask)" in webgpu
    assert "mask_feather: 0" in webgpu and "mask_opacity: 1" in webgpu
    assert "entry.baseTexture" in webgpu and "entry.horizontalTexture" in webgpu
    assert "entry.refinedTexture" in webgpu
    # The luma feather is round (a fraction of the long edge on both axes)
    # and reads every texel it covers; 25 taps a quarter-sigma apart turned
    # thin strips into repeating copies.
    assert "const sigma = 0.09 * amount * Math.max(width, height) * referenceScale;" in webgpu
    # ...measured against the uncropped source, as the backend does.
    assert "state.gpuPreview.featherReferenceScale = maskFeatherReferenceScale;" in (FRONTEND / "app.js").read_text(encoding="utf-8")
    assert "for (var tap = -reach; tap <= reach; tap = tap + 1)" in webgpu
    assert "stepSize = max(1.0, sigma * 0.25)" not in webgpu
    assert 'this.createMaskPipeline("maskDownsampleFragmentMain")' in webgpu
    assert "sceneLuminanceTextures: this.sceneLuminance.size" in webgpu
    assert "cpuMaskRequest: false" in webgpu
    assert "textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0)" in webgpu
    assert "params[129] = vignette.center_x" in webgpu
    assert "params[130] = vignette.center_y" in webgpu
    assert "params[131] = overlayMask && !noiseView ? 1 : 0" in webgpu
    assert "vec3f(p[133], p[134], p[135])" in webgpu
    assert "if (!scene || signal?.aborted || !isCurrent()) return null" in webgpu
    assert "gpuLumaMaskPreviewActive" in javascript
    assert "scheduleSpatialMaskPreview(selectedLocal())" in javascript
    assert "if (!gpuLumaMaskPreviewActive(local)) void queueAuthoritativeLocalMask(local)" in javascript
    assert "gpuResident: true" in javascript

def test_phase_four_retained_boolean_mask_graph_contract() -> None:
    mask_loader = (FRONTEND / "mask-loader.js").read_text(encoding="utf-8")
    webgpu = _webgpu_source()

    assert 'sessionId, local, longEdge, editRevision, geometrySignature, isCurrent, signal' in webgpu
    assert "geometry_signature=${encodeURIComponent(geometrySignature)}" in webgpu
    assert 'response.headers.get("X-Geometry-Signature") !== geometrySignature' in mask_loader
    assert 'this.createMaskPipeline("maskCombineFragmentMain")' in webgpu
    assert 'mask_path=${encodeURIComponent(maskPath)}' in mask_loader
    assert 'spatial_only=true${pathQuery}' in mask_loader
    assert 'kind: "gpu-mask-graph"' in webgpu
    assert "gpuMaskGraphPassCount" in webgpu
    assert "gpuMaskOperatorCode" in webgpu
    assert "left * (1.0 - right)" in webgpu
    assert "entry?.influenceIdentity === influenceIdentity" in webgpu
    assert "maskGraphs:" in webgpu
