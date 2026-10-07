from __future__ import annotations

from pathlib import Path

from frontend_source import frontend_declaration, frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
DESKTOP = ROOT / "desktop"


def test_webgpu_pipeline_preserves_cpu_section_order_and_lane_specific_exposure_bands() -> None:
    shader = frontend_scripts()
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
    assert "params[156] = filmEnabled ? 1 : 0" in shader
    assert "params[157] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0" in shader
    assert "params[158] = film.grain_view_map ? 1 : 0" in shader
    assert 'params[159] = lane === "sdr" ? 1 : 0' in shader
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
    # The limiter is a single final-output stage: one shoulder call site per lane,
    # each followed by the ceiling that makes the target a delivery guarantee.
    assert shader.count("hdrPeakFit(hdrSoftCeiling(") == 1
    assert shader.count("sdrPeakFit(sdrSoftCeiling(") == 2
    assert "fn clipToOutputTarget(input: vec3f) -> vec3f" in shader
    assert "if (p[0] > 0.5) { return clipToOutputTarget(hdrPeakFit(hdrSoftCeiling(input))); }" in shader
    assert "p[159]" not in shader
    # Sharpening excursions must stay bounded, or the anchor above measures
    # ringing instead of picture.
    assert "const SHARPEN_HALO_ALLOWANCE_EV: f32 = 0.25;" in shader
    assert "const DETAIL_LUMA_FLOOR: f32 = 0.0001;" in shader
    assert shader.count("min(0.12 * (extrema.y - extrema.x), SHARPEN_HALO_ALLOWANCE_EV)") == 2
    assert "0.12 * (extrema.y - extrema.x);" not in shader
    assert "let y = max(select(lumaSrgb(input), lumaAces(input), p[0] > 0.5), 0.0)" in shader
    assert "if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }" in shader
    assert "if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }" in shader
    assert "log2(value / 0.18) / log2(100.0)" in shader
    assert "let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr)" in shader
    assert "let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr)" in shader
    assert "rgb = curveEncode(rgb, hdr)" in shader
    assert "let targetLevel = max(p[73], start + 0.0018)" in shader
    assert "let softness = clamp(p[3] / 100.0, 0.0, 1.0)" in shader
    assert 'branch.highlight_compression_mode === "peak_fit" ? 1' in shader
    assert 'branch.highlight_compression_mode === "clip" ? 3' in shader
    assert 'branch.highlight_compression_color_handling === "smooth_rolloff" ? 2' in shader
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
    assert "filmResponse(textureLoad(sourceTexture" in shader
    assert "spatialExtractFragmentMain" in shader
    assert "fn applyColorGrading" in shader
    assert "srgbEncode(sourceY)" in shader
    assert "srgbEncode(vec3f(sourceY))" not in shader
    assert "fn applyVignette" in shader


def test_advanced_finishing_controls_are_wired_to_the_editor_and_export_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")
    shader = frontend_scripts()
    assert 'data-group="geometry"' in html
    assert 'id="crop-guide"' in html
    assert 'id="crop-grid-density"' in html
    assert 'id="crop-tool-toggle" class="geometry-tool-crop"' in html
    assert 'id="rotate-tool-toggle" class="geometry-tool-rotate"' in html
    assert 'id="crop-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="rotate-tool-settings" class="geometry-tool-settings hidden"' in html
    assert 'id="straighten-grid-overlay" class="straighten-grid-overlay hidden"' in html
    assert html.index('id="crop-tool-toggle"') > html.index('data-group="geometry"')
    assert 'data-group="color-grading"' in html
    assert 'id="color-grading-match-hdr"' in html
    assert 'data-group="vignette"' in html
    assert 'id="vignette-center-handle"' in html
    assert 'id="export-sharpening"' in html
    assert 'id="export-resize-mode"' in html
    assert "Â" not in html and "Ã" not in html
    assert "90&deg;" in html and "8&times;8" in html
    assert ".color-wheel-pad::before" in css
    assert "inset: 4px" in css
    assert "inset 0 0 0 50px #7778" not in css
    for wheel in ["shadows", "midtones", "highlights"]:
        assert f'max="360" step="1" value="0" data-path="current.color_grading.{wheel}.hue"' in html
        assert f'max="100" step="1" value="0" data-path="current.color_grading.{wheel}.saturation"' in html
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
    assert "let diffusionDelta = spatial.rgb - qualified" in shader
    assert "let edgeProtection = smoothRange(0.025, 0.20, relativeDetail)" in shader
    assert "(1.0 - edgeProtection)" in shader
    assert "chroma = p[104] * (1.0 - 0.8 * smoothRange(0.88, 1.0, signal))" in shader
    assert "rgb *= exp2(grain * amount)" in shader
    assert "if (p[158] > 0.5) { rgb = vec3f(filmLumaFromSignal(0.5)); }" in shader


def test_film_look_panel_exposes_cinema_controls_and_branch_matching() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()

    assert html.index('data-group="film-look"') > html.index('data-group="curves"')
    assert 'id="film-reference-model"' not in html
    for label in ["Clean Cinema", "Soft Color Negative", "Dense Print", "High-Speed Texture"]:
        assert label in javascript
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
    assert "fn grainLayerNoise" in frontend_scripts()
    shader = frontend_scripts()
    assert "halationEdgeSource" in shader
    assert "center * smoothRange(0.004, 0.12, relativeEdge)" in shader
    assert "let edgeRadius = clamp(halationRadius / 4, 1, 16)" in shader
    assert "rgb * bloomMask * bloomMask" in shader
    assert "let edgeProtection = smoothRange(0.025, 0.20, relativeDetail)" in shader
    assert "Physical Extent" in html
    assert "Optical Spread" in html
    assert "% output diag" in javascript
    assert "exp2(0.55 * p[81] * p[79])" not in shader
    assert "mapped -= p[82] * p[79]" not in shader
    assert "mapped -= p[83] * p[79]" not in shader
    assert "if (p[108] < 1.0)" in shader
    assert "if (p[100] > 0.5 && p[108] < 1.0)" not in shader
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
    assert "film_grain_seed: 271828" in javascript


def test_rgb_primary_purity_slider_zeroes_align_with_hue_centers() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    for lane in ["hdr", "sdr"]:
        for primary in ["red", "green", "blue"]:
            assert f'id="{lane}-{primary}-purity" type="range" min="-95" max="95"' in html


def test_interactive_preview_scheduler_and_quality_preference_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()
    scheduler = frontend_scripts()
    source_transport = frontend_scripts()
    webgpu = frontend_scripts()
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    # One opt-in replaces the
    # Responsive / Balanced / Precise menu; full detail is the default.
    assert 'id="preview-latency"' not in html
    assert '<input id="preview-faster-dragging" type="checkbox">' in html
    assert '<span>Faster dragging</span>' in html
    assert html.count('title="For slower computers: shows a softer image while you drag, sharp again when you let go. Exports are unaffected."') == 2
    assert html.index('id="overlay-toggle"') < html.index('id="overlay-popover"') < html.index('id="preview-faster-dragging"')
    assert "armSettle(this.current, 0);" in scheduler
    assert ".toolbar-preview-resolution::after" in css
    assert "overflow-wrap: anywhere;" in css
    assert "white-space: normal;" in css
    assert 'id="scope-freshness"' in html and 'aria-live="polite"' in html
    assert '/static/preview-scheduler.js' in html
    assert 'const DEFAULT_PREVIEW_RESOLUTION = "1024"' in javascript
    assert 'new Set(["1024", "2048", "4096", "full"])' in javascript
    assert "rgba16f" in source_transport and "X-Pixel-Format" in source_transport
    assert "settledScopeFragmentMain" in webgpu
    assert "full-cell maximum" in webgpu
    assert "peakReductionMain" in webgpu


def test_electron_preview_correctness_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    javascript = frontend_scripts()
    main = (DESKTOP / "main.js").read_text(encoding="utf-8")
    preload = (DESKTOP / "preload.js").read_text(encoding="utf-8")

    assert 'id="preview-quality-status"' in html and 'aria-live="polite"' in html
    assert "Windows shell integrations and catalog applications" in javascript
    assert 'const nativeOverwriteApproved = ["win32", "darwin", "linux"].includes(process.platform)' in main
    assert 'id="rotate-apply"' in html and 'id="rotate-cancel"' in html
    assert 'label: "Rendering Mode"' in main
    assert all(label in main for label in ("Auto (Recommended)", "GPU Preferred", "CPU Compatibility"))
    assert "const activeBackend = backend;" in main
    assert 'activeBackend.authoringSecret' in main
    assert 'details.requestHeaders["X-HDR-Finisher-Token"] = backend.authoringSecret' not in main
    assert 'setRenderingMode: (mode)' in preload
    assert 'writeClipboardText: (value)' in preload
    assert 'resolveDroppedFile: async (file)' in preload
    assert 'webUtils.getPathForFile(file)' in preload
    assert 'handle("desktop:write-clipboard-text"' in main
    assert "clipboard.writeText(value)" in main
    assert "var highlightMask = smoothRange" in frontend_scripts()


def test_export_format_dropdown_does_not_claim_a_provisional_or_alternative_ranking() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert "Mainstream alternative" not in html
    assert "Provisional default" not in html
    assert '<option value="avif_gain_map">AVIF + gain map</option>' in html
    assert '<option value="jpeg_ultrahdr" selected>JPEG Ultra HDR</option>' in html


def test_manual_source_interpretation_status_contract() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'id="interpretation-linear-reference"' in html
    assert 'value="diffuse_white_1_0">1.0 = diffuse white (Affinity)' in html


def test_developed_camera_raw_distinguishes_source_profile_from_working_space() -> None:
    javascript = frontend_scripts()
    assert "Camera-native RAW developed through its camera profile into the ACEScg working space." in javascript


def test_desktop_source_open_handoffs_surface_failures() -> None:
    javascript = frontend_scripts()

    bridge_handler = javascript[
        javascript.index("desktop.onOpenRequest((selection)"):
        javascript.index("await desktop.rendererReady();")
    ]
    assert "openDesktopSelection(selection).catch((error)" in bridge_handler
    assert 'showUploadError(error?.message || "Could not open that source image.");' in bridge_handler

    browser_handler = frontend_declaration("confirmMediaBrowserSelection")
    assert "await openDesktopSelection({ kind: \"source\", ...selection });" in browser_handler
    assert 'showUploadError(error?.message || "Could not open that source image.");' in browser_handler


def test_project_open_shows_immediate_loading_feedback() -> None:
    status = frontend_declaration("beginProjectOpenStatus")
    project_open = frontend_declaration("openProjectFromPath")

    assert 'id: "project-open"' in status
    assert 'severity: "progress"' in status
    assert "`Opening project · ${label}" in status
    assert "els.projectOpen.disabled = true;" in project_open
    assert project_open.index("beginProjectOpenStatus(") < project_open.index("window.requestAnimationFrame(resolve)")


def test_phase_one_local_influence_and_latest_generation_contract() -> None:
    javascript = frontend_scripts()
    webgpu = frontend_scripts()

    assert "window.setTimeout(flushAuthoritativeLocalMaskDraft, 90)" in javascript
    assert "Math.min(1600, settledProxyLongEdge())" in javascript
    assert "Math.max(state.scopeGeneration + 1, generation ?? 0)" in javascript
    assert "p[1] * p[13]" in webgpu


def test_webgpu_local_detail_uses_ordered_gpu_chain_and_scaled_parameters() -> None:
    params = frontend_declaration("buildLocalParams")
    assert "values[14] = (Number(detail.texture_amount) || 0) / 100" in params
    assert "values[15] = (Number(detail.clarity_amount) || 0) / 125" in params
    assert "values[17] = Math.min(2, Math.max(0, (Number(detail.sharpen_amount) || 0) / 100))" in params
    assert "(Number(detail.sharpen_threshold) || 0) / 100" in params
    assert "values[20] = Math.min(1, Math.max(0.05, Number(sourcePixelScale) || 1))" in params


def test_phase_two_gpu_luma_retained_mask_contract() -> None:
    webgpu = frontend_scripts()

    assert "mask_feather: 0" in webgpu and "mask_opacity: 1" in webgpu
    # The luma feather is round (a fraction of the long edge on both axes)
    # and reads every texel it covers; 25 taps a quarter-sigma apart turned
    # thin strips into repeating copies.
    assert "const sigma = 0.09 * amount * Math.max(width, height) * referenceScale;" in webgpu
    # ...measured against the uncropped source, as the backend does.
    assert "state.gpuPreview.featherReferenceScale = maskFeatherReferenceScale;" in frontend_scripts()
    assert "for (var tap = -reach; tap <= reach; tap = tap + 1)" in webgpu
    assert "stepSize = max(1.0, sigma * 0.25)" not in webgpu
    assert "textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0)" in webgpu
    assert "params[131] = overlayMask && !noiseView ? 1 : 0" in webgpu
    assert "vec3f(p[133], p[134], p[135])" in webgpu


def test_phase_four_retained_boolean_mask_graph_contract() -> None:
    webgpu = frontend_scripts()

    assert "left * (1.0 - right)" in webgpu
