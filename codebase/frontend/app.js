const desktop = window.hdrFinisherDesktop || null;
const FINE_ADJUSTMENT_SCALE = 0.1;

const latitudePresets = {
  WIDE: {
    "hdr.exposure": [-4, 4, 0.05],
    "hdr.highlight_compression_softness": [0, 100, 0.5],
    "hdr.highlight_compression_peak_detail": [0, 100, 1],
    "hdr.highlight_compression_bias": [-100, 100, 1],
    "hdr.shadow_lift": [-0.5, 0.5, 0.005],
    "hdr.lift": [-0.5, 0.5, 0.005],
    "hdr.gamma": [-1, 1, 0.005],
    "hdr.gain": [-0.5, 0.5, 0.005],
    "hdr.contrast": [-1, 1, 0.001],
    "hdr.contrast_pivot": [0.02, 1, 0.0005],
    "sdr.exposure": [-4, 4, 0.05],
    "sdr.highlight_compression_softness": [0, 100, 0.5],
    "sdr.highlight_compression_peak_detail": [0, 100, 1],
    "sdr.highlight_compression_bias": [-100, 100, 1],
    "sdr.shadow": [-1, 1, 0.01],
    "sdr.lift": [-0.5, 0.5, 0.002],
    "sdr.gamma": [-1, 1, 0.005],
    "sdr.gain": [-0.5, 0.5, 0.005],
    "sdr.contrast": [-1, 1, 0.001],
    "sdr.contrast_pivot": [0.02, 0.98, 0.005],
  },
  MEDIUM: {
    "hdr.exposure": [-3, 3, 0.05],
    "hdr.highlight_compression_softness": [0, 100, 0.5],
    "hdr.highlight_compression_peak_detail": [0, 100, 1],
    "hdr.highlight_compression_bias": [-100, 100, 1],
    "hdr.shadow_lift": [-0.3, 0.3, 0.005],
    "hdr.lift": [-0.35, 0.35, 0.005],
    "hdr.gamma": [-0.75, 0.75, 0.005],
    "hdr.gain": [-0.35, 0.35, 0.005],
    "hdr.contrast": [-0.75, 0.75, 0.001],
    "hdr.contrast_pivot": [0.02, 0.75, 0.0005],
    "sdr.exposure": [-3, 3, 0.05],
    "sdr.highlight_compression_softness": [0, 100, 0.5],
    "sdr.highlight_compression_peak_detail": [0, 100, 1],
    "sdr.highlight_compression_bias": [-100, 100, 1],
    "sdr.shadow": [-0.5, 0.5, 0.01],
    "sdr.lift": [-0.35, 0.35, 0.002],
    "sdr.gamma": [-0.75, 0.75, 0.005],
    "sdr.gain": [-0.35, 0.35, 0.005],
    "sdr.contrast": [-0.75, 0.75, 0.001],
    "sdr.contrast_pivot": [0.05, 0.95, 0.005],
  },
  NARROW: {
    "hdr.exposure": [-2, 2, 0.05],
    "hdr.highlight_compression_softness": [0, 100, 0.5],
    "hdr.highlight_compression_peak_detail": [0, 100, 1],
    "hdr.highlight_compression_bias": [-100, 100, 1],
    "hdr.shadow_lift": [-0.2, 0.2, 0.005],
    "hdr.lift": [-0.25, 0.25, 0.005],
    "hdr.gamma": [-0.5, 0.5, 0.005],
    "hdr.gain": [-0.25, 0.25, 0.005],
    "hdr.contrast": [-0.5, 0.5, 0.001],
    "hdr.contrast_pivot": [0.02, 0.5, 0.0005],
    "sdr.exposure": [-2, 2, 0.05],
    "sdr.highlight_compression_softness": [0, 100, 0.5],
    "sdr.highlight_compression_peak_detail": [0, 100, 1],
    "sdr.highlight_compression_bias": [-100, 100, 1],
    "sdr.shadow": [-0.3, 0.3, 0.01],
    "sdr.lift": [-0.25, 0.25, 0.002],
    "sdr.gamma": [-0.5, 0.5, 0.005],
    "sdr.gain": [-0.25, 0.25, 0.005],
    "sdr.contrast": [-0.5, 0.5, 0.001],
    "sdr.contrast_pivot": [0.05, 0.95, 0.005],
  },
};

// Slider travel stays deliberately conservative for fast visual grading. These
// limits are the wider safety envelope accepted by direct numeric entry and the
// backend API. `decimals` controls stored precision, not slider step size.
const MANUAL_VALUE_RULES = {
  "hdr.exposure": { min: -8, max: 8, decimals: 2 },
  "hdr.highlight_compression_start_nits": { min: 1, max: 9999, decimals: 0 },
  "hdr.highlight_compression_target_nits": { min: 2, max: 10000, decimals: 0 },
  "hdr.highlight_compression_softness": { min: 0, max: 100, decimals: 1 },
  "hdr.highlight_compression_peak_detail": { min: 0, max: 100, decimals: 0 },
  "hdr.highlight_compression_manual_peak_nits": { min: 1, max: 1000000, decimals: 0 },
  "hdr.highlight_compression_bias": { min: -100, max: 100, decimals: 0 },
  "hdr.contrast": { min: -2, max: 2, decimals: 3 },
  "hdr.contrast_pivot": { min: 0.0001, max: 18, decimals: 4 },
  "hdr.shadow_lift": { min: -1, max: 1, decimals: 3 },
  "hdr.tone_equalizer_smoothing": { min: 0, max: 1, decimals: 2 },
  "sdr.exposure": { min: -8, max: 8, decimals: 2 },
  "sdr.highlight_compression_start_percent": { min: 1, max: 99, decimals: 0 },
  "sdr.highlight_compression_softness": { min: 0, max: 100, decimals: 1 },
  "sdr.highlight_compression_peak_detail": { min: 0, max: 100, decimals: 0 },
  "sdr.highlight_compression_manual_peak_percent": { min: 1, max: 1000000, decimals: 0 },
  "sdr.highlight_compression_bias": { min: -100, max: 100, decimals: 0 },
  "sdr.contrast": { min: -2, max: 2, decimals: 3 },
  "sdr.contrast_pivot": { min: 0.001, max: 0.999, decimals: 3 },
  "sdr.shadow": { min: -2, max: 2, decimals: 2 },
};

for (const lane of ["hdr", "sdr"]) {
  Object.assign(MANUAL_VALUE_RULES, {
    [`${lane}.white_balance_kelvin`]: { min: 1000, max: 25000, decimals: 0 },
    [`${lane}.tint`]: { min: -2, max: 2, decimals: 2 },
    [`${lane}.saturation`]: { min: -1, max: 3, decimals: 2, entryScale: 100 },
    [`${lane}.vibrance`]: { min: -1, max: 3, decimals: 2, entryScale: 100 },
    [`${lane}.red_hue`]: { min: -180, max: 180, decimals: 1 },
    [`${lane}.red_purity`]: { min: -99, max: 400, decimals: 1 },
    [`${lane}.green_hue`]: { min: -180, max: 180, decimals: 1 },
    [`${lane}.green_purity`]: { min: -99, max: 400, decimals: 1 },
    [`${lane}.blue_hue`]: { min: -180, max: 180, decimals: 1 },
    [`${lane}.blue_purity`]: { min: -99, max: 400, decimals: 1 },
    [`${lane}.tint_hue`]: { min: -180, max: 180, decimals: 1 },
    [`${lane}.tint_purity`]: { min: 0, max: 99, decimals: 1 },
    [`${lane}.lift`]: { min: -1, max: 1, decimals: 3 },
    [`${lane}.lift_range`]: { min: 0.5, max: 24, decimals: 2 },
    [`${lane}.lift_pivot`]: { min: -12, max: 12, decimals: 2 },
    [`${lane}.gamma`]: { min: -2, max: 2, decimals: 3 },
    [`${lane}.gamma_range`]: { min: 0.5, max: 24, decimals: 2 },
    [`${lane}.gamma_pivot`]: { min: -12, max: 12, decimals: 2 },
    [`${lane}.gain`]: { min: -1, max: 1, decimals: 3 },
    [`${lane}.gain_range`]: { min: 0.5, max: 24, decimals: 2 },
    [`${lane}.gain_pivot`]: { min: -12, max: 12, decimals: 2 },
  });
}

Object.assign(MANUAL_VALUE_RULES, {
  "shared.geometry.straighten_angle": { min: -45, max: 45, decimals: 1 },
  "current.color_grading.shadows.luminance_ev": { min: -1, max: 1, decimals: 2 },
  "current.color_grading.midtones.luminance_ev": { min: -1, max: 1, decimals: 2 },
  "current.color_grading.highlights.luminance_ev": { min: -1, max: 1, decimals: 2 },
  "current.color_grading.blending": { min: 0, max: 100, decimals: 0 },
  "current.color_grading.balance": { min: -100, max: 100, decimals: 0 },
  "current.vignette.amount": { min: -100, max: 100, decimals: 0 },
  "current.vignette.midpoint": { min: 0, max: 100, decimals: 0 },
  "current.vignette.roundness": { min: -100, max: 100, decimals: 0 },
  "current.vignette.feather": { min: 0, max: 100, decimals: 0 },
  "current.vignette.highlight_protection": { min: 0, max: 100, decimals: 0 },
  "current.detail.texture_amount": { min: -100, max: 100, decimals: 0 },
  "current.detail.clarity_amount": { min: -100, max: 100, decimals: 0 },
  "current.detail.clarity_radius_percent": { min: 0.2, max: 3, decimals: 2 },
  "current.detail.sharpen_amount": { min: 0, max: 100, decimals: 0 },
  "current.detail.sharpen_radius_px": { min: 0.3, max: 3, decimals: 2 },
  "current.detail.sharpen_threshold": { min: 0, max: 100, decimals: 0 },
  "current.film_look.look_strength": { min: 0, max: 100, decimals: 0 },
  "current.film_look.print_strength": { min: 0, max: 100, decimals: 0 },
  "current.film_look.print_contrast": { min: -100, max: 100, decimals: 0 },
  "current.film_look.print_toe": { min: -100, max: 100, decimals: 0 },
  "current.film_look.print_shoulder": { min: -100, max: 100, decimals: 0 },
  "current.film_look.color_density": { min: -100, max: 100, decimals: 0 },
  "current.film_look.red_response": { min: -100, max: 100, decimals: 0 },
  "current.film_look.green_response": { min: -100, max: 100, decimals: 0 },
  "current.film_look.blue_response": { min: -100, max: 100, decimals: 0 },
  "current.film_look.highlight_desaturation": { min: 0, max: 100, decimals: 0 },
  "current.film_look.shadow_desaturation": { min: 0, max: 100, decimals: 0 },
  "current.film_look.grain_amount": { min: 0, max: 100, decimals: 0 },
  "current.film_look.grain_size": { min: 0, max: 100, decimals: 0 },
  "current.film_look.grain_softness": { min: 0, max: 100, decimals: 0 },
  "current.film_look.grain_chroma": { min: 0, max: 100, decimals: 0 },
  "current.film_look.grain_shadow_response": { min: 0, max: 150, decimals: 0 },
  "current.film_look.grain_midtone_response": { min: 0, max: 150, decimals: 0 },
  "current.film_look.grain_highlight_response": { min: 0, max: 150, decimals: 0 },
  "current.film_look.film_resolution": { min: 0, max: 100, decimals: 0 },
  "current.film_look.halation_amount": { min: 0, max: 100, decimals: 0 },
  "current.film_look.halation_sensitivity": { min: 0, max: 100, decimals: 0 },
  "current.film_look.halation_radius": { min: 0, max: 5, decimals: 2 },
  "current.film_look.halation_hue_offset": { min: -100, max: 100, decimals: 0 },
  "current.film_look.halation_saturation": { min: 0, max: 100, decimals: 0 },
  "current.film_look.bloom_amount": { min: 0, max: 100, decimals: 0 },
  "current.film_look.bloom_sensitivity": { min: 0, max: 100, decimals: 0 },
  "current.film_look.bloom_radius": { min: 0, max: 10, decimals: 2 },
  "current.film_look.bloom_highlight_detail": { min: 0, max: 100, decimals: 0 },
  "current.film_look.image_softness": { min: 0, max: 100, decimals: 0 },
  "current.film_look.microcontrast": { min: -100, max: 100, decimals: 0 },
});

const TONE_EQUALIZER_MIN_EV = -6;
const TONE_EQUALIZER_MAX_EV = 6;
const toneEqualizerPqMaxEv = () => Math.log2(10000 / projectReferenceWhiteNits());
const TONE_EQUALIZER_MAX_ADJUSTMENT_EV = 2;
const TONE_EQUALIZER_MIN_TARGET_STEP = 0.001;
const TONE_EQUALIZER_MIN_NODE_COUNT = 2;
const TONE_EQUALIZER_MAX_NODE_COUNT = 16;
const DARKTABLE_TINT_HUE_STOPS = [
  [-180, [83, 167, 177]],
  [-120, [83, 104, 181]],
  [-60, [184, 79, 154]],
  [0, [224, 82, 115]],
  [60, [211, 173, 91]],
  [120, [84, 165, 121]],
  [180, [83, 167, 177]],
];

const MIN_ZOOM_PERCENT = 1;
const MAX_ZOOM_PERCENT = 3200;
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 200, 300, 400, 500, 600, 800, 1200, 1600, 2400, 3200];
const LAYOUT_DEFAULTS = { railW: 268, gradeW: 340, dockH: 252, dockOpen: true, dockTab: "histogram" };
const LAYOUT_LIMITS = {
  railW: [200, 380],
  gradeW: [340, 420],
  dockH: [240, 340],
};
const LAYOUT_SETTLE_DELAY = 120;
const COMPACT_WORKSPACE_QUERY = "(max-width: 1499px)";
const PREVIEW_RESOLUTION_OPTIONS = new Set(["1024", "2048", "4096"]);
const DEFAULT_PREVIEW_RESOLUTION = "1024";
const DEFAULT_SCOPE_QUALITY = "detailed";
const SCOPE_QUALITY_PROFILES = {
  performance: { densityGain: 1.35, horizontalSpread: 1, interactiveEdge: 384, settledEdge: 768, refinementEdge: 960 },
  detailed: { densityGain: 1.9, horizontalSpread: 2, interactiveEdge: 512, settledEdge: 960, refinementEdge: 1200 },
  reference: { densityGain: 2.15, horizontalSpread: 3, interactiveEdge: 640, settledEdge: 1200, refinementEdge: 1600 },
};
const WAVEFORM_HORIZONTAL_KERNELS = {
  1: { weights: [1, 2, 1], total: 4 },
  2: { weights: [1, 4, 6, 4, 1], total: 16 },
  3: { weights: [1, 6, 15, 20, 15, 6, 1], total: 64 },
};
const LEGACY_UI_PREFERENCE_KEYS = new Set([
  "hdr-finisher:high-quality-preview:v1",
  "hdr-finisher:scope-zoom:v1",
  "hdr-finisher:compare-layout:v1",
  "hdr-finisher-source-collapsed",
  "hdr-finisher-chrome-proof-v1",
]);
const COMPARE_LAYOUTS = new Set(["single", "split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]);
const waveformCanvasCache = new WeakMap();
const vectorscopeTransferLutCache = new Map();
const localBrushMaskCanvasCache = new Map();
const localBrushGestureCanvasCache = new WeakMap();
const localTintedMaskCanvasCache = new WeakMap();
const localAuthoritativeMaskCache = new Map();
const localAuthoritativeMaskRequests = new Map();
const localComparisonMaskCache = new Map();
const localComparisonMaskRequests = new Map();
const localComparisonCompositeCache = new Map();
const LOCAL_COMPARISON_COLORS = Object.freeze({
  parent: Object.freeze([255, 38, 61]),
  child: Object.freeze([38, 117, 255]),
  overlap: Object.freeze([255, 48, 226]),
});
const geometryCoordinateMapCache = new Map();
const geometryCoordinateMapRequests = new Map();
let localMaskOverlayFrame = 0;
let pathMarchingAntFrame = 0;

const defaultDenoiseDocument = () => ({
  schema_version: 1,
  hdr: { enabled: false, controls: { amount: 0.5, luminance: 0.5, color_noise: 0.5, detail_recovery: 0.5 }, analysis: { algorithm_version: "compact-haar-residual-v1", preset: "photo_fine", levels: 2, noise_threshold: 3, luma_sigma: 0.035, chroma_sigma: 0.035 } },
  sdr: { enabled: false, controls: { amount: 0.5, luminance: 0.5, color_noise: 0.5, detail_recovery: 0.5 }, analysis: { algorithm_version: "compact-haar-residual-v1", preset: "photo_fine", levels: 2, noise_threshold: 3, luma_sigma: 0.035, chroma_sigma: 0.035 } },
});

const DENOISE_ANALYSIS_PRESETS = Object.freeze({
  photo_fine: Object.freeze({ levels: 2, noise_threshold: 3, luma_sigma: 0.035, chroma_sigma: 0.035, note: "Two-scale cleanup for fine photographic noise." }),
  photo_mixed: Object.freeze({ levels: 3, noise_threshold: 3.4, luma_sigma: 0.05, chroma_sigma: 0.07, note: "Three-scale cleanup for mixed luma noise and larger color structure." }),
  render_fine: Object.freeze({ levels: 2, noise_threshold: 3.6, luma_sigma: 0.025, chroma_sigma: 0.025, note: "Two-scale cleanup tuned for fine, channel-balanced render noise." }),
  render_coarse: Object.freeze({ levels: 4, noise_threshold: 4, luma_sigma: 0.065, chroma_sigma: 0.065, note: "Four-scale cleanup for larger Monte Carlo noise; inspect edges and texture carefully." }),
  custom: Object.freeze({ note: "Custom scale count, threshold, and scene-linear luma/color noise levels." }),
});

const SDR_MATCH_GRAIN_FIELDS = Object.freeze([
  "grain_enabled",
  "grain_amount",
  "grain_size",
  "grain_softness",
  "grain_chroma",
  "grain_film_format",
  "grain_capture_geometry",
  "grain_custom_width_mm",
  "grain_custom_height_mm",
  "grain_shadow_response",
  "grain_midtone_response",
  "grain_highlight_response",
]);

const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  activeWorkflow: "import",
  gradeMode: "global",
  editDocument: null,
  editRevision: 0,
  selectedLocalId: null,
  selectedSubMaskId: null,
  localTool: null,
  localCreationTool: null,
  pendingLocalAdjustment: null,
  pendingSubMask: null,
  localShowMask: false,
  localOverlayColor: "#ff263d",
  compareWithoutLocals: false,
  localPointerGesture: null,
  localPathDraft: null,
  localPathCreatePendingId: null,
  localPathEditMode: "path",
  selectedPathNode: null,
  pathKeyboardTarget: "node",
  hoveredPathTarget: null,
  localPathCursor: null,
  pathInvalidGesture: false,
  localBrushCursor: null,
  localBrushPreviewPinned: false,
  localBrushVisibleBounds: null,
  localAdjustmentMenuId: null,
  localMaskDraftDirty: false,
  localMaskDraftTimer: 0,
  localMaskDraftController: null,
  localMaskDraftGeneration: 0,
  localMaskDraftPending: null,
  pathMaskProgressTimer: 0,
  pathMaskProgressTarget: null,
  pathMaskProgressStartedAt: 0,
  localPreviewDirty: false,
  localMaskCommitDepth: 0,
  localMaskCommitRefreshPending: false,
  localErase: false,
  projectPath: "",
  globalEditDirty: false,
  globalEditGeneration: 0,
  globalEditSyncPending: null,
  globalEditHistoryGroup: null,
  globalEditHistorySequence: 0,
  sdrMatchGrainOverridePending: false,
  documentDirty: false,
  denoise: defaultDenoiseDocument(),
  denoiseDocumentSessionId: null,
  denoiseRuntime: {
    hdr: { status: "off", dirty: false, generation: 0, showOriginal: false, error: "" },
    sdr: { status: "off", dirty: false, generation: 0, showOriginal: false, error: "" },
  },
  scopeMode: "histogram",
  scopeChannelMode: "composite",
  scopeMaxNits: 4000,
  scopeQuality: DEFAULT_SCOPE_QUALITY,
  scopeRegionEnabled: false,
  scopeRegion: null,
  scopeRegionDrag: null,
  scopeRegionRefreshTimer: 0,
  scopeRegionSessionId: null,
  sourceSettingsOpen: false,
  rawSettingsOpen: false,
  activeImportJobId: null,
  importGeneration: 0,
  projectOpenGeneration: 0,
  projectOpenController: null,
  mediaBrowserGeneration: 0,
  mediaPreviewGeneration: 0,
  mediaPreviewRequest: null,
  mediaPreviewObjectUrl: null,
  mediaBrowserEntries: [],
  mediaBrowserSortKey: "name",
  mediaBrowserSortDirection: "ascending",
  mediaBrowserColumnWidths: null,
  mediaBrowserColumnResize: null,
  mediaBrowserPreviewWidth: null,
  mediaBrowserPreviewResize: null,
  mediaBrowserResolver: null,
  lensProfileGeneration: 0,
  importInProgress: false,
  metadataOpen: false,
  interpretationGateDismissed: false,
  zoomMode: "fit",
  zoomPercent: 100,
  zoomReferenceFrame: null,
  geometryPresentationPending: false,
  geometryTransformHandoffSignature: null,
  activeDockTab: "histogram",
  dockCollapsed: false,
  lastScope: null,
  scopeGeneration: 0,
  previewResolution: DEFAULT_PREVIEW_RESOLUTION,
  renderingMode: "auto",
  appPreferences: null,
  acceptedPresentation: null,
  detailInteractionRestore: null,
  previewScheduler: null,
  gpuPreparedLane: { hdr: false, sdr: false },
  scopeZoneOverlay: null,
  lastExportPath: "",
  defaultExportDirectory: "",
  desktopEnvironment: null,
  desktopDocumentStateKey: "",
  compareHoldTimer: null,
  compareHeld: false,
  comparePeekActive: false,
  compareLayout: "single",
  comparisonRenderedLane: null,
  comparisonRenderedGeneration: null,
  comparisonRenderedGeometry: null,
  previewGeneration: { hdr: 0, sdr: 0 },
  cropMode: false,
  cropDraftGeometry: null,
  rotateDraftGeometry: null,
  cropEditBaseCrop: null,
  cropGuide: "none",
  cropGridDensity: 8,
  cropDrag: null,
  geometryTool: null,
  perspectiveMode: false,
  perspectiveDraftGeometry: null,
  perspectiveTool: null,
  perspectiveGuides: null,
  perspectiveGuidesTouched: { vertical: false, horizontal: false },
  perspectiveGuidesDirty: false,
  perspectiveResetPending: false,
  perspectiveGuideDrag: null,
  perspectiveSolveController: null,
  perspectivePreviewController: null,
  perspectivePreviewTimer: 0,
  perspectivePreviewUrl: null,
  straightenGestureActive: false,
  straightenPreviewBaseAngle: null,
  straightenPreviewFrameRect: null,
  vignettePickCenter: false,
  vignetteCenterGesture: null,
  groupPresetContext: null,
  previewCache: { hdr: null, sdr: null },
  previewControllers: { hdr: null, sdr: null },
  previewInfoByLane: {
    hdr: {
      mediaType: "n/a",
      transport: "n/a",
      colorSpace: "n/a",
      transfer: "n/a",
      bitDepth: "n/a",
      notes: "No preview yet",
    },
    sdr: {
      mediaType: "n/a",
      transport: "n/a",
      colorSpace: "n/a",
      transfer: "n/a",
      bitDepth: "n/a",
      notes: "No preview yet",
    },
  },
  adjustments: {
    hdr: {
      tone_section_enabled: true,
      highlight_section_enabled: false,
      tone_equalizer_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_compression_start_nits: 400,
      highlight_compression_target_nits: 1000,
      highlight_compression_softness: 0,
      highlight_compression_mode: "peak_fit",
      highlight_compression_peak_measurement: "maximum",
      highlight_compression_source_peak_nits: 1000,
      highlight_compression_manual_peak_nits: 1000,
      highlight_compression_peak_detail: 35,
      highlight_compression_bias: 0,
      highlight_compression_color_handling: "smooth_rolloff",
      shadow_lift: 0,
      tone_equalizer_nodes: defaultToneEqualizerNodes(),
      tone_equalizer_influence_radius: 1.5,
      tone_equalizer_smoothing: 0.5,
      lift: 0,
      gamma: 0,
      gain: 0,
      lift_pivot: -2,
      lift_range: 4,
      gamma_pivot: 0,
      gamma_range: 4.25,
      gain_pivot: 2,
      gain_range: 4,
      contrast: 0,
      contrast_pivot: 0.1845,
      white_balance_kelvin: 6500,
      tint: 0,
      saturation: 0,
      vibrance: 0,
      red_hue: 0,
      red_purity: 0,
      green_hue: 0,
      green_purity: 0,
      blue_hue: 0,
      blue_purity: 0,
      tint_hue: 0,
      tint_purity: 0,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    sdr: {
      rendering_version: "highlight_v2",
      base_section_enabled: true,
      use_authored_base: true,
      tone_section_enabled: true,
      highlight_section_enabled: true,
      tone_equalizer_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_recovery: 0.6,
      highlight_compression_start_percent: 50,
      highlight_compression_softness: 0,
      highlight_compression_mode: "peak_fit",
      highlight_compression_peak_measurement: "maximum",
      highlight_compression_source_peak_percent: 100,
      highlight_compression_manual_peak_percent: 100,
      highlight_compression_peak_detail: 35,
      highlight_compression_bias: 0,
      highlight_compression_color_handling: "smooth_rolloff",
      tone_contrast: 1,
      tone_skew: 0,
      shadow: 0,
      tone_equalizer_nodes: defaultToneEqualizerNodes(),
      tone_equalizer_influence_radius: 1.5,
      tone_equalizer_smoothing: 0.5,
      lift: 0,
      gamma: 0,
      gain: 0,
      lift_pivot: -2,
      lift_range: 4,
      gamma_pivot: 0,
      gamma_range: 4.25,
      gain_pivot: 2,
      gain_range: 4,
      contrast: 0,
      contrast_pivot: 0.5,
      white_balance_kelvin: 6500,
      tint: 0,
      saturation: 0,
      vibrance: 0,
      red_hue: 0,
      red_purity: 0,
      green_hue: 0,
      green_purity: 0,
      blue_hue: 0,
      blue_purity: 0,
      tint_hue: 0,
      tint_purity: 0,
      tone_mapper: "filmic",
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    shared: {
      overlay_mode: "off",
      false_color_band_anchor: "project",
      false_color_ceiling_nits: 1000,
      overlay_opacity: 0.72,
      overlay_threshold: 100,
    },
  },
  selectedCurveChannel: "luma",
  activeCurvePoint: null,
  selectedCurvePoint: 1,
  activeToneEqualizerBand: null,
  selectedToneEqualizerBand: 2,
  previewAbortController: null,
  overlayAbortController: null,
  scopeRequestInFlight: null,
  pendingScopeRequest: null,
  gpuScopeRequestInFlight: null,
  pendingGpuScopeRequest: null,
  refreshTimer: null,
  settleTimer: null,
  gpuRenderSerial: 0,
  laneSwitchGeneration: 0,
  gpuRenderFrame: null,
  gpuQueuedLane: null,
  gpuPreview: null,
  gpuSurfaceHdr: false,
  gpuSurfaceHdrByLane: { hdr: false, sdr: false },
  presentationCapability: null,
  previewInfo: {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  },
  displayInfo: buildDisplayProbe(),
  layout: { ...LAYOUT_DEFAULTS },
  layoutSettleTimer: null,
  compactWorkspace: false,
  compactSourceOpen: false,
  wideSourceCollapsed: false,
  proofEnabled: false,
  proofArtifact: null,
  proofReconstruction: null,
  proofSdrReconstruction: null,
  proofDeliveryAvailable: true,
  proofPreview: "delivered",
  proofDirty: true,
  proofFormat: "jpeg_ultrahdr",
  proofTarget: "auto",
  proofCustomNits: 1000,
  proofDisplayId: "",
  proofWatermarkEnabled: true,
  displayTelemetry: null,
};

let scopeResizeObserver = null;
let scopeResizeFrame = null;
let viewerResizeObserver = null;
let viewerResizeFrame = null;
let graphEditorResizeObserver = null;

const defaultFilmLook = () => ({
  reference_model: "custom",
  look_strength: 100,
  print_strength: 0,
  print_contrast: 0,
  print_toe: 0,
  print_shoulder: 0,
  color_density: 0,
  red_response: 0,
  green_response: 0,
  blue_response: 0,
  highlight_desaturation: 0,
  shadow_desaturation: 0,
  grain_enabled: true,
  grain_amount: 0,
  grain_size: 50,
  grain_softness: 25,
  grain_chroma: 0,
  grain_film_format: "35mm",
  grain_capture_geometry: "frame",
  grain_custom_width_mm: 36,
  grain_custom_height_mm: 24,
  grain_shadow_response: 100,
  grain_midtone_response: 100,
  grain_highlight_response: 100,
  grain_view_map: false,
  film_resolution: 100,
  halation_enabled: true,
  halation_amount: 0,
  halation_sensitivity: 75,
  halation_radius: 0.2,
  halation_hue_offset: 0,
  halation_saturation: 75,
  halation_view_map: false,
  bloom_enabled: true,
  bloom_amount: 0,
  bloom_sensitivity: 80,
  bloom_radius: 0.5,
  bloom_highlight_detail: 75,
  image_structure_enabled: true,
  image_softness: 0,
  microcontrast: 0,
});

const FILM_LOOK_PRESET_RECIPE_VERSION = 1;

function completeFilmLookRecipe(values) {
  return Object.freeze({
    ...defaultFilmLook(),
    ...values,
    reference_model: "custom",
    halation_view_map: false,
    grain_view_map: false,
  });
}

const FILM_LOOK_PRESETS = Object.freeze([
  Object.freeze({
    id: "clean-cinema",
    name: "Clean Cinema",
    description: "Fine texture, restrained density, and a clean highlight finish.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 42, print_contrast: 6, print_toe: 3, print_shoulder: 10, color_density: 9, red_response: 3, blue_response: -2, highlight_desaturation: 12, shadow_desaturation: 5, grain_amount: 14, grain_size: 22, grain_softness: 50, grain_chroma: 10, grain_film_format: "65mm", grain_shadow_response: 82, grain_highlight_response: 110, film_resolution: 98, halation_amount: 6, halation_sensitivity: 84, halation_radius: 0.16, halation_saturation: 68, bloom_amount: 4, bloom_sensitivity: 88, bloom_radius: 0.32, bloom_highlight_detail: 90, image_softness: 2, microcontrast: -2 }),
  }),
  Object.freeze({
    id: "soft-color-negative",
    name: "Soft Color Negative",
    description: "Gentle shoulders, soft color separation, and quiet portrait texture.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 48, print_contrast: -2, print_toe: 7, print_shoulder: 22, color_density: 12, red_response: 5, green_response: -1, blue_response: -4, highlight_desaturation: 28, shadow_desaturation: 9, grain_amount: 22, grain_size: 38, grain_softness: 52, grain_chroma: 13, grain_film_format: "35mm", grain_shadow_response: 88, grain_midtone_response: 98, grain_highlight_response: 112, film_resolution: 94, halation_amount: 9, halation_sensitivity: 78, halation_radius: 0.24, halation_saturation: 74, bloom_amount: 9, bloom_sensitivity: 76, bloom_radius: 0.62, bloom_highlight_detail: 78, image_softness: 8, microcontrast: -7 }),
  }),
  Object.freeze({
    id: "dense-print",
    name: "Dense Print",
    description: "Deeper color, firmer print contrast, and a richer projected finish.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 62, print_contrast: 18, print_toe: 12, print_shoulder: 15, color_density: 26, red_response: 7, green_response: -2, blue_response: -6, highlight_desaturation: 20, shadow_desaturation: 12, grain_amount: 30, grain_size: 46, grain_softness: 34, grain_chroma: 18, grain_film_format: "35mm", grain_shadow_response: 92, grain_midtone_response: 104, grain_highlight_response: 118, film_resolution: 90, halation_amount: 13, halation_sensitivity: 72, halation_radius: 0.28, halation_hue_offset: 2, halation_saturation: 82, bloom_amount: 8, bloom_sensitivity: 78, bloom_radius: 0.5, bloom_highlight_detail: 80, image_softness: 6, microcontrast: -3 }),
  }),
  Object.freeze({
    id: "high-speed-texture",
    name: "High-Speed Texture",
    description: "Coarse responsive grain, open glow, and softened fine detail for low-light character.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 54, print_contrast: 7, print_toe: 10, print_shoulder: 18, color_density: 17, red_response: 8, green_response: -3, blue_response: -7, highlight_desaturation: 30, shadow_desaturation: 17, grain_amount: 56, grain_size: 76, grain_softness: 29, grain_chroma: 27, grain_film_format: "16mm", grain_shadow_response: 100, grain_midtone_response: 114, grain_highlight_response: 130, film_resolution: 80, halation_amount: 16, halation_sensitivity: 66, halation_radius: 0.36, halation_hue_offset: 3, halation_saturation: 86, bloom_amount: 12, bloom_sensitivity: 70, bloom_radius: 0.7, bloom_highlight_detail: 70, image_softness: 13, microcontrast: -9 }),
  }),
]);

const defaultColorGrading = () => ({
  shadows: { hue: 0, saturation: 0, luminance_ev: 0 },
  midtones: { hue: 0, saturation: 0, luminance_ev: 0 },
  highlights: { hue: 0, saturation: 0, luminance_ev: 0 },
  blending: 50,
  balance: 0,
});

const defaultVignette = () => ({ amount: 0, midpoint: 50, roundness: 0, feather: 75, highlight_protection: 0, center_x: 0.5, center_y: 0.5 });
const defaultGeometry = () => ({
  rotation: 0,
  flip_horizontal: false,
  flip_vertical: false,
  straighten_angle: 0,
  perspective_horizontal: 0,
  perspective_vertical: 0,
  perspective_rotate: 0,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  ratio_mode: "free",
  custom_ratio: { width: 1, height: 1 },
});

function geometrySignature() {
  return JSON.stringify(state.adjustments.shared?.geometry || defaultGeometry());
}

const IDENTITY_GEOMETRY_COORDINATE_MAP = Object.freeze({
  outputToSource: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  sourceToOutput: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]),
});

function geometryTransformIsNeutral(geometry = state.adjustments.shared?.geometry) {
  const crop = geometry?.crop || {};
  return (Number(geometry?.rotation) || 0) === 0
    && !geometry?.flip_horizontal
    && !geometry?.flip_vertical
    && Math.abs(Number(geometry?.straighten_angle) || 0) < 1e-8
    && Math.abs(Number(geometry?.perspective_horizontal) || 0) < 1e-8
    && Math.abs(Number(geometry?.perspective_vertical) || 0) < 1e-8
    && Math.abs(Number(geometry?.perspective_rotate) || 0) < 1e-8
    && Math.abs((Number(crop.x) || 0)) < 1e-8
    && Math.abs((Number(crop.y) || 0)) < 1e-8
    && Math.abs((Number(crop.width) || 1) - 1) < 1e-8
    && Math.abs((Number(crop.height) || 1) - 1) < 1e-8;
}

function geometryCoordinateMapKey(signature = geometrySignature(), longEdge = settledProxyLongEdge()) {
  return `${state.session?.session_id || "none"}:${longEdge}:${signature}`;
}

function currentGeometryCoordinateMap() {
  if (geometryTransformIsNeutral()) return IDENTITY_GEOMETRY_COORDINATE_MAP;
  return geometryCoordinateMapCache.get(geometryCoordinateMapKey()) || null;
}

function projectivePoint(matrix, point) {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-10) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

async function ensureGeometryCoordinateMap() {
  if (!state.session || geometryTransformIsNeutral()) return IDENTITY_GEOMETRY_COORDINATE_MAP;
  const sessionId = state.session.session_id;
  const signature = geometrySignature();
  const longEdge = settledProxyLongEdge();
  const key = geometryCoordinateMapKey(signature, longEdge);
  const cached = geometryCoordinateMapCache.get(key);
  if (cached) return cached;
  const inflight = geometryCoordinateMapRequests.get(key);
  if (inflight) return inflight;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  const request = fetch(`/api/session/${state.session.session_id}/geometry-map`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments, edit_revision: state.editRevision, long_edge: longEdge }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Geometry coordinate map failed (${response.status}).`);
    const payload = await response.json();
    if (state.session?.session_id !== sessionId || signature !== geometrySignature()) return null;
    const result = {
      outputToSource: payload.output_to_source,
      sourceToOutput: payload.source_to_output,
      outputWidth: payload.output_width,
      outputHeight: payload.output_height,
      fullOutputWidth: payload.full_output_width,
      fullOutputHeight: payload.full_output_height,
    };
    geometryCoordinateMapCache.set(key, result);
    while (geometryCoordinateMapCache.size > 12) {
      geometryCoordinateMapCache.delete(geometryCoordinateMapCache.keys().next().value);
    }
    queueLocalMaskOverlayRender();
    applyZoomGeometry();
    if (state.cropMode) constrainCropToRatio();
    return result;
  }).catch((error) => {
    console.warn("Source-anchored editor geometry is unavailable.", error);
    return null;
  }).finally(() => geometryCoordinateMapRequests.delete(key));
  geometryCoordinateMapRequests.set(key, request);
  return request;
}

function gpuPreviewEligible(lane = state.currentView) {
  return state.renderingMode !== "cpu"
    && Boolean(state.gpuPreview?.available)
    && state.gpuPreview.supportsLocalAdjustments(lane, state.compareWithoutLocals ? [] : localAdjustments());
}

function gpuPreviewSourceOptions(lane = state.currentView) {
  const match = state.editDocument?.sdr_match;
  if (lane !== "sdr" || !match?.active) return null;
  const boundary = match.manual_highlight_boundary_ratio ?? match.automatic_highlight_boundary_ratio;
  const inheritedGrain = match.grain_source === "captured_hdr"
    ? {
        filmLook: match.captured_hdr_adjustments?.film_look || null,
        filmLookSectionEnabled: match.captured_hdr_adjustments?.film_look_section_enabled !== false,
        filmGrainSeed: match.captured_shared_adjustments?.film_grain_seed,
      }
    : null;
  return {
    identity: [match.algorithm_version, match.signature, match.captured_reference_white_nits, boundary].join(":"),
    inheritedGrain,
  };
}

function normalizedPreviewResolution(value = state.previewResolution) {
  const normalized = String(value || "");
  return PREVIEW_RESOLUTION_OPTIONS.has(normalized) ? normalized : DEFAULT_PREVIEW_RESOLUTION;
}

function previewResolutionLabel(value = state.previewResolution) {
  const normalized = normalizedPreviewResolution(value);
  return `${Math.round(Number(normalized) / 1024)}K`;
}

function previewTargetLongEdge(value = state.previewResolution) {
  const normalized = normalizedPreviewResolution(value);
  const sourceEdge = Math.max(Number(state.session?.source?.width) || 0, Number(state.session?.source?.height) || 0);
  const requested = Number(normalized);
  return Math.max(256, Math.min(sourceEdge || requested, requested));
}

function previewNeedsRefinement() {
  return previewTargetLongEdge() > settledProxyLongEdge();
}

function applyPreviewResolution(value, { schedule = true } = {}) {
  state.previewResolution = normalizedPreviewResolution(value);
  if (els.previewResolution) {
    els.previewResolution.value = state.previewResolution;
    els.previewResolution.title = "Sets the maximum preview width and height. Higher settings use more memory; export quality is unchanged.";
  }
  state.gpuPreview?.resetSession(state.session?.session_id || null);
  if (state.denoise?.[state.currentView]?.enabled) {
    state.denoiseRuntime[state.currentView].status = "dirty";
    state.denoiseRuntime[state.currentView].dirty = true;
    if (schedule) window.setTimeout(() => recalculateDenoise(), 300);
  }
  state.gpuPreparedLane = { hdr: false, sdr: false };
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    if (previewNeedsRefinement()) markRefining();
    if (schedule) debouncePreview(state.currentView);
  }
  renderReadouts();
  renderCurrentPreviewSize();
}

function acceptPresentation(lane, tier, width, height, transport, fallbackReason = "", sourceSerial = null, generation = state.previewGeneration[lane]) {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  state.acceptedPresentation = {
    lane,
    generation,
    geometrySignature: geometrySignature(),
    tier,
    width: Number(width) || null,
    height: Number(height) || null,
    longEdge,
    transport,
    sourceSerial,
    fallbackReason,
  };
  if (lane === state.currentView && width && height) {
    if (state.geometryTransformHandoffSignature === geometrySignature()) {
      state.geometryTransformHandoffSignature = null;
      clearRotateDraftTransformProperties();
      clearInteractiveStraightenPreview();
    }
    const sessionId = state.session?.session_id || null;
    state.zoomReferenceFrame = {
      sessionId,
      geometrySignature: geometrySignature(),
      // Proxy resolution can change between interactive, settled, and refined
      // presentations. Preserve the session's display scale while accepting
      // the authoritative aspect ratio of the newly presented geometry.
      longEdge: state.zoomReferenceFrame?.sessionId === sessionId
        ? state.zoomReferenceFrame.longEdge
        : longEdge,
      aspect: Number(width) / Number(height),
    };
    state.geometryPresentationPending = false;
    applyZoomGeometry();
    if (state.adjustments.shared.geometry.perspective_horizontal
      || state.adjustments.shared.geometry.perspective_vertical) void ensureGeometryCoordinateMap();
  }
  const targetLabel = previewResolutionLabel();
  const dimensions = width && height ? `${Number(width)} × ${Number(height)}` : longEdge ? `${longEdge}px max` : "";
  const label = `${fallbackReason ? "Fallback · " : ""}${targetLabel}${dimensions ? ` · ${dimensions}` : ""}`;
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = label;
  renderCurrentPreviewSize();
  renderReadouts();
}

function markRefining() {
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = "Refining…";
  renderCurrentPreviewSize({ refining: true });
}

const defaultAdjustments = () => ({
  hdr: {
    tone_section_enabled: true,
    highlight_section_enabled: false,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    detail_section_enabled: true,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10 },
    exposure: 0,
    highlight_compression_start_nits: 400,
    highlight_compression_target_nits: 1000,
    highlight_compression_softness: 0,
    highlight_compression_mode: "peak_fit",
    highlight_compression_peak_measurement: "maximum",
    highlight_compression_source_peak_nits: 1000,
    highlight_compression_manual_peak_nits: 1000,
    highlight_compression_peak_detail: 35,
    highlight_compression_bias: 0,
    highlight_compression_color_handling: "smooth_rolloff",
    shadow_lift: 0,
    tone_equalizer_nodes: defaultToneEqualizerNodes(),
    tone_equalizer_influence_radius: 1.5,
    tone_equalizer_smoothing: 0.5,
    lift: 0,
    gamma: 0,
    gain: 0,
    lift_pivot: -2,
    lift_range: 4,
    gamma_pivot: 0,
    gamma_range: 4.25,
    gain_pivot: 2,
    gain_range: 4,
    contrast: 0,
    contrast_pivot: 0.1845,
    white_balance_kelvin: 6500,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    red_hue: 0,
    red_purity: 0,
    green_hue: 0,
    green_purity: 0,
    blue_hue: 0,
    blue_purity: 0,
    tint_hue: 0,
    tint_purity: 0,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  sdr: {
    rendering_version: "highlight_v2",
    base_section_enabled: true,
    use_authored_base: true,
    tone_section_enabled: true,
    highlight_section_enabled: true,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    detail_section_enabled: true,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10 },
    exposure: 0,
    highlight_recovery: 0.6,
    highlight_compression_start_percent: 50,
    highlight_compression_softness: 0,
    highlight_compression_mode: "peak_fit",
    highlight_compression_peak_measurement: "maximum",
    highlight_compression_source_peak_percent: 100,
    highlight_compression_manual_peak_percent: 100,
    highlight_compression_peak_detail: 35,
    highlight_compression_bias: 0,
    highlight_compression_color_handling: "smooth_rolloff",
    tone_contrast: 1,
    tone_skew: 0,
    shadow: 0,
    tone_equalizer_nodes: defaultToneEqualizerNodes(),
    tone_equalizer_influence_radius: 1.5,
    tone_equalizer_smoothing: 0.5,
    lift: 0,
    gamma: 0,
    gain: 0,
    lift_pivot: -2,
    lift_range: 4,
    gamma_pivot: 0,
    gamma_range: 4.25,
    gain_pivot: 2,
    gain_range: 4,
    contrast: 0,
    contrast_pivot: 0.5,
    white_balance_kelvin: 6500,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    red_hue: 0,
    red_purity: 0,
    green_hue: 0,
    green_purity: 0,
    blue_hue: 0,
    blue_purity: 0,
    tint_hue: 0,
    tint_purity: 0,
    tone_mapper: "filmic",
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  shared: {
    overlay_mode: "off",
    false_color_band_anchor: "project",
    false_color_ceiling_nits: 1000,
    overlay_opacity: 0.72,
    overlay_threshold: 100,
    film_grain_seed: 271828,
    geometry: defaultGeometry(),
  },
});

// Keep the pre-session UI state on the same schema returned by the backend.
state.adjustments = defaultAdjustments();

const els = {
  denoiseBypass: document.getElementById("denoise-bypass"),
  denoiseMethod: document.getElementById("denoise-method"),
  denoiseMethodNote: document.getElementById("denoise-method-note"),
  denoiseCustomSettings: document.getElementById("denoise-custom-settings"),
  denoiseLevels: document.getElementById("denoise-levels"),
  denoiseThreshold: document.getElementById("denoise-threshold"),
  denoiseLumaSigma: document.getElementById("denoise-luma-sigma"),
  denoiseChromaSigma: document.getElementById("denoise-chroma-sigma"),
  denoiseThresholdValue: document.getElementById("denoise-threshold-value"),
  denoiseLumaSigmaValue: document.getElementById("denoise-luma-sigma-value"),
  denoiseChromaSigmaValue: document.getElementById("denoise-chroma-sigma-value"),
  denoiseAmount: document.getElementById("denoise-amount"),
  denoiseLuminance: document.getElementById("denoise-luminance"),
  denoiseColor: document.getElementById("denoise-color"),
  denoiseDetail: document.getElementById("denoise-detail"),
  denoiseAmountValue: document.getElementById("denoise-amount-value"),
  denoiseLuminanceValue: document.getElementById("denoise-luminance-value"),
  denoiseColorValue: document.getElementById("denoise-color-value"),
  denoiseDetailValue: document.getElementById("denoise-detail-value"),
  denoiseRecalculate: document.getElementById("denoise-recalculate"),
  denoiseState: document.getElementById("denoise-state"),
  denoiseStatus: document.getElementById("denoise-status"),
  hdrReferenceWhite: document.getElementById("hdr-reference-white"),
  projectOpen: document.getElementById("project-open"),
  projectSave: document.getElementById("project-save"),
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  appShell: document.querySelector(".app-shell"),
  workspaceMain: document.querySelector(".workspace-main"),
  sourceSplitter: document.getElementById("source-splitter"),
  gradeSplitter: document.getElementById("grade-splitter"),
  dockSplitter: document.getElementById("dock-splitter"),
  importButton: document.getElementById("import-button"),
  testPatternButton: document.getElementById("test-pattern-button"),
  emptyImportButton: document.getElementById("empty-import-button"),
  experimentalDngNote: document.getElementById("experimental-dng-note"),
  ejectButton: document.getElementById("eject-button"),
  badge: document.getElementById("badge"),
  sourceRailExpand: document.getElementById("source-rail-expand"),
  sessionNameWrap: document.getElementById("session-name-wrap"),
  sessionNameTooltip: document.getElementById("session-name-tooltip"),
  copySourcePath: document.getElementById("copy-source-path"),
  capabilitySummary: document.getElementById("capability-summary"),
  workflowTabs: [...document.querySelectorAll("[data-workflow-tab]")],
  sourceSettingsToggle: document.getElementById("source-settings-toggle"),
  sourceSettingsPanel: document.getElementById("source-settings-panel"),
  interpretationMode: document.getElementById("interpretation-mode"),
  interpretationColorSpace: document.getElementById("interpretation-color-space"),
  interpretationTransfer: document.getElementById("interpretation-transfer"),
  interpretationLinearReference: document.getElementById("interpretation-linear-reference"),
  sourceSettingsNote: document.getElementById("source-settings-note"),
  applyInterpretationButton: document.getElementById("apply-interpretation"),
  resetInterpretationButton: document.getElementById("reset-interpretation"),
  rawSettingsSection: document.getElementById("raw-settings-section"),
  rawSettingsToggle: document.getElementById("raw-settings-toggle"),
  rawSettingsPanel: document.getElementById("raw-settings-panel"),
  lensMode: document.getElementById("lens-mode"),
  manualLensControls: document.getElementById("manual-lens-controls"),
  lensProfileSearch: document.getElementById("lens-profile-search"),
  lensProfile: document.getElementById("lens-profile"),
  lensDistortion: document.getElementById("lens-distortion"),
  lensChromaticAberration: document.getElementById("lens-ca"),
  lensVignetting: document.getElementById("lens-vignetting"),
  lensFocal: document.getElementById("lens-focal"),
  lensAperture: document.getElementById("lens-aperture"),
  lensDistance: document.getElementById("lens-distance"),
  lensSettingsNote: document.getElementById("lens-settings-note"),
  applyRawSettings: document.getElementById("apply-raw-settings"),
  rawHighlightGroup: document.getElementById("raw-highlight-group"),
  rawHighlightBypass: document.getElementById("raw-highlight-bypass"),
  rawHighlightReset: document.getElementById("raw-highlight-reset"),
  rawHighlightMethod: document.getElementById("raw-highlight-method"),
  rawHighlightThreshold: document.getElementById("raw-highlight-threshold"),
  rawHighlightThresholdValue: document.getElementById("raw-highlight-threshold-value"),
  metadataToggle: document.getElementById("metadata-toggle"),
  metadataPanel: document.getElementById("metadata-panel"),
  interpretationGate: document.getElementById("interpretation-gate"),
  interpretationGateCopy: document.getElementById("interpretation-gate-copy"),
  acceptInterpretation: document.getElementById("accept-interpretation"),
  manualInterpretation: document.getElementById("manual-interpretation"),
  curveEditor: document.getElementById("curve-editor"),
  toneEqualizerEditor: document.getElementById("tone-equalizer-editor"),
  highlightCompressionGraph: document.getElementById("highlight-compression-graph"),
  sdrHighlightCompressionGraph: document.getElementById("sdr-highlight-compression-graph"),
  sdrHighlightCompressionSummary: document.getElementById("sdr-highlight-compression-summary"),
  highlightCompressionSummary: document.getElementById("highlight-compression-summary"),
  toneEqualizerBandValue: document.getElementById("tone-equalizer-band-value"),
  toneEqualizerBandLabel: document.getElementById("tone-equalizer-band-label"),
  toneEqualizerBandOutput: document.getElementById("tone-equalizer-band-output"),
  toneEqualizerAdd: document.getElementById("tone-equalizer-add"),
  toneEqualizerRemove: document.getElementById("tone-equalizer-remove"),
  toneEqualizerRadiusDown: document.getElementById("tone-equalizer-radius-down"),
  toneEqualizerRadiusUp: document.getElementById("tone-equalizer-radius-up"),
  toneEqualizerRadius: document.getElementById("tone-equalizer-radius"),
  sdrToneEqualizerEditor: document.getElementById("sdr-tone-equalizer-editor"),
  sdrToneEqualizerBandValue: document.getElementById("sdr-tone-equalizer-band-value"),
  sdrToneEqualizerBandLabel: document.getElementById("sdr-tone-equalizer-band-label"),
  sdrToneEqualizerBandOutput: document.getElementById("sdr-tone-equalizer-band-output"),
  sdrToneEqualizerAdd: document.getElementById("sdr-tone-equalizer-add"),
  sdrToneEqualizerRemove: document.getElementById("sdr-tone-equalizer-remove"),
  sdrToneEqualizerRadiusDown: document.getElementById("sdr-tone-equalizer-radius-down"),
  sdrToneEqualizerRadiusUp: document.getElementById("sdr-tone-equalizer-radius-up"),
  sdrToneEqualizerRadius: document.getElementById("sdr-tone-equalizer-radius"),
  sdrMatchHdrBands: document.getElementById("sdr-match-hdr-bands"),
  sdrMatchEntireActions: document.getElementById("sdr-match-entire-actions"),
  sdrMatchEntire: document.getElementById("sdr-match-entire"),
  sdrMatchRevert: document.getElementById("sdr-match-revert"),
  sdrMatchEntireStatus: document.getElementById("sdr-match-entire-status"),
  detailSdrActions: document.getElementById("detail-sdr-actions"),
  detailMatchHdr: document.getElementById("detail-match-hdr"),
  overlayPresetNote: document.getElementById("overlay-preset-note"),
  falseColorKey: document.getElementById("false-color-key"),
  curveReset: document.getElementById("curve-reset"),
  curveAdd: document.getElementById("curve-add"),
  curveRemove: document.getElementById("curve-remove"),
  curveChannelButtons: [...document.querySelectorAll("[data-curve-channel]")],
  metadataList: document.getElementById("metadata-list"),
  workflowContextList: document.getElementById("workflow-context-list"),
  previewOutputList: document.getElementById("preview-output-list"),
  displayInfoList: document.getElementById("display-info-list"),
  sourcePreviewList: document.getElementById("source-preview-list"),
  sessionName: document.getElementById("session-name"),
  previewStage: document.getElementById("preview-stage"),
  hdrPresentationWarning: document.getElementById("hdr-presentation-warning"),
  hdrPresentationWarningCopy: document.getElementById("hdr-presentation-warning-copy"),
  previewPrimaryPane: document.getElementById("preview-primary-pane"),
  previewSecondaryPane: document.getElementById("preview-secondary-pane"),
  previewCanvas: document.getElementById("preview-canvas"),
  previewImage: document.getElementById("preview-image"),
  comparisonCanvas: document.getElementById("comparison-canvas"),
  comparisonImage: document.getElementById("comparison-image"),
  previewOverlay: document.getElementById("preview-overlay"),
  localMaskOverlay: document.getElementById("local-mask-overlay"),
  pathMaskProgress: document.getElementById("path-mask-progress"),
  pathMaskProgressCopy: document.getElementById("path-mask-progress-copy"),
  straightenGridOverlay: document.getElementById("straighten-grid-overlay"),
  perspectiveEditorOverlay: document.getElementById("perspective-editor-overlay"),
  perspectiveGuideSvg: document.getElementById("perspective-guide-svg"),
  perspectiveGuideHandles: document.getElementById("perspective-guide-handles"),
  gradeModeGlobal: document.getElementById("grade-mode-global"),
  gradeModeLocal: document.getElementById("grade-mode-local"),
  localAdjustmentGroup: document.getElementById("local-adjustments-group"),
  localAdjustmentCount: document.getElementById("local-adjustment-count"),
  localPanel: document.getElementById("local-adjustments-panel"),
  localToolButtons: [...document.querySelectorAll("[data-local-tool]")],
  localEraser: document.getElementById("local-eraser"),
  localAdjustmentList: document.getElementById("local-adjustment-list"),
  localEmpty: document.getElementById("local-empty"),
  localEditor: document.getElementById("local-editor"),
  localCompare: document.getElementById("local-compare"),
  localRename: document.getElementById("local-rename"),
  localDuplicate: document.getElementById("local-duplicate"),
  localAddAdjustment: document.getElementById("local-add-adjustment"),
  localInvert: document.getElementById("local-invert"),
  localDelete: document.getElementById("local-delete"),
  localMoveUp: document.getElementById("local-move-up"),
  localMoveDown: document.getElementById("local-move-down"),
  localShowMask: document.getElementById("local-show-mask"),
  localOverlayColorButton: document.getElementById("local-overlay-color-button"),
  localOverlayColorInput: document.getElementById("local-overlay-color"),
  localOverlayColorSwatch: document.getElementById("local-overlay-color-swatch"),
  localMaskTreeSummary: document.getElementById("local-mask-tree-summary"),
  localMaskFooterActions: document.getElementById("local-mask-footer-actions"),
  localGradientControls: document.getElementById("local-gradient-controls"),
  localOpacity: document.getElementById("local-opacity"),
  localOpacityValue: document.getElementById("local-opacity-value"),
  localLaneButtons: [...document.querySelectorAll("[data-local-lane]")],
  localGradeOutputs: [...document.querySelectorAll("[data-local-grade-output]")],
  localGradeControls: [...document.querySelectorAll("[data-local-grade]")],
  localExposureValue: document.getElementById("local-exposure-value"),
  chromeProofImage: document.getElementById("chrome-proof-image"),
  chromeProofWatermark: document.getElementById("chrome-proof-watermark"),
  chromeProofToggle: document.getElementById("chrome-proof-toggle"),
  chromeProofWatermarkToggle: document.getElementById("chrome-proof-watermark-toggle"),
  chromeProofInlineStatus: document.getElementById("chrome-proof-inline-status"),
  chromeProofRefresh: document.getElementById("chrome-proof-refresh"),
  openProofExternal: document.getElementById("open-proof-external"),
  chromeProofFormat: document.getElementById("chrome-proof-format"),
  chromeProofTarget: document.getElementById("chrome-proof-target"),
  chromeProofCustomField: document.getElementById("chrome-proof-custom-field"),
  chromeProofCustomNits: document.getElementById("chrome-proof-custom-nits"),
  chromeProofDisplay: document.getElementById("chrome-proof-display"),
  chromeProofStatus: document.getElementById("chrome-proof-status"),
  proofPreviewSwitch: document.getElementById("proof-preview-switch"),
  proofPreviewButtons: [...document.querySelectorAll("[data-proof-preview]")],
  emptyState: document.getElementById("empty-state"),
  previewStatus: document.getElementById("preview-status"),
  previewStatusCopy: document.getElementById("preview-status-copy"),
  previewProgress: document.getElementById("preview-progress"),
  cancelImport: document.getElementById("cancel-import"),
  falseColorLegend: document.getElementById("false-color-legend"),
  viewerBranchNote: document.getElementById("viewer-branch-note"),
  compareButton: document.getElementById("compare-button"),
  compareLayoutButtons: [...document.querySelectorAll("button[data-compare-layout]")],
  zoomFit: document.getElementById("zoom-fit"),
  zoomActual: document.getElementById("zoom-actual"),
  zoomOut: document.getElementById("zoom-out"),
  zoomIn: document.getElementById("zoom-in"),
  zoomSlider: document.getElementById("zoom-slider"),
  zoomReadout: document.getElementById("zoom-readout"),
  overlayToggle: document.getElementById("overlay-toggle"),
  overlayClose: document.getElementById("overlay-close"),
  overlayPopover: document.getElementById("overlay-popover"),
  previewToggle: document.getElementById("preview-toggle"),
  previewClose: document.getElementById("preview-close"),
  previewPopover: document.getElementById("preview-popover"),
  scopeRegionToggle: document.getElementById("scope-region-toggle"),
  scopeRegionOverlay: document.getElementById("scope-region-overlay"),
  scopeRegionBox: document.getElementById("scope-region-box"),
  scopeTitle: document.getElementById("scope-title"),
  scopeNote: document.getElementById("scope-note"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  scopeRegionBadge: document.getElementById("scope-region-badge"),
  scopeFreshness: document.getElementById("scope-freshness"),
  scopeMode: document.getElementById("scope-mode"),
  scopeChannelMode: document.getElementById("scope-channel-mode"),
  scopeDetail: document.getElementById("scope-detail"),
  scopeZoom: document.getElementById("scope-zoom"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  analysisDock: document.getElementById("analysis-dock"),
  dockCollapse: document.getElementById("dock-collapse"),
  dockSummary: document.getElementById("dock-summary"),
  dockTabs: [...document.querySelectorAll("[data-dock-tab]")],
  scopeView: document.getElementById("scope-view"),
  technicalView: document.getElementById("technical-view"),
  previewResolution: document.getElementById("preview-resolution"),
  previewQualityStatus: document.getElementById("preview-quality-status"),
  exportSheet: document.getElementById("export-sheet"),
  exportConfirmButton: document.getElementById("export-confirm-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportDirectoryBrowse: document.getElementById("export-directory-browse"),
  directoryBrowser: document.getElementById("directory-browser"),
  directoryBrowserPath: document.getElementById("directory-browser-path"),
  directoryBrowserTitle: document.getElementById("directory-browser-title"),
  directoryBrowserGo: document.getElementById("directory-browser-go"),
  directoryBrowserUp: document.getElementById("directory-browser-up"),
  directoryBrowserPin: document.getElementById("directory-browser-pin"),
  directoryBrowserStatus: document.getElementById("directory-browser-status"),
  directoryBrowserLayout: document.querySelector(".media-browser-layout"),
  directoryBrowserTable: document.querySelector(".media-browser-table"),
  directoryBrowserList: document.getElementById("directory-browser-list"),
  directoryBrowserSortButtons: [...document.querySelectorAll("[data-media-browser-sort]")],
  directoryBrowserColumnResizers: [...document.querySelectorAll("[data-media-browser-resize]")],
  directoryBrowserRecents: document.getElementById("directory-browser-recents"),
  directoryBrowserPinned: document.getElementById("directory-browser-pinned"),
  directoryBrowserLocations: document.getElementById("directory-browser-locations"),
  directoryBrowserPreview: document.getElementById("directory-browser-preview"),
  directoryBrowserPreviewFrame: document.querySelector(".media-browser-preview-image-frame"),
  directoryBrowserPreviewPane: document.querySelector(".media-browser-preview"),
  directoryBrowserPreviewResizer: document.querySelector(".media-browser-preview-resizer"),
  directoryBrowserSelection: document.getElementById("directory-browser-selection"),
  directoryBrowserPreviewNote: document.getElementById("directory-browser-preview-note"),
  directoryBrowserClose: document.getElementById("directory-browser-close"),
  directoryBrowserCancel: document.getElementById("directory-browser-cancel"),
  directoryBrowserSelect: document.getElementById("directory-browser-select"),
  directoryBrowserFilenameRow: document.getElementById("directory-browser-filename-row"),
  directoryBrowserFilename: document.getElementById("directory-browser-filename"),
  exportFormat: document.getElementById("export-format"),
  exportQualityRow: document.querySelector(".export-quality-row"),
  exportQuality: document.getElementById("export-quality"),
  exportQualityValue: document.getElementById("export-quality-value"),
  jpegAdvancedSettings: document.getElementById("jpeg-advanced-settings"),
  avifSettings: document.getElementById("avif-settings"),
  avifBitDepth: document.getElementById("avif-bit-depth"),
  avifChromaSubsampling: document.getElementById("avif-chroma-subsampling"),
  jpegUltrahdrSettings: document.getElementById("jpeg-ultrahdr-settings"),
  jpegUltrahdrChromaSubsampling: document.getElementById("jpeg-ultrahdr-chroma-subsampling"),
  sdrJpegSettings: document.getElementById("sdr-jpeg-settings"),
  jpegChromaSubsampling: document.getElementById("jpeg-chroma-subsampling"),
  jpegxlSettings: document.getElementById("jpegxl-settings"),
  jpegxlPrecision: document.getElementById("jpegxl-precision"),
  sdrPngSettings: document.getElementById("sdr-png-settings"),
  sdrPngBitDepth: document.getElementById("sdr-png-bit-depth"),
  exportDitheringField: document.getElementById("export-dithering-field"),
  exportDithering: document.getElementById("export-dithering"),
  exportDitheringNote: document.getElementById("export-dithering-note"),
  exportMetadataPolicyField: document.getElementById("export-metadata-policy-field"),
  exportMetadataPolicy: document.getElementById("export-metadata-policy"),
  exportMetadataPolicyNote: document.getElementById("export-metadata-policy-note"),
  exportResolvedEncoding: document.getElementById("export-resolved-encoding"),
  exportReferenceWhite: document.getElementById("export-reference-white"),
  jpegGainMapQuality: document.getElementById("jpeg-gain-map-quality"),
  jpegGainMapQualityValue: document.getElementById("jpeg-gain-map-quality-value"),
  jpegGainMapScale: document.getElementById("jpeg-gain-map-scale"),
  exportResult: document.getElementById("export-result"),
  exportResultPath: document.getElementById("export-result-path"),
  copyExportPath: document.getElementById("copy-export-path"),
  revealExportPath: document.getElementById("reveal-export-path"),
  openExportPath: document.getElementById("open-export-path"),
  exportPreset: document.getElementById("export-preset"),
  exportFormatNote: document.getElementById("export-format-note"),
  avifGainMapQuality: document.getElementById("avif-gain-map-quality"),
  avifGainMapQualityValue: document.getElementById("avif-gain-map-quality-value"),
  avifGainMapScale: document.getElementById("avif-gain-map-scale"),
  viewButtons: [...document.querySelectorAll("[data-kind]")],
  controls: [...document.querySelectorAll("[data-path]")],
  valueOutputs: [...document.querySelectorAll("[data-value-path]")],
  lanePanels: [...document.querySelectorAll("[data-lane-panel]")],
  groupToggles: [...document.querySelectorAll(".group-toggle")],
  groupResets: [...document.querySelectorAll("[data-reset-group]")],
  groupPresetDialog: document.getElementById("group-preset-dialog"),
  groupPresetTitle: document.getElementById("group-preset-title"),
  groupPresetContext: document.getElementById("group-preset-context"),
  groupPresetList: document.getElementById("group-preset-list"),
  groupPresetName: document.getElementById("group-preset-name"),
  groupPresetSave: document.getElementById("group-preset-save"),
  groupPresetStatus: document.getElementById("group-preset-status"),
  groupPresetClose: document.getElementById("group-preset-close"),
  sdrMatchHdrColors: document.getElementById("sdr-match-hdr-colors"),
  filmLookReset: document.getElementById("film-look-reset"),
  filmLookMatchHdr: document.getElementById("film-look-match-hdr"),
  filmLookSdrActions: document.getElementById("film-look-sdr-actions"),
  filmLookState: document.getElementById("film-look-state"),
  sectionBypasses: [...document.querySelectorAll("[data-section-path]")],
  controlRows: [...document.querySelectorAll("[data-control-path]")],
  modifiedCounts: [...document.querySelectorAll("[data-modified-count]")],
  gradeModifiedSummary: document.getElementById("grade-modified-summary"),
  curveGroupState: document.getElementById("curve-group-state"),
  cropToolToggle: document.getElementById("crop-tool-toggle"),
  rotateToolToggle: document.getElementById("rotate-tool-toggle"),
  cropToolSettings: document.getElementById("crop-tool-settings"),
  rotateToolSettings: document.getElementById("rotate-tool-settings"),
  cropStraighten: document.getElementById("crop-straighten"),
  cropEditorOverlay: document.getElementById("crop-editor-overlay"),
  cropBox: document.getElementById("crop-box"),
  cropGuideCanvas: document.getElementById("crop-guide-canvas"),
  cropDone: document.getElementById("crop-done"),
  cropCancel: document.getElementById("crop-cancel"),
  cropResetFrame: document.getElementById("crop-reset-frame"),
  cropGuide: document.getElementById("crop-guide"),
  cropGridDensity: document.getElementById("crop-grid-density"),
  cropGridDensityValue: document.getElementById("crop-grid-density-value"),
  cropGridDensityRow: document.getElementById("crop-grid-density-row"),
  cropRatio: document.getElementById("crop-ratio"),
  cropCustomRatioWidth: document.getElementById("crop-custom-ratio-width"),
  cropCustomRatioHeight: document.getElementById("crop-custom-ratio-height"),
  customRatioFields: document.getElementById("custom-ratio-fields"),
  rotateLeft: document.getElementById("rotate-left"),
  rotateRight: document.getElementById("rotate-right"),
  rotateApply: document.getElementById("rotate-apply"),
  rotateCancel: document.getElementById("rotate-cancel"),
  flipHorizontal: document.getElementById("flip-horizontal"),
  flipVertical: document.getElementById("flip-vertical"),
  swapCustomRatio: document.getElementById("swap-custom-ratio"),
  perspectiveVerticalTool: document.getElementById("perspective-vertical-tool"),
  perspectiveHorizontalTool: document.getElementById("perspective-horizontal-tool"),
  perspectiveGuideApply: document.getElementById("perspective-guide-apply"),
  perspectiveHorizontal: document.getElementById("perspective-horizontal"),
  perspectiveVertical: document.getElementById("perspective-vertical"),
  perspectiveRotate: document.getElementById("perspective-rotate"),
  perspectiveHorizontalValue: document.getElementById("perspective-horizontal-value"),
  perspectiveVerticalValue: document.getElementById("perspective-vertical-value"),
  perspectiveRotateValue: document.getElementById("perspective-rotate-value"),
  perspectiveStatus: document.getElementById("perspective-status"),
  perspectiveApply: document.getElementById("perspective-apply"),
  perspectiveCancel: document.getElementById("perspective-cancel"),
  colorGradingReset: document.getElementById("color-grading-reset"),
  colorGradingMatchHdr: document.getElementById("color-grading-match-hdr"),
  colorGradingSdrActions: document.getElementById("color-grading-sdr-actions"),
  colorGradingState: document.getElementById("color-grading-state"),
  vignetteReset: document.getElementById("vignette-reset"),
  vignetteMatchHdr: document.getElementById("vignette-match-hdr"),
  vignetteSdrActions: document.getElementById("vignette-sdr-actions"),
  vignetteState: document.getElementById("vignette-state"),
  vignettePickCenter: document.getElementById("vignette-pick-center"),
  vignetteCenterHandle: document.getElementById("vignette-center-handle"),
  vignetteCenterX: document.getElementById("vignette-center-x"),
  vignetteCenterY: document.getElementById("vignette-center-y"),
  vignetteHighlightProtectionRow: document.getElementById("vignette-highlight-protection-row"),
  exportResizeMode: document.getElementById("export-resize-mode"),
  exportLongEdge: document.getElementById("export-long-edge"),
  exportWidth: document.getElementById("export-width"),
  exportHeight: document.getElementById("export-height"),
  exportLongEdgeRow: document.getElementById("export-long-edge-row"),
  exportFitRow: document.getElementById("export-fit-row"),
  exportPreventEnlargement: document.getElementById("export-prevent-enlargement"),
  exportSharpening: document.getElementById("export-sharpening"),
};

const controlGroups = {
  // Perspective owns its own three fields and its own Reset; Crop & Rotate's
  // Reset should only touch what it owns, not silently sweep up perspective too.
  geometry: [
    "shared.geometry.rotation",
    "shared.geometry.flip_horizontal",
    "shared.geometry.flip_vertical",
    "shared.geometry.straighten_angle",
    "shared.geometry.crop",
    "shared.geometry.ratio_mode",
    "shared.geometry.custom_ratio",
  ],
  perspective: ["shared.geometry.perspective_horizontal", "shared.geometry.perspective_vertical", "shared.geometry.perspective_rotate"],
  "hdr-tone": ["hdr.exposure", "hdr.contrast", "hdr.contrast_pivot", "hdr.shadow_lift"],
  "hdr-highlights": ["hdr.highlight_compression_mode", "hdr.highlight_compression_start_nits", "hdr.highlight_compression_target_nits", "hdr.highlight_compression_softness", "hdr.highlight_compression_peak_detail", "hdr.highlight_compression_peak_measurement", "hdr.highlight_compression_manual_peak_nits", "hdr.highlight_compression_bias", "hdr.highlight_compression_color_handling"],
  "hdr-equalizer": ["hdr.tone_equalizer_nodes", "hdr.tone_equalizer_influence_radius", "hdr.tone_equalizer_smoothing"],
  "hdr-color": ["hdr.white_balance_kelvin", "hdr.tint", "hdr.saturation", "hdr.vibrance", "hdr.red_hue", "hdr.red_purity", "hdr.green_hue", "hdr.green_purity", "hdr.blue_hue", "hdr.blue_purity", "hdr.tint_hue", "hdr.tint_purity"],
  "hdr-zones": ["hdr.lift", "hdr.lift_range", "hdr.lift_pivot", "hdr.gamma", "hdr.gamma_range", "hdr.gamma_pivot", "hdr.gain", "hdr.gain_range", "hdr.gain_pivot"],
  "hdr-detail": ["hdr.detail"],
  "sdr-tone": ["sdr.exposure", "sdr.contrast", "sdr.contrast_pivot", "sdr.shadow"],
  "sdr-highlights": ["sdr.highlight_compression_mode", "sdr.highlight_compression_start_percent", "sdr.highlight_compression_softness", "sdr.highlight_compression_peak_detail", "sdr.highlight_compression_peak_measurement", "sdr.highlight_compression_manual_peak_percent", "sdr.highlight_compression_bias", "sdr.highlight_compression_color_handling"],
  "sdr-equalizer": ["sdr.tone_equalizer_nodes", "sdr.tone_equalizer_influence_radius", "sdr.tone_equalizer_smoothing"],
  "sdr-color": ["sdr.white_balance_kelvin", "sdr.tint", "sdr.saturation", "sdr.vibrance", "sdr.red_hue", "sdr.red_purity", "sdr.green_hue", "sdr.green_purity", "sdr.blue_hue", "sdr.blue_purity", "sdr.tint_hue", "sdr.tint_purity"],
  "sdr-zones": ["sdr.lift", "sdr.lift_range", "sdr.lift_pivot", "sdr.gamma", "sdr.gamma_range", "sdr.gamma_pivot", "sdr.gain", "sdr.gain_range", "sdr.gain_pivot"],
  "sdr-detail": ["sdr.detail"],
};

const falseColorPaletteTokens = [
  "--exposure-band-deep-shadow",
  "--exposure-band-shadow",
  "--exposure-band-low-mid",
  "--exposure-band-mid",
  "--exposure-band-white",
  "--exposure-band-highlight",
  "--exposure-band-peak",
];
const COLOR_CONTROL_KEYS = controlGroups["hdr-color"].map((path) => path.slice("hdr.".length));

const sectionPathForGroup = {
  "hdr-tone": "hdr.tone_section_enabled",
  "hdr-highlights": "hdr.highlight_section_enabled",
  "hdr-equalizer": "hdr.tone_equalizer_section_enabled",
  "hdr-color": "hdr.color_section_enabled",
  "hdr-zones": "hdr.primaries_section_enabled",
  "sdr-tone": "sdr.tone_section_enabled",
  "sdr-highlights": "sdr.highlight_section_enabled",
  "sdr-equalizer": "sdr.tone_equalizer_section_enabled",
  "sdr-color": "sdr.color_section_enabled",
  "sdr-zones": "sdr.primaries_section_enabled",
  "hdr-detail": "hdr.detail_section_enabled",
  "sdr-detail": "sdr.detail_section_enabled",
};

const GROUP_PRESET_LABELS = {
  tone: "Tone",
  highlights: "Highlight Compression",
  equalizer: "Exposure Bands",
  color: "Color",
  zones: "Lift, Gamma, Gain",
  base: "Base Rendition",
  curves: "Curves",
  "color-grading": "Color Grading",
  detail: "Detail",
  "film-look": "Film Look",
  vignette: "Vignette",
  denoise: "Denoise",
};

function groupPresetPaths(groupId) {
  if (controlGroups[groupId]) return [...controlGroups[groupId]];
  const separator = groupId.indexOf("-");
  const lane = groupId.slice(0, separator);
  const group = groupId.slice(separator + 1);
  if (!["hdr", "sdr"].includes(lane)) return [];
  if (group === "denoise") return [`denoise.${lane}.controls`, `denoise.${lane}.analysis`];
  if (group === "curves") return ["luma_curve", "red_curve", "green_curve", "blue_curve"].map((key) => `${lane}.${key}`);
  if (["color-grading", "detail", "film-look", "vignette"].includes(group)) return [`${lane}.${group.replaceAll("-", "_")}`];
  return [];
}

function groupPresetContextForElement(groupElement) {
  const rawGroup = groupElement?.dataset.group || "";
  if (["geometry", "perspective", "local-adjustments"].includes(rawGroup)) return null;
  const groupId = ["curves", "color-grading", "detail", "film-look", "vignette", "denoise"].includes(rawGroup)
    ? `${state.currentView}-${rawGroup}`
    : rawGroup;
  const paths = groupPresetPaths(groupId);
  if (!paths.length) return null;
  const separator = groupId.indexOf("-");
  const lane = groupId.slice(0, separator);
  const group = groupId.slice(separator + 1);
  return { groupId, lane, group, label: GROUP_PRESET_LABELS[group] || group, paths };
}

function groupPresetPathValue(context, path) {
  return context.group === "denoise" ? getValueByPath(state, path) : getValueByPath(state.adjustments, path);
}

function setGroupPresetPathValue(context, path, value) {
  if (context.group === "denoise") setValueByPath(state, path, value);
  else setValueByPath(state.adjustments, path, value);
}

const branchCopy = {
  hdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
  sdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
};

const capabilityForFormat = {
  avif_gain_map: "avif_gain_map_encoder",
  jpeg_ultrahdr: "ultrahdr_encoder",
  jpegxl_hdr: "jpegxl_export",
  sdr_jpegxl: "jpegxl_export",
  sdr_jpeg: "pillow",
  sdr_png: "pillow",
};

const exportPresetMappings = {
  avif_gain_map: {
    web_default: { quality: 85, avifBitDepth: "10", avifChromaSubsampling: "420", avifGainMapQuality: 85, avifGainMapScale: "half", exportDithering: "off", exportMetadataPolicy: "none" },
    web_optimized: { quality: 75, avifBitDepth: "10", avifChromaSubsampling: "420", avifGainMapQuality: 70, avifGainMapScale: "half", exportDithering: "off", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, avifBitDepth: "12", avifChromaSubsampling: "444", avifGainMapQuality: 100, avifGainMapScale: "full", exportDithering: "off", exportMetadataPolicy: "none" },
  },
  jpeg_ultrahdr: {
    web_default: { quality: 85, jpegGainMapQuality: 90, jpegGainMapScale: "full", jpegUltrahdrChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 75, jpegGainMapQuality: 80, jpegGainMapScale: "half", jpegUltrahdrChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegGainMapQuality: 100, jpegGainMapScale: "full", jpegUltrahdrChromaSubsampling: "444", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  jpegxl_hdr: {
    web_default: { quality: 90, jpegxlPrecision: "uint12", exportDithering: "off", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 80, jpegxlPrecision: "uint10", exportDithering: "off", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegxlPrecision: "uint16", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  sdr_jpegxl: {
    web_default: { quality: 90, exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 80, exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, exportDithering: "subtle", exportMetadataPolicy: "all_except_location" },
  },
  sdr_png: {
    web_default: { quality: 100, sdrPngBitDepth: "8", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 100, sdrPngBitDepth: "8", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, sdrPngBitDepth: "16", exportDithering: "off", exportMetadataPolicy: "all_except_location" },
  },
  sdr_jpeg: {
    web_default: { quality: 85, jpegChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "copyright" },
    web_optimized: { quality: 75, jpegChromaSubsampling: "420", exportDithering: "auto", exportMetadataPolicy: "none" },
    maximum_fidelity: { quality: 100, jpegChromaSubsampling: "444", exportDithering: "subtle", exportMetadataPolicy: "all_except_location" },
  },
};

const exportFormatNotes = {
  avif_gain_map: "Efficient adaptive HDR for current Chromium browsers, with an SDR base for other decoders.",
  jpeg_ultrahdr: "Broad JPEG fallback with HDR in compatible viewers; recompression can remove the gain map.",
  jpegxl_hdr: "Direct Rec.2020 PQ HDR for specialist workflows; no SDR fallback and limited browser support.",
  sdr_jpegxl: "Compact SDR for JPEG XL-aware workflows; browser support remains uneven.",
  sdr_png: "Lossless SDR delivery with 8-bit web and 16-bit fidelity choices.",
  sdr_jpeg: "Conventional compact SDR JPEG, including very wide images up to 65,500 pixels.",
};

const exportOptionTooltips = {
  avifBitDepth: {
    8: "Smallest AVIF primary image; lower gradient precision.",
    10: "Balanced AVIF precision for HDR publishing.",
    12: "Highest available AVIF primary-image precision.",
  },
  avifChromaSubsampling: {
    420: "Smallest primary image; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  avifGainMapScale: {
    full: "Stores the gain map at full image resolution.",
    half: "Stores a half-resolution gain map to reduce delivery size.",
  },
  jpegGainMapScale: {
    full: "Stores the gain map at full image resolution.",
    half: "Stores a half-resolution gain map to reduce delivery size.",
  },
  jpegUltrahdrChromaSubsampling: {
    420: "Smallest primary JPEG; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  jpegChromaSubsampling: {
    420: "Smallest JPEG; suitable for most photographic content.",
    422: "Retains more horizontal color detail.",
    444: "Retains full color resolution for fine colored edges and text.",
  },
  jpegxlPrecision: {
    uint10: "Compact integer HDR precision.",
    uint12: "Balanced integer HDR precision.",
    uint16: "Highest practical integer precision.",
    float16: "Specialist half-float interchange.",
    float32: "Specialist full-float interchange with the largest files.",
  },
  sdrPngBitDepth: {
    8: "Standard web-compatible PNG precision.",
    16: "High-precision PNG interchange.",
  },
  exportDithering: {
    auto: "Applies deterministic signal-domain dither when exporting 8-bit output.",
    off: "Disables export dithering.",
    subtle: "Applies subtle signal-domain dither.",
  },
  exportMetadataPolicy: {
    none: "Removes optional source metadata while retaining required color and HDR signaling.",
    copyright: "Preserves copyright metadata only.",
    all_except_location: "Preserves source metadata except location information.",
    all_including_location: "Preserves all supported source metadata, including possible GPS coordinates.",
  },
  exportResizeMode: {
    original: "Exports the original cropped dimensions.",
    long_edge: "Resizes by the image's longest edge.",
    fit: "Fits the image within specified width and height limits.",
  },
  exportSharpening: {
    off: "No output sharpening.",
    subtle: "Light edge-aware sharpening after resize.",
    standard: "Moderate edge-aware sharpening after resize.",
    strong: "Strong edge-aware sharpening after resize.",
  },
};

boot();

async function boot() {
  clearLegacyUiPreferences();
  initializeLocalOverlayColor();
  initializePreviewPreferences();
  initializeInstrumentShell();
  initializePreviewScheduler();
  initializeBoundedTooltips();
  activateWorkflowTab("import", { focus: false });
  await initializeDesktopBridge();
  await initializeApplicationShell();
  initializeGroupPresetControls();
  bindEvents();
  applyExportPreset(els.exportFormat.value, "web_default", { invalidate: false });
  await initializeGpuPreview();
  await loadCapabilities().catch(() => {
    els.capabilitySummary.textContent = "Encoder status unavailable";
    els.capabilitySummary.className = "capability-chip attention";
  });
  await loadDefaultExportDirectory().catch(() => null);
  renderReadouts();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderLaneChrome();
  renderCompareLayout();
  renderControlState();
  renderCapabilities();
  updateExportAvailability();
  setGradeMode("global");
  renderLocalAdjustments();
  window.addEventListener("resize", () => {
    syncOverlayPlacement();
    renderLocalMaskOverlay();
    syncSourceFilenameOverflow();
  });
  observeScopeSize();
  observeGraphEditorSizes();
  observeViewerSize();
}

async function initializeGpuPreview() {
  if (!window.HDRWebGPUPreview) return;
  state.gpuPreview = new window.HDRWebGPUPreview(els.previewCanvas);
  await state.gpuPreview.initialize();
  state.displayInfo.gpu = state.gpuPreview.detail;
}

function clearLegacyUiPreferences() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    keys
      .filter((key) => LEGACY_UI_PREFERENCE_KEYS.has(key) || key?.startsWith("hdr-finisher-layout:"))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // Startup defaults do not depend on browser storage being available.
  }
}

function initializeLocalOverlayColor() {
  if (els.localOverlayColorInput) els.localOverlayColorInput.value = state.localOverlayColor;
  if (els.localOverlayColorSwatch) els.localOverlayColorSwatch.style.backgroundColor = state.localOverlayColor;
}

function initializePreviewPreferences() {
  state.previewResolution = DEFAULT_PREVIEW_RESOLUTION;
  state.scopeMaxNits = 4000;
  state.scopeQuality = DEFAULT_SCOPE_QUALITY;
  state.compareLayout = "single";
  if (els.previewResolution) els.previewResolution.value = state.previewResolution;
  if (els.scopeZoom) els.scopeZoom.value = String(state.scopeMaxNits);
  if (els.scopeDetail) els.scopeDetail.value = state.scopeQuality;
}

function initializePreviewScheduler() {
  if (!window.HDRPreviewScheduler) return;
  state.previewScheduler = new window.HDRPreviewScheduler({
    highQuality: () => previewNeedsRefinement(),
    onFrame: async (task) => {
      if (state.localMaskDraftDirty) return false;
      const detailActive = gpuDetailGraphActive(task.lane);
      const detailInteraction = state.detailInteractionRestore?.lane === task.lane;
      // A queued interactive callback may become runnable only after pointerup
      // because the preceding Detail graph was GPU-backpressured. The settled
      // callback owns the final value at that point; submitting another low-res
      // frame here could overwrite the restored refined frame.
      if (detailInteraction && !state.previewScheduler?.interacting) return false;
      const residentLongEdge = detailActive || detailInteraction ? residentAuthoringLongEdge() : null;
      if (residentLongEdge) {
        state.detailInteractionRestore = { lane: task.lane, longEdge: residentLongEdge };
      }
      const rendered = await renderGpuDraft(task.lane, {
        longEdge: interactiveProxyLongEdge(),
        tier: "interactive",
      });
      // Detail adds three full-frame filtering passes. Keep at most one such
      // graph in the GPU queue so rapid slider input coalesces to the newest
      // scheduler task instead of building latency behind obsolete frames.
      if (rendered && (detailActive || detailInteraction)) await state.gpuPreview?.waitForSubmittedWork?.();
      return rendered;
    },
    onScope: (task) => refreshScopes(scopeLongEdge(task.tier), {
      tier: task.tier,
      generation: task.scopeGeneration,
      lane: task.lane,
    }),
    onSettle: (task) => settlePreview(task.lane, task),
    onRefine: (task) => refinePreview(task.lane, task),
    onInactive: (task) => preloadInactiveLane(task.lane, task.applicationGeneration),
  });
  window.HDRFinisherPerformance = {
    snapshot: () => state.previewScheduler.snapshot(),
    gpuSnapshot: () => state.gpuPreview?.diagnosticsSnapshot?.() || null,
    enableGpuInstrumentation: (enabled = true) => state.gpuPreview?.setInstrumentationEnabled?.(enabled),
    renderGpuTier: (longEdge) => renderGpuDraft(state.currentView, {
      longEdge: Number(longEdge),
      tier: "settled",
    }),
    prepareDenoiseSelectorSeam: (variant = "resolved-a", longEdge = settledProxyLongEdge()) => (
      state.gpuPreview?.prepareDenoiseSelectorSeam?.(
        state.session?.session_id,
        state.currentView,
        JSON.parse(JSON.stringify(state.adjustments)),
        Number(longEdge),
        state.editRevision,
        variant,
      ) || Promise.resolve(false)
    ),
    analyzeDenoiseWavelet: async (preset = {}, longEdge = settledProxyLongEdge()) => {
      const ready = await state.gpuPreview?.analyzeDenoiseProxy?.(
        state.session?.session_id,
        state.currentView,
        JSON.parse(JSON.stringify(state.adjustments)),
        Number(longEdge),
        state.editRevision,
        preset,
      );
      if (!ready) return false;
      return renderGpuDraft(state.currentView, { longEdge: Number(longEdge), tier: "settled" });
    },
    resolveDenoiseWavelet: async (controls = {}, longEdge = settledProxyLongEdge()) => {
      const ready = await state.gpuPreview?.resolveDenoiseProxy?.(controls);
      if (!ready) return false;
      return renderGpuDraft(state.currentView, { longEdge: Number(longEdge), tier: "settled" });
    },
    selectDenoiseSelectorSeam: async (enabled, longEdge = settledProxyLongEdge()) => {
      if (!state.gpuPreview?.selectDenoiseSelectorSource?.(enabled)) return false;
      return renderGpuDraft(state.currentView, { longEdge: Number(longEdge), tier: "settled" });
    },
    sampleDenoiseSelectorSeam: async () => {
      const analysis = await state.gpuPreview?.analyzeScope?.(els.previewCanvas, {
        width: 16,
        height: 16,
        generation: 0,
        tier: "selector-test",
      });
      if (!analysis?.pixels?.length) return null;
      let sum = 0;
      let weighted = 0;
      for (let index = 0; index < analysis.pixels.length; index += 1) {
        const value = analysis.pixels[index];
        sum += value;
        weighted += value * ((index % 97) + 1);
      }
      return { mean: sum / analysis.pixels.length, fingerprint: weighted };
    },
    readDenoiseSelectorPixel: () => state.gpuPreview?.readDenoiseSelectorPixel?.() || Promise.resolve(null),
    readDenoiseResolvedRegion: (width = 16, height = 16) => (
      state.gpuPreview?.readDenoiseResolvedRegion?.(width, height) || Promise.resolve(null)
    ),
    disposeDenoiseSelectorSeam: () => state.gpuPreview?.disposeDenoiseSelectorSeam?.(),
    evictDenoiseCache: () => state.gpuPreview?.evictDenoiseCache?.(),
    sessionId: () => state.session?.session_id || null,
    previewMode: () => `${previewResolutionLabel().toLowerCase()}-${state.gpuPreview?.available ? "gpu" : "cpu"}`,
    authoringState: () => ({
      sessionId: state.session?.session_id || null,
      lane: state.currentView,
      adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      previewResolution: normalizedPreviewResolution(),
      previewMaxDimension: previewTargetLongEdge(),
      longEdge: settledProxyLongEdge(),
    }),
  };
}

function observeScopeSize() {
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => drawHistogram(state.lastScope || []));
    return;
  }
  scopeResizeObserver = new ResizeObserver(() => {
    if (scopeResizeFrame !== null) cancelAnimationFrame(scopeResizeFrame);
    scopeResizeFrame = requestAnimationFrame(() => {
      scopeResizeFrame = null;
      drawHistogram(state.lastScope || []);
    });
  });
  scopeResizeObserver.observe(els.histogram);
}

function observeViewerSize() {
  const refreshGeometry = () => {
    if (viewerResizeFrame !== null) cancelAnimationFrame(viewerResizeFrame);
    viewerResizeFrame = requestAnimationFrame(() => {
      viewerResizeFrame = null;
      applyZoomGeometry();
    });
  };
  if (!window.ResizeObserver) {
    window.addEventListener("resize", refreshGeometry);
    return;
  }
  viewerResizeObserver = new ResizeObserver(refreshGeometry);
  viewerResizeObserver.observe(els.dropzone);
}

function initializeInstrumentShell() {
  initializeLayoutState();
  initializeSourceRailState();
  enhanceRangeControls();
  enhanceEditableGradeValues();
  initSplitter({
    element: els.sourceSplitter,
    stateKey: "railW",
    cssVar: "--rail-w",
    axis: "x",
    direction: 1,
  });
  initSplitter({
    element: els.gradeSplitter,
    stateKey: "gradeW",
    cssVar: "--grade-w",
    axis: "x",
    direction: -1,
  });
  initSplitter({
    element: els.dockSplitter,
    stateKey: "dockH",
    cssVar: "--dock-h",
    axis: "y",
    direction: -1,
  });
}

function initializeSourceRailState() {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_WORKSPACE_QUERY) : null;
  state.compactWorkspace = Boolean(media?.matches);
  state.compactSourceOpen = false;
  state.wideSourceCollapsed = false;
  applyResponsiveWorkspaceState();
  media?.addEventListener?.("change", (event) => {
    state.compactWorkspace = event.matches;
    state.compactSourceOpen = false;
    closeOverlayPopover({ restoreFocus: false });
    closePreviewPopover({ restoreFocus: false });
    applyResponsiveWorkspaceState();
    scheduleLayoutSettled();
  });
}

function applyResponsiveWorkspaceState() {
  const rail = els.sourceRailExpand.closest(".source-rail");
  const collapsed = state.compactWorkspace ? !state.compactSourceOpen : state.wideSourceCollapsed;
  els.appShell.classList.toggle("compact-workspace", state.compactWorkspace);
  rail.classList.toggle("collapsed", collapsed);
  els.appShell.classList.toggle("source-collapsed", state.compactWorkspace || collapsed);
  els.appShell.classList.toggle("source-overlay-open", state.compactWorkspace && state.compactSourceOpen);
  els.sourceRailExpand.setAttribute("aria-expanded", String(!collapsed));
  els.sourceRailExpand.setAttribute("aria-label", collapsed ? "Expand source metadata" : "Collapse source metadata");
  els.sourceRailExpand.title = collapsed ? "Expand metadata" : "Collapse metadata";
}

function toggleSourceRail() {
  if (state.compactWorkspace) state.compactSourceOpen = !state.compactSourceOpen;
  else state.wideSourceCollapsed = !state.wideSourceCollapsed;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
}

function revealSourceRail() {
  const collapsed = state.compactWorkspace ? !state.compactSourceOpen : state.wideSourceCollapsed;
  if (!collapsed) return;
  if (state.compactWorkspace) state.compactSourceOpen = true;
  else state.wideSourceCollapsed = false;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
}

function closeCompactSourceRail({ restoreFocus = false } = {}) {
  if (!state.compactWorkspace || !state.compactSourceOpen) return;
  state.compactSourceOpen = false;
  applyResponsiveWorkspaceState();
  scheduleLayoutSettled();
  if (restoreFocus) els.sourceRailExpand.focus();
}

function initializeLayoutState() {
  state.layout = { ...LAYOUT_DEFAULTS };
  applyLayoutState();
}

function applyLayoutState() {
  // Proof and export rails are fixed siblings of .app-shell. Keep layout
  // variables on the shared root so those panels track the same splitter.
  document.documentElement.style.setProperty("--rail-w", `${state.layout.railW}px`);
  document.documentElement.style.setProperty("--grade-w", `${state.layout.gradeW}px`);
  document.documentElement.style.setProperty("--dock-h", `${state.layout.dockH}px`);
  state.dockCollapsed = !state.layout.dockOpen;
  state.activeDockTab = state.layout.dockTab;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  renderDockCollapseControl();
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === state.activeDockTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = state.activeDockTab === "technical";
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  if (technical) {
    els.scopeMode.value = "technical";
  } else {
    state.scopeMode = state.activeDockTab === "vectorscope"
      ? "vectorscope"
      : state.activeDockTab === "waveform" || state.activeDockTab === "parade" ? "waveform" : "histogram";
    state.scopeChannelMode = state.activeDockTab === "parade" ? "parade" : "composite";
    els.scopeMode.value = state.scopeMode;
    els.scopeChannelMode.value = state.scopeChannelMode;
  }
  [els.scopeChannelMode, els.scopeDetail, els.scopeZoom].forEach((control) => { if (control) control.disabled = technical; });
  renderScopeControlAvailability();
  updateSplitterAria();
}

function renderScopeControlAvailability() {
  const technical = state.scopeMode === "technical" || state.activeDockTab === "technical";
  const vectorscope = state.scopeMode === "vectorscope";
  // Channel selection and nit range do not alter a standards-based
  // vectorscope. Hide them instead of leaving controls that appear to work.
  els.scopeChannelMode?.classList.toggle("hidden", technical || vectorscope);
  if (els.scopeChannelMode) els.scopeChannelMode.disabled = technical || vectorscope;
  const rangeRelevant = !technical && !vectorscope && state.currentView === "hdr";
  els.scopeZoom?.closest(".scope-zoom-control")?.classList.toggle("hidden", !rangeRelevant);
  if (els.scopeZoom) els.scopeZoom.disabled = !rangeRelevant;
  if (els.scopeDetail) els.scopeDetail.disabled = technical;
}

function updateSplitterAria() {
  const entries = [
    [els.sourceSplitter, "railW"],
    [els.gradeSplitter, "gradeW"],
    [els.dockSplitter, "dockH"],
  ];
  entries.forEach(([element, key]) => element?.setAttribute("aria-valuenow", String(Math.round(state.layout[key]))));
}

function scheduleLayoutSettled() {
  window.clearTimeout(state.layoutSettleTimer);
  state.layoutSettleTimer = window.setTimeout(dispatchLayoutSettled, LAYOUT_SETTLE_DELAY);
}

function dispatchLayoutSettled() {
  applyZoomGeometry();
  drawHistogram(state.lastScope || []);
  drawToneEqualizerEditor();
  document.dispatchEvent(new CustomEvent("layout:settled", { detail: { ...state.layout } }));
}

function initSplitter({ element, stateKey, cssVar, axis, direction }) {
  if (!element) return;
  const [minimum, maximum] = LAYOUT_LIMITS[stateKey];
  let frame = null;
  let pendingValue = state.layout[stateKey];

  const writeValue = (requested) => {
    pendingValue = clamp(requested, minimum, maximum);
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      state.layout[stateKey] = pendingValue;
      document.documentElement.style.setProperty(cssVar, `${pendingValue}px`);
      element.setAttribute("aria-valuenow", String(Math.round(pendingValue)));
    });
  };

  const commit = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
      state.layout[stateKey] = pendingValue;
      document.documentElement.style.setProperty(cssVar, `${pendingValue}px`);
    }
    element.classList.remove("dragging");
    document.documentElement.removeAttribute("data-resizing");
    document.documentElement.style.cursor = "";
    scheduleLayoutSettled();
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const startPosition = axis === "x" ? event.clientX : event.clientY;
    const startValue = state.layout[stateKey];
    element.setPointerCapture(pointerId);
    element.classList.add("dragging");
    document.documentElement.dataset.resizing = "true";
    document.documentElement.style.cursor = axis === "x" ? "col-resize" : "row-resize";

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const position = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      writeValue(startValue + (position - startPosition) * direction);
    };
    const stop = (stopEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      commit();
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  });

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    writeValue(LAYOUT_DEFAULTS[stateKey]);
    commit();
  });

  element.addEventListener("keydown", (event) => {
    const vertical = axis === "y";
    const decreaseKey = vertical ? "ArrowDown" : "ArrowLeft";
    const increaseKey = vertical ? "ArrowUp" : "ArrowRight";
    let next = null;
    if (event.key === decreaseKey) next = state.layout[stateKey] - 8;
    if (event.key === increaseKey) next = state.layout[stateKey] + 8;
    if (event.key === "Home") next = minimum;
    if (event.key === "End") next = maximum;
    if (next === null) return;
    event.preventDefault();
    writeValue(next);
    commit();
  });
}

function enhanceRangeControls() {
  document.querySelectorAll('input[type="range"]').forEach(enhanceRangeControl);
}

function pointerAdjustmentScale(event) {
  return event?.ctrlKey ? FINE_ADJUSTMENT_SCALE : 1;
}

function fineRangeStep(step) {
  return Math.round(Number(step) * FINE_ADJUSTMENT_SCALE * 1e12) / 1e12;
}

function createPrecisionPointerDelta(event) {
  let previousX = event.clientX;
  let previousY = event.clientY;
  let deltaX = 0;
  let deltaY = 0;
  let minimumScale = pointerAdjustmentScale(event);
  return {
    update(nextEvent) {
      const scale = pointerAdjustmentScale(nextEvent);
      minimumScale = Math.min(minimumScale, scale);
      deltaX += (nextEvent.clientX - previousX) * scale;
      deltaY += (nextEvent.clientY - previousY) * scale;
      previousX = nextEvent.clientX;
      previousY = nextEvent.clientY;
      return { x: deltaX, y: deltaY, minimumScale };
    },
  };
}

function enhanceRangeControl(control) {
  if (!control || control.closest(".range-shell")) return;
  const shell = document.createElement("span");
  shell.className = "range-shell";
  const track = document.createElement("span");
  track.className = "slider-track";
  const fill = document.createElement("span");
  fill.className = "slider-fill";
  control.before(shell);
  shell.append(track, fill, control);
  const declaredStep = Number(control.step);
  if (Number.isFinite(declaredStep) && declaredStep > 0) {
    control.dataset.instrumentStep = String(declaredStep);
    control.step = String(fineRangeStep(declaredStep));
  }
  updateRangeVisual(control);
  control.addEventListener("input", () => updateRangeVisual(control));
  bindInstrumentRangePointer(control, shell);
}

function enhanceEditableGradeValues() {
  els.valueOutputs.forEach((output) => {
    const path = output.dataset.valuePath;
    const resolvedPath = resolveAdjustmentPath(path);
    const rulePath = MANUAL_VALUE_RULES[path] ? path : resolvedPath;
    const rule = MANUAL_VALUE_RULES[rulePath];
    if (!rule || !output.closest("#grade-workflow-panel")) return;
    bindEditableValue(output, {
      getValue: () => getValueByPath(state.adjustments, path),
      normalize: (text) => normalizeManualControlValue(rulePath, text),
      commit: ({ value }) => commitAdjustmentValue(path, value, { manual: true }),
      label: () => `${output.closest(".control-heading")?.querySelector("label")?.textContent?.trim() || path} value`,
      range: () => manualRangeLabel(path, rule),
    });
  });

  for (const lane of ["hdr", "sdr"]) {
    const ui = toneEqualizerUi(lane);
    bindEditableValue(ui.bandOutput, {
      getValue: () => currentToneEqualizerNodes(lane)[state.selectedToneEqualizerBand]?.adjustment_ev ?? 0,
      normalize: (text) => normalizeManualNumber(text, {
        min: toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane))[0],
        max: toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane))[1],
        decimals: 2,
      }),
      commit: ({ value }) => setToneEqualizerBand(state.selectedToneEqualizerBand, value, lane),
      label: () => `Selected ${lane.toUpperCase()} Exposure Band adjustment`,
      range: () => {
        const [minimum, maximum] = toneEqualizerBandLimits(state.selectedToneEqualizerBand, currentToneEqualizerNodes(lane));
        return `${formatSignedEv(minimum, 2)} to ${formatSignedEv(maximum, 2)}`;
      },
    });

    bindEditableValue(ui.radius, {
      getValue: () => state.adjustments[lane].tone_equalizer_influence_radius,
      normalize: (text) => normalizeManualNumber(text, { min: 0.25, max: 12, decimals: 2 }),
      commit: ({ value }) => {
        state.adjustments[lane].tone_equalizer_influence_radius = value;
        syncToneEqualizerControls(lane);
        drawToneEqualizerEditor(lane);
        renderControlState();
      },
      label: () => `${lane.toUpperCase()} Exposure Band influence`,
      range: () => "0.25 EV to 12.00 EV",
    });
  }
}

function bindEditableValue(element, { getValue, normalize, commit, label, range }) {
  if (!element) return;
  element.classList.add("editable-value");
  element.tabIndex = 0;

  const refreshAccessibility = () => {
    const rangeText = range();
    element.title = `Double-click or press Enter to type a value. Manual range: ${rangeText}.`;
    element.setAttribute("aria-label", `${label()}. Press Enter to edit. Manual range ${rangeText}.`);
  };
  refreshAccessibility();

  let editing = false;
  let previousText = "";
  const finish = () => {
    editing = false;
    element.dataset.editing = "false";
    element.removeAttribute("contenteditable");
    element.removeAttribute("role");
    refreshAccessibility();
  };
  const cancel = () => {
    if (!editing) return;
    finish();
    element.textContent = previousText;
  };
  const apply = () => {
    if (!editing) return;
    const normalized = normalize(element.textContent);
    if (!normalized) {
      cancel();
      return;
    }
    finish();
    commit(normalized);
    if (normalized.clamped) {
      element.classList.remove("value-clamped");
      requestAnimationFrame(() => element.classList.add("value-clamped"));
      window.setTimeout(() => element.classList.remove("value-clamped"), 900);
    }
  };
  const begin = () => {
    if (editing || !state.session) return;
    const pairedControl = element.dataset.valuePath
      ? document.querySelector(`[data-path="${element.dataset.valuePath}"]`)
      : null;
    if (pairedControl?.disabled) return;
    editing = true;
    previousText = element.textContent;
    element.dataset.editing = "true";
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("role", "textbox");
    const value = Number(getValue());
    const rule = element.dataset.valuePath ? MANUAL_VALUE_RULES[element.dataset.valuePath] : null;
    element.textContent = String(rule?.entryScale ? value * rule.entryScale : value);
    element.focus({ preventScroll: true });
    const selection = window.getSelection();
    const contents = document.createRange();
    contents.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(contents);
  };

  element.addEventListener("dblclick", (event) => {
    event.preventDefault();
    begin();
  });
  element.addEventListener("keydown", (event) => {
    if (!editing && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      begin();
      return;
    }
    if (!editing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  });
  element.addEventListener("blur", apply);
}

function normalizeManualControlValue(path, text) {
  const rule = MANUAL_VALUE_RULES[path];
  if (!rule) return null;
  const parsed = parseManualNumber(text);
  if (!Number.isFinite(parsed)) return null;
  const storedValue = rule.entryScale ? parsed / rule.entryScale : parsed;
  return normalizeManualNumber(storedValue, rule);
}

function normalizeManualNumber(textOrValue, rule) {
  const parsed = typeof textOrValue === "number" ? textOrValue : parseManualNumber(textOrValue);
  if (!Number.isFinite(parsed)) return null;
  const bounded = clamp(parsed, rule.min, rule.max);
  const scale = 10 ** rule.decimals;
  return {
    value: Math.round(bounded * scale) / scale,
    clamped: bounded !== parsed,
  };
}

function parseManualNumber(text) {
  let normalized = String(text ?? "").trim().replace(/\u2212/g, "-");
  normalized = normalized.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1").replace(",", ".");
  const match = normalized.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
  return match ? Number(match[0]) : Number.NaN;
}

function manualRangeLabel(path, rule) {
  return `${formatControlValue(path, rule.min)} to ${formatControlValue(path, rule.max)}`;
}

function updateRangeVisual(control) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const value = Number(control.value);
  const percent = maximum > minimum ? clamp((value - minimum) / (maximum - minimum), 0, 1) * 100 : 0;
  const shell = control.closest(".range-shell");
  if (!shell) return;
  const bipolar = minimum < 0 && maximum > 0;
  const fillOriginValue = bipolar ? rangeControlHome(control, minimum, maximum) : minimum;
  const fillOrigin = maximum > minimum ? clamp((fillOriginValue - minimum) / (maximum - minimum), 0, 1) * 100 : 0;
  shell.style.setProperty("--pos", `${percent}%`);
  shell.style.setProperty("--fill-start", `${Math.min(percent, fillOrigin)}%`);
  shell.style.setProperty("--fill-w", `${Math.abs(percent - fillOrigin)}%`);
  shell.dataset.bipolar = String(bipolar);
}

function syncRangeVisuals(root = document) {
  root.querySelectorAll?.('input[type="range"]').forEach(updateRangeVisual);
}

function bindInstrumentRangePointer(control, shell) {
  control.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const minimum = Number(control.min);
    const maximum = Number(control.max);
    const ordinaryStep = Number(control.dataset.instrumentStep) || Number(control.step) || (maximum - minimum) / 100;
    const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
    const next = event.shiftKey
      ? adjacentRangeSnap(control, Number(control.value), direction)
      : clamp(Number(control.value) + direction * ordinaryStep * pointerAdjustmentScale(event), minimum, maximum);
    control.value = String(next);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });

  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || control.disabled) return;
    event.preventDefault();
    control.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const rect = control.getBoundingClientRect();
    const minimum = Number(control.min);
    const maximum = Number(control.max);
    const step = Number(control.dataset.instrumentStep) || Number(control.step) || (maximum - minimum) / 100;
    const startX = event.clientX;
    const startValue = Number(control.value);
    const directValue = minimum + clamp((startX - rect.left) / Math.max(rect.width, 1), 0, 1) * (maximum - minimum);
    let mode = event.shiftKey ? "snap" : event.ctrlKey ? "fine" : "ordinary";
    let previousX = startX;
    let requestedValue = mode === "fine" ? startValue : directValue;
    shell.classList.add("dragging");
    control.setPointerCapture(pointerId);

    const quantize = (requested, precision = 1) => {
      const clamped = clamp(requested, minimum, maximum);
      const quantum = step * Math.min(1, precision);
      const steps = Math.round((clamped - minimum) / quantum);
      return clamp(minimum + steps * quantum, minimum, maximum);
    };
    const setValue = (requested, activeMode) => {
      const next = activeMode === "snap"
        ? nearestRangeSnap(control, requested)
        : quantize(requested, activeMode === "fine" ? FINE_ADJUSTMENT_SCALE : 1);
      if (Number(control.value) === next) return;
      control.value = String(next);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };

    setValue(requestedValue, mode);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const nextMode = moveEvent.shiftKey ? "snap" : moveEvent.ctrlKey ? "fine" : "ordinary";
      if (nextMode !== mode) {
        requestedValue = Number(control.value);
        previousX = moveEvent.clientX;
        mode = nextMode;
        if (mode === "snap") setValue(requestedValue, mode);
        return;
      }
      const scale = mode === "fine" ? FINE_ADJUSTMENT_SCALE : 1;
      requestedValue += ((moveEvent.clientX - previousX) / Math.max(rect.width, 1)) * (maximum - minimum) * scale;
      previousX = moveEvent.clientX;
      setValue(requestedValue, mode);
    };
    const stop = (stopEvent) => {
      if (stopEvent.pointerId !== pointerId) return;
      control.removeEventListener("pointermove", move);
      control.removeEventListener("pointerup", stop);
      control.removeEventListener("pointercancel", stop);
      if (control.hasPointerCapture(pointerId)) control.releasePointerCapture(pointerId);
      shell.classList.remove("dragging");
      control.dispatchEvent(new Event("change", { bubbles: true }));
    };
    control.addEventListener("pointermove", move);
    control.addEventListener("pointerup", stop);
    control.addEventListener("pointercancel", stop);
  });
}

function bindEvents() {
  window.addEventListener("unhandledrejection", (event) => {
    if (event.reason?.name === "AbortError") event.preventDefault();
  });
  els.workflowTabs.forEach((button) => {
    button.addEventListener("click", () => activateWorkflowTab(button.dataset.workflowTab));
    button.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const enabled = els.workflowTabs.filter((tab) => !tab.disabled);
      const current = enabled.indexOf(button);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = enabled[(current + direction + enabled.length) % enabled.length];
      next?.focus();
      if (next) activateWorkflowTab(next.dataset.workflowTab, { focus: false });
    });
  });
  document.querySelectorAll(".lane-switch, .local-lane-switch, .proof-preview-switch").forEach((segment) => {
    const buttons = [...segment.querySelectorAll("button")];
    buttons.forEach((button) => button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const enabled = buttons.filter((candidate) => !candidate.disabled && !candidate.hidden);
      if (!enabled.length) return;
      event.preventDefault();
      const current = Math.max(0, enabled.indexOf(button));
      let next;
      if (event.key === "Home") next = enabled[0];
      else if (event.key === "End") next = enabled.at(-1);
      else {
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        next = enabled[(current + direction + enabled.length) % enabled.length];
      }
      next?.focus();
      next?.click();
    }));
  });
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file && await confirmUnsavedTransition("import another source")) await uploadFile(file);
    event.target.value = "";
  });
  els.importButton.addEventListener("click", requestSourceImport);
  els.cancelImport?.addEventListener("click", cancelActiveImport);
  els.testPatternButton.addEventListener("click", async () => {
    if (!await confirmUnsavedTransition("replace the source with a test pattern")) return;
    els.badge.textContent = "Generating delivery proof test pattern...";
    try {
      const response = await fetch("/api/proof/test-pattern");
      if (!response.ok) throw new Error(`Test pattern failed with HTTP ${response.status}.`);
      const file = new File([await response.blob()], "hdr_delivery_proof_pattern.tiff", { type: "image/tiff" });
      await uploadFile(file);
    } catch (error) {
      showUploadError(error?.message || "The delivery proof test pattern could not be generated.");
    }
  });
  els.emptyImportButton.addEventListener("click", requestSourceImport);
  els.sourceRailExpand.addEventListener("click", toggleSourceRail);
  bindLocalAdjustmentEvents();
  els.projectOpen?.addEventListener("click", () => openProjectFromPath());
  els.projectSave?.addEventListener("click", () => saveProjectToPath());
  els.hdrReferenceWhite?.addEventListener("change", async () => {
    if (!state.session) return;
    const requested = Number(els.hdrReferenceWhite.value);
    const previous = projectReferenceWhiteNits();
    if (![100, 203].includes(requested) || requested === previous) return;
    els.hdrReferenceWhite.disabled = true;
    const applied = await queueEditCommand("set_hdr_reference_white", { hdr_reference_white_nits: requested });
    if (!applied) els.hdrReferenceWhite.value = String(previous);
    else {
      state.gpuPreview?.resetSession(state.session?.session_id || null);
      state.gpuPreparedLane = { hdr: false, sdr: false };
      renderSession();
      await settlePreview(state.currentView);
    }
    els.hdrReferenceWhite.disabled = false;
  });
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
  els.rawSettingsToggle?.addEventListener("click", () => {
    state.rawSettingsOpen = !state.rawSettingsOpen;
    renderRawImportControls(state.session);
  });
  els.lensMode?.addEventListener("change", () => renderRawImportControls(state.session));
  let lensSearchTimer = 0;
  els.lensProfileSearch?.addEventListener("input", () => {
    window.clearTimeout(lensSearchTimer);
    lensSearchTimer = window.setTimeout(loadLensProfiles, 250);
  });
  els.applyRawSettings?.addEventListener("click", applyRawImportSettings);
  els.rawHighlightBypass?.addEventListener("click", async () => {
    const enabled = els.rawHighlightBypass.getAttribute("aria-pressed") !== "true";
    renderRawHighlightState({ enabled });
    await applyRawImportSettings();
  });
  els.rawHighlightMethod?.addEventListener("change", applyRawImportSettings);
  els.rawHighlightThreshold?.addEventListener("input", () => {
    renderRawHighlightState({
      enabled: els.rawHighlightBypass.getAttribute("aria-pressed") === "true",
    });
  });
  els.rawHighlightThreshold?.addEventListener("change", applyRawImportSettings);
  els.rawHighlightReset?.addEventListener("click", async () => {
    els.rawHighlightMethod.value = "opposed_color_v1";
    els.rawHighlightThreshold.value = "1";
    renderRawHighlightState({ enabled: true });
    await applyRawImportSettings();
  });
  els.metadataToggle.addEventListener("click", () => {
    state.metadataOpen = !state.metadataOpen;
    renderMetadataVisibility();
  });
  els.acceptInterpretation.addEventListener("click", () => {
    state.interpretationGateDismissed = true;
    renderInterpretationGate();
    updateExportAvailability();
  });
  els.manualInterpretation.addEventListener("click", openManualInterpretation);
  els.interpretationMode.addEventListener("change", () => {
    renderSourceSettingsControls();
  });
  els.interpretationTransfer.addEventListener("change", () => renderSourceSettingsControls());
  els.scopeMode.addEventListener("change", async () => {
    await activateDockTab(els.scopeMode.value);
  });
  els.scopeChannelMode.addEventListener("change", async () => {
    state.scopeChannelMode = els.scopeChannelMode.value;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeZoom.addEventListener("change", async () => {
    const requestedMaxNits = Number(els.scopeZoom.value);
    state.scopeMaxNits = [1000, 4000, 10000].includes(requestedMaxNits) ? requestedMaxNits : 4000;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.previewResolution?.addEventListener("change", () => {
    const requested = normalizedPreviewResolution(els.previewResolution.value);
    applyPreviewResolution(requested);
  });
  els.scopeDetail?.addEventListener("change", async () => {
    state.scopeQuality = SCOPE_QUALITY_PROFILES[els.scopeDetail.value] ? els.scopeDetail.value : DEFAULT_SCOPE_QUALITY;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeRegionToggle?.addEventListener("click", () => toggleScopeRegion());
  els.scopeRegionOverlay?.addEventListener("pointerdown", beginScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointermove", moveScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointerup", endScopeRegionDrag);
  els.scopeRegionOverlay?.addEventListener("pointercancel", endScopeRegionDrag);
  els.scopeRegionBox?.addEventListener("keydown", handleScopeRegionKeydown);

  ["dragenter", "dragover"].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      els.dropzone.classList.add("drag-active");
    });
  });
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget || (event.clientX > 0 && event.clientY > 0)) return;
    els.dropzone.classList.remove("drag-active");
  });
  document.addEventListener("drop", async (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    els.dropzone.classList.remove("drag-active");
    const files = event.dataTransfer.files;
    const [file] = files || [];
    if (!file) return;
    try {
      if (desktop) {
        // Pass the actual File through the preload bridge. A DOM FileList is
        // not reliably cloneable across Electron's isolated-world boundary.
        const selection = await desktop.resolveDroppedFile(file);
        if (!selection) {
          // Windows shell integrations and catalog applications can provide a
          // real File without exposing a filesystem path to Electron. Upload
          // those bytes through the local backend instead of misreporting the
          // source extension as unsupported.
          if (await confirmUnsavedTransition("import another source")) await uploadFile(file);
          return;
        }
        await openDesktopSelection(selection);
      } else {
        await uploadFile(file);
      }
    } catch (error) {
      console.error(error);
      showUploadError(error?.message || "The dropped file could not be opened.");
    }
  });
  [els.previewImage, els.comparisonImage, els.previewOverlay].forEach((image) => {
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await switchLane(button.dataset.kind);
    });
  });

  els.controls.forEach((control) => {
    const transactionOwnedControl = control.dataset.path === "shared.geometry.straighten_angle";
    control.addEventListener("pointerdown", () => {
      if (transactionOwnedControl) return;
      beginGlobalEditGesture(control);
      beginGlobalDetailInteraction(control.dataset.path);
      state.previewScheduler?.beginInteraction();
    });
    ["pointerup", "pointercancel", "change"].forEach((eventName) => {
      control.addEventListener(eventName, () => {
        if (transactionOwnedControl) return;
        if (eventName === "change" && control.dataset.historyKeyboardActive === "true") return;
        state.previewScheduler?.endInteraction();
        endGlobalEditGesture(control);
      });
    });
    control.addEventListener("keydown", (event) => {
      if (transactionOwnedControl) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
        control.dataset.historyKeyboardActive = "true";
        beginGlobalEditGesture(control);
        beginGlobalDetailInteraction(control.dataset.path);
        state.previewScheduler?.beginInteraction();
      }
    }, true);
    control.addEventListener("keyup", () => {
      if (transactionOwnedControl) return;
      delete control.dataset.historyKeyboardActive;
      state.previewScheduler?.endInteraction();
      endGlobalEditGesture(control);
    });
    control.addEventListener("input", () => {
      const value = control.type === "range" || control.type === "number"
        ? Number(control.value)
        : control.type === "checkbox" ? control.checked : control.value;
      if (control.dataset.path === "shared.geometry.straighten_angle") {
        updateStraightenInteractive(value);
        return;
      }
      if (state.cropMode && isCropDraftControl(control.dataset.path)) {
        updateCropDraftControl(control.dataset.path, value);
        return;
      }
      commitAdjustmentValue(control.dataset.path, value);
    });
  });
  els.denoiseBypass?.addEventListener("click", () => setDenoiseEnabled(!state.denoise[state.currentView].enabled));
  els.denoiseMethod?.addEventListener("change", () => updateDenoiseAnalysisPreset(els.denoiseMethod.value));
  els.denoiseLevels?.addEventListener("change", () => updateCustomDenoiseAnalysis("levels", Number(els.denoiseLevels.value)));
  const denoiseAnalysisSliders = [
    [els.denoiseThreshold, "noise_threshold"],
    [els.denoiseLumaSigma, "luma_sigma"],
    [els.denoiseChromaSigma, "chroma_sigma"],
  ];
  for (const [control, key] of denoiseAnalysisSliders) {
    control?.addEventListener("input", () => updateCustomDenoiseAnalysis(key, Number(control.value), false));
    control?.addEventListener("change", () => updateCustomDenoiseAnalysis(key, Number(control.value), true));
  }
  const denoiseSliders = [
    [els.denoiseAmount, "amount"],
    [els.denoiseLuminance, "luminance"],
    [els.denoiseColor, "color_noise"],
    [els.denoiseDetail, "detail_recovery"],
  ];
  for (const [control, key] of denoiseSliders) {
    control?.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
    control?.addEventListener("input", () => updateLiveDenoiseControl(key, Number(control.value)));
    for (const eventName of ["pointerup", "pointercancel", "change"]) {
      control?.addEventListener(eventName, () => {
        state.previewScheduler?.endInteraction();
        if (eventName === "change") void persistDenoiseSettings();
      });
    }
  }
  els.denoiseRecalculate?.addEventListener("click", () => recalculateDenoise());
  bindRangeResetControls();

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setValueByPath(state.adjustments, `${currentCurveLane()}.curves_section_enabled`, true);
    ["luma", "red", "green", "blue"].forEach((channel) => {
      setCurveValues(channel, defaultCurvePoints());
    });
    state.selectedCurvePoint = Math.floor(defaultCurvePoints().length / 2);
    syncCurveControlsFromState();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveAdd.addEventListener("click", () => {
    addCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  els.curveRemove.addEventListener("click", () => {
    removeCurvePoint();
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  bindCurveEditor();
  bindToneEqualizerEditor();
  bindZoneScopeOverlays();

  els.exportConfirmButton.addEventListener("click", exportCurrentSession);
  els.exportDirectoryBrowse.addEventListener("click", chooseExportDirectory);
  els.directoryBrowserGo.addEventListener("click", () => loadMediaDirectory(els.directoryBrowserPath.value));
  els.directoryBrowserUp.addEventListener("click", () => loadMediaDirectory(els.directoryBrowser.dataset.parent));
  els.directoryBrowserPin.addEventListener("click", pinCurrentMediaFolder);
  els.directoryBrowserList.addEventListener("keydown", handleMediaBrowserListKeydown);
  els.directoryBrowserSortButtons.forEach((button) => {
    button.addEventListener("click", () => sortMediaBrowserBy(button.dataset.mediaBrowserSort));
  });
  els.directoryBrowserColumnResizers.forEach((resizer) => {
    resizer.addEventListener("pointerdown", beginMediaBrowserColumnResize);
    resizer.addEventListener("pointermove", continueMediaBrowserColumnResize);
    resizer.addEventListener("pointerup", endMediaBrowserColumnResize);
    resizer.addEventListener("pointercancel", endMediaBrowserColumnResize);
    resizer.addEventListener("lostpointercapture", endMediaBrowserColumnResize);
    resizer.addEventListener("keydown", handleMediaBrowserColumnResizeKeydown);
  });
  els.directoryBrowserPreviewResizer.addEventListener("pointerdown", beginMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointermove", continueMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointerup", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("pointercancel", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("lostpointercapture", endMediaBrowserPreviewResize);
  els.directoryBrowserPreviewResizer.addEventListener("keydown", handleMediaBrowserPreviewResizeKeydown);
  els.directoryBrowserPath.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadMediaDirectory(els.directoryBrowserPath.value);
  });
  els.directoryBrowserFilename.addEventListener("input", updateProjectSaveBrowserAction);
  els.directoryBrowserFilename.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmMediaBrowserSelection();
  });
  [els.directoryBrowserClose, els.directoryBrowserCancel].forEach((button) => {
    button.addEventListener("click", closeExportDirectoryBrowser);
  });
  els.directoryBrowserSelect.addEventListener("click", confirmMediaBrowserSelection);
  els.directoryBrowser.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeExportDirectoryBrowser();
  });
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.resetInterpretationButton.addEventListener("click", resetInterpretationToAuto);
  els.ejectButton.addEventListener("click", ejectCurrentSession);
  els.copySourcePath.addEventListener("click", copySourcePath);
  els.copyExportPath.addEventListener("click", copyLastExportPath);
  els.revealExportPath?.addEventListener("click", () => desktop?.revealPath(state.lastExportPath));
  els.openExportPath?.addEventListener("click", () => desktop?.openPath(state.lastExportPath));

  els.groupToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".control-group");
      if (!group) return;
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
      if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");
      renderVignetteCenter();
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(
      button.dataset.resetGroup === "detail" ? `${state.currentView}-detail` : button.dataset.resetGroup
    ));
  });
  els.sdrMatchHdrColors.addEventListener("click", matchHdrColorsToSdr);
  els.sdrMatchEntire?.addEventListener("click", () => setSdrMatch(
    state.editDocument?.sdr_match?.active ? "convert" : "match"
  ));
  els.sdrMatchRevert?.addEventListener("click", () => setSdrMatch("revert"));
  els.detailMatchHdr?.addEventListener("click", () => matchLaneObject("detail"));
  els.filmLookReset?.addEventListener("click", resetFilmLook);
  els.filmLookMatchHdr?.addEventListener("click", matchHdrFilmLookToSdr);
  els.colorGradingReset?.addEventListener("click", () => resetLaneObject("color_grading", defaultColorGrading()));
  els.colorGradingMatchHdr?.addEventListener("click", () => matchLaneObject("color_grading"));
  els.vignetteReset?.addEventListener("click", () => resetLaneObject("vignette", defaultVignette()));
  els.vignetteMatchHdr?.addEventListener("click", () => matchLaneObject("vignette"));
  bindColorWheels();
  bindCropEditor();
  bindPerspectiveEditor();
  bindVignetteCenter();
  els.sectionBypasses.forEach((button) => {
    button.addEventListener("click", () => {
      const path = resolveAdjustmentPath(button.dataset.sectionPath);
      setValueByPath(state.adjustments, path, !Boolean(getValueByPath(state.adjustments, path)));
      invalidatePreview(path.startsWith("sdr.") ? "sdr" : "hdr");
      renderControlState();
      debouncePreview(path.startsWith("sdr.") ? "sdr" : "hdr");
    });
  });

  els.zoomFit.addEventListener("click", () => setZoomMode("fit"));
  els.zoomActual.addEventListener("click", () => setZoomMode("actual"));
  els.zoomOut.addEventListener("click", () => stepZoom(-1));
  els.zoomIn.addEventListener("click", () => stepZoom(1));
  els.zoomSlider.addEventListener("input", () => {
    setCustomZoom(sliderToZoomPercent(Number(els.zoomSlider.value)));
  });
  els.zoomReadout.addEventListener("focus", () => els.zoomReadout.select());
  els.zoomReadout.addEventListener("change", commitZoomReadout);
  els.zoomReadout.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitZoomReadout();
      els.zoomReadout.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      updateZoomReadout();
      els.zoomReadout.blur();
    }
  });
  els.dropzone.addEventListener("wheel", handleViewerWheel, { passive: false });
  els.dropzone.addEventListener("scroll", () => {
    syncLocalMaskOverlayViewport();
    queueLocalMaskOverlayRender();
  }, { passive: true });
  els.overlayToggle.addEventListener("click", toggleOverlayPopover);
  els.overlayClose.addEventListener("click", closeOverlayPopover);
  els.previewToggle.addEventListener("click", togglePreviewPopover);
  els.previewClose.addEventListener("click", closePreviewPopover);
  document.addEventListener("pointerdown", (event) => {
    if (state.compactSourceOpen && !event.target.closest(".source-rail")) closeCompactSourceRail();
    if (!els.overlayPopover.classList.contains("hidden") && !event.target.closest("#overlay-popover, #overlay-toggle")) closeOverlayPopover({ restoreFocus: false });
    if (!els.previewPopover.classList.contains("hidden") && !event.target.closest("#preview-popover, #preview-toggle")) closePreviewPopover({ restoreFocus: false });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.overlayPopover.classList.contains("hidden")) {
      event.preventDefault();
      closeOverlayPopover();
      return;
    }
    if (!els.previewPopover.classList.contains("hidden")) {
      event.preventDefault();
      closePreviewPopover({ restoreFocus: true });
      return;
    }
    if (state.compactSourceOpen) {
      event.preventDefault();
      closeCompactSourceRail({ restoreFocus: true });
    }
  });
  els.dockCollapse.addEventListener("click", toggleAnalysisDock);
  els.dockTabs.forEach((button) => {
    button.addEventListener("click", () => activateDockTab(button.dataset.dockTab));
  });
  els.exportFormat.addEventListener("change", () => {
    const requestedPreset = els.exportPreset.value === "custom" ? "web_default" : els.exportPreset.value;
    applyExportPreset(els.exportFormat.value, requestedPreset);
    updateExportAvailability();
    renderWorkflowContext();
  });
  els.exportPreset.addEventListener("change", () => {
    if (els.exportPreset.value === "custom") return;
    applyExportPreset(els.exportFormat.value, els.exportPreset.value);
  });
  els.exportQuality.addEventListener("input", () => {
    els.exportQualityValue.textContent = els.exportQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  els.jpegGainMapQuality.addEventListener("input", () => {
    els.jpegGainMapQualityValue.textContent = els.jpegGainMapQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  els.avifGainMapQuality.addEventListener("input", () => {
    els.avifGainMapQualityValue.textContent = els.avifGainMapQuality.value;
    markExportPresetCustom();
    window.HDRProofing?.invalidate("settings");
  });
  [
    els.avifBitDepth,
    els.avifChromaSubsampling,
    els.avifGainMapScale,
    els.jpegUltrahdrChromaSubsampling,
    els.jpegGainMapScale,
    els.jpegChromaSubsampling,
    els.jpegxlPrecision,
    els.sdrPngBitDepth,
    els.exportDithering,
    els.exportMetadataPolicy,
  ].forEach((control) => control?.addEventListener("change", () => {
    markExportPresetCustom();
    renderFormatCards();
    window.HDRProofing?.invalidate("settings");
  }));
  els.exportResizeMode?.addEventListener("change", () => {
    markExportPresetCustom();
    renderOutputFinishingControls();
  });
  [els.exportLongEdge, els.exportWidth, els.exportHeight].forEach((control) => control?.addEventListener("change", markExportPresetCustom));
  els.exportPreventEnlargement?.addEventListener("change", markExportPresetCustom);
  els.exportSharpening?.addEventListener("change", markExportPresetCustom);

  bindCompareControl();
  window.addEventListener("hdrfinisher:webgpulost", (event) => {
    state.displayInfo.gpu = event.detail?.message || "WebGPU device lost; using CPU fallback";
    clearGpuSurfaceHdr();
    renderReadouts();
    if (state.session) settlePreview(state.currentView).catch(() => null);
  });
  if (window.matchMedia) {
    ["(dynamic-range: high)", "(color-gamut: p3)", "(color-gamut: rec2020)"].forEach((query) => {
      const media = window.matchMedia(query);
      media.addEventListener?.("change", () => {
        state.displayInfo = buildDisplayProbe(state.desktopEnvironment);
        state.displayInfo.gpu = state.gpuPreview?.detail || "Backend fallback";
        clearGpuSurfaceHdr();
        state.gpuPreview?.invalidateSurfaces?.();
        renderReadouts();
        if (state.session) settlePreview(state.currentView).catch(() => null);
      });
    });
  }
}

async function loadCapabilities() {
  const response = await fetch("/api/capabilities");
  const data = await response.json();
  state.capabilities = data.capabilities;
}

async function loadDefaultExportDirectory() {
  if (state.appPreferences?.folders?.fileSave) {
    state.defaultExportDirectory = state.appPreferences.folders.fileSave;
    if (!els.exportDirectory.value.trim()) els.exportDirectory.value = state.defaultExportDirectory;
    return;
  }
  const response = await fetch("/api/export-directory/default");
  const payload = await safeJson(response);
  if (!response.ok || !payload?.directory) return;
  state.defaultExportDirectory = payload.directory;
  if (!els.exportDirectory.value.trim()) els.exportDirectory.value = payload.directory;
}

function bindRangeResetControls() {
  document.addEventListener("dblclick", (event) => {
    const control = event.target.closest('input[type="range"]:not([data-no-double-reset])');
    if (!control || control.disabled) return;
    event.preventDefault();
    control.value = control.dataset.defaultValue ?? control.defaultValue;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function uploadFile(file) {
  renderExperimentalDngNote(file);
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Reading source file...", 8);
  const startedAt = performance.now();
  const ticker = window.setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const detail = elapsed >= 10
      ? "The decoder is still working; the interface remains responsive"
      : "Reading and decoding source data";
    setIndeterminatePreviewMessage(`${detail} · ${elapsed.toFixed(1)}s elapsed`);
  }, 250);
  try {
    const response = await fetch("/api/session", { method: "POST", body: formData });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return false;
    }
    clearPreviewCache();
    state.session = payload.session;
    if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
    setPreviewMessage("Source decoded. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    state.documentDirty = Boolean(payload.session.dirty);
    state.selectedLocalId = null;
    state.projectPath = "";
    state.currentView = "hdr";
    await applyNewSessionPreferences();
    activateWorkflowTab("grade", { focus: false });
    state.interpretationGateDismissed = false;
    state.gpuPreview?.resetSession(payload.session.session_id);
    invalidatePreview("hdr", { markDirty: false });
    invalidatePreview("sdr", { markDirty: false });
    renderSession();
    renderLocalAdjustments();
    seedExportFieldsFromSession();
    const gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
    await Promise.all([
      gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
      refreshOverlay(),
      refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
    ]);
    hidePreviewMessage();
    prepareInactivePreview();
    if (previewNeedsRefinement()) debouncePreview("hdr");
    return true;
  } catch (error) {
    console.error(error);
    showUploadError("The upload could not reach the local HDR Finisher server.");
    return false;
  } finally {
    window.clearInterval(ticker);
  }
}

function showUploadError(message) {
  els.badge.textContent = message;
  els.badge.className = "badge bad";
  setPreviewError(message);
  clearPreviewImage();
  clearPreviewOverlay();
}

async function ejectCurrentSession() {
  if (!state.session) return;
  if (!await confirmUnsavedTransition("eject the current image")) return;
  await fetch("/api/session/current", { method: "DELETE" }).catch(() => null);
  clearPreviewCache();
  state.session = null;
  renderExperimentalDngNote();
  renderRawImportControls(null);
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = defaultAdjustments();
  state.editDocument = null;
  loadDenoiseDocument(null);
  els.hdrReferenceWhite.value = String(state.appPreferences?.defaultReferenceWhiteNits || 203);
  els.hdrReferenceWhite.disabled = false;
  state.editRevision = 0;
  state.documentDirty = false;
  state.selectedLocalId = null;
  state.projectPath = "";
  state.compareWithoutLocals = false;
  state.currentView = "hdr";
  activateWorkflowTab("import", { focus: false });
  state.interpretationGateDismissed = false;
  state.lastScope = null;
  state.lastExportPath = "";
  state.gpuPreview?.resetSession();
  state.previewInfo = {
    mediaType: "n/a",
    transport: "n/a",
    colorSpace: "n/a",
    transfer: "n/a",
    bitDepth: "n/a",
    notes: "No preview yet",
  };
  clearPreviewImage();
  clearPreviewOverlay();
  els.badge.textContent = "No file loaded.";
  els.badge.className = "badge neutral";
  renderSourceFilename("No active image");
  syncCopySourcePathButton();
  els.metadataList.innerHTML = "";
  els.sourceSettingsPanel.classList.add("hidden");
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  els.interpretationLinearReference.value = "scene_0_18";
  state.sourceSettingsOpen = true;
  state.metadataOpen = true;
  els.exportStatus.textContent = "Choose a format and destination.";
  els.exportResult.classList.add("hidden");
  els.exportFilename.value = "hdr_finisher_export";
  els.exportDirectory.value = state.defaultExportDirectory;
  syncControlsFromState();
  drawHistogram([]);
  renderReadouts();
  hidePreviewMessage();
  renderSessionChrome();
  state.selectedCurveChannel = "luma";
  state.selectedCurvePoint = Math.floor(currentCurveValues().length / 2);
  state.selectedToneEqualizerBand = 6;
  renderCurveChannelTabs();
  syncCurveControlsFromState();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  updateExportAvailability();
}

function renderSession() {
  const session = state.session;
  els.hdrReferenceWhite.value = String(projectReferenceWhiteNits());
  els.hdrReferenceWhite.disabled = false;
  renderExperimentalDngNote(session);
  renderSourceFilename(session.source.filename);
  clearPreviewOverlay();
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  syncCopySourcePathButton();
  syncInterpretationControls(session);
  renderRawImportControls(session);
  applyLatitudePresets(session.analysis.source_latitude);
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  renderMetadata(session);
  renderReadouts();
  syncControlsFromState();
  syncCurveControlsFromState();
  renderSessionChrome();
  drawCurveEditor();
  drawToneEqualizerEditor();
  renderOverlayPresetNote();
  renderMetadataVisibility();
  renderInterpretationGate();
  renderLaneChrome();
  renderControlState();
  updateExportAvailability();
  window.HDRProofing?.reset();
}

function formatFocalLength(value) {
  const text = String(value ?? "").trim();
  if (!text) return "n/a";
  if (/mm\b/i.test(text)) return text;
  const numeric = Number(text);
  return `${Number.isFinite(numeric) ? numeric : text} mm`;
}

function formatAperture(value) {
  const text = String(value ?? "").trim();
  if (!text) return "n/a";
  if (/^f\s*\//i.test(text)) return text;
  const numeric = Number(text);
  return `f/${Number.isFinite(numeric) ? numeric : text}`;
}

function renderMetadata(session) {
  const entries = [
    ["Size", `${session.source.width} x ${session.source.height}`],
    ["Current Preview Size", currentPreviewSizeLabel()],
    ["Format", session.source.suffix],
    ["Working space", session.source.working_space],
    ["Source space", session.source.source_color_space || "unknown"],
    ["Transfer", session.source.transfer_function || "unknown"],
    ["Interpretation", session.source.interpretation_mode || "auto"],
    ["Confidence", session.source.color_space_confident ? "confirmed" : "review"],
    ["Bit depth", session.metadata.bit_depth || "unknown"],
    ["Camera make", session.metadata.camera_maker || "n/a"],
    ["Camera model", session.metadata.camera_model || "n/a"],
    ["Lens make", session.metadata.lens_maker || "n/a"],
    ["Lens model", session.metadata.lens || "n/a"],
    ["ISO", session.metadata.iso || "n/a"],
    ["Shutter", session.metadata.shutter_speed || "n/a"],
    ["Focal length", formatFocalLength(session.metadata.focal_length_mm)],
    ["Aperture", formatAperture(session.metadata.aperture)],
  ];
  if (session.metadata.extra?.experimental_dng_import === "True") {
    entries.push(
      ["DNG status", session.metadata.extra.experimental_dng_label || "Experimental DNG Import"],
      ["DNG route", session.metadata.extra.dng_route || "unknown"],
      ["DNG color path", session.metadata.extra.dng_color_path || "unknown"],
      ["DNG operations", session.metadata.extra.dng_operations || "none"],
      ["DNG warnings", session.metadata.extra.dng_warnings || "none"],
    );
  }
  if (session.metadata.extra?.raw_pipeline) {
    entries.push(["RAW pipeline", session.metadata.extra.raw_pipeline]);
  }
  if (session.metadata.extra?.raw_fallback_reason) {
    entries.push(["RAW compatibility fallback", session.metadata.extra.raw_fallback_reason]);
  }
  els.metadataList.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (key === "Current Preview Size") dd.id = "metadata-current-preview-size";
    els.metadataList.append(dt, dd);
  }
}

function currentPreviewSizeLabel({ refining = false } = {}) {
  const target = previewResolutionLabel();
  if (refining) return `${target} · Refining…`;
  const presentation = state.acceptedPresentation;
  if (!presentation?.width || !presentation?.height || presentation.lane !== state.currentView) return `${target} · Waiting`;
  return `${target} · ${presentation.width} × ${presentation.height}`;
}

function renderCurrentPreviewSize(options) {
  const value = document.getElementById("metadata-current-preview-size");
  if (value) value.textContent = currentPreviewSizeLabel(options);
}

function renderReadouts() {
  renderPresentationCapability();
  renderKeyValueList(els.previewOutputList, previewOutputEntries());
  renderKeyValueList(els.displayInfoList, displayProbeEntries());
  renderKeyValueList(els.sourcePreviewList, sourceInterpretationEntries());
  renderWorkflowContext();
}

function renderOverlayPresetNote() {
  const levels = falseColorLevels();
  const anchorSource = state.adjustments.shared.false_color_band_anchor || "project";
  const anchorLabel = anchorSource === "project" ? "project HDR reference white" : `fixed ${levels.referenceWhite} nit`;
  els.overlayPresetNote.textContent = `Bands anchor to ${anchorLabel}; the independent warning ceiling is ${levels.peak.toLocaleString()} nit.`;
  const mode = state.adjustments.shared.overlay_mode || "off";
  const active = mode === "false_color" || mode === "zebra";
  els.overlayToggle.textContent = "Overlays";
  els.overlayToggle.classList.toggle("overlay-enabled", active);
  els.overlayToggle.setAttribute("aria-pressed", String(active));
  els.overlayToggle.setAttribute("aria-label", active ? `Overlays on: ${mode === "false_color" ? "False Color" : "Zebra"}` : "Overlays off");
  renderFalseColorKey(mode);
  els.falseColorLegend.classList.toggle("hidden", mode !== "false_color" || !state.session);
}

function renderFalseColorKey(mode) {
  if (!els.falseColorKey) return;
  els.falseColorKey.classList.toggle("hidden", mode !== "false_color");
  const items = falseColorBands()
    .map(({ lower, upper, paletteIndex }) => {
      const item = document.createElement("span");
      item.className = "false-color-key-item";
      const swatch = document.createElement("i");
      swatch.className = "false-color-key-swatch";
      swatch.style.backgroundColor = exposureBandColor(paletteIndex);
      const text = document.createElement("span");
      text.textContent = lower === null
        ? `< ${formatReferenceNits(upper)}`
        : upper === null
          ? `≥ ${formatReferenceNits(lower)}`
          : `${formatReferenceNits(lower)}–${formatReferenceNits(upper)}`;
      item.append(swatch, text);
      return item;
    });
  els.falseColorKey.replaceChildren(...items);
}

function projectReferenceWhiteNits() {
  return Number(state.editDocument?.hdr_reference_white_nits) === 100 ? 100 : 203;
}

function falseColorLevels() {
  const anchor = state.adjustments.shared.false_color_band_anchor || "project";
  const referenceWhite = anchor === "100_nits" ? 100 : anchor === "203_nits" ? 203 : projectReferenceWhiteNits();
  const requestedPeak = Number(state.adjustments.shared.false_color_ceiling_nits);
  const peak = [100, 1000, 4000].includes(requestedPeak) ? requestedPeak : 1000;
  return { referenceWhite, peak };
}

function falseColorBands() {
  const levels = falseColorLevels();
  const highlightStart = Math.max(levels.referenceWhite, Math.min(levels.referenceWhite * 2, levels.peak * 0.5));
  const boundaries = [
    levels.referenceWhite * 0.1,
    levels.referenceWhite * 0.25,
    levels.referenceWhite * 0.5,
    levels.referenceWhite,
    highlightStart,
    levels.peak,
  ];
  const ranges = boundaries.map((upper, index) => ({
    lower: index === 0 ? null : boundaries[index - 1],
    upper,
    paletteIndex: index,
  }));
  ranges.push({ lower: boundaries.at(-1), upper: null, paletteIndex: falseColorPaletteTokens.length - 1 });
  return ranges.filter(({ lower, upper }) => lower === null || upper === null || upper > lower);
}

function formatReferenceNits(value) {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} nit`;
}

async function initializeDesktopBridge() {
  els.revealExportPath?.classList.toggle("hidden", !desktop);
  els.openExportPath?.classList.toggle("hidden", !desktop);
  document.addEventListener("hdr:desktop-command", (event) => {
    void handleDesktopCommand(event.detail?.command, event.detail?.payload);
  });
  if (!desktop) return;
  desktop.onMenuCommand(({ command, payload }) => handleDesktopCommand(command, payload));
  desktop.onOpenRequest((selection) => {
    void openDesktopSelection(selection).catch((error) => {
      console.error(error);
      showUploadError(error?.message || "Could not open that source image.");
    });
  });
  desktop.onDisplayStateChanged?.((environment) => {
    state.desktopEnvironment = environment;
    state.displayInfo = buildDisplayProbe(environment);
    state.displayInfo.gpu = state.gpuPreview?.detail || "Backend fallback";
    clearGpuSurfaceHdr();
    state.gpuPreview?.invalidateSurfaces?.();
    renderReadouts();
    if (state.session) settlePreview(state.currentView).catch(() => null);
  });
  await desktop.rendererReady();
  state.desktopEnvironment = await desktop.environment();
  state.displayInfo = buildDisplayProbe(state.desktopEnvironment);
  state.renderingMode = ["auto", "gpu", "cpu"].includes(state.desktopEnvironment.renderingMode)
    ? state.desktopEnvironment.renderingMode
    : "auto";
}

async function handleDesktopCommand(command, payload = null) {
  if (command === "open-source") return requestSourceImport();
  if (command === "open-project") return openProjectFromPath();
  if (command === "save") return saveProjectToPath({ saveAs: false });
  if (command === "save-as") return saveProjectToPath({ saveAs: true });
  if (command === "export") return openExportSheet();
  if (command === "undo") return queueEditCommand("undo");
  if (command === "redo") return queueEditCommand("redo");
  if (command === "rendering-mode") {
    if (window.HDRApplicationShell) {
      window.HDRApplicationShell.setRenderingModePreference(payload?.mode);
      return true;
    }
    return applyRenderingMode(payload?.mode);
  }
  if (command === "settings") return window.HDRApplicationShell?.openSettings();
  if (command === "help") return window.HDRApplicationShell?.openHelp();
  if (command === "check-updates") {
    window.HDRApplicationShell?.openSettings("updates");
    return window.HDRApplicationShell?.checkForUpdates({ force: true, manual: true });
  }
}

function applicationCommands() {
  return [
    { id: "app.settings", label: "Open Settings", category: "Application", global: true, execute: () => window.HDRApplicationShell?.openSettings() },
    { id: "app.help", label: "Open Help", category: "Application", global: true, execute: () => window.HDRApplicationShell?.openHelp() },
    { id: "file.import", label: "Import source", category: "File", execute: () => requestSourceImport() },
    { id: "file.importQuick", label: "Import source (quick key)", category: "File", execute: () => requestSourceImport() },
    { id: "project.open", label: "Open project", category: "File", execute: () => openProjectFromPath() },
    { id: "project.save", label: "Save project", category: "File", execute: () => saveProjectToPath({ saveAs: false }) },
    { id: "project.saveAs", label: "Save project as", category: "File", execute: () => saveProjectToPath({ saveAs: true }) },
    { id: "file.export", label: "Open Export", category: "File", execute: () => openExportSheet() },
    { id: "file.exportStandard", label: "Open Export (standard)", category: "File", execute: () => openExportSheet() },
    { id: "edit.undo", label: "Undo", category: "Edit", global: true, execute: () => queueEditCommand("undo") },
    { id: "edit.redo", label: "Redo", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "edit.redoAlternate", label: "Redo (alternate)", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "edit.redoRequested", label: "Redo (Ctrl+R)", category: "Edit", global: true, execute: () => queueEditCommand("redo") },
    { id: "view.compareHold", label: "Hold to compare HDR / SDR", category: "Viewer", hold: true, execute: (_event, phase) => phase === "keyup" ? endCompareHold() : beginCompareHold() },
    { id: "view.zoomFit", label: "Zoom to fit", category: "Viewer", execute: () => setZoomMode("fit") },
    { id: "view.zoomActual", label: "Zoom to 100%", category: "Viewer", execute: () => setZoomMode("actual") },
    { id: "view.zoomIn", label: "Zoom in", category: "Viewer", repeatable: true, execute: () => stepZoom(1) },
    { id: "view.zoomOut", label: "Zoom out", category: "Viewer", repeatable: true, execute: () => stepZoom(-1) },
    { id: "view.analysis", label: "Toggle analysis panel", category: "Viewer", execute: () => toggleAnalysisDock() },
    { id: "view.overlay", label: "Cycle overlay mode", category: "Viewer", execute: () => cycleOverlayMode() },
    { id: "view.scopeRegion", label: "Toggle Scope Region", category: "Viewer", execute: () => toggleScopeRegion() },
    { id: "view.hdr", label: "Show HDR rendition", category: "Viewer", execute: () => switchLane("hdr") },
    { id: "view.sdr", label: "Show SDR rendition", category: "Viewer", execute: () => switchLane("sdr") },
    {
      id: "crop.cycleGuide",
      label: "Cycle crop guide",
      category: "Crop",
      execute: () => {
        if (!state.cropMode) return;
        const guides = ["none", "thirds", "golden", "grid", "x", "diagonals"];
        state.cropGuide = guides[(guides.indexOf(state.cropGuide) + 1) % guides.length];
        renderCropOptions();
      },
    },
    ...["import", "grade", "proof", "export"].map((workflow) => ({
      id: `workflow.${workflow}`,
      label: `Open ${workflow[0].toUpperCase()}${workflow.slice(1)} workspace`,
      category: "Workflow",
      execute: () => activateWorkflowTab(workflow, { focus: true }),
    })),
  ];
}

function adjustControlFromShortcut(path, direction, event) {
  const control = [...document.querySelectorAll('input[type="range"][data-path]')]
    .find((candidate) => candidate.dataset.path === path && !candidate.disabled);
  if (!control) return false;
  if (direction === "reset") {
    control.value = control.dataset.defaultValue ?? control.defaultValue;
  } else {
    const baseStep = Number(control.dataset.instrumentStep) || Number(control.step) || ((Number(control.max) - Number(control.min)) / 100) || 1;
    const multiplier = event?.ctrlKey ? FINE_ADJUSTMENT_SCALE : 1;
    const delta = baseStep * multiplier * (direction === "increase" ? 1 : -1);
    const value = clamp(Number(control.value) + delta, Number(control.min), Number(control.max));
    control.value = String(Math.round(value * 1e8) / 1e8);
  }
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function initializeApplicationShell() {
  if (!window.HDRApplicationShell) return;
  state.appPreferences = await window.HDRApplicationShell.init({
    desktop,
    commands: applicationCommands(),
    adjustControl: adjustControlFromShortcut,
    onPreferencesChanged: (preferences, options = {}) => {
      const oldDirectory = state.appPreferences?.folders?.fileSave || "";
      const themeChanged = !options.initial && preferences.theme !== state.appPreferences?.theme;
      state.appPreferences = preferences;
      if (themeChanged) {
        // CSS custom properties repaint immediately, but canvases (scopes,
        // curve editor, tone equalizer) only redraw when explicitly told to —
        // otherwise they keep showing colors sampled at the last draw call.
        drawHistogram(state.lastScope || []);
        if (els.curveEditor) drawCurveEditor();
        if (els.toneEqualizerEditor) drawToneEqualizerEditor("hdr");
        if (els.sdrToneEqualizerEditor) drawToneEqualizerEditor("sdr");
        if (els.highlightCompressionGraph) renderHighlightCompressionControls();
        if (els.sdrHighlightCompressionGraph) renderSdrHighlightCompressionControls();
      }
      if (preferences.folders.fileSave) {
        state.defaultExportDirectory = preferences.folders.fileSave;
        if (!els.exportDirectory.value.trim() || els.exportDirectory.value === oldDirectory) els.exportDirectory.value = preferences.folders.fileSave;
      } else if (oldDirectory) {
        state.defaultExportDirectory = "";
        if (els.exportDirectory.value === oldDirectory) els.exportDirectory.value = "";
        void loadDefaultExportDirectory();
      }
      if (!state.session) els.hdrReferenceWhite.value = String(preferences.defaultReferenceWhiteNits);
      if (options.initial) state.renderingMode = preferences.renderingMode;
      else if (preferences.renderingMode !== state.renderingMode) void applyRenderingMode(preferences.renderingMode);
    },
  });
}

async function applyNewSessionPreferences() {
  const requested = Number(state.appPreferences?.defaultReferenceWhiteNits) === 100 ? 100 : 203;
  if (!state.session || projectReferenceWhiteNits() === requested) return true;
  return queueEditCommand("set_hdr_reference_white", { hdr_reference_white_nits: requested }, null, { refreshPreview: false });
}

async function applyRenderingMode(mode) {
  if (!["auto", "gpu", "cpu"].includes(mode)) return false;
  state.renderingMode = mode;
  state.gpuPreparedLane = { hdr: false, sdr: false };
  state.gpuPreview?.resetSession(state.session?.session_id || null);
  if (state.session) {
    invalidatePreview("hdr", { markDirty: false });
    invalidatePreview("sdr", { markDirty: false });
    await settlePreview(state.currentView);
  }
  renderReadouts();
  return true;
}

async function requestSourceImport() {
  if (!desktop) {
    els.fileInput.click();
    return;
  }
  const currentSourceDirectory = splitOutputPath(sourcePathForClipboard()).directory;
  await openMediaBrowser("source", currentSourceDirectory || state.appPreferences?.folders?.fileImport || "");
}

const LUMA_RANGE_MIN_NITS = 0.1;
const LUMA_RANGE_MAX_NITS = 10000;
const LUMA_TONAL_RAMP_EV = 0.75;

function referenceNitsToEv(value) {
  return Math.log2(clamp(Number(value), LUMA_RANGE_MIN_NITS, LUMA_RANGE_MAX_NITS) / projectReferenceWhiteNits());
}

function evToReferenceNits(value) {
  return projectReferenceWhiteNits() * (2 ** Number(value));
}

function lumaBandLabel(lower, upper) {
  if (lower === null) return `< ${formatReferenceNits(upper)}`;
  if (upper === null) return `>= ${formatReferenceNits(lower)}`;
  return `${formatReferenceNits(lower)} - ${formatReferenceNits(upper)}`;
}

function previewOutputEntries() {
  return [
    ["View", state.currentView.toUpperCase()],
    ["Rendering", state.renderingMode === "cpu" ? "CPU Compatibility" : state.renderingMode === "gpu" ? "GPU Preferred" : "Auto"],
    ["Preview Target", `${previewResolutionLabel()} · max ${previewTargetLongEdge()} × ${previewTargetLongEdge()}`],
    ["Presented", state.acceptedPresentation?.longEdge ? `${state.acceptedPresentation.longEdge}px · ${state.acceptedPresentation.transport}` : "Waiting"],
    ["Scope", els.scopeFreshness?.textContent || "Waiting"],
    ["Transport", state.previewInfo.transport],
    ["Media", state.previewInfo.mediaType],
    ["Space", state.previewInfo.colorSpace],
    ["Transfer", state.previewInfo.transfer],
    ["Bit Depth", state.previewInfo.bitDepth],
    ["Notes", state.previewInfo.notes],
  ];
}

function displayProbeEntries() {
  const display = state.desktopEnvironment?.currentDisplay;
  const presentation = state.presentationCapability || presentationCapabilityState();
  return [
    ["HDR Presentation", presentation.qualified ? "Qualified" : "SDR simulation"],
    ["Session", state.desktopEnvironment?.nativeWayland ? "Native Wayland" : state.desktopEnvironment?.sessionType || "Browser"],
    ["Display", display?.label || "Current browser display"],
    ["Output Space", display?.colorSpace || "unknown"],
    ["Component Depth", display?.depthPerComponent ? `${display.depthPerComponent}-bit` : "unknown"],
    ["Dynamic Range", state.displayInfo.dynamicRange],
    ["Color Gamut", state.displayInfo.colorGamut],
    ["Pixel Ratio", state.displayInfo.pixelRatio],
    ["Screen Depth", state.displayInfo.screenDepth],
    ["Browser", state.displayInfo.browser],
    ["GPU Preview", state.displayInfo.gpu || "Backend fallback"],
  ];
}

function setGpuSurfaceHdr(lane, active) {
  if (lane === "hdr" || lane === "sdr") state.gpuSurfaceHdrByLane[lane] = Boolean(active);
  state.gpuSurfaceHdr = Boolean(state.gpuSurfaceHdrByLane.hdr);
}

function clearGpuSurfaceHdr() {
  state.gpuSurfaceHdrByLane = { hdr: false, sdr: false };
  state.gpuSurfaceHdr = false;
}

function presentationCapabilityState() {
  const environment = state.desktopEnvironment;
  const onLinux = environment?.platform === "linux";
  const reasons = [];
  if (onLinux && !environment.nativeWayland) reasons.push("native Wayland is not active");
  if (!mediaQueryMatch("(dynamic-range: high)")) reasons.push("the current display does not report high dynamic range");
  if (!state.gpuPreview?.available || state.renderingMode === "cpu") reasons.push("WebGPU is unavailable or CPU preview is selected");
  if (state.gpuPreview?.adapterInfo?.fallback) reasons.push("WebGPU is using a software fallback adapter");
  if (!state.gpuSurfaceHdr) reasons.push("the extended rgba16float canvas is not active");
  return {
    qualified: Boolean((!onLinux || environment.nativeWayland) && reasons.length === 0),
    reasons,
    nativeWayland: Boolean(environment?.nativeWayland),
    browserDynamicRange: mediaQueryMatch("(dynamic-range: high)"),
    browserGamut: state.displayInfo.colorGamut,
    extendedSurface: Boolean(state.gpuSurfaceHdr),
    softwareFallback: Boolean(state.gpuPreview?.adapterInfo?.fallback),
    display: environment?.currentDisplay || null,
    exactHeadroomAvailable: false,
  };
}

function renderPresentationCapability() {
  state.presentationCapability = presentationCapabilityState();
  if (!els.hdrPresentationWarning) return;
  const show = state.desktopEnvironment?.platform === "linux" && !state.presentationCapability.qualified;
  els.hdrPresentationWarning.classList.toggle("hidden", !show);
  if (show) {
    const reason = state.presentationCapability.reasons.join("; ");
    els.hdrPresentationWarningCopy.textContent = `${reason}. Editing, scopes, and export remain accurate; visible HDR brightness is an SDR simulation.`;
  }
}

function renderWorkflowContext() {
  if (!els.workflowContextList) return;
  const selectedDisplay = (state.displayTelemetry?.displays || [])
    .find((display) => display.id === state.proofDisplayId);
  const proofFormat = {
    avif_gain_map: "AVIF + gain map",
    jpeg_ultrahdr: "JPEG Ultra HDR",
    jpegxl_hdr: "JPEG XL HDR",
  }[state.proofFormat] || "Unknown";
  const exportFormat = {
    avif_gain_map: "AVIF + gain map",
    jpeg_ultrahdr: "JPEG Ultra HDR",
    jpegxl_hdr: "JPEG XL HDR",
    sdr_jpegxl: "JPEG XL (SDR)",
    sdr_jpeg: "JPEG (SDR)",
    sdr_png: "PNG (SDR)",
  }[els.exportFormat?.value] || "Not selected";
  const proofStatus = !state.proofReconstruction
    ? "Not built"
    : state.proofDirty ? "Stale" : "Current";
  const entriesByWorkflow = {
    grade: [
      ["Stage", "Grade"],
      ["View", state.currentView === "sdr" ? "SDR fallback" : "HDR grade"],
      ["Format", state.session?.source?.suffix || "n/a"],
    ],
    proof: [
      ["Stage", "Chromium Proof"],
      ["Status", proofStatus],
      ["Format", proofFormat],
      ["Display ID", selectedDisplay?.id || state.proofDisplayId || "Unavailable"],
    ],
    export: [
      ["Stage", "Export"],
      ["Format", exportFormat],
      ["Proof", proofStatus],
      ["Display ID", selectedDisplay?.id || state.proofDisplayId || "Unavailable"],
    ],
  };
  renderKeyValueList(els.workflowContextList, entriesByWorkflow[state.activeWorkflow] || entriesByWorkflow.grade);
}

function sourceInterpretationEntries() {
  if (!state.session) {
    return [
      ["Format", "n/a"],
      ["Source Space", "n/a"],
      ["Transfer", "n/a"],
      ["Working", "n/a"],
      ["Signal", "n/a"],
    ];
  }

  const luminance = state.editDocument?.source?.luminance || {};
  return [
    ["Format", state.session.source.suffix],
    ["Source Space", state.session.source.source_color_space || "unknown"],
    ["Transfer", state.session.source.transfer_function || "unknown"],
    ["Summary", interpretationSummary(state.session)],
    ["Interpretation", state.session.source.interpretation_mode || "auto"],
    ["Working", state.session.source.working_space || "ACEScg"],
    ["Signal", state.session.analysis.classification],
    ["Latitude", state.session.analysis.source_latitude],
    ["Source Depth", state.session.metadata.bit_depth || "unknown"],
    ["Source diffuse white", luminance.source_diffuse_white_nits ? `${luminance.source_diffuse_white_nits} nit` : "not declared"],
    ["Source peak", luminance.source_peak_nits ? `${luminance.source_peak_nits} nit` : "measured separately"],
    ["Project reference white", `${projectReferenceWhiteNits()} nit`],
  ];
}

function renderKeyValueList(container, entries) {
  container.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    container.append(dt, dd);
  }
}

function applyLatitudePresets(latitude) {
  const preset = latitudePresets[latitude] || latitudePresets.MEDIUM;
  Object.entries(preset).forEach(([path, [min, max, step]]) => {
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) {
      control.min = min;
      control.max = max;
      control.dataset.instrumentStep = String(step);
      control.step = String(fineRangeStep(step));
      syncRangeControlFromState(path, control);
    }
  });
}

function debouncePreview(lane = state.currentView) {
  if (!state.previewScheduler) {
    queueGpuDraft(lane);
    window.clearTimeout(state.settleTimer);
    state.settleTimer = window.setTimeout(() => settlePreview(lane), 120);
    return;
  }
  state.previewScheduler.schedule(lane, state.previewGeneration[lane]);
}

function queueGpuDraft(lane = state.currentView) {
  state.gpuQueuedLane = lane;
  if (state.gpuRenderFrame !== null) return;
  state.gpuRenderFrame = requestAnimationFrame(() => {
    state.gpuRenderFrame = null;
    const queuedLane = state.gpuQueuedLane;
    state.gpuQueuedLane = null;
    renderGpuDraft(queuedLane).catch(() => null);
  });
}

async function settlePreview(lane = state.currentView, task = {}) {
  // Rotate/Straighten is an explicit Apply/Cancel transaction. A scheduler
  // task left resident by an earlier grading gesture must never settle the
  // transient geometry on slider release.
  if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;
  await syncGlobalEditState();
  const display = lane === state.currentView;
  const detailRestore = state.detailInteractionRestore?.lane === lane
    && state.detailInteractionRestore.longEdge === refinementProxyLongEdge()
    ? state.detailInteractionRestore.longEdge
    : null;
  const longEdge = detailRestore || settledProxyLongEdge();
  if (state.detailInteractionRestore?.lane === lane) state.detailInteractionRestore = null;
  const tier = longEdge >= refinementProxyLongEdge() ? "refinement" : "settled";
  if (display) {
    if (gpuPreviewEligible(lane)) {
      const rendered = await renderGpuDraft(lane, { longEdge, tier });
      if (rendered) await refreshOverlay(longEdge);
      else await renderPreviewForLane(lane, true, longEdge, { showProgress: false });
    } else {
      await renderPreviewForLane(lane, true, longEdge, { showProgress: false });
    }
    prepareInactivePreview();
  } else {
    state.previewScheduler?.scheduleInactive(lane, state.previewGeneration[lane]);
  }
  window.HDRProofing?.settled(lane);
}

async function refinePreview(lane, task = {}) {
  if (!state.session || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView) return;
  if (task.applicationGeneration !== undefined && task.applicationGeneration !== state.previewGeneration[lane]) return;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const targetLongEdge = refinementProxyLongEdge();
  markRefining();
  const rendered = gpuPreviewEligible(lane)
    ? await renderGpuDraft(lane, { longEdge: targetLongEdge, tier: "refinement" })
    : false;
  if (rendered || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView || targetLongEdge !== refinementProxyLongEdge()) return;
  await renderPreviewForLane(lane, true, targetLongEdge, { showProgress: false });
  if (generation !== state.previewGeneration[lane] || signature !== geometrySignature() || !previewNeedsRefinement()) return;
}

function displayedLongEdge() {
  const rect = els.dropzone.getBoundingClientRect();
  const paneWidth = state.compareLayout === "side-horizontal" ? rect.width / 2 : rect.width;
  const paneHeight = state.compareLayout === "side-vertical" ? rect.height / 2 : rect.height;
  return Math.max(paneWidth, paneHeight) * Math.max(1, window.devicePixelRatio || 1);
}

function residentAuthoringLongEdge() {
  const accepted = state.acceptedPresentation;
  const target = previewTargetLongEdge();
  if (!gpuPreviewEligible(state.currentView)
    || accepted?.transport !== "WebGPU"
    || accepted.lane !== state.currentView
    || accepted.geometrySignature !== geometrySignature()
    || accepted.longEdge !== target
    || els.previewCanvas.style.display === "none") return null;
  return target;
}

function interactiveProxyLongEdge() {
  // Interaction is intentionally display-bounded even when a 2K/4K refined
  // proxy is resident. The GPU proxy cache retains two levels per lane, so the
  // refined source remains available for the post-gesture settle/refinement.
  return Math.round(clamp(displayedLongEdge(), 512, 1024));
}

function globalDetailActive(lane = state.currentView) {
  const branch = state.adjustments?.[lane];
  const detail = branch?.detail || {};
  return Boolean(
    branch?.detail_section_enabled !== false
    && [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
      .some((value) => Math.abs(Number(value) || 0) > 0.000001)
  );
}

function gpuDetailGraphActive(lane = state.currentView) {
  if (globalDetailActive(lane)) return true;
  return localAdjustments().some((local) => {
    const grade = local?.[`${lane}_grade`];
    const detail = grade?.detail || {};
    return local?.enabled !== false
      && Number(local?.opacity) > 0
      && grade?.enabled !== false
      && [detail.texture_amount, detail.clarity_amount, detail.sharpen_amount]
        .some((value) => Math.abs(Number(value) || 0) > 0.000001);
  });
}

function beginGlobalDetailInteraction(path) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (!/^(hdr|sdr)\.detail\./.test(resolvedPath || "")) {
    // A no-op Detail pointer gesture does not schedule a settle callback.
    // Reset its marker when any other global gesture starts so unrelated
    // controls never inherit Detail backpressure or refinement restoration.
    state.detailInteractionRestore = null;
    return;
  }
  const lane = resolvedPath.startsWith("sdr.") ? "sdr" : "hdr";
  state.detailInteractionRestore = {
    lane,
    longEdge: residentAuthoringLongEdge(),
  };
}

function settledProxyLongEdge() {
  const resident = residentAuthoringLongEdge();
  if (resident) return resident;
  return Math.round(Math.min(previewTargetLongEdge(), clamp(displayedLongEdge(), 768, 1024)));
}

function refinementProxyLongEdge() {
  return Math.round(previewTargetLongEdge());
}

function scopeLongEdge(tier) {
  // Interactive scopes favor visible motion; the settled pass restores the
  // denser authoring result immediately after the drag ends.
  const profile = scopeQualityProfile();
  if (tier === "interactive") return Math.min(profile.interactiveEdge, interactiveProxyLongEdge());
  if (tier === "refinement") return Math.min(profile.refinementEdge, refinementProxyLongEdge());
  return Math.min(profile.settledEdge, settledProxyLongEdge());
}

function debounceOverlayAndScopes() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    renderOverlayPresetNote();
    await refreshOverlay();
    await refreshScopes();
  }, 120);
}

function refreshOverlayAndScopesImmediately() {
  window.clearTimeout(state.refreshTimer);
  renderOverlayPresetNote();
  if (state.adjustments.shared.overlay_mode === "off") clearPreviewOverlay();
  void (async () => {
    await refreshOverlay();
    await refreshScopes();
  })();
}

async function refreshPreview(options = {}) {
  return renderPreviewForLane(state.currentView, true, state.session?.preview?.long_edge || 1600, options);
}

async function renderPreviewForLane(
  lane,
  displayWhenReady,
  longEdge = 1600,
  { showProgress = true, progressSteps = [12, 76, 92], raw = !state.gpuPreview?.available } = {},
) {
  // Perspective owns its transient preview until Apply/Cancel. Revision-based
  // renders still contain the committed geometry, even when the controls reset.
  if (!state.session || geometryDraftActive()) return false;
  const sessionId = state.session.session_id;
  if (await syncGlobalEditState() === false) return false;
  if (geometryDraftActive() || state.session?.session_id !== sessionId) return false;
  if (raw) return renderRawPreviewForLane(lane, displayWhenReady, longEdge, { showProgress });
  const cached = state.previewCache[lane];
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  if (cached?.generation === generation && cached.geometrySignature === signature && (cached.longEdge || 0) >= longEdge) {
    if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) showCachedPreview(lane);
    renderCompareStatus();
    return true;
  }

  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady && showProgress) setPreviewMessage(`Rendering ${lane.toUpperCase()} preview...`, progressSteps[0]);

  const response = await fetch(`/api/session/${state.session.session_id}/preview/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edit_revision: state.editRevision,
      include_locals: !state.compareWithoutLocals,
      local_adjustments: state.localPreviewDirty && !state.compareWithoutLocals
        ? JSON.parse(JSON.stringify(localAdjustments()))
        : null,
      long_edge: longEdge,
      hdr_display: mediaQueryMatch("(dynamic-range: high)"),
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  const requestIsCurrent = () => controller === state.previewControllers[lane]
    && !geometryDraftActive()
    && state.session?.session_id === sessionId
    && generation === state.previewGeneration[lane]
    && signature === geometrySignature();
  if (response.status === 409) {
    if (displayWhenReady && showProgress && requestIsCurrent()) setPreviewMessage("A newer adjustment replaced this render.", progressSteps[0]);
    return false;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    if (displayWhenReady && requestIsCurrent()) {
      setPreviewError(payload?.detail || "Preview failed to render.");
      clearPreviewImage();
      clearPreviewOverlay();
    }
    return false;
  }

  if (displayWhenReady && showProgress) setPreviewMessage("Processing complete. Decoding preview...", progressSteps[1]);
  const previewInfo = previewInfoFromResponse(response, lane);
  let width = Number(response.headers.get("X-Image-Width"));
  let height = Number(response.headers.get("X-Image-Height"));
  const blob = await response.blob();
  if (!requestIsCurrent()) return false;
  const url = URL.createObjectURL(blob);
  if (!(width > 0 && height > 0)) {
    try {
      const decoded = await decodePreviewImage(url);
      width = decoded.naturalWidth;
      height = decoded.naturalHeight;
    } catch (error) {
      URL.revokeObjectURL(url);
      if (requestIsCurrent()) setPreviewError(error.message);
      return false;
    }
    if (!requestIsCurrent()) { URL.revokeObjectURL(url); return false; }
  }
  const previous = state.previewCache[lane];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.previewCache[lane] = { url, generation, longEdge: Math.max(width, height) || longEdge, width, height, geometrySignature: signature };
  if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) {
    if (showProgress) setPreviewMessage("Presenting preview...", progressSteps[2]);
    const keptGpuSurface = shouldKeepHdrGpuSurface(lane)
      && await renderGpuDraft(lane)
      && state.gpuSurfaceHdr;
    if (!requestIsCurrent()) return false;
    if (!keptGpuSurface) {
      setGpuSurfaceHdr(lane, false);
      state.previewInfoByLane[lane] = previewInfo;
      if (!await applyPreviewUrl(url, requestIsCurrent)) return false;
      state.previewInfo = previewInfo;
      acceptPresentation(lane, longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", width, height, previewInfo.transport, gpuPreviewEligible(lane) ? "" : "CPU/backend");
      els.scopeKindLabel.textContent = lane.toUpperCase();
      renderReadouts();
    }
  } else {
    state.previewInfoByLane[lane] = previewInfo;
  }
  renderCompareStatus();
  return true;
}

async function renderRawPreviewForLane(lane, displayWhenReady, longEdge, { showProgress = false } = {}) {
  if (!state.session || geometryDraftActive()) return false;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const cached = state.previewCache[lane];
  if (cached?.raw && cached.generation === generation && cached.geometrySignature === signature && cached.longEdge >= longEdge) {
    if (displayWhenReady && lane === state.currentView) applyRawPreview(cached);
    return true;
  }
  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady && showProgress) setPreviewMessage(`Rendering ${lane.toUpperCase()} canvas preview...`, 24);
  const response = await fetch(`/api/session/${state.session.session_id}/preview-raw/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      edit_revision: state.editRevision,
      include_locals: !state.compareWithoutLocals,
      long_edge: longEdge,
      generation,
      tier: "settled",
      hdr_display: false,
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name !== "AbortError") console.error(error);
    return null;
  });
  if (!response || response.status === 409 || controller !== state.previewControllers[lane]) return false;
  if (!response.ok) {
    return false;
  }
  const width = Number(response.headers.get("X-Image-Width"));
  const height = Number(response.headers.get("X-Image-Height"));
  const rawGeneration = Number(response.headers.get("X-Generation"));
  const data = new Uint8ClampedArray(await response.arrayBuffer());
  if (geometryDraftActive() || controller !== state.previewControllers[lane]
    || generation !== state.previewGeneration[lane] || rawGeneration !== generation || signature !== geometrySignature()) return false;
  const frame = { raw: data, width, height, generation, longEdge: Math.max(width, height) || longEdge, geometrySignature: signature };
  state.previewCache[lane] = frame;
  state.previewInfoByLane[lane] = {
    mediaType: "application/octet-stream",
    transport: "Raw RGBA8",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Persistent CPU fallback canvas; export quality is unchanged",
  };
  if (displayWhenReady && lane === state.currentView && !state.comparePeekActive) applyRawPreview(frame);
  return true;
}

function applyRawPreview(frame) {
  let canvas = els.previewCanvas;
  let context = canvas.getContext("2d");
  if (!context) {
    const replacement = document.createElement("canvas");
    replacement.id = canvas.id;
    replacement.className = canvas.className;
    canvas.replaceWith(replacement);
    els.previewCanvas = replacement;
    canvas = replacement;
    context = canvas.getContext("2d");
  }
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(frame.raw, frame.width, frame.height), 0, 0);
  els.previewImage.style.display = "none";
  canvas.style.display = "block";
  els.emptyState.style.display = "none";
  setGpuSurfaceHdr(state.currentView, false);
  state.previewInfo = state.previewInfoByLane[state.currentView];
  hidePreviewMessage();
  clearInteractiveStraightenPreview();
  applyZoomGeometry();
  renderReadouts();
  acceptPresentation(state.currentView, frame.longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", frame.width, frame.height, "Raw RGBA8", "CPU/backend");
}

function applyRawComparisonPreview(frame) {
  let canvas = els.comparisonCanvas;
  let context = canvas.getContext("2d");
  if (!context) {
    const replacement = document.createElement("canvas");
    replacement.id = canvas.id;
    replacement.setAttribute("aria-label", canvas.getAttribute("aria-label") || "Settled comparison preview");
    canvas.replaceWith(replacement);
    els.comparisonCanvas = replacement;
    canvas = replacement;
    context = canvas.getContext("2d");
  }
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.putImageData(new ImageData(frame.raw, frame.width, frame.height), 0, 0);
  els.comparisonImage.style.display = "none";
  canvas.style.display = "block";
}

async function refreshOverlay(longEdge = state.session?.preview?.long_edge || 1600) {
  if (geometryDraftActive() || await syncGlobalEditState() === false || geometryDraftActive()) return;
  if (!state.session) return;
  state.overlayAbortController?.abort();
  state.overlayAbortController = null;
  if (state.adjustments.shared.overlay_mode === "off") {
    clearPreviewOverlay();
    return;
  }
  const controller = new AbortController();
  state.overlayAbortController = controller;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  const revision = state.editRevision;
  const response = await fetch(`/api/session/${sessionId}/overlay/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edit_revision: state.editRevision, include_locals: !state.compareWithoutLocals, long_edge: longEdge }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  const requestIsCurrent = () => controller === state.overlayAbortController
    && state.session?.session_id === sessionId
    && state.currentView === lane
    && state.editRevision === revision
    && state.adjustments.shared.overlay_mode !== "off";
  if (!requestIsCurrent()) return;
  if (response.status === 204) {
    clearPreviewOverlay();
    return;
  }
  if (!response.ok) {
    clearPreviewOverlay();
    return;
  }

  const blob = await response.blob();
  if (!requestIsCurrent()) return;
  const url = URL.createObjectURL(blob);
  await applyOverlayUrl(url, requestIsCurrent);
}

function refreshScopes(longEdge = 960, { tier = "settled", generation = null, lane = state.currentView } = {}) {
  if (!state.session || geometryDraftActive()) return Promise.resolve(false);
  if (state.globalEditDirty) {
    // A deferred or rejected sync can leave edits dirty. Retrying it in a
    // resolved-Promise loop starves input and grows the heap until V8 OOMs.
    return syncGlobalEditState().then((applied) => applied && !state.globalEditDirty
      ? refreshScopes(longEdge, { tier, generation, lane })
      : false);
  }
  // Scheduler generations and direct refreshes originate in different
  // counters. Normalize both into one strictly increasing presentation serial
  // so an older response can never become current again.
  const requestGeneration = Math.max(state.scopeGeneration + 1, generation ?? 0);
  state.scopeGeneration = requestGeneration;
  const mode = state.scopeMode;
  const resolution = mode === "waveform"
    ? waveformRequestResolution(tier)
    : mode === "vectorscope" ? vectorscopeRequestResolution(tier)
      : { bins: 256, columns: 256 };
  const effectiveLongEdge = mode === "waveform" ? waveformScopeLongEdge(tier, longEdge) : longEdge;
  const includeLocals = !state.compareWithoutLocals;
  const scopeRegion = activeScopeRegion();

  const request = {
    sessionId: state.session.session_id,
    lane,
    mode,
    quality: state.scopeQuality,
    channelMode: state.scopeChannelMode,
    tier,
    generation: requestGeneration,
    longEdge: effectiveLongEdge,
    resolution,
    maxNits: state.scopeMaxNits,
    edit_revision: state.editRevision,
    include_locals: includeLocals,
    localAdjustments: state.localPreviewDirty && includeLocals
      ? JSON.parse(JSON.stringify(localAdjustments()))
      : null,
    scopeRegion,
    resolve: null,
    controller: null,
  };

  if (gpuScopeEligible(lane)) {
    return enqueueGpuScopeRequest(request);
  }
  if (gpuPreviewEligible(lane)
    && lane === state.currentView
    && els.previewCanvas.style.display !== "none"
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof") {
    // The grading render owns source identity. Never analyze the previous
    // WebGPU texture under a newer edit generation; retain the last valid scope
    // with Updating until the matching preview has actually been presented.
    markScopeUpdating();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    enqueueScopeRequest({ ...request, resolve });
  });
}

function gpuScopeEligible(lane) {
  return Boolean(
    state.gpuPreview?.available
    && lane === state.currentView
    && state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation?.transport === "WebGPU"
    && state.acceptedPresentation?.generation === state.previewGeneration[lane]
    && state.acceptedPresentation?.geometrySignature === geometrySignature()
    && Number.isInteger(state.acceptedPresentation?.sourceSerial)
    && els.previewCanvas.style.display !== "none"
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof"
  );
}

async function runGpuScopeRequest(request) {
  const { lane, mode, tier, generation, resolution, maxNits, scopeRegion } = request;
  markScopeUpdating();
  const widthLimit = tier === "interactive"
    ? state.scopeQuality === "performance" ? 192 : state.scopeQuality === "reference" ? 384 : 320
    : state.scopeQuality === "performance" ? 384 : state.scopeQuality === "reference" ? 768 : 640;
  const sampleWidth = Math.max(64, Math.min(widthLimit, resolution.columns));
  const sampleHeight = tier === "interactive"
    ? state.scopeQuality === "performance" ? 128 : state.scopeQuality === "reference" ? 256 : 192
    : state.scopeQuality === "performance" ? 256 : state.scopeQuality === "reference" ? 512 : 384;
  const analysis = await state.gpuPreview.analyzeScope(els.previewCanvas, {
    width: sampleWidth,
    height: sampleHeight,
    generation,
    tier,
  });
  // A saturated two-buffer readback pool is intentional backpressure. Keep
  // the last valid scope visible and let the next scheduled generation win;
  // never fall back to an image-sized CPU request merely because the GPU is busy.
  if (!analysis) return false;
  const accepted = state.acceptedPresentation;
  if (analysis.sessionId !== request.sessionId
    || analysis.sourceSerial !== accepted?.sourceSerial
    || analysis.applicationGeneration !== accepted?.generation
    || accepted?.generation !== state.previewGeneration[lane]
    || analysis.geometrySignature !== accepted?.geometrySignature
    || generation !== state.scopeGeneration
    || lane !== state.currentView
    || mode !== state.scopeMode
    || request.sessionId !== state.session?.session_id) {
    state.previewScheduler?.recordStaleResult();
    return false;
  }
  const payload = buildGpuScopePayload(analysis, {
    lane,
    mode,
    tier,
    generation,
    bins: resolution.bins,
    columns: resolution.columns,
    maxNits,
    scopeRegion,
  });
  presentScopePayload(payload, { generation, tier, lane, mode, source: "gpu", metric: analysis.metric });
  return true;
}

function enqueueGpuScopeRequest(request) {
  return new Promise((resolve) => {
    const queued = { ...request, resolve };
    if (state.gpuScopeRequestInFlight) {
      state.pendingGpuScopeRequest?.resolve(false);
      state.pendingGpuScopeRequest = queued;
      markScopeUpdating();
      return;
    }
    void runQueuedGpuScopeRequest(queued);
  });
}

async function runQueuedGpuScopeRequest(request) {
  state.gpuScopeRequestInFlight = request;
  let applied = false;
  try {
    applied = await runGpuScopeRequest(request);
  } finally {
    request.resolve(applied);
    if (state.gpuScopeRequestInFlight !== request) return;
    state.gpuScopeRequestInFlight = null;
    const next = state.pendingGpuScopeRequest;
    state.pendingGpuScopeRequest = null;
    if (next) void runQueuedGpuScopeRequest(next);
    else if (!state.scopeRequestInFlight && gpuScopeEligible(state.currentView)) {
      els.scopeFreshness.classList.remove("updating");
      if (!applied) els.scopeFreshness.textContent = state.lastScope ? scopeFreshnessLabel(state.lastScope.tier) : "Waiting";
    }
  }
}

function enqueueScopeRequest(request) {
  const active = state.scopeRequestInFlight;
  if (!active) {
    void runScopeRequest(request);
    return;
  }

  state.pendingScopeRequest?.resolve(false);
  state.pendingScopeRequest = request;
  markScopeUpdating();

  // The last valid scope remains visible while the newest generation replaces
  // obsolete work. Slow scope computation must never queue in front of input.
  active.controller?.abort();
}

function scopeRequestKey(request) {
  const region = request.scopeRegion
    ? [request.scopeRegion.x, request.scopeRegion.y, request.scopeRegion.width, request.scopeRegion.height].map((value) => value.toFixed(5)).join(",")
    : "full";
  return `${request.sessionId}:${request.lane}:${request.mode}:${request.quality}:${request.maxNits}:${region}`;
}

function markScopeUpdating() {
  els.scopeFreshness.textContent = "Updating";
  els.scopeFreshness.classList.add("updating");
}

function scopeFreshnessLabel(tier) {
  return tier === "interactive" ? "Preview" : tier === "refinement" ? "Refined" : "Settled";
}

async function runScopeRequest(request) {
  const controller = new AbortController();
  request.controller = controller;
  state.scopeRequestInFlight = request;
  markScopeUpdating();
  let applied = false;

  try {
    const { sessionId, lane, mode, tier, generation, longEdge, resolution, maxNits, edit_revision, include_locals, localAdjustments: requestLocals, channelMode, scopeRegion } = request;
    const requestedChannels = channelMode === "luma" ? "luma" : "rgb";
    const resolutionQuery = `&bins=${resolution.bins}&columns=${resolution.columns}&channels=${requestedChannels}`;
    const requestScope = (revision) => fetch(`/api/session/${sessionId}/scopes?kind=${lane}&mode=${mode}&long_edge=${longEdge}&max_nits=${maxNits}${resolutionQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        edit_revision: revision,
        include_locals,
        local_adjustments: requestLocals,
        long_edge: longEdge,
        generation,
        tier,
        scope_region: scopeRegion,
      }),
      signal: controller.signal,
    });
    let response = await requestScope(edit_revision);
    if (response.status === 409) {
      const conflict = await safeJson(response);
      // Latest-state cancellation intentionally uses 409, but it is not an
      // edit conflict. Reloading the committed document here can replace the
      // optimistic slider value in the middle of a gesture and visibly flash
      // both the preview and the next scope back to an older state.
      if (conflict?.detail === "Stale scope request dropped.") return false;
      await (state.editCommandQueue || Promise.resolve());
      if (state.editRevision === edit_revision) {
        await refreshEditState({ preserveLocalDraft: state.localPreviewDirty });
      }
      if (state.session?.session_id !== sessionId || lane !== state.currentView || mode !== state.scopeMode) return false;
      request.edit_revision = state.editRevision;
      response = await requestScope(state.editRevision);
    }
    if (!response.ok) {
      els.scopeNote.textContent = `The ${mode} could not be refreshed. It will retry with the next edit.`;
      return false;
    }
    const payload = await response.json();
    if (state.session?.session_id !== sessionId || lane !== state.currentView || mode !== state.scopeMode) return false;
    if (payload.generation !== null && payload.generation !== generation) return false;
    if (generation !== state.scopeGeneration) {
      state.previewScheduler?.recordStaleResult();
      return false;
    }
    presentScopePayload(payload, { generation, tier, lane, mode, source: "cpu" });
    applied = true;
    return true;
  } catch (error) {
    if (error.name !== "AbortError") console.error(error);
    return false;
  } finally {
    if (state.scopeRequestInFlight === request) state.scopeRequestInFlight = null;
    request.resolve(applied);
    const next = state.pendingScopeRequest;
    state.pendingScopeRequest = null;
    if (next) {
      void runScopeRequest(next);
    } else {
      els.scopeFreshness.classList.remove("updating");
      if (!applied) els.scopeFreshness.textContent = state.lastScope ? scopeFreshnessLabel(state.lastScope.tier) : "Waiting";
    }
  }
}

function waveformRequestResolution(tier) {
  const width = Math.max(1, els.histogram.clientWidth);
  if (state.scopeQuality === "performance") {
    return {
      columns: Math.round(clamp(width / 2, 320, 384)),
      bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128,
    };
  }
  if (state.scopeQuality === "reference") {
    return {
      columns: Math.round(tier === "interactive" ? clamp(width * 0.7, 512, 640) : clamp(width, 768, 1024)),
      bins: tier === "interactive" ? 128 : 384,
    };
  }
  return {
    columns: Math.round(tier === "interactive" ? clamp(width * 0.55, 384, 512) : clamp(width * 0.75, 512, 768)),
    bins: tier === "interactive" ? 96 : 256,
  };
}

function waveformScopeLongEdge(tier, requestedLongEdge) {
  const profile = scopeQualityProfile();
  if (tier === "interactive") return Math.min(requestedLongEdge, profile.interactiveEdge);
  if (tier === "refinement") return Math.min(requestedLongEdge, profile.refinementEdge);
  return Math.min(requestedLongEdge, profile.settledEdge);
}

function vectorscopeRequestResolution(tier) {
  if (state.scopeQuality === "performance") {
    const bins = tier === "interactive" ? 96 : 128;
    return { bins, columns: bins };
  }
  if (state.scopeQuality === "reference") {
    const bins = tier === "interactive" ? 192 : 384;
    return { bins, columns: bins };
  }
  const bins = tier === "interactive" ? 128 : 256;
  return { bins, columns: bins };
}

function scopeQualityProfile() {
  return SCOPE_QUALITY_PROFILES[state.scopeQuality] || SCOPE_QUALITY_PROFILES[DEFAULT_SCOPE_QUALITY];
}

function drawHistogram(scope) {
  const canvas = els.histogram;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--deep");
  ctx.fillRect(0, 0, width, height);
  if (!scope?.channels?.length) {
    els.scopeTitle.textContent = "Histogram";
    els.scopeNote.textContent = "Reference scopes will appear here after a preview is rendered.";
    canvas.removeAttribute("title");
    els.scopeStats.innerHTML = "";
    state.lastScope = null;
    renderDockSummary();
    return;
  }
  els.scopeTitle.textContent = scopeTitleFor(scope);
  canvas.setAttribute("aria-label", els.scopeTitle.textContent);
  els.scopeNote.textContent = scope.scope_type === "vectorscope"
    ? "Vectorscope plots chroma direction and saturation from the same current authored preview. Density is log-scaled."
    : scope.preview_kind === "hdr"
    ? scope.scope_type.includes("waveform")
      ? `HDR waveform plots horizontal image position against reference nits. In this project, 0.18 scene-linear equals ${projectReferenceWhiteNits()} nits. RW marks the active project reference white.`
      : "HDR histogram plots BT.2020 transport RGB and luminance in reference nits on a logarithmic scale. Density is log-scaled to retain fine tonal detail. RW marks the active project reference white."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against the nonlinear Rec.709/sRGB output signal. Guides and percentages are signal levels, not scene-linear values."
      : "SDR histogram plots sRGB/Rec.709 signal values from black to white. Density is log-scaled so small tonal populations remain visible.";
  canvas.title = scopeGuideTooltip(scope);
  renderKeyValueList(els.scopeStats, (scope.stats || []).map((item) => [item.label, item.value]));

  if (scope.scope_type === "vectorscope") {
    drawVectorscope(ctx, scope, width, height);
    return;
  }

  const channels = filteredScopeChannels(scope.channels);
  const palette = {
    R: uiToken("--scope-red"),
    G: uiToken("--scope-green"),
    B: uiToken("--scope-blue"),
    Y: uiToken("--scope-luma"),
  };
  const isWaveform = scope.scope_type.includes("waveform");
  const plotLeft = isWaveform ? 62 : 14;
  const plotRight = 10;
  const plotTop = 8;
  const plotBottom = 22;
  const plotWidth = Math.max(1, width - plotLeft - plotRight);
  const plotHeight = Math.max(1, height - plotTop - plotBottom);

  ctx.font = '11px "Space Mono", "Cascadia Mono", Consolas';
  ctx.textBaseline = "middle";
  drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, height);
  drawZoneScopeOverlay(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight);

  if (scope.scope_type.includes("waveform")) drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
  else drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight);
}

function resizeCanvasSurface(canvas) {
  const width = Math.round(canvas.clientWidth);
  const height = Math.round(canvas.clientHeight);
  if (width < 2 || height < 2) return null;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const bitmapWidth = Math.round(width * dpr);
  const bitmapHeight = Math.round(height * dpr);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  return { ctx, width, height };
}

function drawVectorscope(ctx, scope, width, height) {
  const grid = scope.channels?.[0]?.grid || [];
  const bins = grid.length;
  if (!bins) return;
  const size = Math.max(1, Math.min(width - 28, height - 20));
  const left = (width - size) / 2;
  const top = (height - size) / 2;
  ctx.save();
  ctx.strokeStyle = uiToken("--scope-guide-line-labeled");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(left + size / 2, top + size / 2, size / 2, 0, Math.PI * 2);
  ctx.moveTo(left + size / 2, top); ctx.lineTo(left + size / 2, top + size);
  ctx.moveTo(left, top + size / 2); ctx.lineTo(left + size, top + size / 2);
  ctx.stroke();
  const peak = Math.max(1, scope.normalization_peak || 1);
  const cell = size / bins;
  for (let row = 0; row < bins; row += 1) {
    for (let column = 0; column < bins; column += 1) {
      const value = grid[row][column];
      if (!value) continue;
      const density = Math.min(1, Math.log1p(value) / Math.log1p(peak));
      const hue = (Math.atan2(row / bins - 0.5, column / bins - 0.5) * 180 / Math.PI + 360) % 360;
      ctx.fillStyle = `hsla(${hue}, 80%, 68%, ${0.08 + density * 0.72})`;
      ctx.fillRect(left + column * cell, top + (bins - row - 1) * cell, Math.max(1, cell), Math.max(1, cell));
    }
  }
  ctx.restore();
}

function observeGraphEditorSizes() {
  const redraw = (canvas) => {
    if (canvas.clientWidth < 2 || canvas.clientHeight < 2) return;
    if (canvas === els.curveEditor) drawCurveEditor();
    if (canvas === els.toneEqualizerEditor) drawToneEqualizerEditor("hdr");
    if (canvas === els.sdrToneEqualizerEditor) drawToneEqualizerEditor("sdr");
  };
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => {
      redraw(els.curveEditor);
      redraw(els.toneEqualizerEditor);
      redraw(els.sdrToneEqualizerEditor);
    });
    return;
  }
  graphEditorResizeObserver = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => redraw(target));
  });
  graphEditorResizeObserver.observe(els.curveEditor);
  graphEditorResizeObserver.observe(els.toneEqualizerEditor);
  graphEditorResizeObserver.observe(els.sdrToneEqualizerEditor);
}

function drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, canvasHeight) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = uiToken("--scope-grid-line");
  [0, 0.25, 0.5, 0.75, 1].forEach((position) => {
    const y = plotTop + plotHeight - position * plotHeight;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
  });

  const labeledGuides = scopeGuidesForDisplay(scope);
  (scope.guides || []).forEach((guide) => {
    const normalized = guidePosition(scope, guide.value);
    const showLabel = labeledGuides.has(Number(guide.value));
    ctx.strokeStyle = showLabel ? uiToken("--scope-guide-line-labeled") : uiToken("--scope-guide-line");
    ctx.fillStyle = uiToken("--scope-guide-label");
    if (isWaveform) {
      const y = plotTop + plotHeight - normalized * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = "right";
        ctx.fillText(compactScopeGuideLabel(scope, guide), plotLeft - 7, clamp(y, plotTop + 6, plotTop + plotHeight - 6));
      }
    } else {
      const x = plotLeft + normalized * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = normalized <= 0.02 ? "left" : normalized >= 0.98 ? "right" : "center";
        ctx.fillText(compactScopeGuideLabel(scope, guide), x, canvasHeight - 7);
      }
    }
  });
  ctx.restore();
}

function scopeGuidesForDisplay(scope) {
  if (scope.preview_kind === "hdr") {
    const ceiling = scopeHdrCeiling(scope);
    if (ceiling >= 10000) return new Set([1, 10, 100, 203, 1000, 4000, 10000]);
    if (ceiling >= 4000) return new Set([1, 10, 100, 203, 1000, 4000]);
    return new Set([1, 10, 100, 203, 1000]);
  }
  return new Set([0.18, 0.5, 1]);
}

function compactScopeGuideLabel(scope, guide) {
  if (scope.preview_kind !== "hdr") return guide.label;
  const value = Number(guide.value);
  const compactValue = value >= 1000
    ? `${Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))}k`
    : String(Number(value.toFixed(value < 10 ? 1 : 0)));
  return /\bactive\b/i.test(guide.label) ? `RW ${compactValue}` : compactValue;
}

function scopeGuideTooltip(scope) {
  if (scope?.scope_type === "vectorscope") {
    return "Chroma direction and saturation. Distance from center indicates saturation.";
  }
  const labeledGuides = scopeGuidesForDisplay(scope);
  const guides = (scope?.guides || []).filter((guide) => labeledGuides.has(Number(guide.value)));
  if (!guides.length) return "";
  const descriptions = guides.map((guide) => {
    const shortLabel = compactScopeGuideLabel(scope, guide);
    if (scope.preview_kind !== "hdr") return `${shortLabel} output`;
    if (/\bactive\b/i.test(guide.label)) return `${shortLabel}: active HDR reference white`;
    const detail = String(guide.label || "").replace(/^\s*[\d.]+\s*/, "").trim();
    if (detail === "nit") return `${shortLabel}: 1 nit`;
    return detail ? `${shortLabel}: ${detail}` : `${shortLabel}: ${Number(guide.value)} nits`;
  });
  return `Scope guides — ${descriptions.join("; ")}. RW means active HDR reference white.`;
}

function guidePosition(scope, value) {
  if (scope.preview_kind === "hdr") {
    const min = Math.log10(1);
    const max = Math.log10(scopeHdrCeiling(scope));
    return (Math.log10(Math.max(value, 1)) - min) / (max - min);
  }
  return Math.min(1, Math.max(0, value));
}

function scopeHdrCeiling(scope) {
  const edge = Number(scope?.bin_edges?.[scope.bin_edges.length - 1]);
  if (!Number.isFinite(edge)) return 4000;
  if (edge >= 10000 - 1) return 10000;
  if (edge >= 4000 - 1) return 4000;
  return 1000;
}

function bindZoneScopeOverlays() {
  document.querySelectorAll("[data-zone-hover]").forEach((target) => {
    const show = () => {
      state.scopeZoneOverlay = {
        zone: target.dataset.zoneHover,
        lane: target.closest("[data-lane-panel]")?.dataset.lanePanel || state.currentView,
      };
      drawHistogram(state.lastScope || []);
    };
    const hide = (event) => {
      if (event.type === "focusout" && target.contains(event.relatedTarget)) return;
      state.scopeZoneOverlay = null;
      drawHistogram(state.lastScope || []);
    };
    target.addEventListener("pointerenter", show);
    target.addEventListener("pointerleave", hide);
    target.addEventListener("focusin", show);
    target.addEventListener("focusout", hide);
  });
}

function drawZoneScopeOverlay(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight) {
  const overlay = state.scopeZoneOverlay;
  if (!overlay || overlay.lane !== scope.preview_kind) return;
  const settings = state.adjustments[overlay.lane];
  const pivot = Number(settings?.[`${overlay.zone}_pivot`] ?? 0);
  const range = Math.max(0.1, Number(settings?.[`${overlay.zone}_range`] ?? 4));
  const lowerStop = pivot - range * 0.5;
  const upperStop = pivot + range * 0.5;
  const toValue = overlay.lane === "hdr"
    ? (stop) => 100 * (2 ** stop)
    : (stop) => clamp(0.5 * (2 ** stop), 0, 1);
  const lower = clamp(guidePosition(scope, toValue(lowerStop)), 0, 1);
  const upper = clamp(guidePosition(scope, toValue(upperStop)), 0, 1);
  const start = Math.min(lower, upper);
  const end = Math.max(lower, upper);
  ctx.save();
  ctx.fillStyle = "rgba(151, 224, 236, 0.13)";
  ctx.strokeStyle = "rgba(151, 224, 236, 0.55)";
  ctx.lineWidth = 1;
  if (isWaveform) {
    const top = plotTop + (1 - end) * plotHeight;
    const bandHeight = Math.max(2, (end - start) * plotHeight);
    ctx.fillRect(plotLeft, top, plotWidth, bandHeight);
    ctx.strokeRect(plotLeft, top, plotWidth, bandHeight);
  } else {
    const left = plotLeft + start * plotWidth;
    const bandWidth = Math.max(2, (end - start) * plotWidth);
    ctx.fillRect(left, plotTop, bandWidth, plotHeight);
    ctx.strokeRect(left, plotTop, bandWidth, plotHeight);
  }
  ctx.restore();
}

function drawResolveHistogram(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawHistogramParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const peak = robustHistogramPeak(channels);
  ctx.save();
  ctx.globalCompositeOperation = channels.length > 1 ? uiToken("--histogram-blend-mode") : "source-over";
  channels.forEach((channel) => {
    drawHistogramTrace(ctx, channel, palette[channel.name], peak, plotLeft, plotTop, plotWidth, plotHeight);
  });
  ctx.restore();
}

function robustHistogramPeak(channels) {
  if (Number.isFinite(state.lastScope?.normalization_peak)) return Math.max(1, state.lastScope.normalization_peak);
  const populations = channels
    .flatMap((channel) => channel.bins || [])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!populations.length) return 1;
  return Math.max(1, populations[Math.floor((populations.length - 1) * 0.985)]);
}

function histogramHeight(value, peak) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log1p(value) / Math.log1p(Math.max(peak, 1)));
}

function drawHistogramTrace(ctx, channel, color, peak, plotLeft, plotTop, plotWidth, plotHeight) {
  const bins = channel.bins || [];
  if (!bins.length) return;
  const baseline = plotTop + plotHeight;
  const colorRgb = hexToRgb(color);
  const points = bins.map((value, index) => ({
    x: plotLeft + (index / Math.max(bins.length - 1, 1)) * plotWidth,
    y: baseline - histogramHeight(value, peak) * plotHeight,
  }));

  ctx.beginPath();
  ctx.moveTo(points[0].x, baseline);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, baseline);
  ctx.closePath();
  ctx.fillStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.22)`;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = `rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.9)`;
  ctx.lineWidth = 1.15;
  ctx.stroke();
}

function drawWaveform(ctx, scope, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  if (state.scopeChannelMode === "parade") {
    drawWaveformParade(ctx, channels.filter((channel) => channel.name !== "Y"), palette, plotLeft, plotTop, plotWidth, plotHeight);
    return;
  }
  const peak = robustWaveformPeak(channels);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();
  ctx.globalCompositeOperation = channels.length > 1 ? uiToken("--waveform-blend-mode") : "source-over";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  channels.forEach((channel) => {
    const density = waveformDensityCanvas(channel, hexToRgb(palette[channel.name]), peak);
    if (density) ctx.drawImage(density, plotLeft, plotTop, plotWidth, plotHeight);
  });
  ctx.restore();
}

function robustWaveformPeak(channels) {
  if (Number.isFinite(state.lastScope?.normalization_peak)) return Math.max(1, state.lastScope.normalization_peak);
  const populations = channels
    .flatMap((channel) => (channel.grid || []).flat())
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!populations.length) return 1;
  return Math.max(1, populations[Math.floor((populations.length - 1) * 0.995)]);
}

function waveformDensityCanvas(channel, color, peak) {
  const grid = channel.grid || [];
  const rowCount = grid.length;
  const columnCount = grid[0]?.length || 0;
  if (!rowCount || !columnCount) return null;
  const profile = scopeQualityProfile();
  const densityGain = profile.densityGain;
  const horizontalSpread = profile.horizontalSpread;
  const cacheKey = `${color.r},${color.g},${color.b}:${peak}:${rowCount}x${columnCount}:h5:${densityGain}:${horizontalSpread}`;
  const cached = waveformCanvasCache.get(channel);
  if (cached?.key === cacheKey) return cached.canvas;
  const surface = document.createElement("canvas");
  surface.width = columnCount;
  surface.height = rowCount;
  const surfaceContext = surface.getContext("2d");
  const pixels = surfaceContext.createImageData(columnCount, rowCount);
  grid.forEach((row, rowIndex) => {
    row.forEach((_value, columnIndex) => {
      const value = smoothedWaveformPopulation(row, columnIndex, horizontalSpread);
      if (value <= 0) return;
      const density = Math.min(1, value / Math.max(1, peak));
      const offset = (((rowCount - 1 - rowIndex) * columnCount) + columnIndex) * 4;
      pixels.data[offset] = color.r;
      pixels.data[offset + 1] = color.g;
      pixels.data[offset + 2] = color.b;
      // Exponential exposure gives sparse traces useful lift without flattening
      // dense areas into one opaque slab. Each detail profile calibrates gain
      // with its sample count so changing quality does not make the scope dimmer.
      const opacity = 1 - Math.exp(-densityGain * Math.pow(density, 0.72));
      pixels.data[offset + 3] = Math.round(opacity * 255);
    });
  });
  surfaceContext.putImageData(pixels, 0, 0);
  waveformCanvasCache.set(channel, { key: cacheKey, canvas: surface });
  return surface;
}

function smoothedWaveformPopulation(row, columnIndex, spread = 1) {
  const kernel = WAVEFORM_HORIZONTAL_KERNELS[spread] || WAVEFORM_HORIZONTAL_KERNELS[1];
  const radius = Math.floor(kernel.weights.length / 2);
  let weightedPopulation = 0;
  for (let offset = 0; offset < kernel.weights.length; offset += 1) {
    const sampleIndex = Math.max(0, Math.min(row.length - 1, columnIndex + offset - radius));
    weightedPopulation += (Number(row[sampleIndex]) || 0) * kernel.weights[offset];
  }
  return weightedPopulation / kernel.total;
}

function drawHistogramParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  channels.forEach((channel, laneIndex) => {
    const laneLeft = plotLeft + laneIndex * laneWidth + 4;
    drawHistogramTrace(
      ctx,
      channel,
      palette[channel.name],
      robustHistogramPeak([channel]),
      laneLeft,
      plotTop,
      Math.max(1, laneWidth - 8),
      plotHeight,
    );
  });
}

function drawWaveformParade(ctx, channels, palette, plotLeft, plotTop, plotWidth, plotHeight) {
  const laneWidth = plotWidth / Math.max(channels.length, 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  channels.forEach((channel, laneIndex) => {
    const density = waveformDensityCanvas(channel, hexToRgb(palette[channel.name]), robustWaveformPeak([channel]));
    if (density) ctx.drawImage(density, plotLeft + laneIndex * laneWidth + 3, plotTop, Math.max(1, laneWidth - 6), plotHeight);
  });
  ctx.restore();
}

function filteredScopeChannels(channels) {
  if (state.scopeChannelMode === "luma") {
    return channels.filter((channel) => channel.name === "Y");
  }
  if (state.scopeChannelMode === "parade") {
    return channels.filter((channel) => channel.name === "R" || channel.name === "G" || channel.name === "B");
  }
  return channels.filter((channel) => channel.name === "R" || channel.name === "G" || channel.name === "B");
}

function scopeTitleFor(scope) {
  const suffix = state.scopeChannelMode === "luma" ? " Luma" : state.scopeChannelMode === "parade" ? " Parade" : "";
  if (scope.scope_type === "vectorscope") return `${scope.preview_kind.toUpperCase()} Vectorscope`;
  if (scope.scope_type === "reference_nits_waveform") return `HDR Reference Waveform${suffix}`;
  if (scope.scope_type === "normalized_waveform") return `SDR Waveform${suffix}`;
  if (scope.scope_type === "reference_nits_histogram") return `Reference Nit Histogram${suffix}`;
  return `SDR Histogram${suffix}`;
}

function hexToRgb(value) {
  const normalized = value.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function activeScopeRegion() {
  if (!state.scopeRegionEnabled || !state.scopeRegion || state.scopeRegionSessionId !== state.session?.session_id) return null;
  return { ...state.scopeRegion };
}

function toggleScopeRegion(force = null) {
  if (!state.session) return false;
  if (state.scopeRegionSessionId !== state.session.session_id) {
    state.scopeRegion = null;
    state.scopeRegionSessionId = state.session.session_id;
  }
  state.scopeRegionEnabled = force === null ? !state.scopeRegionEnabled : Boolean(force);
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  if (state.scopeRegionEnabled && state.scopeRegion) els.scopeRegionBox?.focus({ preventScroll: true });
  return true;
}

function clearScopeRegion() {
  state.scopeRegion = null;
  state.scopeRegionDrag = null;
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
}

function renderScopeRegionOverlay() {
  if (!els.scopeRegionToggle || !els.scopeRegionOverlay || !els.scopeRegionBox) return;
  const available = Boolean(state.session && previewIsVisible());
  if (state.scopeRegionSessionId && state.scopeRegionSessionId !== state.session?.session_id) {
    state.scopeRegionEnabled = false;
    state.scopeRegion = null;
    state.scopeRegionSessionId = null;
  }
  els.scopeRegionToggle.disabled = !available;
  els.scopeRegionToggle.classList.toggle("active", state.scopeRegionEnabled);
  els.scopeRegionToggle.setAttribute("aria-pressed", String(state.scopeRegionEnabled));
  const shown = available && state.scopeRegionEnabled;
  els.scopeRegionOverlay.classList.toggle("hidden", !shown);
  els.scopeRegionOverlay.setAttribute("aria-hidden", String(!shown));
  const region = activeScopeRegion();
  els.scopeRegionBox.classList.toggle("hidden", !region);
  if (region) {
    Object.assign(els.scopeRegionBox.style, {
      left: `${region.x * 100}%`,
      top: `${region.y * 100}%`,
      width: `${region.width * 100}%`,
      height: `${region.height * 100}%`,
    });
  }
  const coverage = region ? region.width * region.height * 100 : 100;
  els.scopeRegionBadge?.classList.toggle("hidden", !region);
  if (els.scopeRegionBadge) {
    els.scopeRegionBadge.textContent = region ? `Region · ${coverage < 1 ? coverage.toFixed(1) : Math.round(coverage)}%` : "Region";
  }
}

function scopeRegionPoint(event) {
  const rect = els.scopeRegionOverlay.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
    rect,
  };
}

function beginScopeRegionDrag(event) {
  if (!state.scopeRegionEnabled || event.button !== 0) return;
  event.preventDefault();
  const point = scopeRegionPoint(event);
  const handle = event.target.closest("[data-scope-region-handle]")?.dataset.scopeRegionHandle
    || (event.target.closest("#scope-region-box") ? "move" : "draw");
  state.scopeRegionDrag = {
    handle,
    pointerId: event.pointerId,
    start: { x: point.x, y: point.y },
    region: state.scopeRegion ? { ...state.scopeRegion } : null,
    rect: point.rect,
  };
  if (handle === "draw") {
    state.scopeRegion = { x: point.x, y: point.y, width: 0.001, height: 0.001 };
  }
  els.scopeRegionOverlay.setPointerCapture?.(event.pointerId);
  renderScopeRegionOverlay();
}

function moveScopeRegionDrag(event) {
  const drag = state.scopeRegionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  const point = scopeRegionPoint(event);
  const minWidth = Math.max(0.01, 12 / Math.max(1, drag.rect.width));
  const minHeight = Math.max(0.01, 12 / Math.max(1, drag.rect.height));
  let next;
  if (drag.handle === "draw") {
    next = {
      x: Math.min(drag.start.x, point.x),
      y: Math.min(drag.start.y, point.y),
      width: Math.max(minWidth, Math.abs(point.x - drag.start.x)),
      height: Math.max(minHeight, Math.abs(point.y - drag.start.y)),
    };
    next.x = Math.min(next.x, 1 - next.width);
    next.y = Math.min(next.y, 1 - next.height);
  } else if (drag.handle === "move" && drag.region) {
    next = {
      ...drag.region,
      x: clamp(drag.region.x + point.x - drag.start.x, 0, 1 - drag.region.width),
      y: clamp(drag.region.y + point.y - drag.start.y, 0, 1 - drag.region.height),
    };
  } else if (drag.region) {
    const left = drag.region.x;
    const top = drag.region.y;
    const right = left + drag.region.width;
    const bottom = top + drag.region.height;
    const west = drag.handle.includes("w");
    const north = drag.handle.includes("n");
    const nextLeft = west ? clamp(point.x, 0, right - minWidth) : left;
    const nextRight = west ? right : clamp(point.x, left + minWidth, 1);
    const nextTop = north ? clamp(point.y, 0, bottom - minHeight) : top;
    const nextBottom = north ? bottom : clamp(point.y, top + minHeight, 1);
    next = { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
  }
  if (!next) return;
  state.scopeRegion = next;
  renderScopeRegionOverlay();
  scheduleScopeRegionRefresh();
}

function scheduleScopeRegionRefresh() {
  if (state.scopeRegionRefreshTimer) return;
  state.scopeRegionRefreshTimer = window.setTimeout(() => {
    state.scopeRegionRefreshTimer = 0;
    void refreshScopes(scopeLongEdge("interactive"), { tier: "interactive" });
  }, 80);
}

function endScopeRegionDrag(event) {
  const drag = state.scopeRegionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  state.scopeRegionDrag = null;
  if (els.scopeRegionOverlay.hasPointerCapture?.(event.pointerId)) els.scopeRegionOverlay.releasePointerCapture(event.pointerId);
  window.clearTimeout(state.scopeRegionRefreshTimer);
  state.scopeRegionRefreshTimer = 0;
  if (state.scopeRegion && (state.scopeRegion.width < 0.01 || state.scopeRegion.height < 0.01)) state.scopeRegion = null;
  renderScopeRegionOverlay();
  void refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  els.scopeRegionBox?.focus({ preventScroll: true });
}

function handleScopeRegionKeydown(event) {
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    clearScopeRegion();
  } else if (event.key === "Escape") {
    event.preventDefault();
    toggleScopeRegion(false);
    els.scopeRegionToggle?.focus();
  }
}

function syncOverlayPlacement() {
  const preview = activePreviewElement();
  if (!previewIsVisible()) {
    renderScopeRegionOverlay();
    return;
  }
  const paneRect = els.previewPrimaryPane.getBoundingClientRect();
  const imageRect = state.straightenPreviewFrameRect || preview.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) return;
  if (els.previewOverlay.style.display !== "none") {
    els.previewOverlay.style.left = `${imageRect.left - paneRect.left + imageRect.width / 2}px`;
    els.previewOverlay.style.top = `${imageRect.top - paneRect.top + imageRect.height / 2}px`;
    els.previewOverlay.style.width = `${imageRect.width}px`;
    els.previewOverlay.style.height = `${imageRect.height}px`;
  }
  if (els.cropEditorOverlay) Object.assign(els.cropEditorOverlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`, width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  if (els.scopeRegionOverlay) Object.assign(els.scopeRegionOverlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`, width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  renderScopeRegionOverlay();
  renderVignetteCenter();
  syncLocalMaskOverlayViewport();
  queueLocalMaskOverlayRender();
}

function rangeControlHome(control, minimum, maximum) {
  const declared = Number(control.dataset.defaultValue ?? control.defaultValue);
  if (Number.isFinite(declared)) return clamp(declared, minimum, maximum);
  return minimum < 0 && maximum > 0 ? 0 : minimum + (maximum - minimum) / 2;
}

function rangeSnapProfile(control) {
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return [];
  const home = rangeControlHome(control, minimum, maximum);
  const identity = `${control.id || ""} ${control.dataset.path || ""} ${control.dataset.localGrade || ""} ${control.dataset.localMaskParam || ""}`.toLowerCase();
  const row = control.closest(".control-row");
  const heading = row?.querySelector("label")?.textContent?.toLowerCase() || "";
  const output = row?.querySelector("output")?.textContent || "";
  let authored = [];
  let usesDefaultLinearProfile = false;

  if (identity.includes("kelvin") || heading.includes("temperature")) {
    authored = [1000, 2000, 2500, 3200, 4300, 5600, 6500, 7500, 10000, 12000, 25000];
  } else if (identity.includes("nit") || /\bnit\b/i.test(output)) {
    authored = [0, 100, 203, 400, 600, 1000, 2000, 4000, 10000, 100000];
  } else if (identity.includes("angle") || heading.includes("degree") || output.includes("°")) {
    authored = [-180, -90, -45, -30, -15, 0, 15, 30, 45, 90, 180];
  } else if (output.includes("%") || ["opacity", "strength", "saturation", "vibrance"].some((term) => identity.includes(term) || heading.includes(term))) {
    authored = [minimum, minimum + (maximum - minimum) * 0.25, home, minimum + (maximum - minimum) * 0.75, maximum];
    usesDefaultLinearProfile = true;
  } else if (identity.includes("exposure") || /\bev\b/i.test(output)) {
    for (let value = Math.ceil(minimum); value <= Math.floor(maximum); value += 1) authored.push(value);
    // Narrow EV ranges still need the standard five useful landing positions.
    // Keep authored whole stops when the range supports them, then supplement
    // short ranges with quartiles rather than collapsing to min/home/max.
    if (new Set([...authored, minimum, home, maximum]).size < 5) {
      usesDefaultLinearProfile = true;
      authored.push(
        minimum + (maximum - minimum) * 0.25,
        minimum + (maximum - minimum) * 0.75,
      );
    }
  } else {
    usesDefaultLinearProfile = true;
    authored = [minimum, minimum + (maximum - minimum) * 0.25, home, minimum + (maximum - minimum) * 0.75, maximum];
  }

  authored.push(minimum, home, maximum);
  if (minimum < 0 && maximum > 0) authored.push(0);
  let legal = authored
    .filter((value) => Number.isFinite(value) && value >= minimum && value <= maximum)
    .map((value) => Math.round(value * 1e8) / 1e8)
    .sort((a, b) => a - b);
  legal = legal.filter((value, index) => index === 0 || Math.abs(value - legal[index - 1]) > 1e-8);
  if (usesDefaultLinearProfile && legal.length < 5) {
    for (const fraction of [0.5, 0.125, 0.375, 0.625, 0.875]) {
      const candidate = Math.round((minimum + (maximum - minimum) * fraction) * 1e8) / 1e8;
      if (!legal.some((value) => Math.abs(value - candidate) <= 1e-8)) legal.push(candidate);
      if (legal.length >= 5) break;
    }
    legal.sort((a, b) => a - b);
  }
  return legal;
}

function nearestRangeSnap(control, requested) {
  const profile = rangeSnapProfile(control);
  return profile.reduce((nearest, value) => (
    Math.abs(value - requested) < Math.abs(nearest - requested) ? value : nearest
  ), profile[0] ?? requested);
}

function adjacentRangeSnap(control, current, direction) {
  const profile = rangeSnapProfile(control);
  const epsilon = Math.max(1, Math.abs(current)) * 1e-8;
  if (direction > 0) return profile.find((value) => value > current + epsilon) ?? profile.at(-1) ?? current;
  return [...profile].reverse().find((value) => value < current - epsilon) ?? profile[0] ?? current;
}

function seedExportFieldsFromSession() {
  if (!state.session) return;
  const sourceName = state.session.source.filename.replace(/\.[^.]+$/, "");
  if (!els.exportFilename.value || els.exportFilename.value === "hdr_finisher_export") {
    els.exportFilename.value = `${sourceName}_finished`;
  }
}

function buildExportOutputPath() {
  const filename = sanitizeFilename(els.exportFilename.value || "hdr_finisher_export");
  const extension = exportExtensionForFormat(els.exportFormat.value);
  const directory = (els.exportDirectory.value || "").trim();
  return joinExportPath(directory, `${filename}${extension}`);
}

function joinExportPath(directory, filename) {
  if (!directory) return filename;
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  return `${directory.replace(/[\\/]$/, "")}${separator}${filename}`;
}

function sanitizeFilename(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "hdr_finisher_export";
}

function exportExtensionForFormat(format) {
  if (format === "sdr_jpeg") return ".jpg";
  if (format === "sdr_png") return ".png";
  if (format === "sdr_jpegxl") return ".jxl";
  if (format === "jpeg_ultrahdr") return ".jpg";
  if (format === "jpegxl_hdr") return ".jxl";
  return ".avif";
}

function splitOutputPath(path) {
  const normalized = String(path || "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  const parts = normalized.split(/[/\\]/);
  const filename = parts.pop() || "";
  let directory = parts.join(separator);
  if (/^[A-Za-z]:[\\/]/.test(normalized) && /^[A-Za-z]:$/.test(directory)) directory += separator;
  else if (normalized.startsWith("/") && !directory) directory = "/";
  return {
    filename: filename.replace(/\.[^.]+$/, ""),
    directory,
  };
}

async function exportCurrentSession() {
  if (!state.session) return;
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  const editsApplied = globalsApplied === false
    ? false
    : await (state.editCommandQueue || Promise.resolve(true));
  if (editsApplied === false) {
    els.exportStatus.textContent = "Export paused because the latest edit could not be saved. Review the edit error and try again.";
    return;
  }
  let outputPath = buildExportOutputPath();
  let pathGrant = null;
  let nativeOverwrite = null;
  if (desktop) {
    const extension = exportExtensionForFormat(els.exportFormat.value);
    const selection = await desktop.chooseExportPath({
      suggestedName: `${sanitizeFilename(els.exportFilename.value || "hdr_finisher_export")}${extension}`,
      directory: (els.exportDirectory.value || "").trim(),
      extension,
      formatName: els.exportFormat.value === "avif_gain_map" ? "AVIF gain map" : els.exportFormat.value === "sdr_jpeg" ? "JPEG image" : els.exportFormat.value === "sdr_png" ? "PNG image" : els.exportFormat.value === "sdr_jpegxl" ? "JPEG XL SDR" : els.exportFormat.value === "jpegxl_hdr" ? "JPEG XL HDR" : "JPEG Ultra HDR",
    });
    if (!selection) {
      els.exportStatus.textContent = "Export cancelled.";
      return;
    }
    outputPath = selection.path;
    pathGrant = selection.grant;
    nativeOverwrite = selection.overwriteTarget || null;
  }
  els.exportConfirmButton.disabled = true;
  els.exportStatus.textContent = "Encoding and validating the finished file…";
  els.exportResult.classList.add("hidden");
  const exportStartedAt = performance.now();
  const exportTicker = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((performance.now() - exportStartedAt) / 1000));
    const expectation = elapsedSeconds < 20
      ? "Rendering full-resolution HDR and SDR endpoints"
      : elapsedSeconds < 60
        ? "Encoding gain-map media; large sources can take a minute or more"
        : "Still working locally; the final file will be validated before completion";
    els.exportStatus.textContent = `${expectation} · ${elapsedSeconds}s elapsed`;
  }, 1000);
  try {
    desktop?.setOperationProgress({ kind: "export", value: 0.01, state: "indeterminate" });
    let response = await requestSessionExport(outputPath, Boolean(nativeOverwrite), pathGrant, nativeOverwrite);
    let payload = await safeJson(response);
    if (response.status === 409 && payload?.detail?.code === "overwrite_required") {
      const detail = payload.detail;
      const approved = window.confirm(`${detail.message}\n\n${detail.output_path}\n\nThis cannot be undone.`);
      if (!approved) {
        els.exportStatus.textContent = "Export cancelled; the existing file was left unchanged.";
        return;
      }
      els.exportStatus.textContent = "Replacing the existing file and validating the result...";
      response = await requestSessionExport(outputPath, true, pathGrant, null);
      payload = await safeJson(response);
    }
    if (!response.ok) {
      els.exportStatus.textContent = responseErrorMessage(payload, "Export failed.");
      return;
    }
    const exportMessage = payload.message || "Export request finished.";
    const totalExportMs = Number(payload.timings_ms?.total);
    els.exportStatus.textContent = Number.isFinite(totalExportMs)
      ? `${exportMessage} Completed in ${(totalExportMs / 1000).toFixed(1)}s.`
      : exportMessage;
    if (payload.output_path) {
      const parsed = splitOutputPath(payload.output_path);
      els.exportFilename.value = parsed.filename;
      els.exportDirectory.value = parsed.directory;
      state.lastExportPath = payload.output_path;
      els.exportResultPath.textContent = payload.output_path;
      els.exportResult.classList.remove("hidden");
    }
  } catch (error) {
    console.error(error);
    els.exportStatus.textContent = "Export could not reach the local HDR Finisher server.";
  } finally {
    window.clearInterval(exportTicker);
    els.exportConfirmButton.disabled = false;
    desktop?.setOperationProgress({ kind: "export", value: -1, state: "normal" });
  }
}

async function chooseExportDirectory() {
  await openMediaBrowser("export_directory", els.exportDirectory.value);
}

async function openMediaBrowser(mode, path = "", options = {}) {
  els.directoryBrowser.dataset.mode = mode;
  delete els.directoryBrowser.dataset.selectedPath;
  const projectMode = mode === "project_open" || mode === "project_save";
  els.directoryBrowserTitle.textContent = mode === "source"
    ? "Choose a source image"
    : mode === "project_open"
      ? "Open Project"
      : mode === "project_save"
        ? "Save Project"
        : "Choose save folder";
  els.directoryBrowserSelect.textContent = mode === "source"
    ? "Open image"
    : mode === "project_open"
      ? "Open Project"
      : mode === "project_save"
        ? "Save Project"
        : "Select this folder";
  els.directoryBrowserFilenameRow.hidden = mode !== "project_save";
  els.directoryBrowserFilename.value = mode === "project_save" ? String(options.suggestedName || "Untitled.hdrfinisher") : "";
  els.directoryBrowserList.setAttribute("aria-label", projectMode ? "Folders and HDR Finisher projects" : "Folders and supported images");
  els.directoryBrowserPreview.hidden = true;
  els.directoryBrowserSelection.textContent = mode === "source"
    ? "No image selected"
    : mode === "project_open"
      ? "No project selected"
      : mode === "project_save"
        ? "Project destination"
        : "Folder selection";
  els.directoryBrowserPreviewNote.textContent = mode === "source"
    ? "Select a supported image to preview it."
    : mode === "project_open"
      ? "Select an HDR Finisher project to open."
      : mode === "project_save"
        ? "Choose a folder and enter the project file name below."
    : "Files remain visible so you can confirm the destination.";
  if (!els.directoryBrowser.open) els.directoryBrowser.showModal();
  await loadMediaDirectory(path);
}

async function chooseProjectPath(mode, path, suggestedName = "") {
  if (!desktop?.grantProjectPath) return null;
  if (state.mediaBrowserResolver) state.mediaBrowserResolver(null);
  return new Promise((resolve) => {
    state.mediaBrowserResolver = resolve;
    openMediaBrowser(mode, path, { suggestedName }).catch((error) => {
      console.error(error);
      settleMediaBrowserSelection(null);
    });
  });
}

function settleMediaBrowserSelection(selection) {
  const resolve = state.mediaBrowserResolver;
  state.mediaBrowserResolver = null;
  resolve?.(selection);
}

function updateProjectSaveBrowserAction() {
  if (els.directoryBrowser.dataset.mode !== "project_save") return;
  els.directoryBrowserSelect.disabled = !els.directoryBrowserFilename.value.trim();
}

async function loadExportDirectory(path) {
  els.directoryBrowser.dataset.mode = "export_directory";
  return loadMediaDirectory(path);
}

function formatMediaBrowserSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value < 1000) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = "B";
  for (const candidate of units) {
    scaled /= 1000;
    unit = candidate;
    if (scaled < 1000) break;
  }
  return `${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2)} ${unit}`;
}

function formatMediaBrowserDate(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value)) return "--";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function mediaBrowserCell(className, value) {
  const cell = document.createElement("span");
  cell.className = className;
  cell.textContent = value;
  cell.title = value;
  return cell;
}

const MEDIA_BROWSER_COLUMN_MINIMUMS = Object.freeze({ name: 120, size: 62, kind: 90, date: 120 });
const MEDIA_BROWSER_COLUMN_MAXIMUM = 640;

function sortedMediaBrowserEntries(entries) {
  const key = state.mediaBrowserSortKey;
  const direction = state.mediaBrowserSortDirection === "descending" ? -1 : 1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const valueFor = (entry) => {
    if (key === "size") return Number(entry.size ?? -1);
    if (key === "date") return Number(entry.date_added_ms ?? -1);
    if (key === "kind") return entry.kind_label || (entry.kind === "directory" ? "Folder" : "File");
    return entry.name || "";
  };
  return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
    if (left.entry.kind !== right.entry.kind) return left.entry.kind === "directory" ? -1 : 1;
    const leftValue = valueFor(left.entry);
    const rightValue = valueFor(right.entry);
    const comparison = typeof leftValue === "number"
      ? leftValue - rightValue
      : collator.compare(String(leftValue), String(rightValue));
    if (comparison) return comparison * direction;
    const nameComparison = collator.compare(left.entry.name || "", right.entry.name || "");
    return nameComparison || left.index - right.index;
  }).map(({ entry }) => entry);
}

function updateMediaBrowserSortHeaders() {
  for (const button of els.directoryBrowserSortButtons) {
    const active = button.dataset.mediaBrowserSort === state.mediaBrowserSortKey;
    const direction = active ? state.mediaBrowserSortDirection : "none";
    button.parentElement.setAttribute("aria-sort", direction);
    button.setAttribute(
      "aria-label",
      active
        ? `Sort by ${button.textContent}, currently ${direction}`
        : `Sort by ${button.textContent}`,
    );
  }
}

function sortMediaBrowserBy(key) {
  if (!MEDIA_BROWSER_COLUMN_MINIMUMS[key]) return;
  if (state.mediaBrowserSortKey === key) {
    state.mediaBrowserSortDirection = state.mediaBrowserSortDirection === "ascending" ? "descending" : "ascending";
  } else {
    state.mediaBrowserSortKey = key;
    state.mediaBrowserSortDirection = key === "date" ? "descending" : "ascending";
  }
  updateMediaBrowserSortHeaders();
  renderMediaBrowserEntries(state.mediaBrowserEntries, els.directoryBrowser.dataset.mode || "source");
}

function captureMediaBrowserColumnWidths() {
  if (state.mediaBrowserColumnWidths) return;
  state.mediaBrowserColumnWidths = Object.fromEntries(els.directoryBrowserSortButtons.map((button) => [
    button.dataset.mediaBrowserSort,
    Math.round(button.parentElement.getBoundingClientRect().width),
  ]));
  applyMediaBrowserColumnWidths();
}

function applyMediaBrowserColumnWidths() {
  if (!state.mediaBrowserColumnWidths) return;
  let trackWidth = 0;
  for (const [column, width] of Object.entries(state.mediaBrowserColumnWidths)) {
    const clamped = Math.max(MEDIA_BROWSER_COLUMN_MINIMUMS[column], Math.min(MEDIA_BROWSER_COLUMN_MAXIMUM, width));
    state.mediaBrowserColumnWidths[column] = clamped;
    els.directoryBrowserTable.style.setProperty(`--media-browser-${column}-column`, `${clamped}px`);
    trackWidth += clamped;
    const resizer = els.directoryBrowserColumnResizers.find((item) => item.dataset.mediaBrowserResize === column);
    resizer?.setAttribute("aria-valuemin", String(MEDIA_BROWSER_COLUMN_MINIMUMS[column]));
    resizer?.setAttribute("aria-valuemax", String(MEDIA_BROWSER_COLUMN_MAXIMUM));
    resizer?.setAttribute("aria-valuenow", String(clamped));
  }
  els.directoryBrowserTable.style.setProperty("--media-browser-grid-width", `${trackWidth + 68}px`);
}

function setMediaBrowserColumnWidth(column, width) {
  captureMediaBrowserColumnWidths();
  state.mediaBrowserColumnWidths[column] = width;
  applyMediaBrowserColumnWidths();
}

function beginMediaBrowserColumnResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  captureMediaBrowserColumnWidths();
  const column = event.currentTarget.dataset.mediaBrowserResize;
  state.mediaBrowserColumnResize = {
    column,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: state.mediaBrowserColumnWidths[column],
    handle: event.currentTarget,
  };
  event.currentTarget.classList.add("resizing");
  event.currentTarget.setPointerCapture(event.pointerId);
}

function continueMediaBrowserColumnResize(event) {
  const resize = state.mediaBrowserColumnResize;
  if (!resize || resize.pointerId !== event.pointerId || resize.handle !== event.currentTarget) return;
  event.preventDefault();
  setMediaBrowserColumnWidth(resize.column, resize.startWidth + event.clientX - resize.startX);
}

function endMediaBrowserColumnResize(event) {
  const resize = state.mediaBrowserColumnResize;
  if (!resize || resize.handle !== event.currentTarget) return;
  resize.handle.classList.remove("resizing");
  state.mediaBrowserColumnResize = null;
}

function handleMediaBrowserColumnResizeKeydown(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  captureMediaBrowserColumnWidths();
  const column = event.currentTarget.dataset.mediaBrowserResize;
  const amount = event.shiftKey ? 32 : 12;
  setMediaBrowserColumnWidth(column, state.mediaBrowserColumnWidths[column] + (event.key === "ArrowRight" ? amount : -amount));
}

function mediaBrowserPreviewWidthLimits() {
  const layoutWidth = els.directoryBrowserLayout.getBoundingClientRect().width;
  const sidebarWidth = els.directoryBrowserLayout.querySelector(".media-browser-sidebar")?.getBoundingClientRect().width || 180;
  return {
    minimum: 220,
    maximum: Math.max(220, Math.min(720, layoutWidth - sidebarWidth - 328)),
  };
}

function setMediaBrowserPreviewWidth(width) {
  const limits = mediaBrowserPreviewWidthLimits();
  const clamped = Math.round(Math.max(limits.minimum, Math.min(limits.maximum, width)));
  state.mediaBrowserPreviewWidth = clamped;
  els.directoryBrowserLayout.style.setProperty("--media-browser-preview-width", `${clamped}px`);
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuemin", String(limits.minimum));
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuemax", String(Math.round(limits.maximum)));
  els.directoryBrowserPreviewResizer.setAttribute("aria-valuenow", String(clamped));
}

function captureMediaBrowserPreviewWidth() {
  if (state.mediaBrowserPreviewWidth === null) {
    setMediaBrowserPreviewWidth(els.directoryBrowserPreviewPane.getBoundingClientRect().width);
  }
}

function beginMediaBrowserPreviewResize(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  captureMediaBrowserPreviewWidth();
  state.mediaBrowserPreviewResize = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: state.mediaBrowserPreviewWidth,
  };
  event.currentTarget.classList.add("resizing");
  event.currentTarget.setPointerCapture(event.pointerId);
}

function continueMediaBrowserPreviewResize(event) {
  const resize = state.mediaBrowserPreviewResize;
  if (!resize || resize.pointerId !== event.pointerId) return;
  event.preventDefault();
  setMediaBrowserPreviewWidth(resize.startWidth + resize.startX - event.clientX);
}

function endMediaBrowserPreviewResize(event) {
  if (!state.mediaBrowserPreviewResize) return;
  event.currentTarget.classList.remove("resizing");
  state.mediaBrowserPreviewResize = null;
}

function handleMediaBrowserPreviewResizeKeydown(event) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  captureMediaBrowserPreviewWidth();
  const amount = event.shiftKey ? 48 : 24;
  setMediaBrowserPreviewWidth(state.mediaBrowserPreviewWidth + (event.key === "ArrowLeft" ? amount : -amount));
}

function renderMediaBrowserEntries(entries, mode) {
  const selectedPath = els.directoryBrowser.dataset.selectedPath || "";
  els.directoryBrowserList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("li");
    empty.className = "directory-browser-empty";
    empty.textContent = "This folder is empty.";
    els.directoryBrowserList.append(empty);
    return;
  }
  sortedMediaBrowserEntries(entries).forEach((entry) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `directory-browser-entry ${entry.kind}`;
    button.mediaBrowserEntry = entry;
    button.title = entry.path;
    if (entry.path === selectedPath) button.classList.add("selected");
    button.append(
      mediaBrowserCell("directory-browser-entry-name", entry.name),
      mediaBrowserCell("directory-browser-entry-size", entry.kind === "directory" ? "--" : formatMediaBrowserSize(entry.size)),
      mediaBrowserCell("directory-browser-entry-kind", entry.kind_label || (entry.kind === "directory" ? "Folder" : "File")),
      mediaBrowserCell("directory-browser-entry-date", formatMediaBrowserDate(entry.date_added_ms)),
    );
    if (entry.kind === "directory") {
      button.addEventListener("dblclick", () => loadMediaDirectory(entry.path));
      button.addEventListener("click", () => {
        state.mediaPreviewGeneration += 1;
        clearMediaBrowserPreview();
        if (mode === "export_directory") {
          els.directoryBrowser.dataset.selectedPath = entry.path;
          els.directoryBrowserSelect.disabled = false;
        } else {
          delete els.directoryBrowser.dataset.selectedPath;
          els.directoryBrowserSelect.disabled = mode === "project_save" ? !els.directoryBrowserFilename.value.trim() : true;
        }
        els.directoryBrowserSelection.textContent = entry.name;
        els.directoryBrowserPreviewNote.textContent = "Double-click to open this folder.";
        selectMediaBrowserEntry(button);
      });
    } else if (mode === "source" && entry.supported) {
      button.classList.add("supported");
      button.addEventListener("click", () => previewMediaBrowserFile(entry, button));
      button.addEventListener("dblclick", async () => {
        previewMediaBrowserFile(entry, button);
        await confirmMediaBrowserSelection();
      });
    } else if (["project_open", "project_save"].includes(mode) && entry.supported) {
      button.classList.add("supported");
      button.addEventListener("click", () => {
        state.mediaPreviewGeneration += 1;
        clearMediaBrowserPreview();
        els.directoryBrowser.dataset.selectedPath = entry.path;
        selectMediaBrowserEntry(button);
        els.directoryBrowserSelection.textContent = entry.name;
        els.directoryBrowserPreviewNote.textContent = mode === "project_open"
          ? "HDR Finisher project selected."
          : "Saving will replace this project after confirmation.";
        if (mode === "project_save") els.directoryBrowserFilename.value = entry.name;
        els.directoryBrowserSelect.disabled = false;
      });
      button.addEventListener("dblclick", async () => {
        button.click();
        await confirmMediaBrowserSelection();
      });
    } else {
      button.disabled = true;
      button.setAttribute("aria-label", `${entry.name}, file`);
    }
    item.append(button);
    els.directoryBrowserList.append(item);
  });
}

async function loadMediaDirectory(path) {
  const generation = ++state.mediaBrowserGeneration;
  state.mediaPreviewGeneration += 1;
  clearMediaBrowserPreview();
  els.directoryBrowserStatus.textContent = "Loading folders…";
  els.directoryBrowserList.replaceChildren();
  els.directoryBrowserGo.disabled = true;
  els.directoryBrowserUp.disabled = true;
  els.directoryBrowserSelect.disabled = true;
  try {
    const mode = els.directoryBrowser.dataset.mode || "source";
    const params = new URLSearchParams({ mode });
    if (path?.trim()) params.set("path", path.trim());
    const response = await fetch(`/api/media-browser?${params}`);
    const payload = await safeJson(response);
    if (generation !== state.mediaBrowserGeneration) return;
    if (!response.ok) {
      els.directoryBrowserStatus.textContent = responseErrorMessage(payload, "Could not open that folder.");
      return;
    }

    els.directoryBrowserPath.value = payload.current;
    els.directoryBrowser.dataset.parent = payload.parent || "";
    els.directoryBrowserUp.disabled = !payload.parent;
    els.directoryBrowserSelect.disabled = mode === "source" || mode === "project_open";
    if (mode === "project_save") updateProjectSaveBrowserAction();
    delete els.directoryBrowser.dataset.selectedPath;
    renderMediaBrowserNavigation(
      payload.recents || [],
      payload.pinned || [],
      payload.locations || [],
      payload.drives || [],
    );
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    state.mediaBrowserEntries = entries;
    updateMediaBrowserSortHeaders();
    renderMediaBrowserEntries(entries, mode);
    const folderCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = entries.length - folderCount;
    els.directoryBrowserStatus.textContent = `${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  } catch (error) {
    if (generation !== state.mediaBrowserGeneration) return;
    console.error(error);
    els.directoryBrowserStatus.textContent = "Could not reach the local HDR Finisher server.";
  } finally {
    if (generation === state.mediaBrowserGeneration) els.directoryBrowserGo.disabled = false;
  }
}

function renderMediaBrowserNavigation(recents, pinned, locations, drives) {
  const render = (container, entries, removable) => {
    container.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.available ? entry.name : `${entry.name} · unavailable`;
      button.disabled = !entry.available;
      button.addEventListener("click", () => loadMediaDirectory(entry.path));
      item.append(button);
      if (removable) {
        button.title = entry.available ? "Open pinned folder" : "This pinned folder is currently unavailable";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "media-browser-pinned-remove";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${entry.name} from pinned folders`);
        remove.addEventListener("click", async () => {
          await fetch(`/api/media-browser/pinned?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
          await loadMediaDirectory(els.directoryBrowserPath.value);
        });
        item.append(remove);
      }
      container.append(item);
    }
  };
  const seenLocations = new Set();
  const allLocations = [...locations, ...drives].filter((entry) => {
    if (seenLocations.has(entry.path)) return false;
    seenLocations.add(entry.path);
    return true;
  });
  render(els.directoryBrowserRecents, recents, false);
  render(els.directoryBrowserPinned, pinned, true);
  render(els.directoryBrowserLocations, allLocations, false);
}

function selectMediaBrowserEntry(button) {
  els.directoryBrowserList.querySelectorAll(".selected").forEach((entry) => entry.classList.remove("selected"));
  button.classList.add("selected");
}

function handleMediaBrowserListKeydown(event) {
  const current = event.target.closest(".directory-browser-entry:not(:disabled)");
  if (!current) return;
  if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const entries = Array.from(els.directoryBrowserList.querySelectorAll(".directory-browser-entry:not(:disabled)"));
    const currentIndex = entries.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? entries.length - 1
        : Math.max(0, Math.min(entries.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
    const next = entries[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
    next.click();
    return;
  }
  const entry = current.mediaBrowserEntry;
  if (event.key === "ArrowLeft" && els.directoryBrowser.dataset.parent) {
    event.preventDefault();
    loadMediaDirectory(els.directoryBrowser.dataset.parent);
  } else if ((event.key === "ArrowRight" || event.key === "Enter") && entry?.kind === "directory") {
    event.preventDefault();
    loadMediaDirectory(entry.path);
  } else if (event.key === "Enter" && entry?.supported) {
    event.preventDefault();
    if (els.directoryBrowser.dataset.mode === "source") previewMediaBrowserFile(entry, current);
    else current.click();
    confirmMediaBrowserSelection();
  }
}

function clearMediaBrowserPreview() {
  state.mediaPreviewRequest?.abort?.();
  state.mediaPreviewRequest = null;
  if (state.mediaPreviewObjectUrl) URL.revokeObjectURL(state.mediaPreviewObjectUrl);
  state.mediaPreviewObjectUrl = null;
  els.directoryBrowserPreview.onload = null;
  els.directoryBrowserPreview.onerror = null;
  els.directoryBrowserPreview.removeAttribute("src");
  els.directoryBrowserPreview.hidden = true;
  els.directoryBrowserPreviewFrame.removeAttribute("data-preview-state");
  els.directoryBrowserPreviewFrame.removeAttribute("role");
  els.directoryBrowserPreviewFrame.removeAttribute("aria-label");
}

async function previewMediaBrowserFile(entry, button) {
  const generation = ++state.mediaPreviewGeneration;
  renderExperimentalDngNote(entry);
  els.directoryBrowser.dataset.selectedPath = entry.path;
  els.directoryBrowserSelect.disabled = false;
  selectMediaBrowserEntry(button);
  clearMediaBrowserPreview();
  els.directoryBrowserSelection.textContent = entry.name;
  const hdrPossible = window.matchMedia?.("(dynamic-range: high)")?.matches && ["avif", "jxl", "exr", "dng"].includes(entry.format);
  const readyNote = `${String(entry.format || "image").toUpperCase()} · ${hdrPossible ? "HDR selected preview follows after opening" : "SDR browser thumbnail"}`;
  els.directoryBrowserPreviewNote.textContent = `${String(entry.format || "image").toUpperCase()} · Loading preview…`;

  const params = new URLSearchParams({
    path: entry.path,
    size: "512",
    key: entry.thumbnail_key || "",
    version: "natural-aspect-v4",
  });
  const previewUrl = `/api/media-browser/thumbnail?${params}`;
  const request = new AbortController();
  state.mediaPreviewRequest = request;
  const failPreview = () => {
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    clearMediaBrowserPreview();
    els.directoryBrowserPreviewNote.textContent = "Preview unavailable; you can still open the source.";
  };
  try {
    const response = await fetch(previewUrl, { signal: request.signal });
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    if (response.status === 409) {
      const payload = await safeJson(response);
      const detail = payload?.detail;
      if (detail?.code === "interpretation_required") {
        const profile = detail.profile_name ? ` Embedded profile: “${detail.profile_name}”.` : "";
        clearMediaBrowserPreview();
        els.directoryBrowserPreviewFrame.dataset.previewState = "interpretation-required";
        els.directoryBrowserPreviewFrame.setAttribute("role", "img");
        els.directoryBrowserPreviewFrame.setAttribute("aria-label", "Preview withheld because color interpretation is required");
        els.directoryBrowserPreviewNote.textContent = `Color interpretation required. ${detail.message}${profile} Preview withheld to avoid misleading color; open the image to review its interpretation.`;
        return;
      }
    }
    if (!response.ok) throw new Error(`Thumbnail request failed with status ${response.status}.`);
    const blob = await response.blob();
    if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
    const objectUrl = URL.createObjectURL(blob);
    state.mediaPreviewObjectUrl = objectUrl;
    els.directoryBrowserPreview.onload = () => {
      if (generation !== state.mediaPreviewGeneration || state.mediaPreviewRequest !== request) return;
      els.directoryBrowserPreview.onload = null;
      els.directoryBrowserPreview.onerror = null;
      els.directoryBrowserPreview.hidden = false;
      els.directoryBrowserPreviewNote.textContent = readyNote;
      state.mediaPreviewRequest = null;
    };
    els.directoryBrowserPreview.onerror = failPreview;
    els.directoryBrowserPreview.src = objectUrl;
    els.directoryBrowserPreview.alt = `Preview of ${entry.name}`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    failPreview();
  }
}

async function pinCurrentMediaFolder() {
  const path = els.directoryBrowserPath.value.trim();
  if (!path) return;
  const response = await fetch("/api/media-browser/pinned", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    els.directoryBrowserStatus.textContent = responseErrorMessage(payload, "Could not pin that folder.");
    return;
  }
  await loadMediaDirectory(path);
}

async function recordSuccessfulMediaImport(path) {
  if (!path) return;
  try {
    const response = await fetch("/api/media-browser/recents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) console.warn("The imported folder could not be added to Recents.");
  } catch (error) {
    console.warn("The imported folder could not be added to Recents.", error);
  }
}

function closeExportDirectoryBrowser() {
  if (els.directoryBrowser.open) els.directoryBrowser.close();
  settleMediaBrowserSelection(null);
}

async function confirmMediaBrowserSelection() {
  const mode = els.directoryBrowser.dataset.mode || "source";
  const selected = els.directoryBrowser.dataset.selectedPath || els.directoryBrowserPath.value.trim();
  if (!selected) return;
  if (mode === "export_directory") {
    const directory = els.directoryBrowserList.querySelector(".selected.directory")
      ? selected
      : els.directoryBrowserPath.value.trim();
    els.exportDirectory.value = directory;
    els.exportStatus.textContent = `Save folder set to ${directory}`;
    closeExportDirectoryBrowser();
    return;
  }
  if (mode === "project_open" || mode === "project_save") {
    try {
      const requestedPath = mode === "project_open"
        ? els.directoryBrowser.dataset.selectedPath
        : joinExportPath(els.directoryBrowserPath.value.trim(), sanitizeProjectFilename(els.directoryBrowserFilename.value));
      if (!requestedPath) return;
      const selection = await desktop.grantProjectPath(requestedPath, mode === "project_open" ? "project-open" : "project-save");
      if (mode === "project_save" && selection.exists) {
        const approved = window.confirm(`Replace the existing project?\n\n${selection.path}\n\nThis cannot be undone.`);
        if (!approved) {
          els.directoryBrowserStatus.textContent = "The existing project was left unchanged.";
          return;
        }
        selection.grant = (await desktop.grantProjectPath(selection.path, "project-save")).grant;
      }
      const resolve = state.mediaBrowserResolver;
      state.mediaBrowserResolver = null;
      if (els.directoryBrowser.open) els.directoryBrowser.close();
      resolve?.(selection);
    } catch (error) {
      els.directoryBrowserStatus.textContent = error?.message || `Could not ${mode === "project_open" ? "open" : "save"} that project.`;
    }
    return;
  }
  if (!desktop) {
    closeExportDirectoryBrowser();
    els.fileInput.click();
    return;
  }
  let selection;
  try {
    selection = await desktop.grantSourcePath(selected);
  } catch (error) {
    els.directoryBrowserStatus.textContent = error?.message || "Could not open that source image.";
    return;
  }
  closeExportDirectoryBrowser();
  try {
    await openDesktopSelection({ kind: "source", ...selection });
  } catch (error) {
    console.error(error);
    showUploadError(error?.message || "Could not open that source image.");
  }
}

function sanitizeProjectFilename(value) {
  const base = (String(value || "Untitled").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "Untitled").replace(/[. ]+$/, "");
  const stem = base.replace(/\.hdrfinisher$/i, "").split(".", 1)[0];
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    throw new Error(`“${stem}” is a reserved Windows filename. Choose another project name.`);
  }
  return base.toLowerCase().endsWith(".hdrfinisher") ? base : `${base}.hdrfinisher`;
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload();
  els.badge.textContent = "Re-interpreting source file...";
  setPreviewMessage("Re-interpreting source file...", 8);
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/interpretation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(override),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      els.badge.textContent = payload?.detail || "Interpretation override failed.";
      els.badge.className = "badge bad";
      setPreviewError(payload?.detail || "Interpretation override failed.");
      return;
    }
    state.session = payload.session;
    setPreviewMessage("Interpretation applied. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    state.documentDirty = Boolean(payload.session.dirty);
    state.interpretationGateDismissed = false;
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    state.gpuPreview?.resetSession(payload.session.session_id);
    renderSession();
    renderLocalAdjustments();
    const gpuReady = await renderGpuDraft(state.currentView, { hideStatus: false, longEdge: settledProxyLongEdge() });
    await Promise.all([
      gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
      refreshOverlay(),
      refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
    ]);
    hidePreviewMessage();
    prepareInactivePreview();
    if (previewNeedsRefinement()) debouncePreview(state.currentView);
  } catch (error) {
    console.error(error);
    els.badge.textContent = "Interpretation override could not reach the local HDR Finisher server.";
    els.badge.className = "badge bad";
    setPreviewError(els.badge.textContent);
  }
}

async function resetInterpretationToAuto() {
  if (!state.session) return;
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  els.interpretationLinearReference.value = "scene_0_18";
  renderSourceSettingsControls();
  await applyInterpretationOverride();
}

function badgeClass(classification) {
  if (classification === "HDR_TRUE") return "badge good hdr-true";
  if (classification === "HDR_ENCODED" || classification === "HDR_LINEAR_UNCONFIRMED") return "badge warn";
  return "badge bad";
}

function setValueByPath(target, path, value) {
  const parts = resolveAdjustmentPath(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return resolveAdjustmentPath(path).split(".").reduce((cursor, key) => cursor?.[key], target);
}

function bindCropEditor() {
  els.cropToolToggle?.addEventListener("click", async () => {
    abandonPerspectiveDraft();
    if (state.rotateDraftGeometry) closeRotateMode(false);
    if (state.geometryTool === "crop") {
      closeCropMode(true);
      return;
    }
    if (state.cropMode) closeCropMode(true);
    state.geometryTool = "crop";
    await openCropMode();
  });
  els.rotateToolToggle?.addEventListener("click", () => {
    abandonPerspectiveDraft();
    if (state.cropMode) closeCropMode(true);
    if (state.geometryTool === "rotate") {
      closeRotateMode(false);
      return;
    }
    openRotateMode();
  });
  els.cropDone?.addEventListener("click", () => closeCropMode(true));
  els.cropCancel?.addEventListener("click", () => closeCropMode(false));
  els.cropResetFrame?.addEventListener("click", () => {
    if (!state.cropDraftGeometry) return;
    state.cropDraftGeometry.crop = { x: 0, y: 0, width: 1, height: 1 };
    constrainCropToRatio();
    renderCropFrame();
    renderGeometryResetState();
  });
  els.cropGuide?.addEventListener("change", () => {
    state.cropGuide = els.cropGuide.value;
    renderCropOptions();
    drawCropGuide();
  });
  els.cropGridDensity?.addEventListener("input", () => {
    state.cropGridDensity = Number(els.cropGridDensity.value);
    renderCropOptions();
    drawCropGuide();
  });
  els.rotateLeft?.addEventListener("click", () => rotateGeometry(-90));
  els.rotateRight?.addEventListener("click", () => rotateGeometry(90));
  els.flipHorizontal?.addEventListener("click", () => updateRotateDraft("flip_horizontal"));
  els.flipVertical?.addEventListener("click", () => updateRotateDraft("flip_vertical"));
  els.rotateApply?.addEventListener("click", () => closeRotateMode(true));
  els.rotateCancel?.addEventListener("click", () => closeRotateMode(false));
  els.swapCustomRatio?.addEventListener("click", () => {
    const ratio = state.cropDraftGeometry?.custom_ratio;
    if (!ratio) return;
    [ratio.width, ratio.height] = [ratio.height, ratio.width];
    renderCropOptions();
    constrainCropToRatio();
    renderGeometryResetState();
  });
  els.cropBox?.addEventListener("pointerdown", beginCropDrag);
  window.addEventListener("pointermove", moveCropDrag);
  window.addEventListener("pointerup", endCropDrag);
  window.addEventListener("pointercancel", endCropDrag);
  els.cropStraighten?.addEventListener("pointerdown", beginStraightenGesture);
  els.cropStraighten?.addEventListener("keydown", beginStraightenGesture);
  ["pointerup", "pointercancel", "change", "keyup"].forEach((eventName) => {
    els.cropStraighten?.addEventListener(eventName, finishStraightenGesture);
  });
  renderGeometryToolState();
}

function bindPerspectiveEditor() {
  const activateTool = (orientation) => {
    openPerspectiveMode();
    state.perspectiveTool = state.perspectiveTool === orientation ? null : orientation;
    renderPerspectiveControls();
    renderPerspectiveGuides();
  };
  els.perspectiveVerticalTool?.addEventListener("click", () => activateTool("vertical"));
  els.perspectiveHorizontalTool?.addEventListener("click", () => activateTool("horizontal"));
  const sliderInput = (key, control) => {
    const value = Number(control.value);
    openPerspectiveMode();
    state.adjustments.shared.geometry[key] = value;
    state.perspectiveResetPending = false;
    renderPerspectiveControls();
    schedulePerspectiveDraftPreview();
  };
  els.perspectiveHorizontal?.addEventListener("input", () => sliderInput("perspective_horizontal", els.perspectiveHorizontal));
  els.perspectiveVertical?.addEventListener("input", () => sliderInput("perspective_vertical", els.perspectiveVertical));
  els.perspectiveRotate?.addEventListener("input", () => sliderInput("perspective_rotate", els.perspectiveRotate));
  els.perspectiveGuideApply?.addEventListener("click", () => void applyPerspectiveGuides());
  els.perspectiveApply?.addEventListener("click", () => void commitPerspectiveMode());
  els.perspectiveCancel?.addEventListener("click", () => closePerspectiveMode(false));
  els.perspectiveGuideHandles?.addEventListener("pointerdown", beginPerspectiveGuideDrag);
  els.perspectiveGuideHandles?.addEventListener("keydown", movePerspectiveGuideWithKeyboard);
  window.addEventListener("pointermove", movePerspectiveGuideDrag);
  window.addEventListener("pointerup", endPerspectiveGuideDrag);
  window.addEventListener("pointercancel", endPerspectiveGuideDrag);
  window.addEventListener("resize", renderPerspectiveGuides);
  renderPerspectiveControls();
}

function defaultPerspectiveGuides() {
  return {
    vertical: [
      { start: { x: 1 / 3, y: 0.15 }, end: { x: 1 / 3, y: 0.85 } },
      { start: { x: 2 / 3, y: 0.15 }, end: { x: 2 / 3, y: 0.85 } },
    ],
    horizontal: [
      { start: { x: 0.15, y: 1 / 3 }, end: { x: 0.85, y: 1 / 3 } },
      { start: { x: 0.15, y: 2 / 3 }, end: { x: 0.85, y: 2 / 3 } },
    ],
  };
}

function openPerspectiveMode() {
  if (!state.session || state.perspectiveMode) return;
  if (state.cropMode) closeCropMode(true);
  if (state.rotateDraftGeometry) closeRotateMode(false);
  state.perspectiveMode = true;
  suspendGeometryPreviewWork();
  state.perspectiveDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.perspectiveGuides = defaultPerspectiveGuides();
  state.perspectiveGuidesTouched = { vertical: false, horizontal: false };
  state.perspectiveGuidesDirty = false;
  state.perspectiveResetPending = false;
  state.perspectiveTool = null;
  if (state.gradeMode === "local") setGradeMode("global");
  renderPerspectiveControls();
}

function geometryDraftActive() {
  return Boolean(state.perspectiveMode || state.rotateDraftGeometry);
}

function suspendGeometryPreviewWork() {
  // Retire ordinary preview work, including frames already decoding or waiting
  // on a GPU proxy, before this transaction can change the geometry.
  state.previewScheduler?.cancel();
  window.clearTimeout(state.settleTimer);
  state.settleTimer = null;
  state.gpuRenderSerial += 1;
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
  }
}

function openRotateMode() {
  if (!state.session || state.rotateDraftGeometry) return;
  state.rotateDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.geometryTool = "rotate";
  suspendGeometryPreviewWork();
  renderRotateDraftTransform();
  renderGeometryToolState();
}

function closePerspectiveMode(commit) {
  if (!state.perspectiveMode) return;
  const original = state.perspectiveDraftGeometry;
  const changed = original && !valuesEqual(original, state.adjustments.shared.geometry);
  state.perspectiveSolveController?.abort();
  state.perspectiveSolveController = null;
  state.perspectivePreviewController?.abort();
  state.perspectivePreviewController = null;
  window.clearTimeout(state.perspectivePreviewTimer);
  state.perspectivePreviewTimer = 0;
  state.perspectiveMode = false;
  state.perspectiveTool = null;
  state.perspectiveGuideDrag = null;
  state.perspectiveGuides = null;
  state.perspectiveGuidesDirty = false;
  state.perspectiveResetPending = false;
  state.perspectiveDraftGeometry = null;
  els.perspectiveEditorOverlay?.classList.add("hidden");
  els.perspectiveEditorOverlay?.setAttribute("aria-hidden", "true");
  if (!commit && original) state.adjustments.shared.geometry = original;
  if (state.perspectivePreviewUrl) {
    URL.revokeObjectURL(state.perspectivePreviewUrl);
    state.perspectivePreviewUrl = null;
  }
  renderPerspectiveControls();
  renderControlState();
  if (commit && changed) {
    state.geometryTransformHandoffSignature = geometrySignature();
    state.geometryPresentationPending = true;
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else {
    if (state.globalEditDirty || state.geometryPresentationPending) {
      debouncePreview(state.currentView);
      return;
    }
    void showCachedPreview(state.currentView).then((shown) => {
      if (!shown) debouncePreview(state.currentView);
    });
  }
}

// Used wherever navigating away (switching tools, lanes, or workflow tabs)
// would otherwise silently discard an open Perspective draft. A pending Reset
// is a deliberate, complete action -- discarding it via the same path as an
// unrelated tool switch would resurrect the old values the user just cleared,
// so commit it instead of throwing it away. A genuine in-progress edit (never
// reset) keeps the prior discard-on-navigate behavior.
function abandonPerspectiveDraft() {
  if (!state.perspectiveMode) return;
  closePerspectiveMode(state.perspectiveResetPending);
}

function renderPerspectiveControls() {
  const geometry = state.adjustments?.shared?.geometry || defaultGeometry();
  if (els.perspectiveHorizontal) els.perspectiveHorizontal.value = String(Math.round(Number(geometry.perspective_horizontal) || 0));
  if (els.perspectiveVertical) els.perspectiveVertical.value = String(Math.round(Number(geometry.perspective_vertical) || 0));
  if (els.perspectiveRotate) els.perspectiveRotate.value = String(Number(geometry.perspective_rotate) || 0);
  if (els.perspectiveHorizontalValue) els.perspectiveHorizontalValue.textContent = `${Number(geometry.perspective_horizontal) > 0 ? "+" : ""}${Math.round(Number(geometry.perspective_horizontal) || 0)}`;
  if (els.perspectiveVerticalValue) els.perspectiveVerticalValue.textContent = `${Number(geometry.perspective_vertical) > 0 ? "+" : ""}${Math.round(Number(geometry.perspective_vertical) || 0)}`;
  if (els.perspectiveRotateValue) els.perspectiveRotateValue.textContent = `${Number(geometry.perspective_rotate) > 0 ? "+" : ""}${(Number(geometry.perspective_rotate) || 0).toFixed(1)}°`;
  // Setting .value directly (Reset, Cancel, a solved guide Apply) doesn't fire
  // the "input" event that keeps the fill-bar CSS vars attached to the handle,
  // so refresh them explicitly whenever we render from state.
  [els.perspectiveHorizontal, els.perspectiveVertical, els.perspectiveRotate].forEach((control) => {
    if (control) updateRangeVisual(control);
  });
  for (const [orientation, button] of [["vertical", els.perspectiveVerticalTool], ["horizontal", els.perspectiveHorizontalTool]]) {
    const active = state.perspectiveMode && state.perspectiveTool === orientation;
    button?.classList.toggle("active", active);
    button?.setAttribute("aria-pressed", String(active));
  }
  if (els.perspectiveApply) els.perspectiveApply.disabled = !state.perspectiveMode;
  // Once Reset has cleared the draft, Cancel has nothing of the user's to discard
  // except the reset itself -- pressing it would silently bring back the old,
  // just-rejected values, so keep it disabled until a new edit is made.
  if (els.perspectiveCancel) els.perspectiveCancel.disabled = !state.perspectiveMode || state.perspectiveResetPending;
  if (els.perspectiveGuideApply) els.perspectiveGuideApply.disabled = !state.perspectiveGuidesDirty;
}

function renderPerspectiveGuides() {
  const overlay = els.perspectiveEditorOverlay;
  const svg = els.perspectiveGuideSvg;
  const handles = els.perspectiveGuideHandles;
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  const orientation = state.perspectiveTool;
  if (!overlay || !svg || !handles || !orientation || !state.perspectiveGuides || !paneRect || !imageRect?.width || !imageRect?.height) {
    overlay?.classList.add("hidden");
    overlay?.setAttribute("aria-hidden", "true");
    return;
  }
  Object.assign(overlay.style, {
    left: `${imageRect.left - paneRect.left}px`, top: `${imageRect.top - paneRect.top}px`,
    width: `${imageRect.width}px`, height: `${imageRect.height}px`, right: "auto", bottom: "auto",
  });
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  svg.replaceChildren();
  const existingHandles = [...handles.children];
  const reuseHandles = existingHandles.length === 4
    && existingHandles.every((handle) => handle.dataset.orientation === orientation);
  if (!reuseHandles) handles.replaceChildren();
  state.perspectiveGuides[orientation].forEach((guide, guideIndex) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${guide.start.x * 100}%`); line.setAttribute("y1", `${guide.start.y * 100}%`);
    line.setAttribute("x2", `${guide.end.x * 100}%`); line.setAttribute("y2", `${guide.end.y * 100}%`);
    svg.append(line);
    for (const pointName of ["start", "end"]) {
      const point = guide[pointName];
      const handle = reuseHandles
        ? existingHandles[guideIndex * 2 + (pointName === "end" ? 1 : 0)]
        : document.createElement("button");
      handle.type = "button";
      handle.className = "perspective-guide-handle";
      handle.dataset.orientation = orientation;
      handle.dataset.guideIndex = String(guideIndex);
      handle.dataset.guidePoint = pointName;
      handle.style.left = `${point.x * 100}%`;
      handle.style.top = `${point.y * 100}%`;
      handle.setAttribute("aria-label", `${orientation} guide ${guideIndex + 1} ${pointName}. Use arrow keys to move; Shift moves ten pixels.`);
      if (!reuseHandles) handles.append(handle);
    }
  });
}

function beginPerspectiveGuideDrag(event) {
  const handle = event.target.closest?.(".perspective-guide-handle");
  if (!handle) return;
  event.preventDefault();
  handle.setPointerCapture?.(event.pointerId);
  state.perspectiveGuideDrag = {
    orientation: handle.dataset.orientation,
    guideIndex: Number(handle.dataset.guideIndex),
    pointName: handle.dataset.guidePoint,
    pointerId: event.pointerId,
  };
}

function movePerspectiveGuideDrag(event) {
  const drag = state.perspectiveGuideDrag;
  const rect = els.perspectiveEditorOverlay?.getBoundingClientRect();
  if (!drag || event.pointerId !== drag.pointerId || !rect?.width || !rect?.height) return;
  const point = state.perspectiveGuides?.[drag.orientation]?.[drag.guideIndex]?.[drag.pointName];
  if (!point) return;
  point.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  point.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  renderPerspectiveGuides();
}

function endPerspectiveGuideDrag(event) {
  const drag = state.perspectiveGuideDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  state.perspectiveGuideDrag = null;
  markPerspectiveGuidesDirty(drag.orientation);
}

function movePerspectiveGuideWithKeyboard(event) {
  const handle = event.target.closest?.(".perspective-guide-handle");
  if (!handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const rect = els.perspectiveEditorOverlay?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const orientation = handle.dataset.orientation;
  const point = state.perspectiveGuides?.[orientation]?.[Number(handle.dataset.guideIndex)]?.[handle.dataset.guidePoint];
  if (!point) return;
  const pixels = event.shiftKey ? 10 : 1;
  point.x = clamp(point.x + (event.key === "ArrowLeft" ? -pixels / rect.width : event.key === "ArrowRight" ? pixels / rect.width : 0), 0, 1);
  point.y = clamp(point.y + (event.key === "ArrowUp" ? -pixels / rect.height : event.key === "ArrowDown" ? pixels / rect.height : 0), 0, 1);
  renderPerspectiveGuides();
  markPerspectiveGuidesDirty(orientation);
}

function markPerspectiveGuidesDirty(orientation) {
  state.perspectiveGuidesTouched[orientation] = true;
  state.perspectiveGuidesDirty = true;
  state.perspectiveResetPending = false;
  if (els.perspectiveStatus) els.perspectiveStatus.textContent = "Guide placement changed. Click Apply Guides to solve the correction.";
  renderPerspectiveControls();
}

async function applyPerspectiveGuides() {
  if (!state.perspectiveGuidesDirty) return true;
  return solvePerspectiveGuides();
}

function transformPerspectiveGuide(guide, matrix) {
  const start = projectivePoint(matrix, guide.start);
  const end = projectivePoint(matrix, guide.end);
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  // A safe-area crop can move an endpoint outside the corrected image. Clip
  // the segment, rather than clamping X/Y independently and bending the line.
  let near = 0;
  let far = 1;
  for (const axis of ["x", "y"]) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < 0 || start[axis] > 1) return null;
      continue;
    }
    const a = -start[axis] / delta;
    const b = (1 - start[axis]) / delta;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (near > far) return null;
  const point = (t) => ({ x: clamp(start.x + t * (end.x - start.x), 0, 1),
    y: clamp(start.y + t * (end.y - start.y), 0, 1) });
  const clipped = { start: point(near), end: point(far) };
  return Math.hypot(clipped.end.x - clipped.start.x, clipped.end.y - clipped.start.y) >= 0.05
    ? clipped : null;
}

async function solvePerspectiveGuides() {
  if (!state.session || !state.perspectiveMode) return false;
  const vertical = state.perspectiveGuidesTouched.vertical ? state.perspectiveGuides.vertical : [];
  const horizontal = state.perspectiveGuidesTouched.horizontal ? state.perspectiveGuides.horizontal : [];
  if (!vertical.length && !horizontal.length) return false;
  state.perspectiveSolveController?.abort();
  const controller = new AbortController();
  state.perspectiveSolveController = controller;
  const sessionId = state.session.session_id;
  const draft = state.perspectiveDraftGeometry;
  const signature = JSON.stringify([state.adjustments.shared.geometry, state.perspectiveGuides, state.perspectiveGuidesTouched]);
  const isCurrent = () => state.perspectiveMode && state.perspectiveDraftGeometry === draft
    && state.session?.session_id === sessionId && controller === state.perspectiveSolveController
    && signature === JSON.stringify([state.adjustments.shared.geometry, state.perspectiveGuides, state.perspectiveGuidesTouched]);
  els.perspectiveStatus.textContent = "Solving guided correction…";
  const response = await fetch(`/api/session/${state.session.session_id}/perspective-solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments, vertical_guides: vertical, horizontal_guides: horizontal, edit_revision: state.editRevision }),
    signal: controller.signal,
  }).catch(() => null);
  if (!isCurrent()) return false;
  if (!response?.ok) {
    const payload = response ? await safeJson(response) : null;
    if (!isCurrent()) return false;
    els.perspectiveStatus.textContent = responseErrorMessage(payload, "The selected guides could not be solved.");
    return false;
  }
  const solved = await response.json();
  if (!isCurrent()) return false;
  const geometry = state.adjustments.shared.geometry;
  geometry.perspective_horizontal = solved.perspective_horizontal;
  geometry.perspective_vertical = solved.perspective_vertical;
  geometry.perspective_rotate = solved.perspective_rotate;
  let guidesOutsideFrame = false;
  if (solved.guide_transform) {
    for (const orientation of ["vertical", "horizontal"]) {
      if (!state.perspectiveGuidesTouched[orientation]) continue;
      const guides = state.perspectiveGuides[orientation].map((guide) => transformPerspectiveGuide(guide, solved.guide_transform));
      if (guides.every(Boolean)) state.perspectiveGuides[orientation] = guides;
      else {
        state.perspectiveGuides[orientation] = defaultPerspectiveGuides()[orientation];
        state.perspectiveGuidesTouched[orientation] = false;
        guidesOutsideFrame = true;
      }
    }
  }
  state.perspectiveGuidesDirty = false;
  els.perspectiveStatus.textContent = `Guides aligned within ${Number(solved.residual_degrees).toFixed(2)}°.`;
  if (guidesOutsideFrame) els.perspectiveStatus.textContent += " Some guides fell outside the corrected image; place those guides again before another solve.";
  renderPerspectiveControls();
  renderPerspectiveGuides();
  schedulePerspectiveDraftPreview();
  return true;
}

async function commitPerspectiveMode() {
  const draft = state.perspectiveDraftGeometry;
  if (state.perspectiveGuidesDirty && !await applyPerspectiveGuides()) return false;
  if (!state.perspectiveMode || state.perspectiveDraftGeometry !== draft) return false;
  closePerspectiveMode(true);
  return true;
}

function schedulePerspectiveDraftPreview() {
  window.clearTimeout(state.perspectivePreviewTimer);
  state.perspectivePreviewTimer = window.setTimeout(renderPerspectiveDraftPreview, 90);
}

async function renderPerspectiveDraftPreview() {
  if (!state.session || !state.perspectiveMode) return;
  state.perspectivePreviewController?.abort();
  const controller = new AbortController();
  state.perspectivePreviewController = controller;
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  const signature = JSON.stringify(state.adjustments.shared.geometry);
  const isCurrent = () => state.perspectiveMode && controller === state.perspectivePreviewController
    && state.session?.session_id === sessionId && state.currentView === lane
    && signature === JSON.stringify(state.adjustments.shared.geometry);
  const response = await fetch(`/api/session/${state.session.session_id}/preview/${state.currentView}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adjustments: state.adjustments,
      transient_adjustments: true,
      edit_revision: state.editRevision,
      include_locals: !state.compareWithoutLocals,
      local_adjustments: state.compareWithoutLocals ? [] : localAdjustments(),
      long_edge: interactiveProxyLongEdge(),
      hdr_display: mediaQueryMatch("(dynamic-range: high)"),
      tier: "interactive",
    }),
    signal: controller.signal,
  }).catch((error) => error.name === "AbortError" ? null : null);
  if (!response || !isCurrent()) return;
  if (!response.ok) {
    const payload = await safeJson(response);
    if (!isCurrent()) return;
    els.perspectiveStatus.textContent = responseErrorMessage(payload, "Perspective preview failed.");
    return;
  }
  const blob = await response.blob();
  if (!isCurrent()) return;
  const url = URL.createObjectURL(blob);
  const applied = await applyPreviewUrl(url, isCurrent);
  if (!applied) { URL.revokeObjectURL(url); return; }
  const previous = state.perspectivePreviewUrl;
  state.perspectivePreviewUrl = url;
  if (previous) URL.revokeObjectURL(previous);
  renderPerspectiveGuides();
  renderControlState();
  void ensureGeometryCoordinateMap();
}

function openCropMode() {
  if (!state.session || state.cropMode) return;
  state.geometryTool = "crop";
  state.cropMode = true;
  state.cropDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  state.cropEditBaseCrop = { ...state.cropDraftGeometry.crop };
  // The preview already represents the committed crop. Author the next frame
  // relative to that visible image, then compose it back into source space on
  // Apply; reusing source-relative coordinates here double-crops the frame.
  state.cropDraftGeometry.crop = { x: 0, y: 0, width: 1, height: 1 };
  els.cropEditorOverlay?.classList.remove("hidden");
  els.cropEditorOverlay?.setAttribute("aria-hidden", "false");
  renderGeometryToolState();
  renderCropOptions();
  void ensureGeometryCoordinateMap();
}

function responseErrorMessage(payload, fallback) {
  if (typeof payload?.detail === "string") return payload.detail;
  if (typeof payload?.detail?.message === "string") return payload.detail.message;
  if (typeof payload?.message === "string") return payload.message;
  return fallback;
}

function closeCropMode(commit) {
  if (!state.cropMode) return;
  const draft = state.cropDraftGeometry;
  const baseCrop = state.cropEditBaseCrop;
  state.cropMode = false;
  state.cropDraftGeometry = null;
  state.cropEditBaseCrop = null;
  state.cropDrag = null;
  state.geometryTool = null;
  els.cropEditorOverlay?.classList.add("hidden");
  els.cropEditorOverlay?.setAttribute("aria-hidden", "true");
  if (commit && draft) {
    if (baseCrop) {
      draft.crop = {
        x: baseCrop.x + draft.crop.x * baseCrop.width,
        y: baseCrop.y + draft.crop.y * baseCrop.height,
        width: draft.crop.width * baseCrop.width,
        height: draft.crop.height * baseCrop.height,
      };
    }
    state.adjustments.shared.geometry = JSON.parse(JSON.stringify(draft));
    // Crop can be committed while a preceding rotation is still represented
    // by a CSS transform on the old bitmap. Carry that atomic handoff forward
    // to the combined rotation + crop signature; otherwise edit-state sync
    // clears the transform before the matching geometry proxy is ready.
    if (state.geometryTransformHandoffSignature) {
      state.geometryTransformHandoffSignature = geometrySignature();
    }
    // Keep the mounted, pre-crop frame at its current display geometry until a
    // frame for the committed crop is actually presented. Recomputing zoom in
    // this gap uses stale bitmap dimensions and produces a brief zoom jump.
    state.geometryPresentationPending = true;
  }
  syncControlsFromState();
  renderGeometryToolState();
  renderLocalAdjustments();
  if (commit && draft) {
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  }
}

function renderGeometryToolState() {
  const cropActive = state.geometryTool === "crop";
  const rotateActive = state.geometryTool === "rotate";
  els.cropToolToggle?.classList.toggle("active", cropActive);
  els.cropToolToggle?.setAttribute("aria-pressed", String(cropActive));
  els.rotateToolToggle?.classList.toggle("active", rotateActive);
  els.rotateToolToggle?.setAttribute("aria-pressed", String(rotateActive));
  els.cropToolSettings?.classList.toggle("hidden", !cropActive);
  els.rotateToolSettings?.classList.toggle("hidden", !rotateActive);
}

function beginStraightenGesture(event = null) {
  if (event?.type === "keydown" && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
  if (!state.session || state.straightenGestureActive) return;
  state.straightenGestureActive = true;
  if (state.straightenPreviewBaseAngle === null) {
    state.straightenPreviewBaseAngle = Number(state.adjustments.shared.geometry.straighten_angle) || 0;
  }
  showStraightenGrid();
  if (state.rotateDraftGeometry) {
    // The scheduler deliberately retains its last task so ordinary controls
    // can request another settled pass on pointer-up. Straighten is owned by
    // the rotate transaction, so discard that resident task before it can be
    // re-armed with unapplied geometry.
    state.previewScheduler?.cancel();
    window.clearTimeout(state.settleTimer);
    state.settleTimer = null;
  }
  // Make any older authoritative geometry response stale without scheduling a
  // replacement until this gesture finishes.
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
  }
}

function updateStraightenInteractive(value) {
  if (!state.session) return;
  if (!state.straightenGestureActive) beginStraightenGesture();
  const angle = clamp(Number(value) || 0, -45, 45);
  state.adjustments.shared.geometry.straighten_angle = angle;
  syncRangeControlFromState("shared.geometry.straighten_angle", els.cropStraighten);
  updateControlReadouts();
  renderControlState();
  const delta = angle - (state.straightenPreviewBaseAngle ?? angle);
  // Keep the image at its current viewer scale while the user straightens it.
  // The fixed grid is the authoring reference and the image moves behind it;
  // the authoritative render applies the largest valid-pixel crop on release.
  // Scaling to cover the old frame here made portrait images appear to zoom by
  // 25% or more and did not match the backend's variable-aspect safe crop.
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.setProperty("--interactive-straighten-angle", `${-delta}deg`);
    preview?.style.setProperty("--interactive-straighten-scale", "1");
    if (preview) preview.style.clipPath = "";
  });
}

function finishStraightenGesture() {
  if (!state.straightenGestureActive) return;
  state.straightenGestureActive = false;
  hideStraightenGrid();
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else {
    // A settled frame that was already in flight may present immediately after
    // pointer-up. Reassert the transaction's visual transform until Apply or
    // Cancel resolves the draft.
    renderRotateDraftTransform();
  }
}

function showStraightenGrid() {
  const canvas = els.straightenGridOverlay;
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  if (!canvas || !paneRect || !imageRect?.width || !imageRect?.height) return;
  state.straightenPreviewFrameRect = {
    left: imageRect.left,
    top: imageRect.top,
    width: imageRect.width,
    height: imageRect.height,
  };
  Object.assign(canvas.style, {
    left: `${imageRect.left - paneRect.left}px`,
    top: `${imageRect.top - paneRect.top}px`,
    width: `${imageRect.width}px`,
    height: `${imageRect.height}px`,
  });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(imageRect.width * dpr));
  canvas.height = Math.max(1, Math.round(imageRect.height * dpr));
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  const drawLines = (strokeStyle, lineWidth) => {
    context.beginPath();
    for (let index = 1; index < 6; index += 1) {
      const x = Math.round(canvas.width * index / 6) + 0.5;
      const y = Math.round(canvas.height * index / 6) + 0.5;
      context.moveTo(x, 0); context.lineTo(x, canvas.height);
      context.moveTo(0, y); context.lineTo(canvas.width, y);
    }
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth * dpr;
    context.stroke();
  };
  drawLines("rgba(0, 0, 0, .78)", 2.5);
  drawLines("rgba(255, 255, 255, .88)", 1);
  const drawBorder = (strokeStyle, lineWidth) => {
    const inset = lineWidth * dpr / 2;
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth * dpr;
    context.strokeRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2);
  };
  drawBorder("rgba(0, 0, 0, .9)", 4);
  drawBorder("rgba(255, 255, 255, .95)", 1.5);
  canvas.classList.remove("hidden");
}

function hideStraightenGrid() {
  els.straightenGridOverlay?.classList.add("hidden");
}

function clearInteractiveStraightenPreview() {
  if (state.straightenGestureActive || state.straightenPreviewBaseAngle === null) return;
  // A committed rotation can still be represented by a transform on the old
  // bitmap while its authoritative frame is rendering. Clearing straighten
  // here would partially dismantle that atomic geometry handoff.
  if (state.geometryTransformHandoffSignature) return;
  if (state.rotateDraftGeometry) {
    renderRotateDraftTransform();
    return;
  }
  state.straightenPreviewBaseAngle = null;
  state.straightenPreviewFrameRect = null;
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.removeProperty("--interactive-straighten-angle");
    preview?.style.removeProperty("--interactive-straighten-scale");
    if (preview) preview.style.clipPath = "";
  });
}

function rotateGeometry(delta) {
  const geometry = state.adjustments.shared.geometry;
  geometry.rotation = (geometry.rotation + delta + 360) % 360;
  geometry.crop = { x: 0, y: 0, width: 1, height: 1 };
  syncControlsFromState();
  renderRotateDraftTransform({ reflow: true });
  renderGeometryResetState();
  if (!state.rotateDraftGeometry) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  }
}

function updateRotateDraft(key) {
  if (!state.rotateDraftGeometry) return;
  state.adjustments.shared.geometry[key] = !state.adjustments.shared.geometry[key];
  syncControlsFromState();
  renderRotateDraftTransform();
  renderControlState();
}

function renderRotateDraftTransform({ reflow = false } = {}) {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const current = state.adjustments.shared.geometry;
  const visualBase = original;
  const delta = ((Number(current.rotation) || 0) - (Number(visualBase.rotation) || 0) + 360) % 360;
  const flipX = Boolean(current.flip_horizontal) === Boolean(visualBase.flip_horizontal) ? 1 : -1;
  const flipY = Boolean(current.flip_vertical) === Boolean(visualBase.flip_vertical) ? 1 : -1;
  const straightenDelta = (Number(current.straighten_angle) || 0) - (Number(visualBase.straighten_angle) || 0);
  const neutralDraft = delta === 0 && flipX === 1 && flipY === 1 && Math.abs(straightenDelta) < 1e-9;
  if (neutralDraft && !state.geometryTransformHandoffSignature) {
    clearRotateDraftTransformProperties();
    if (reflow) applyZoomGeometry();
    return;
  }
  [els.previewImage, els.previewCanvas, els.chromeProofImage].forEach((preview) => {
    preview?.style.setProperty("--interactive-rotate-angle", `${delta}deg`);
    preview?.style.setProperty("--interactive-flip-x", String(flipX));
    preview?.style.setProperty("--interactive-flip-y", String(flipY));
    preview?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`);
    preview?.style.setProperty("--interactive-straighten-scale", "1");
    if (preview) preview.style.clipPath = "";
  });
  applySourceOverlayGeometryTransform(original, current);
  // Quarter-turn buttons change the draft's layout bounds and need a fit
  // recalculation. Straighten and flip only move the already-sized bitmap; a
  // recalculation on pointer release would size from the proxy rather than the
  // source frame and make the image appear to zoom far out.
  if (reflow) applyZoomGeometry();
}

function applySourceOverlayGeometryTransform(original, current) {
  const delta = ((Number(current.rotation) || 0) - (Number(original.rotation) || 0) + 360) % 360;
  const flipX = Boolean(current.flip_horizontal) === Boolean(original.flip_horizontal) ? 1 : -1;
  const flipY = Boolean(current.flip_vertical) === Boolean(original.flip_vertical) ? 1 : -1;
  const straightenDelta = (Number(current.straighten_angle) || 0) - (Number(original.straighten_angle) || 0);
  [els.previewOverlay, els.localMaskOverlay].forEach((overlay) => {
    overlay?.style.setProperty("--interactive-rotate-angle", `${delta}deg`);
    overlay?.style.setProperty("--interactive-flip-x", String(flipX));
    overlay?.style.setProperty("--interactive-flip-y", String(flipY));
    overlay?.style.setProperty("--interactive-straighten-angle", `${-straightenDelta}deg`);
    overlay?.style.setProperty("--interactive-straighten-scale", "1");
    if (overlay) overlay.style.clipPath = "";
  });
}

function clearRotateDraftTransformProperties() {
  [els.previewImage, els.previewCanvas, els.previewOverlay, els.localMaskOverlay, els.chromeProofImage].forEach((preview) => {
    preview?.style.removeProperty("--interactive-rotate-angle");
    preview?.style.removeProperty("--interactive-flip-x");
    preview?.style.removeProperty("--interactive-flip-y");
    preview?.style.removeProperty("--interactive-straighten-angle");
    preview?.style.removeProperty("--interactive-straighten-scale");
    if (preview) preview.style.clipPath = "";
  });
}

function closeRotateMode(commit) {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const changed = !valuesEqual(original, state.adjustments.shared.geometry);
  state.rotateDraftGeometry = null;
  state.straightenGestureActive = false;
  hideStraightenGrid();
  state.geometryTool = null;
  if (!commit) state.adjustments.shared.geometry = original;
  // If the current bitmap is still the pre-rotation frame, keep its draft
  // transform in place until the matching authoritative frame presents. This
  // prevents Rotate -> Crop from visibly undoing and then redoing rotation
  // while Crop waits for the committed geometry render.
  if (commit && changed) {
    state.geometryTransformHandoffSignature = geometrySignature();
    // The mounted bitmap still represents the geometry from before this
    // transaction. Keep both its CSS size and visual transform atomic until a
    // frame for the committed geometry is actually accepted. This also stops
    // an unrelated adjustment made during the handoff from exposing the old
    // pre-rotation bitmap.
    state.geometryPresentationPending = true;
  } else {
    state.geometryTransformHandoffSignature = null;
    clearRotateDraftTransformProperties();
    clearInteractiveStraightenPreview();
    applyZoomGeometry();
  }
  syncControlsFromState();
  renderGeometryToolState();
  renderControlState();
  if (commit && changed) {
    state.gpuPreparedLane = { hdr: false, sdr: false };
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else if (state.globalEditDirty || state.geometryPresentationPending) {
    debouncePreview(state.currentView);
  }
}

function renderCropOptions() {
  if (!els.cropGuide) return;
  const geometry = activeCropGeometry();
  els.cropGuide.value = state.cropGuide;
  els.cropGridDensity.value = String(state.cropGridDensity);
  els.cropGridDensityValue.textContent = `${state.cropGridDensity}\u00d7${state.cropGridDensity}`;
  els.cropGridDensityRow.classList.toggle("hidden", state.cropGuide !== "grid");
  els.cropRatio.value = geometry.ratio_mode;
  els.cropCustomRatioWidth.value = String(geometry.custom_ratio.width);
  els.cropCustomRatioHeight.value = String(geometry.custom_ratio.height);
  els.customRatioFields?.classList.toggle("hidden", geometry.ratio_mode !== "custom");
  renderCropFrame();
}

function renderCropFrame() {
  if (!state.cropMode || !els.cropBox) return;
  const crop = activeCropGeometry().crop;
  Object.assign(els.cropBox.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` });
  requestAnimationFrame(drawCropGuide);
}

function activeCropGeometry() {
  return state.cropMode && state.cropDraftGeometry
    ? state.cropDraftGeometry
    : state.adjustments.shared.geometry;
}

function isCropDraftControl(path) {
  return path === "shared.geometry.ratio_mode" || path?.startsWith("shared.geometry.custom_ratio.");
}

function updateCropDraftControl(path, value) {
  if (!state.cropDraftGeometry) return;
  const relativePath = path.replace("shared.geometry.", "");
  setValueByPath(state.cropDraftGeometry, relativePath, value);
  if (relativePath.startsWith("custom_ratio.")) {
    const key = relativePath.endsWith("width") ? "width" : "height";
    state.cropDraftGeometry.custom_ratio[key] = Math.max(0.01, Number(value) || 0.01);
  }
  renderCropOptions();
  constrainCropToRatio();
  renderGeometryResetState();
}

function cropAspectRatio() {
  const geometry = activeCropGeometry();
  if (geometry.ratio_mode === "free") return null;
  if (geometry.ratio_mode === "original") {
    const source = state.session?.source;
    if (!source) return null;
    return [90, 270].includes(geometry.rotation) ? source.height / source.width : source.width / source.height;
  }
  if (geometry.ratio_mode === "custom") return geometry.custom_ratio.width / geometry.custom_ratio.height;
  const [width, height] = geometry.ratio_mode.split(":").map(Number);
  return width / height;
}

function cropAuthoringFrameAspect() {
  const geometry = activeCropGeometry();
  const map = currentGeometryCoordinateMap();
  if (map?.fullOutputWidth && map?.fullOutputHeight) return map.fullOutputWidth / map.fullOutputHeight;
  const source = state.session?.source;
  if (!source?.width || !source?.height) {
    return Math.max(0.01, els.cropEditorOverlay.clientWidth / Math.max(1, els.cropEditorOverlay.clientHeight));
  }
  let width = Number(source.width);
  let height = Number(source.height);
  if ([90, 270].includes(geometry.rotation)) [width, height] = [height, width];
  const angle = Math.abs((Number(geometry.straighten_angle) || 0) + (Number(geometry.perspective_rotate) || 0)) * Math.PI / 180;
  const sine = Math.abs(Math.sin(angle));
  const cosine = Math.abs(Math.cos(angle));
  if (sine >= 1e-9) {
    const widthIsLonger = width >= height;
    const sideLong = widthIsLonger ? width : height;
    const sideShort = widthIsLonger ? height : width;
    let safeWidth;
    let safeHeight;
    if (sideShort <= 2 * sine * cosine * sideLong || Math.abs(sine - cosine) < 1e-9) {
      const halfShort = 0.5 * sideShort;
      safeWidth = widthIsLonger ? halfShort / sine : halfShort / cosine;
      safeHeight = widthIsLonger ? halfShort / cosine : halfShort / sine;
    } else {
      const cosineDouble = cosine * cosine - sine * sine;
      safeWidth = (width * cosine - height * sine) / cosineDouble;
      safeHeight = (height * cosine - width * sine) / cosineDouble;
    }
    width = Math.max(1, Math.floor(Math.abs(safeWidth)) - 4);
    height = Math.max(1, Math.floor(Math.abs(safeHeight)) - 4);
  }
  const baseCrop = state.cropEditBaseCrop || geometry.crop || { width: 1, height: 1 };
  return Math.max(0.01, (width * baseCrop.width) / Math.max(1e-6, height * baseCrop.height));
}

function projectOpenNeedsSourceRelink(payload) {
  return payload?.detail?.code === "source_relink_required";
}

function beginProjectOpenStatus(label) {
  const startedAt = performance.now();
  const update = () => {
    const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
    setIndeterminatePreviewMessage(`Opening project · ${label} · ${elapsed.toFixed(1)}s elapsed`);
  };
  update();
  return window.setInterval(update, 250);
}

function sourcePixelFrameDimensions(geometry = state.adjustments?.shared?.geometry) {
  const source = state.session?.source;
  if (!source?.width || !source?.height || !geometry) return null;
  const map = geometryCoordinateMapCache.get(geometryCoordinateMapKey(JSON.stringify(geometry)));
  if (map?.fullOutputWidth && map?.fullOutputHeight) return { width: map.fullOutputWidth, height: map.fullOutputHeight };
  let width = Number(source.width);
  let height = Number(source.height);
  if ([90, 270].includes(Number(geometry.rotation) || 0)) [width, height] = [height, width];
  const angle = Math.abs((Number(geometry.straighten_angle) || 0) + (Number(geometry.perspective_rotate) || 0)) * Math.PI / 180;
  const sine = Math.abs(Math.sin(angle));
  const cosine = Math.abs(Math.cos(angle));
  if (sine >= 1e-9) {
    const widthIsLonger = width >= height;
    const sideLong = widthIsLonger ? width : height;
    const sideShort = widthIsLonger ? height : width;
    let safeWidth;
    let safeHeight;
    if (sideShort <= 2 * sine * cosine * sideLong || Math.abs(sine - cosine) < 1e-9) {
      const halfShort = 0.5 * sideShort;
      safeWidth = widthIsLonger ? halfShort / sine : halfShort / cosine;
      safeHeight = widthIsLonger ? halfShort / cosine : halfShort / sine;
    } else {
      const cosineDouble = cosine * cosine - sine * sine;
      safeWidth = (width * cosine - height * sine) / cosineDouble;
      safeHeight = (height * cosine - width * sine) / cosineDouble;
    }
    width = Math.max(1, Math.floor(Math.abs(safeWidth)) - 4);
    height = Math.max(1, Math.floor(Math.abs(safeHeight)) - 4);
  }
  const crop = geometry.crop || { x: 0, y: 0, width: 1, height: 1 };
  const left = clamp(Math.round(Number(crop.x || 0) * width), 0, Math.max(0, width - 1));
  const top = clamp(Math.round(Number(crop.y || 0) * height), 0, Math.max(0, height - 1));
  const right = clamp(Math.round((Number(crop.x || 0) + Number(crop.width || 1)) * width), left + 1, width);
  const bottom = clamp(Math.round((Number(crop.y || 0) + Number(crop.height || 1)) * height), top + 1, height);
  return { width: right - left, height: bottom - top };
}

function constrainCropToRatio() {
  const ratio = cropAspectRatio();
  if (!ratio) return renderCropFrame();
  const crop = activeCropGeometry().crop;
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  const normalizedRatio = ratio / cropAuthoringFrameAspect();
  let width = crop.width;
  let height = width / normalizedRatio;
  if (height > crop.height) {
    height = crop.height;
    width = height * normalizedRatio;
  }
  const scale = Math.min(1, 1 / Math.max(width, height));
  width *= scale;
  height *= scale;
  crop.width = Math.max(0.02, width);
  crop.height = Math.max(0.02, height);
  crop.x = clamp(centerX - crop.width / 2, 0, 1 - crop.width);
  crop.y = clamp(centerY - crop.height / 2, 0, 1 - crop.height);
  renderCropFrame();
}

function presentScopePayload(payload, { generation, tier, lane, mode, source, metric = null }) {
  state.lastScope = payload;
  els.scopeFreshness.textContent = scopeFreshnessLabel(tier);
  els.scopeFreshness.classList.remove("updating");
  drawHistogram(payload);
  renderDockSummary();
  updateExportAvailability();
  const scopeFingerprint = payload.channels.reduce((total, channel, channelIndex) => {
    const channelWeight = channelIndex + 1;
    const binTotal = (channel.bins || []).reduce(
      (sum, value, index) => sum + value * (index + 1) * channelWeight,
      0,
    );
    const gridTotal = (channel.grid || []).reduce(
      (sum, row, rowIndex) => sum + row.reduce(
        (rowSum, value, columnIndex) => rowSum + value * (rowIndex + columnIndex + 2) * channelWeight,
        0,
      ),
      0,
    );
    return total + binTotal + gridTotal;
  }, 0);
  window.dispatchEvent(new CustomEvent("hdrfinisher:scope-presented", {
    detail: {
      generation,
      tier,
      lane,
      mode,
      source,
      metric,
      peakValue: payload.peak_value,
      fingerprint: scopeFingerprint,
      presentedAt: performance.now(),
    },
  }));
}

function hdrWaveformRec2020(r, g, b) {
  return [
    Math.max(0, 1.0260187082 * r - 0.0221655448 * g - 0.0038531634 * b),
    Math.max(0, -0.0017230808 * r + 1.0023190716 * g - 0.0005959908 * b),
    Math.max(0, -0.0051099278 * r - 0.0216355504 * g + 1.0267454781 * b),
  ];
}

function linearSrgbToScopeSignal(value) {
  const linear = clamp(value, 0, 1);
  return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function buildGpuScopePayload(analysis, { lane, mode, tier, generation, bins, columns, maxNits, scopeRegion = null }) {
  const hdr = lane === "hdr";
  const referenceWhite = projectReferenceWhiteNits();
  const ceiling = maxNits === 1000 ? 1000 : maxNits === 10000 ? 10000 : 4000;
  const channelEntries = state.scopeChannelMode === "luma"
    ? [[3, "Y"]]
    : [[0, "R"], [1, "G"], [2, "B"]];
  if (mode === "vectorscope") return buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins, scopeRegion });
  const binEdges = hdr
    ? Array.from({ length: bins + 1 }, (_, index) => 10 ** (Math.log10(ceiling) * index / bins))
    : Array.from({ length: bins + 1 }, (_, index) => index / bins);
  const counts = channelEntries.map(() => new Int32Array(mode === "waveform" ? bins * columns : bins));
  const bounds = scopeAnalysisBounds(analysis, scopeRegion);
  const lumaValues = new Float32Array(bounds.width * bounds.height);
  let peak = 0;
  let clipped = false;
  let above100 = 0;
  let above203 = 0;
  let above1000 = 0;
  let regionPixel = 0;
  for (let sourceY = bounds.y0; sourceY < bounds.y1; sourceY += 1) {
    for (let sourceX = bounds.x0; sourceX < bounds.x1; sourceX += 1) {
      const pixel = sourceY * analysis.width + sourceX;
      const offset = pixel * 3;
      const r = Math.max(0, analysis.pixels[offset]);
      const g = Math.max(0, analysis.pixels[offset + 1]);
      const b = Math.max(0, analysis.pixels[offset + 2]);
      const scopeRgb = hdr
        ? hdrWaveformRec2020(r, g, b)
        : [linearSrgbToScopeSignal(r), linearSrgbToScopeSignal(g), linearSrgbToScopeSignal(b)];
      const luma = hdr
        ? 0.2627 * scopeRgb[0] + 0.6780 * scopeRgb[1] + 0.0593 * scopeRgb[2]
        : 0.2126 * scopeRgb[0] + 0.7152 * scopeRgb[1] + 0.0722 * scopeRgb[2];
      const scopeLuma = luma;
      const values = hdr
        ? [...scopeRgb, scopeLuma].map((value) => value / 0.18 * referenceWhite)
        : [...scopeRgb, scopeLuma].map((value) => clamp(value, 0, 1));
      lumaValues[regionPixel] = values[3];
      regionPixel += 1;
      peak = Math.max(peak, values[3]);
      if (hdr && analysis.cellPeaks) {
        peak = Math.max(peak, Math.max(0, analysis.cellPeaks[pixel]) / 0.18 * referenceWhite);
      }
      clipped ||= hdr
        ? values[0] >= 10000 || values[1] >= 10000 || values[2] >= 10000
        : r >= 1 || g >= 1 || b >= 1;
      if (hdr) {
        above100 += values[3] > 100 ? 1 : 0;
        above203 += values[3] > 203 ? 1 : 0;
        above1000 += values[3] > 1000 ? 1 : 0;
      }
      const column = Math.min(columns - 1, Math.floor((sourceX - bounds.x0) / bounds.width * columns));
      channelEntries.forEach(([valueIndex], channel) => {
        const value = values[valueIndex];
        const bin = hdr
          ? Math.min(bins - 1, Math.max(0, Math.floor(Math.log10(clamp(value, 1, ceiling)) / Math.log10(ceiling) * bins)))
          : Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
        counts[channel][mode === "waveform" ? bin * columns + column : bin] += 1;
      });
    }
  }
  // TypedArray#sort is numeric and in-place. Avoid boxing every sample into a
  // second JavaScript array during frequent scope refreshes.
  const sortedLuma = lumaValues.sort();
  const percentile = (amount) => sortedLuma[Math.min(sortedLuma.length - 1, Math.round((sortedLuma.length - 1) * amount))] || 0;
  const formatNits = (value) => value >= 1000 ? `${value.toFixed(0)} nit` : value >= 99.995 ? `${value.toFixed(1)} nit` : `${value.toFixed(2)} nit`;
  const sampleCount = Math.max(1, lumaValues.length);
  const stats = hdr ? [
    { label: "Peak", value: formatNits(peak) },
    { label: "P99", value: formatNits(percentile(0.99)) },
    { label: "P95", value: formatNits(percentile(0.95)) },
    { label: "Median", value: formatNits(percentile(0.5)) },
    { label: "% > 100", value: `${(above100 / sampleCount * 100).toFixed(2)}%` },
    { label: "% > 203", value: `${(above203 / sampleCount * 100).toFixed(2)}%` },
    { label: "% > 1000", value: `${(above1000 / sampleCount * 100).toFixed(2)}%` },
  ] : [
    { label: "Peak", value: peak.toFixed(3) },
    { label: "P95", value: percentile(0.95).toFixed(3) },
    { label: "Median", value: percentile(0.5).toFixed(3) },
  ];
  const channels = channelEntries.map(([, name], index) => ({
    name,
    bins: mode === "waveform" ? [] : Array.from(counts[index]),
    grid: mode === "waveform"
      ? Array.from({ length: bins }, (_, row) => Array.from(counts[index].subarray(row * columns, (row + 1) * columns)))
      : [],
  }));
  const populationPeak = robustScopePopulationPeak(counts, mode === "histogram" ? 0.985 : 0.995);
  const hdrGuides = [[1, "1 nit"], [10, "10"], [25, "25"], [50, "50"], [100, "100 controlled white"], [203, "203 standard white"], [400, "400"], [600, "600"], [1000, "1000"], [2000, "2000"], [4000, "4000"], [10000, "10000 PQ limit"]]
    .map(([value, label]) => [value, value === referenceWhite ? `${label} · active` : label]);
  return {
    preview_kind: lane,
    scope_type: hdr ? `reference_nits_${mode}` : `normalized_${mode}`,
    tier,
    generation,
    normalization_peak: populationPeak,
    peak_value: peak,
    clipped,
    x_axis: hdr ? "reference_nits_log10" : "normalized",
    bin_edges: binEdges,
    guides: hdr ? hdrGuides.filter(([value]) => value <= ceiling).map(([value, label]) => ({ value, label })) : [{ value: 0.18, label: mode === "histogram" ? "18% signal" : "18%" }, { value: 0.5, label: mode === "histogram" ? "50% signal" : "50%" }, { value: 1, label: mode === "histogram" ? "100% signal" : "100%" }],
    stats,
    channels,
  };
}

function robustScopePopulationPeak(counts, percentile = 0.995) {
  const positive = [];
  counts.forEach((channel) => channel.forEach((value) => {
    if (value > 0) positive.push(value);
  }));
  if (!positive.length) return 1;
  positive.sort((left, right) => left - right);
  return Math.max(1, positive[Math.floor((positive.length - 1) * percentile)]);
}

function scopeAnalysisBounds(analysis, region = null) {
  if (!region) return { x0: 0, y0: 0, x1: analysis.width, y1: analysis.height, width: analysis.width, height: analysis.height };
  const x0 = Math.min(analysis.width - 1, Math.max(0, Math.floor(region.x * analysis.width)));
  const y0 = Math.min(analysis.height - 1, Math.max(0, Math.floor(region.y * analysis.height)));
  const x1 = Math.min(analysis.width, Math.max(x0 + 1, Math.ceil((region.x + region.width) * analysis.width)));
  const y1 = Math.min(analysis.height, Math.max(y0 + 1, Math.ceil((region.y + region.height) * analysis.height)));
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins, scopeRegion = null }) {
  const hdr = lane === "hdr";
  const referenceWhite = projectReferenceWhiteNits();
  const transfer = vectorscopeTransferLut(hdr, referenceWhite);
  const grid = Array.from({ length: bins }, () => new Int32Array(bins));
  let peak = 0;
  const bounds = scopeAnalysisBounds(analysis, scopeRegion);
  for (let sourceY = bounds.y0; sourceY < bounds.y1; sourceY += 1) {
    for (let sourceX = bounds.x0; sourceX < bounds.x1; sourceX += 1) {
      const pixel = sourceY * analysis.width + sourceX;
      const offset = pixel * 3;
      const workingR = Math.max(0, analysis.pixels[offset]);
      const workingG = Math.max(0, analysis.pixels[offset + 1]);
      const workingB = Math.max(0, analysis.pixels[offset + 2]);
      const sceneY = hdr
        ? 0.2722287 * workingR + 0.6740818 * workingG + 0.0536895 * workingB
        : 0.2126 * workingR + 0.7152 * workingG + 0.0722 * workingB;
      peak = Math.max(peak, hdr ? sceneY / 0.18 * referenceWhite : sceneY);
      if (hdr && analysis.cellPeaks) {
        peak = Math.max(peak, Math.max(0, analysis.cellPeaks[pixel]) / 0.18 * referenceWhite);
      }
      const linearR = hdr ? Math.max(0, 1.0260187082 * workingR - 0.0221655448 * workingG - 0.0038531634 * workingB) : workingR;
      const linearG = hdr ? Math.max(0, -0.0017230808 * workingR + 1.0023190716 * workingG - 0.0005959908 * workingB) : workingG;
      const linearB = hdr ? Math.max(0, -0.0051099278 * workingR - 0.0216355504 * workingG + 1.0267454781 * workingB) : workingB;
      const r = sampleVectorscopeTransfer(transfer, linearR);
      const g = sampleVectorscopeTransfer(transfer, linearG);
      const b = sampleVectorscopeTransfer(transfer, linearB);
      const [kr, kg, kb] = hdr ? [0.2627, 0.6780, 0.0593] : [0.2126, 0.7152, 0.0722];
      const y = kr * r + kg * g + kb * b;
      const u = clamp(0.5 + (b - y) / (2 * (1 - kb)), 0, 1);
      const v = clamp(0.5 + (r - y) / (2 * (1 - kr)), 0, 1);
      grid[Math.min(bins - 1, Math.floor(v * bins))][Math.min(bins - 1, Math.floor(u * bins))] += 1;
    }
  }
  const normalizationPeak = robustScopePopulationPeak(grid);
  return {
    preview_kind: lane,
    scope_type: "vectorscope",
    tier,
    generation,
    normalization_peak: normalizationPeak,
    peak_value: peak,
    clipped: peak >= (hdr ? 10000 : 1),
    x_axis: "chroma_uv",
    bin_edges: Array.from({ length: bins + 1 }, (_, index) => index / bins),
    guides: [],
    stats: [{ label: "Peak", value: hdr ? `${peak.toFixed(1)} nit` : peak.toFixed(3) }],
    channels: [{ name: "Y", bins: [], grid: grid.map((row) => Array.from(row)) }],
  };
}

function vectorscopeTransferLut(hdr, referenceWhite) {
  const key = `${hdr ? "pq" : "srgb"}:${hdr ? referenceWhite : 1}`;
  const cached = vectorscopeTransferLutCache.get(key);
  if (cached) return cached;
  const size = 4096;
  const maximumLinear = hdr ? 10000 * 0.18 / Math.max(1, referenceWhite) : 1;
  const values = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const linear = maximumLinear * index / (size - 1);
    if (hdr) {
      const m1 = 2610 / 16384;
      const m2 = 2523 / 32;
      const c1 = 3424 / 4096;
      const c2 = 2413 / 128;
      const c3 = 2392 / 128;
      const lm1 = Math.pow(linear / maximumLinear, m1);
      values[index] = Math.pow((c1 + c2 * lm1) / (1 + c3 * lm1), m2);
    } else {
      values[index] = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    }
  }
  const result = { values, maximumLinear };
  vectorscopeTransferLutCache.set(key, result);
  return result;
}

function sampleVectorscopeTransfer(transfer, linear) {
  const position = clamp(linear / transfer.maximumLinear, 0, 1) * (transfer.values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(transfer.values.length - 1, lower + 1);
  const mix = position - lower;
  return transfer.values[lower] + (transfer.values[upper] - transfer.values[lower]) * mix;
}

function beginCropDrag(event) {
  if (!state.cropMode || event.button !== 0) return;
  event.preventDefault();
  const rect = els.cropEditorOverlay.getBoundingClientRect();
  state.cropDrag = { handle: event.target.dataset.cropHandle || "move", startX: event.clientX, startY: event.clientY, rect, crop: { ...activeCropGeometry().crop } };
  els.cropBox.setPointerCapture?.(event.pointerId);
}

function moveCropDrag(event) {
  const drag = state.cropDrag;
  if (!drag) return;
  const dx = (event.clientX - drag.startX) / Math.max(1, drag.rect.width);
  const dy = (event.clientY - drag.startY) / Math.max(1, drag.rect.height);
  const next = { ...drag.crop };
  if (drag.handle === "move") {
    next.x = Math.max(0, Math.min(1 - next.width, drag.crop.x + dx));
    next.y = Math.max(0, Math.min(1 - next.height, drag.crop.y + dy));
  } else {
    if (drag.handle.includes("w")) { const right = drag.crop.x + drag.crop.width; next.x = Math.max(0, Math.min(right - 0.02, drag.crop.x + dx)); next.width = right - next.x; }
    if (drag.handle.includes("e")) next.width = Math.max(0.02, Math.min(1 - drag.crop.x, drag.crop.width + dx));
    if (drag.handle.includes("n")) { const bottom = drag.crop.y + drag.crop.height; next.y = Math.max(0, Math.min(bottom - 0.02, drag.crop.y + dy)); next.height = bottom - next.y; }
    if (drag.handle.includes("s")) next.height = Math.max(0.02, Math.min(1 - drag.crop.y, drag.crop.height + dy));
    const ratio = cropAspectRatio();
    if (ratio) constrainDraggedCrop(next, drag, ratio);
  }
  if (!state.cropDraftGeometry) return;
  state.cropDraftGeometry.crop = next;
  renderCropFrame();
  renderGeometryResetState();
}

function endCropDrag() { state.cropDrag = null; }

function constrainDraggedCrop(next, drag, ratio) {
  const normalizedRatio = ratio / cropAuthoringFrameAspect();
  const source = drag.crop;
  const anchorX = drag.handle.includes("w") ? source.x + source.width : source.x;
  const anchorY = drag.handle.includes("n") ? source.y + source.height : source.y;
  let width = next.width;
  let height = width / normalizedRatio;
  if (!drag.handle.includes("e") && !drag.handle.includes("w")) {
    height = next.height;
    width = height * normalizedRatio;
  }
  width = Math.max(0.02, Math.min(width, drag.handle.includes("w") ? anchorX : 1 - anchorX));
  height = Math.max(0.02, Math.min(height, drag.handle.includes("n") ? anchorY : 1 - anchorY));
  if (height * normalizedRatio > width) height = width / normalizedRatio;
  else width = height * normalizedRatio;
  next.width = width;
  next.height = height;
  next.x = drag.handle.includes("w") ? anchorX - width : anchorX;
  next.y = drag.handle.includes("n") ? anchorY - height : anchorY;
}

function drawCropGuide() {
  if (!state.cropMode || !els.cropGuideCanvas) return;
  const canvas = els.cropGuideCanvas;
  const width = Math.max(1, Math.round(els.cropBox.clientWidth * (window.devicePixelRatio || 1)));
  const height = Math.max(1, Math.round(els.cropBox.clientHeight * (window.devicePixelRatio || 1)));
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height); context.strokeStyle = "rgba(255,255,255,.82)"; context.lineWidth = window.devicePixelRatio || 1;
  const line = (x1, y1, x2, y2) => { context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke(); };
  if (state.cropGuide === "x") { line(0, 0, width, height); line(width, 0, 0, height); return; }
  if (state.cropGuide === "diagonals") {
    const short = Math.min(width, height);
    line(0, 0, short, short); line(width, 0, width - short, short);
    line(0, height, short, height - short); line(width, height, width - short, height - short);
    return;
  }
  let positions = [];
  if (state.cropGuide === "thirds") positions = [1 / 3, 2 / 3];
  if (state.cropGuide === "golden") positions = [0.382, 0.618];
  if (state.cropGuide === "grid") positions = Array.from({ length: state.cropGridDensity - 1 }, (_, index) => (index + 1) / state.cropGridDensity);
  positions.forEach((position) => { line(position * width, 0, position * width, height); line(0, position * height, width, position * height); });
}

function bindColorWheels() {
  document.querySelectorAll(".color-wheel-pad").forEach((pad) => {
    const update = (event) => {
      const rect = pad.getBoundingClientRect();
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      const radius = Math.min(1, Math.hypot(dx, dy) / Math.max(1, rect.width / 2));
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      setValueByPath(state.adjustments, `current.color_grading.${wheel}.hue`, hue);
      setValueByPath(state.adjustments, `current.color_grading.${wheel}.saturation`, radius * 100);
      syncControlsFromState();
      invalidatePreview(state.currentView);
      debouncePreview(state.currentView);
    };
    pad.addEventListener("pointerdown", (event) => { pad.setPointerCapture(event.pointerId); update(event); });
    pad.addEventListener("pointermove", (event) => { if (pad.hasPointerCapture(event.pointerId)) update(event); });
    pad.addEventListener("keydown", (event) => {
      if (["Delete", "Backspace", "Home"].includes(event.key)) {
        event.preventDefault();
        const wheel = pad.closest("[data-wheel]").dataset.wheel;
        setValueByPath(state.adjustments, `current.color_grading.${wheel}`, { hue: 0, saturation: 0, luminance_ev: 0 });
        syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      const base = `current.color_grading.${wheel}`;
      const step = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        setValueByPath(state.adjustments, `${base}.hue`, (getValueByPath(state.adjustments, `${base}.hue`) + direction * step + 360) % 360);
      } else {
        const direction = event.key === "ArrowUp" ? 1 : -1;
        setValueByPath(state.adjustments, `${base}.saturation`, Math.max(0, Math.min(100, getValueByPath(state.adjustments, `${base}.saturation`) + direction * step)));
      }
      syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
    });
    pad.addEventListener("dblclick", () => {
      const wheel = pad.closest("[data-wheel]").dataset.wheel;
      setValueByPath(state.adjustments, `current.color_grading.${wheel}`, { hue: 0, saturation: 0, luminance_ev: 0 });
      syncControlsFromState(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
    });
  });
}

function renderColorWheels() {
  document.querySelectorAll(".grading-wheel").forEach((container) => {
    const wheel = state.adjustments[state.currentView]?.color_grading?.[container.dataset.wheel];
    const puck = container.querySelector(".color-wheel-puck");
    if (!wheel || !puck) return;
    const radius = Math.min(100, Math.max(0, wheel.saturation)) * 0.45;
    const angle = wheel.hue * Math.PI / 180;
    puck.style.left = `${50 + Math.cos(angle) * radius}%`;
    puck.style.top = `${50 + Math.sin(angle) * radius}%`;
  });
}

function bindVignetteCenter() {
  const commitNumeric = () => {
    state.adjustments[state.currentView].vignette.center_x = Math.max(0, Math.min(1, Number(els.vignetteCenterX.value) / 100));
    state.adjustments[state.currentView].vignette.center_y = Math.max(0, Math.min(1, Number(els.vignetteCenterY.value) / 100));
    renderVignetteCenter(); invalidatePreview(state.currentView); debouncePreview(state.currentView);
  };
  els.vignetteCenterX?.addEventListener("change", commitNumeric);
  els.vignetteCenterY?.addEventListener("change", commitNumeric);
  els.vignettePickCenter?.addEventListener("click", () => {
    state.vignettePickCenter = !state.vignettePickCenter;
    renderVignetteCenter();
  });
  const movePointerGesture = (event) => {
    const gesture = state.vignetteCenterGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateVignetteCenter(
      (event.clientX - gesture.grabOffsetX - gesture.rect.left) / gesture.rect.width,
      (event.clientY - gesture.grabOffsetY - gesture.rect.top) / gesture.rect.height,
      gesture.lane,
    );
  };
  const finishPointerGesture = (event) => {
    const gesture = state.vignetteCenterGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    state.vignetteCenterGesture = null;
    window.removeEventListener("pointermove", movePointerGesture);
    window.removeEventListener("pointerup", finishPointerGesture);
    window.removeEventListener("pointercancel", finishPointerGesture);
    renderVignetteCenter();
    invalidatePreview(gesture.lane);
    debouncePreview(gesture.lane);
    state.previewScheduler?.endInteraction();
  };
  els.vignetteCenterHandle?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    const rect = activePreviewElement()?.getBoundingClientRect();
    const vignette = state.adjustments[state.currentView]?.vignette;
    if (!rect?.width || !rect?.height || !vignette) return;
    event.preventDefault();
    state.vignetteCenterGesture = {
      pointerId: event.pointerId,
      lane: state.currentView,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      grabOffsetX: event.clientX - (rect.left + rect.width * vignette.center_x),
      grabOffsetY: event.clientY - (rect.top + rect.height * vignette.center_y),
    };
    state.previewScheduler?.beginInteraction();
    window.addEventListener("pointermove", movePointerGesture);
    window.addEventListener("pointerup", finishPointerGesture);
    window.addEventListener("pointercancel", finishPointerGesture);
  });
  els.vignetteCenterHandle?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const vignette = state.adjustments[state.currentView].vignette;
    const step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft") vignette.center_x -= step;
    if (event.key === "ArrowRight") vignette.center_x += step;
    if (event.key === "ArrowUp") vignette.center_y -= step;
    if (event.key === "ArrowDown") vignette.center_y += step;
    updateVignetteCenter(vignette.center_x, vignette.center_y);
  });
}

function updateVignetteCenter(x, y, lane = state.currentView) {
  const vignette = state.adjustments[lane].vignette;
  vignette.center_x = Math.max(0, Math.min(1, x)); vignette.center_y = Math.max(0, Math.min(1, y));
  if (lane === state.currentView) renderVignetteCenter();
  invalidatePreview(lane); debouncePreview(lane);
}

function renderVignetteCenter() {
  if (!els.vignetteCenterHandle) return;
  const vignette = state.adjustments[state.currentView]?.vignette || defaultVignette();
  els.vignetteCenterX.value = String(Math.round(vignette.center_x * 100));
  els.vignetteCenterY.value = String(Math.round(vignette.center_y * 100));
  const preview = activePreviewElement();
  const paneRect = els.previewPrimaryPane?.getBoundingClientRect();
  const imageRect = preview?.getBoundingClientRect();
  if (paneRect && imageRect) {
    els.vignetteCenterHandle.style.left = `${imageRect.left - paneRect.left + imageRect.width * vignette.center_x}px`;
    els.vignetteCenterHandle.style.top = `${imageRect.top - paneRect.top + imageRect.height * vignette.center_y}px`;
  }
  const groupOpen = !document.querySelector(".vignette-group")?.classList.contains("collapsed");
  const visible = state.activeWorkflow === "grade" && (state.vignettePickCenter || groupOpen);
  els.vignetteCenterHandle.classList.toggle("hidden", !visible);
  els.vignettePickCenter?.setAttribute("aria-pressed", String(state.vignettePickCenter));
  const dark = vignette.amount < 0;
  els.vignetteHighlightProtectionRow?.classList.toggle("control-disabled", !dark);
  els.vignetteHighlightProtectionRow?.querySelector("input")?.toggleAttribute("disabled", !dark);
}

function resolveAdjustmentPath(path) {
  return path?.startsWith("current.") ? `${state.currentView}.${path.slice("current.".length)}` : path;
}

function prepareSdrMatchGrainOverride() {
  const match = state.editDocument?.sdr_match;
  if (!match?.active || match.grain_source !== "captured_hdr") return false;
  const captured = match.captured_hdr_adjustments?.film_look;
  const target = state.adjustments?.sdr?.film_look;
  if (!captured || !target) return false;
  SDR_MATCH_GRAIN_FIELDS.forEach((field) => {
    target[field] = JSON.parse(JSON.stringify(captured[field]));
  });
  match.grain_source = "sdr_override";
  state.sdrMatchGrainOverridePending = true;
  return true;
}

function commitAdjustmentValue(path, value, { manual = false } = {}) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (manual) {
    beginGlobalDetailInteraction(resolvedPath);
    state.previewScheduler?.beginInteraction();
  }
  const grainField = resolvedPath.startsWith("sdr.film_look.")
    ? resolvedPath.slice("sdr.film_look.".length)
    : null;
  if (grainField && SDR_MATCH_GRAIN_FIELDS.includes(grainField)) prepareSdrMatchGrainOverride();
  setValueByPath(state.adjustments, path, value);
  // Only one film look diagnostic map can be on screen at a time.
  if (value === true && /film_look\.(halation|grain)_view_map$/.test(resolvedPath)) {
    const companion = resolvedPath.endsWith("halation_view_map") ? "grain_view_map" : "halation_view_map";
    setValueByPath(state.adjustments, resolvedPath.replace(/[^.]+$/, companion), false);
    syncControlsFromState();
  }
  if (resolvedPath.startsWith("hdr.highlight_compression_")) normalizeHighlightCompressionControls(resolvedPath);
  if (resolvedPath.startsWith("sdr.highlight_compression_")) normalizeSdrHighlightCompressionControls(resolvedPath);
  if (path === "shared.false_color_band_anchor" || path === "shared.false_color_ceiling_nits") {
    renderOverlayPresetNote();
    drawCurveEditor();
    renderLocalAdjustments();
  }
  if (resolvedPath.includes(".tone_equalizer_")) drawToneEqualizerEditor(resolvedPath.startsWith("sdr.") ? "sdr" : "hdr");
  syncRangeControlFromState(path);
  updateControlReadouts();
  renderControlState();
  if (path.startsWith("shared.overlay_")) {
    markGlobalEditDirty();
    if (path === "shared.overlay_mode") refreshOverlayAndScopesImmediately();
    else debounceOverlayAndScopes();
  } else if (resolvedPath.startsWith("shared.geometry")) {
    renderCropOptions();
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else {
    const lane = resolvedPath.startsWith("sdr.") ? "sdr" : "hdr";
    invalidatePreview(lane);
    debouncePreview(lane);
  }
  if (manual) state.previewScheduler?.endInteraction();
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else {
      if (control.type === "range") syncRangeControlFromState(control.dataset.path, control);
      else if (control.type === "number" && /color_grading\..+\.(hue|saturation)$/.test(control.dataset.path)) {
        control.value = String(Math.round(Number(value)));
      } else control.value = String(value);
    }
  });
  updateControlReadouts();
  syncToneEqualizerControls();
  renderCropOptions();
  renderPerspectiveControls();
  renderColorWheels();
  renderVignetteCenter();
}

function normalizeHighlightCompressionControls(changedPath) {
  const hdr = state.adjustments.hdr;
  if (hdr.highlight_compression_target_nits <= hdr.highlight_compression_start_nits) {
    if (changedPath.endsWith("start_nits")) {
      hdr.highlight_compression_target_nits = Math.min(10000, hdr.highlight_compression_start_nits + 1);
    } else {
      hdr.highlight_compression_start_nits = Math.max(1, hdr.highlight_compression_target_nits - 1);
    }
  }
  for (const path of ["hdr.highlight_compression_start_nits", "hdr.highlight_compression_target_nits"]) {
    syncRangeControlFromState(path);
  }
  if (changedPath.endsWith("peak_measurement") || changedPath.endsWith("manual_peak_nits") || changedPath.endsWith("color_handling")) {
    syncHighlightCompressionSourcePeak();
  }
}

function syncHighlightCompressionSourcePeak() {
  const hdr = state.adjustments.hdr;
  if (!hdr) return;
  if (hdr.highlight_compression_peak_measurement === "manual") {
    hdr.highlight_compression_source_peak_nits = Number(hdr.highlight_compression_manual_peak_nits) || 1000;
    return;
  }
  const analysis = state.session?.analysis;
  const colorHandling = hdr.highlight_compression_color_handling || "smooth_rolloff";
  let linear;
  if (colorHandling === "smooth_rolloff") {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_bt2020_linear ?? analysis?.peak_bt2020_linear ?? analysis?.robust_peak_linear ?? analysis?.peak_linear)
      : (analysis?.peak_bt2020_linear ?? analysis?.peak_linear);
  } else if (colorHandling === "path_to_white") {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_linear ?? analysis?.peak_linear)
      : analysis?.peak_linear;
  } else {
    linear = hdr.highlight_compression_peak_measurement === "robust"
      ? (analysis?.robust_peak_luma_linear ?? analysis?.peak_luma_linear ?? analysis?.peak_linear)
      : (analysis?.peak_luma_linear ?? analysis?.peak_linear);
  }
  if (Number.isFinite(Number(linear))) {
    hdr.highlight_compression_source_peak_nits = Math.max(1, Number(linear) * projectReferenceWhiteNits() / 0.18);
  }
}

function toneAdjustedHighlightPeakNits(hdr) {
  const referenceWhite = projectReferenceWhiteNits();
  let peakLinear = Math.max(1, Number(hdr.highlight_compression_source_peak_nits) || 1000) * 0.18 / referenceWhite;
  if (hdr.tone_section_enabled === false) return Math.max(1, peakLinear * referenceWhite / 0.18);
  peakLinear *= 2 ** (Number(hdr.exposure) || 0);
  const shadowLift = Number(hdr.shadow_lift) || 0;
  if (shadowLift !== 0) {
    const liftFactor = clamp(shadowLift * (1 - clamp(peakLinear, 0, 1)), Number.NEGATIVE_INFINITY, 1);
    peakLinear *= 1 + liftFactor;
  }
  const contrast = Number(hdr.contrast) || 0;
  if (contrast !== 0 && peakLinear > 0.00000001) {
    const pivot = Math.max(Number(hdr.contrast_pivot) || 0.1845, 0.000001);
    const stops = Math.log2(Math.max(peakLinear, 0.00000001) / pivot);
    peakLinear = pivot * (2 ** clamp(stops * (2 ** contrast), -32, 32));
  }
  return Math.max(1, peakLinear * referenceWhite / 0.18);
}

function peakFitCurveInfo(hdr) {
  const start = Math.max(1, Number(hdr.highlight_compression_start_nits) || 400);
  const target = Math.max(start + 1, Number(hdr.highlight_compression_target_nits) || 1000);
  const peak = Math.max(target, toneAdjustedHighlightPeakNits(hdr));
  const startStop = Math.log2(start);
  const targetStop = Math.log2(target);
  const peakStop = Math.log2(peak);
  const detail = clamp((Number(hdr.highlight_compression_peak_detail) || 0) / 100, 0, 1);
  const bias = clamp((Number(hdr.highlight_compression_bias) || 0) / 100, -1, 1) * 0.6;
  const requiredRatio = clamp((1 / (1 + bias) + detail / (1 - bias)) / 3, 0.001, 0.95);
  const requestedRatio = (targetStop - startStop) / Math.max(peakStop - startStop, 0.000001);
  const effectiveStartStop = requestedRatio < requiredRatio
    ? (targetStop - requiredRatio * peakStop) / (1 - requiredRatio)
    : startStop;
  return { start, target, peak, startStop, targetStop, peakStop, detail, bias, effectiveStartStop };
}

function mapHighlightNits(inputNits, hdr) {
  const mode = hdr.highlight_compression_mode || "peak_fit";
  if (mode === "off") return inputNits;
  if (mode === "soft_ceiling") {
    const softness = Number(hdr.highlight_compression_softness) || 0;
    if (softness <= 0) return inputNits;
    const start = Number(hdr.highlight_compression_start_nits) || 400;
    const target = Math.max(start + 1, Number(hdr.highlight_compression_target_nits) || 1000);
    if (inputNits <= start) return inputNits;
    const normalized = (inputNits - start) / (target - start);
    const exponent = 2 ** (5 * (1 - clamp(softness / 100, 0, 1)));
    const compressed = normalized <= 1
      ? normalized / ((1 + normalized ** exponent) ** (1 / exponent))
      : 1 / ((1 + (1 / normalized) ** exponent) ** (1 / exponent));
    const position = clamp(softness / 10, 0, 1);
    const activation = position * position * (3 - 2 * position);
    return start + ((inputNits - start) + activation * ((target - start) * compressed - (inputNits - start)));
  }
  const info = peakFitCurveInfo(hdr);
  if (inputNits <= 2 ** info.effectiveStartStop) return inputNits;
  const u = clamp((Math.log2(inputNits) - info.effectiveStartStop) / Math.max(info.peakStop - info.effectiveStartStop, 0.000001), 0, 1);
  const w = clamp(u + info.bias * u * (1 - u), 0, 1);
  const span = info.targetStop - info.effectiveStartStop;
  const m0 = (info.peakStop - info.effectiveStartStop) / Math.max(span * (1 + info.bias), 0.000001);
  const m1 = info.detail * (info.peakStop - info.effectiveStartStop) / Math.max(span * (1 - info.bias), 0.000001);
  const mapped = w * (1 - w) * (1 - w) * m0 + w * w * (3 - 2 * w) + w * w * (w - 1) * m1;
  return 2 ** (info.effectiveStartStop + span * mapped);
}

function renderHighlightCompressionControls() {
  const hdr = state.adjustments.hdr;
  if (!hdr || !els.highlightCompressionGraph) return;
  syncHighlightCompressionSourcePeak();
  const mode = hdr.highlight_compression_mode || "peak_fit";
  document.querySelector('[data-control-path="hdr.highlight_compression_softness"]')?.toggleAttribute("hidden", mode !== "soft_ceiling");
  document.querySelector('[data-control-path="hdr.highlight_compression_peak_detail"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="hdr.highlight_compression_color_handling"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="hdr.highlight_compression_manual_peak_nits"]')?.toggleAttribute("hidden", hdr.highlight_compression_peak_measurement !== "manual");

  const canvas = els.highlightCompressionGraph;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 35, right: 9, top: 9, bottom: 24 };
  const sourcePeak = Math.max(1000, mode === "peak_fit"
    ? toneAdjustedHighlightPeakNits(hdr)
    : (Number(hdr.highlight_compression_source_peak_nits) || 1000) * (2 ** (Number(hdr.exposure) || 0)));
  const maximum = Math.max(10000, sourcePeak, Number(hdr.highlight_compression_target_nits) * 1.5);
  const minimum = 10;
  const xFor = (value) => pad.left + (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (height - pad.top - pad.bottom);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#343d41";
  context.fillStyle = "#93a0a4";
  context.font = "9px monospace";
  for (const tick of [10, 100, 1000, 10000, 100000]) {
    if (tick > maximum) continue;
    context.beginPath();
    context.moveTo(xFor(tick), pad.top);
    context.lineTo(xFor(tick), height - pad.bottom);
    context.moveTo(pad.left, yFor(tick));
    context.lineTo(width - pad.right, yFor(tick));
    context.stroke();
    context.fillText(tick >= 1000 ? `${tick / 1000}k` : String(tick), xFor(tick) - 6, height - 8);
  }
  context.setLineDash([4, 3]);
  context.strokeStyle = "#6d777b";
  context.beginPath(); context.moveTo(xFor(minimum), yFor(minimum)); context.lineTo(xFor(maximum), yFor(maximum)); context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "#68d7ed";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 160; index += 1) {
    const input = minimum * ((maximum / minimum) ** (index / 160));
    const x = xFor(input);
    const y = yFor(mapHighlightNits(input, hdr));
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  context.lineWidth = 1;
  if (mode === "off") {
    els.highlightCompressionSummary.dataset.tooltip = "Compression is off. The ultraviolet identity line leaves highlights unchanged.";
  } else if (mode === "soft_ceiling") {
    els.highlightCompressionSummary.dataset.tooltip = `Soft Ceiling approaches ${Math.round(hdr.highlight_compression_target_nits)} nit without a hard peak anchor.`;
  } else {
    const info = peakFitCurveInfo(hdr);
    const effective = 2 ** info.effectiveStartStop;
    const adjusted = effective < Number(hdr.highlight_compression_start_nits) * 0.99;
    const colorNote = hdr.highlight_compression_color_handling === "path_to_white"
      ? "; RGB channels are grouped and converge to neutral white"
      : hdr.highlight_compression_color_handling === "preserve_color"
        ? "; color ratios are preserved"
        : "; Rec.2020 channels roll off smoothly toward white";
    els.highlightCompressionSummary.dataset.tooltip = `Peak Fit anchors the measured source peak near ${Math.round(info.target)} nit at the Highlights stage${adjusted ? `; the curve fit widens the shoulder to ${Math.round(effective)} nit` : ""}${colorNote}. Later modules can change the final scoped peak.`;
  }
}

function initializeBoundedTooltips() {
  const selector = ".help-tip[data-tooltip], .help-tip[data-tip], .tooltip-trigger[data-tooltip], .group-toggle[data-tooltip], .disclosure-trigger[data-tooltip]";
  if (!document.querySelector(selector)) return;
  const tooltip = document.createElement("div");
  tooltip.id = "bounded-help-tooltip";
  tooltip.className = "bounded-help-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  let activeTrigger = null;
  let pendingTrigger = null;
  let showTimer = 0;

  const tooltipText = (trigger) => trigger?.dataset.tooltip || trigger?.dataset.tip || "";
  const hide = () => {
    window.clearTimeout(showTimer);
    showTimer = 0;
    pendingTrigger = null;
    activeTrigger = null;
    tooltip.classList.remove("visible");
    tooltip.hidden = true;
  };
  const position = () => {
    if (!activeTrigger || tooltip.hidden || !activeTrigger.isConnected) return hide();
    const visualViewport = window.visualViewport;
    const viewport = {
      left: visualViewport?.offsetLeft || 0,
      top: visualViewport?.offsetTop || 0,
      width: visualViewport?.width || window.innerWidth,
      height: visualViewport?.height || window.innerHeight,
    };
    const margin = 8;
    const gap = 7;
    const triggerRect = activeTrigger.getBoundingClientRect();
    tooltip.style.maxWidth = `${Math.max(80, viewport.width - margin * 2)}px`;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const tooltipRect = tooltip.getBoundingClientRect();
    const minimumLeft = viewport.left + margin;
    const maximumLeft = viewport.left + viewport.width - margin - tooltipRect.width;
    const left = clamp(
      triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
      minimumLeft,
      Math.max(minimumLeft, maximumLeft),
    );
    const minimumTop = viewport.top + margin;
    const maximumTop = viewport.top + viewport.height - margin - tooltipRect.height;
    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - gap - tooltipRect.height;
    const preferredTop = below <= maximumTop ? below : above;
    const top = clamp(preferredTop, minimumTop, Math.max(minimumTop, maximumTop));
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };
  const show = (trigger) => {
    const text = tooltipText(trigger);
    if (!text || !trigger.isConnected) return hide();
    activeTrigger = trigger;
    pendingTrigger = null;
    tooltip.textContent = text;
    tooltip.hidden = false;
    position();
    tooltip.classList.add("visible");
  };
  const schedule = (trigger) => {
    window.clearTimeout(showTimer);
    if (activeTrigger === trigger) {
      tooltip.textContent = tooltipText(trigger);
      position();
      return;
    }
    pendingTrigger = trigger;
    showTimer = window.setTimeout(() => show(trigger), 600);
  };
  const triggerFromEvent = (event) => event.target instanceof Element
    ? event.target.closest(selector)
    : null;

  document.addEventListener("pointerover", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger && !trigger.contains(event.relatedTarget)) schedule(trigger);
  });
  document.addEventListener("pointerout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger.contains(event.relatedTarget) || document.activeElement === trigger) return;
    if (activeTrigger === trigger || pendingTrigger === trigger) hide();
  });
  document.addEventListener("focusin", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger) schedule(trigger);
  });
  document.addEventListener("focusout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger.matches(":hover")) return;
    if (activeTrigger === trigger || pendingTrigger === trigger) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (activeTrigger || pendingTrigger)) hide();
  });
  document.addEventListener("scroll", position, true);
  window.addEventListener("resize", position);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
}

function normalizeSdrHighlightCompressionControls(changedPath) {
  const sdr = state.adjustments.sdr;
  if (!sdr) return;
  if (changedPath.endsWith("peak_measurement") || changedPath.endsWith("manual_peak_percent") || changedPath.endsWith("color_handling")) {
    syncSdrHighlightCompressionSourcePeak();
  }
}

function syncSdrHighlightCompressionSourcePeak() {
  const sdr = state.adjustments.sdr;
  if (!sdr) return;
  if (sdr.highlight_compression_peak_measurement === "manual") {
    sdr.highlight_compression_source_peak_percent = Number(sdr.highlight_compression_manual_peak_percent) || 100;
    return;
  }
  const authored = state.editDocument?.source?.luminance?.sdr_rendition === "authored" && sdr.use_authored_base !== false;
  const analysis = state.session?.analysis;
  let linear = sdr.highlight_compression_peak_measurement === "robust"
    ? (analysis?.robust_peak_linear ?? analysis?.peak_linear)
    : analysis?.peak_linear;
  let percent = authored ? 100 : Number(linear) * (100 / 203) / 0.18 * 100;
  if (Number.isFinite(percent)) {
    sdr.highlight_compression_source_peak_percent = Math.max(1, percent);
  }
}

function sdrHighlightCurveAdapter(sdr) {
  return {
    tone_section_enabled: false,
    highlight_compression_mode: sdr.highlight_compression_mode,
    highlight_compression_start_nits: Number(sdr.highlight_compression_start_percent) || 50,
    highlight_compression_target_nits: 100,
    highlight_compression_softness: sdr.highlight_compression_softness,
    highlight_compression_source_peak_nits: (Number(sdr.highlight_compression_source_peak_percent) || 100)
      * (sdr.tone_section_enabled === false ? 1 : 2 ** (Number(sdr.exposure) || 0)),
    highlight_compression_peak_detail: sdr.highlight_compression_peak_detail,
    highlight_compression_bias: sdr.highlight_compression_bias,
  };
}

function renderSdrHighlightCompressionControls() {
  const sdr = state.adjustments.sdr;
  const canvas = els.sdrHighlightCompressionGraph;
  if (!sdr || !canvas) return;
  syncSdrHighlightCompressionSourcePeak();
  const mode = sdr.highlight_compression_mode || "peak_fit";
  document.querySelector('[data-control-path="sdr.highlight_compression_softness"]')?.toggleAttribute("hidden", mode !== "soft_ceiling");
  document.querySelector('[data-control-path="sdr.highlight_compression_peak_detail"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="sdr.highlight_compression_color_handling"]')?.toggleAttribute("hidden", mode !== "peak_fit");
  document.querySelector('[data-control-path="sdr.highlight_compression_manual_peak_percent"]')?.toggleAttribute("hidden", sdr.highlight_compression_peak_measurement !== "manual");

  const curve = sdrHighlightCurveAdapter(sdr);
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const pad = { left: 35, right: 9, top: 9, bottom: 24 };
  const sourcePeak = Math.max(100, Number(curve.highlight_compression_source_peak_nits) || 100);
  const maximum = Math.max(1000, sourcePeak * 1.25);
  const minimum = 1;
  const xFor = (value) => pad.left + (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (width - pad.left - pad.right);
  const yFor = (value) => height - pad.bottom - (Math.log10(clamp(value, minimum, maximum)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum)) * (height - pad.top - pad.bottom);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#343d41";
  context.fillStyle = "#93a0a4";
  context.font = "9px monospace";
  for (const tick of [1, 10, 100, 1000, 10000, 100000]) {
    if (tick > maximum) continue;
    context.beginPath();
    context.moveTo(xFor(tick), pad.top); context.lineTo(xFor(tick), height - pad.bottom);
    context.moveTo(pad.left, yFor(tick)); context.lineTo(width - pad.right, yFor(tick)); context.stroke();
    context.fillText(tick >= 1000 ? `${tick / 1000}k%` : `${tick}%`, xFor(tick) - 7, height - 8);
  }
  context.setLineDash([4, 3]);
  context.strokeStyle = "#6d777b";
  context.beginPath(); context.moveTo(xFor(minimum), yFor(minimum)); context.lineTo(xFor(maximum), yFor(maximum)); context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "#68d7ed";
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 160; index += 1) {
    const input = minimum * ((maximum / minimum) ** (index / 160));
    const x = xFor(input);
    const y = yFor(mapHighlightNits(input, curve));
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke(); context.lineWidth = 1;
  if (els.sdrHighlightCompressionSummary) {
    const colorNote = sdr.highlight_compression_color_handling === "path_to_white"
      ? " Brightest highlights converge to neutral white."
      : sdr.highlight_compression_color_handling === "preserve_color"
        ? " Color ratios are preserved."
        : " sRGB channels roll off independently for smooth color transitions.";
    els.sdrHighlightCompressionSummary.dataset.tooltip = mode === "soft_ceiling"
      ? "Soft Ceiling approaches display white without a measured peak anchor."
      : `Peak Fit places the measured ${Math.round(sourcePeak)}% input peak at display white.${colorNote}`;
  }
}

function syncRangeControlFromState(path, requestedControl = null) {
  const control = requestedControl || document.querySelector(`[data-path="${path}"]`);
  if (!control || control.type !== "range") return;
  const value = Number(getValueByPath(state.adjustments, path));
  const minimum = Number(control.min);
  const maximum = Number(control.max);
  const outsideSlider = value < minimum || value > maximum;
  control.value = String(clamp(value, minimum, maximum));
  control.closest(".range-shell")?.classList.toggle("manual-overflow", outsideSlider);
  updateRangeVisual(control);
}

function syncCurveControlsFromState() {
  els.curveRemove.disabled = currentCurveValues().length <= 2 || isLockedCurveEndpoint(state.selectedCurvePoint);
}

function renderSessionChrome() {
  const hasSession = Boolean(state.session);
  els.ejectButton.disabled = !hasSession;
  els.workflowTabs.forEach((button) => {
    button.disabled = button.dataset.workflowTab !== "import" && !hasSession;
  });
  els.emptyImportButton.disabled = hasSession;
  document.querySelectorAll("#grade-workflow-panel input, #grade-workflow-panel select, #grade-workflow-panel button").forEach((control) => {
    if (control.matches("[data-local-tool], #grade-mode-local")) {
      control.disabled = false;
    } else {
      const unavailableModule = control.closest(".module-unavailable");
      const bypassedRawHighlightControl = control.matches("#raw-highlight-method, #raw-highlight-threshold")
        && els.rawHighlightBypass?.getAttribute("aria-pressed") !== "true";
      control.disabled = !hasSession || Boolean(unavailableModule) || bypassedRawHighlightControl;
    }
  });
  els.viewButtons.forEach((button) => {
    button.disabled = !hasSession;
  });
  [els.toneEqualizerEditor, els.sdrToneEqualizerEditor].forEach((editor) => {
    editor.setAttribute("aria-disabled", String(!hasSession));
    editor.tabIndex = hasSession ? 0 : -1;
  });
  [els.zoomOut, els.zoomIn, els.zoomSlider, els.zoomReadout, els.zoomFit, els.zoomActual].forEach((control) => {
    control.disabled = !hasSession;
  });
  updateLocalToolState();
  window.HDRProofing?.render();
}

function renderCurveChannelTabs() {
  els.curveChannelButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.curveChannel === state.selectedCurveChannel);
  });
}

function bindToneEqualizerEditor() {
  bindToneEqualizerEditorForLane("hdr");
  bindToneEqualizerEditorForLane("sdr");
  els.sdrMatchHdrBands?.addEventListener("click", matchHdrBandsToSdr);
}

function bindToneEqualizerEditorForLane(lane) {
  const ui = toneEqualizerUi(lane);
  const canvas = ui.editor;
  const beginDrag = (startEvent, bandIndex) => {
    if (!state.session) return;
    const { clientX, clientY, pointerId } = startEvent;
    state.previewScheduler?.beginInteraction();
    const rect = canvas.getBoundingClientRect();
    state.activeToneEqualizerBand = bandIndex;
    state.selectedToneEqualizerBand = state.activeToneEqualizerBand;
    const startingNodes = currentToneEqualizerNodes(lane).map((node) => ({ ...node }));
    const pointerDelta = createPrecisionPointerDelta(startEvent);
    drawToneEqualizerEditor(lane);
    let stopped = false;
    if (pointerId !== null && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(pointerId); } catch {}
    }
    const move = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      event.preventDefault();
      const delta = pointerDelta.update(event);
      updateToneEqualizerFromPointer(clientX + delta.x, clientY + delta.y, rect, startingNodes, lane);
    };
    const stop = (event) => {
      if (stopped || (pointerId !== null && event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
      stopped = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("lostpointercapture", stop);
      if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
        try { canvas.releasePointerCapture(pointerId); } catch {}
      }
      state.activeToneEqualizerBand = null;
      renderControlState();
      state.previewScheduler?.endInteraction();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    canvas.addEventListener("lostpointercapture", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, rect, lane);
    if (bandIndex !== null) {
      beginDrag(event, bandIndex);
      return;
    }
    const curveHit = toneEqualizerCurveHitAtPointer(event.clientX, event.clientY, rect, lane);
    if (!curveHit) return;
    const insertedIndex = addToneEqualizerNode(curveHit.inputEv, lane);
    if (insertedIndex === null) return;
    beginDrag(event, insertedIndex);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.session) return;
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, canvas.getBoundingClientRect(), lane);
    if (bandIndex === null) return;
    state.selectedToneEqualizerBand = bandIndex;
    removeToneEqualizerNode(bandIndex, lane);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state.session) return;
    changeToneEqualizerRadius(event.deltaY < 0 ? 0.25 : -0.25, lane);
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (!state.session) return;
    const index = state.selectedToneEqualizerBand;
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      changeToneEqualizerRadius(event.key === "]" ? 0.25 : -0.25, lane);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      moveToneEqualizerNodeHorizontally(index, event.key === "ArrowRight" ? 0.1 : -0.1, lane);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      removeToneEqualizerNode(null, lane);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nodes = currentToneEqualizerNodes(lane);
      if (event.key === "ArrowLeft") state.selectedToneEqualizerBand = Math.max(0, index - 1);
      if (event.key === "ArrowRight") state.selectedToneEqualizerBand = Math.min(nodes.length - 1, index + 1);
      if (event.key === "Home") state.selectedToneEqualizerBand = 0;
      if (event.key === "End") state.selectedToneEqualizerBand = nodes.length - 1;
      syncToneEqualizerControls(lane);
      drawToneEqualizerEditor(lane);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.ctrlKey ? 0.01 : 0.05;
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setToneEqualizerBand(index, currentToneEqualizerNodes(lane)[index].adjustment_ev + direction * step, lane);
    renderControlState();
  });

  ui.bandValue.addEventListener("input", () => {
    if (!state.session) return;
    setToneEqualizerBand(state.selectedToneEqualizerBand, Number(ui.bandValue.value), lane);
  });
  ui.bandValue.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
  ["pointerup", "pointercancel"].forEach((eventName) => {
    ui.bandValue.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  ui.bandValue.addEventListener("change", () => {
    renderControlState();
  });
  ui.add.addEventListener("click", () => addToneEqualizerNode(null, lane));
  ui.remove.addEventListener("click", () => removeToneEqualizerNode(null, lane));
  ui.radiusDown.addEventListener("click", () => changeToneEqualizerRadius(-0.25, lane));
  ui.radiusUp.addEventListener("click", () => changeToneEqualizerRadius(0.25, lane));
}

function updateToneEqualizerFromPointer(clientX, clientY, rect, startingNodes, lane = state.currentView) {
  const layout = toneEqualizerEditorLayout();
  const paddingTop = layout.top / Math.max(rect.height, 1);
  const paddingBottom = layout.bottom / Math.max(rect.height, 1);
  const normalizedY = clamp((clientY - rect.top) / rect.height, paddingTop, 1 - paddingBottom);
  const graphY = (normalizedY - paddingTop) / Math.max(1 - paddingTop - paddingBottom, 1e-6);
  const value = TONE_EQUALIZER_MAX_ADJUSTMENT_EV - graphY * TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2;
  const index = state.activeToneEqualizerBand ?? state.selectedToneEqualizerBand;
  const nodes = startingNodes.map((node) => ({ ...node }));
  const selected = nodes[index];
  const radius = Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5);
  const delta = value - selected.adjustment_ev;
  nodes.forEach((node, nodeIndex) => {
    const distance = Math.abs(node.input_ev - selected.input_ev);
    const local = clamp(1 - distance / Math.max(radius, 0.25), 0, 1);
    const weight = local * local * (3 - 2 * local);
    node.adjustment_ev = clamp(node.adjustment_ev + delta * weight, -2, 2);
    if (nodeIndex === index && nodeIndex > 0 && nodeIndex < nodes.length - 1) {
      node.input_ev = clamp(
        toneEqualizerEvFromPointer(clientX, rect),
        nodes[nodeIndex - 1].input_ev + 0.1,
        nodes[nodeIndex + 1].input_ev - 0.1,
      );
    }
  });
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function toneEqualizerPointerPosition(clientX, clientY, rect) {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function toneEqualizerCanvasPosition(inputEv, adjustmentEv, lane = state.currentView) {
  const canvas = toneEqualizerUi(lane).editor;
  const { width, height } = canvasLogicalSize(canvas);
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  return {
    x: left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV)) * (width - left - right),
    y: top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - adjustmentEv) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * (height - top - bottom),
  };
}

function toneEqualizerNodeIndexAtPointer(clientX, clientY, rect, lane = state.currentView) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  let nearestIndex = null;
  let nearestDistance = 10 ** 2;
  currentToneEqualizerNodes(lane).forEach((node, index) => {
    const position = toneEqualizerCanvasPosition(node.input_ev, node.adjustment_ev, lane);
    const distance = ((position.x - pointer.x) ** 2) + ((position.y - pointer.y) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function toneEqualizerCurveHitAtPointer(clientX, clientY, rect, lane = state.currentView) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  const inputEv = toneEqualizerEvFromPointer(clientX, rect);
  const adjustmentEv = sampleToneEqualizerAdjustment(
    inputEv,
    currentToneEqualizerNodes(lane),
    Number(state.adjustments[lane].tone_equalizer_smoothing || 0.5),
  );
  const curvePosition = toneEqualizerCanvasPosition(inputEv, adjustmentEv, lane);
  return Math.abs(curvePosition.y - pointer.y) <= 8 ? { inputEv, adjustmentEv } : null;
}

function setToneEqualizerBand(index, requestedValue, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const rounded = Math.round(clamp(Number(requestedValue) || 0, minimum, maximum) * 100) / 100;
  nodes[index].adjustment_ev = clamp(rounded, Math.ceil(minimum * 100) / 100, Math.floor(maximum * 100) / 100);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  state.selectedToneEqualizerBand = index;
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function toneEqualizerBandLimits(index, nodes = currentToneEqualizerNodes()) {
  const inputEv = nodes[index].input_ev;
  let minimum = -TONE_EQUALIZER_MAX_ADJUSTMENT_EV;
  let maximum = TONE_EQUALIZER_MAX_ADJUSTMENT_EV;
  if (index > 0) {
    const previousTarget = nodes[index - 1].input_ev + nodes[index - 1].adjustment_ev;
    minimum = Math.max(minimum, previousTarget + TONE_EQUALIZER_MIN_TARGET_STEP - inputEv);
  }
  if (index < nodes.length - 1) {
    const nextTarget = nodes[index + 1].input_ev + nodes[index + 1].adjustment_ev;
    maximum = Math.min(maximum, nextTarget - TONE_EQUALIZER_MIN_TARGET_STEP - inputEv);
  }
  return [minimum, Math.max(minimum, maximum)];
}

function syncToneEqualizerControls(lane = state.currentView) {
  const ui = toneEqualizerUi(lane);
  const nodes = currentToneEqualizerNodes(lane);
  const index = clamp(state.selectedToneEqualizerBand ?? 2, 0, nodes.length - 1);
  state.selectedToneEqualizerBand = index;
  const inputEv = nodes[index].input_ev;
  const value = nodes[index].adjustment_ev;
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const legalMinimum = Math.ceil(minimum * 100) / 100;
  const legalMaximum = Math.floor(maximum * 100) / 100;
  ui.bandValue.min = String(legalMinimum);
  ui.bandValue.max = String(Math.max(legalMinimum, legalMaximum));
  ui.bandValue.setAttribute("aria-valuemin", ui.bandValue.min);
  ui.bandValue.setAttribute("aria-valuemax", ui.bandValue.max);
  ui.bandValue.value = String(value);
  updateRangeVisual(ui.bandValue);
  ui.bandLabel.textContent = lane === "hdr"
    ? `${formatSignedEv(inputEv, 0)} · ${formatToneBandNits(100 * (2 ** inputEv))}`
    : `${formatSignedEv(inputEv, 0)} · ${formatSdrBandLevel(0.18 * (2 ** inputEv))}`;
  if (ui.bandOutput.dataset.editing !== "true") {
    ui.bandOutput.textContent = formatSignedEv(value, 2);
  }
  if (ui.radius.dataset.editing !== "true") {
    ui.radius.textContent = `Influence ${Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5).toFixed(2)} EV`;
  }
  ui.remove.disabled = nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index === 0 || index === nodes.length - 1;
  ui.add.disabled = nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT;
}

function drawToneEqualizerEditor(lane = state.currentView) {
  const canvas = toneEqualizerUi(lane).editor;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  const graphWidth = width - left - right;
  const graphHeight = height - top - bottom;
  const nodes = currentToneEqualizerNodes(lane);
  const smoothing = clamp(Number(state.adjustments[lane]?.tone_equalizer_smoothing ?? 0.5), 0, 1);
  const enabled = state.adjustments[lane]?.tone_equalizer_section_enabled !== false;
  const xForEv = (inputEv) => left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV)) * graphWidth;
  const yForAdjustment = (value) => top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - value) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * graphHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);
  ctx.font = '9px "Space Mono", "Cascadia Mono", monospace';
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let adjustment = -2; adjustment <= 2; adjustment += 1) {
    const y = yForAdjustment(adjustment);
    ctx.strokeStyle = adjustment === 0 ? uiToken("--equalizer-grid-strong") : uiToken("--equalizer-grid");
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.fillStyle = uiToken("--quiet");
    ctx.fillText(formatSignedEv(adjustment, 0), left - 5, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let inputEv = TONE_EQUALIZER_MIN_EV; inputEv <= TONE_EQUALIZER_MAX_EV; inputEv += 1) {
    const x = xForEv(inputEv);
    ctx.strokeStyle = inputEv === 0 ? uiToken("--equalizer-zero") : uiToken("--equalizer-grid");
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, height - bottom);
    ctx.stroke();
    if (inputEv % 2 === 0) {
      ctx.fillStyle = inputEv === 0 ? uiToken("--equalizer-axis") : uiToken("--quiet");
      ctx.fillText(formatSignedEv(inputEv, 0), x, height - bottom + 7);
    }
  }
  const outputBoundaryEv = lane === "hdr" ? toneEqualizerPqMaxEv() : Math.log2(1 / 0.18);
  const pqX = xForEv(outputBoundaryEv);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = uiToken("--equalizer-pq");
  ctx.beginPath();
  ctx.moveTo(pqX, top);
  ctx.lineTo(pqX, height - bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = uiToken("--attention");
  ctx.textAlign = "right";
  ctx.fillText(lane === "hdr" ? "10K" : "100%", pqX, 3);

  ctx.strokeStyle = enabled ? uiToken("--equalizer-curve") : uiToken("--equalizer-disabled");
  ctx.lineWidth = uiNumberToken("--equalizer-line-width", 2.25);
  ctx.beginPath();
  for (let sample = 0; sample < 180; sample += 1) {
    const inputEv = TONE_EQUALIZER_MIN_EV + (sample / 179) * (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV);
    const adjustment = sampleToneEqualizerAdjustment(inputEv, nodes, smoothing);
    const x = xForEv(inputEv);
    const y = yForAdjustment(adjustment);
    if (sample === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const selectedNode = nodes[state.selectedToneEqualizerBand];
  if (selectedNode) {
    const radius = Number(state.adjustments[lane]?.tone_equalizer_influence_radius || 1.5);
    const start = xForEv(Math.max(TONE_EQUALIZER_MIN_EV, selectedNode.input_ev - radius));
    const end = xForEv(Math.min(TONE_EQUALIZER_MAX_EV, selectedNode.input_ev + radius));
    ctx.fillStyle = uiToken("--equalizer-influence-wash");
    ctx.fillRect(start, top, end - start, graphHeight);
  }
  nodes.forEach((node, index) => {
    const inputEv = node.input_ev;
    const selected = index === state.selectedToneEqualizerBand;
    const radius = selected
      ? uiNumberToken("--equalizer-selected-radius", 5.5)
      : uiNumberToken("--equalizer-node-radius", 4);
    ctx.fillStyle = selected
      ? uiToken("--equalizer-selected")
      : enabled
        ? uiToken("--equalizer-node")
        : uiToken("--equalizer-disabled");
    ctx.beginPath();
    const x = xForEv(inputEv);
    const y = yForAdjustment(node.adjustment_ev);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    drawGraphHomeCue(ctx, x, y, radius, node.adjustment_ev);
  });
  syncToneEqualizerControls(lane);
}

function sampleToneEqualizerAdjustment(inputEv, values, smoothing) {
  const nodes = normalizeToneEqualizerNodes(values);
  if (inputEv <= nodes[0].input_ev) return nodes[0].adjustment_ev;
  if (inputEv >= nodes.at(-1).input_ev) return nodes.at(-1).adjustment_ev;
  const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
  const widths = nodes.slice(1).map((node, index) => Math.max(node.input_ev - nodes[index].input_ev, 0.001));
  const deltas = targets.slice(1).map((value, index) => (value - targets[index]) / widths[index]);
  const slopes = targets.map((_, index) => {
    if (index === 0) return deltas[0];
    if (index === targets.length - 1) return deltas.at(-1);
    const previous = deltas[index - 1];
    const following = deltas[index];
    return previous <= 0 || following <= 0 ? 0 : (2 * previous * following) / (previous + following);
  });
  const segment = Math.min(nodes.findIndex((node) => node.input_ev > inputEv) - 1, nodes.length - 2);
  const local = (inputEv - nodes[segment].input_ev) / widths[segment];
  const local2 = local * local;
  const local3 = local2 * local;
  const y0 = targets[segment];
  const y1 = targets[segment + 1];
  const cubic = ((2 * local3) - (3 * local2) + 1) * y0
    + (local3 - (2 * local2) + local) * slopes[segment] * widths[segment]
    + ((-2 * local3) + (3 * local2)) * y1
    + (local3 - local2) * slopes[segment + 1] * widths[segment];
  const linear = y0 + (y1 - y0) * local;
  return ((linear * (1 - smoothing)) + (cubic * smoothing)) - inputEv;
}

function normalizeToneEqualizerNodes(values) {
  const source = Array.isArray(values) && values.length >= 2 ? values : defaultToneEqualizerNodes();
  const nodes = source.slice(0, 16).map((node, index) => ({
    input_ev: Number.isFinite(Number(node?.input_ev)) ? clamp(Number(node.input_ev), -6, 6) : -6 + index,
    adjustment_ev: Number.isFinite(Number(node?.adjustment_ev)) ? clamp(Number(node.adjustment_ev), -2, 2) : 0,
  })).sort((left, right) => left.input_ev - right.input_ev);
  nodes[0].input_ev = -6;
  nodes[nodes.length - 1].input_ev = 6;
  const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
  for (let index = 1; index < targets.length; index += 1) {
    targets[index] = Math.max(targets[index], targets[index - 1] + TONE_EQUALIZER_MIN_TARGET_STEP);
  }
  nodes.forEach((node, index) => { node.adjustment_ev = clamp(targets[index] - node.input_ev, -2, 2); });
  return nodes;
}

function toneEqualizerUi(lane = state.currentView) {
  if (lane === "sdr") return {
    editor: els.sdrToneEqualizerEditor,
    bandValue: els.sdrToneEqualizerBandValue,
    bandLabel: els.sdrToneEqualizerBandLabel,
    bandOutput: els.sdrToneEqualizerBandOutput,
    add: els.sdrToneEqualizerAdd,
    remove: els.sdrToneEqualizerRemove,
    radiusDown: els.sdrToneEqualizerRadiusDown,
    radiusUp: els.sdrToneEqualizerRadiusUp,
    radius: els.sdrToneEqualizerRadius,
  };
  return {
    editor: els.toneEqualizerEditor,
    bandValue: els.toneEqualizerBandValue,
    bandLabel: els.toneEqualizerBandLabel,
    bandOutput: els.toneEqualizerBandOutput,
    add: els.toneEqualizerAdd,
    remove: els.toneEqualizerRemove,
    radiusDown: els.toneEqualizerRadiusDown,
    radiusUp: els.toneEqualizerRadiusUp,
    radius: els.toneEqualizerRadius,
  };
}

function currentToneEqualizerNodes(lane = state.currentView) {
  return normalizeToneEqualizerNodes(state.adjustments[lane]?.tone_equalizer_nodes).map((node) => ({ ...node }));
}

function toneEqualizerEvFromPointer(clientX, rect) {
  const layout = toneEqualizerEditorLayout();
  const paddingLeft = layout.left / Math.max(rect.width, 1);
  const paddingRight = layout.right / Math.max(rect.width, 1);
  const normalizedX = clamp((clientX - rect.left) / rect.width, paddingLeft, 1 - paddingRight);
  const graphX = (normalizedX - paddingLeft) / Math.max(1 - paddingLeft - paddingRight, 1e-6);
  return TONE_EQUALIZER_MIN_EV + graphX * (toneEqualizerPqMaxEv() - TONE_EQUALIZER_MIN_EV);
}

function addToneEqualizerNode(preferredEv = null, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  if (nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT) return null;
  let inputEv = preferredEv;
  if (inputEv == null) {
    let widest = -1;
    let insertion = 1;
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const gap = nodes[index + 1].input_ev - nodes[index].input_ev;
      if (gap > widest) { widest = gap; insertion = index + 1; }
    }
    inputEv = (nodes[insertion - 1].input_ev + nodes[insertion].input_ev) / 2;
  }
  inputEv = clamp(inputEv, -5.9, 5.9);
  if (nodes.some((node) => Math.abs(node.input_ev - inputEv) < 0.1)) return null;
  const adjustmentEv = sampleToneEqualizerAdjustment(inputEv, nodes, Number(state.adjustments[lane].tone_equalizer_smoothing || 0.5));
  nodes.push({ input_ev: inputEv, adjustment_ev: adjustmentEv });
  nodes.sort((left, right) => left.input_ev - right.input_ev);
  state.selectedToneEqualizerBand = nodes.findIndex((node) => node.input_ev === inputEv);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  renderControlState();
  invalidatePreview(lane);
  debouncePreview(lane);
  return state.selectedToneEqualizerBand;
}

function loadDenoiseDocument(document) {
  const fallback = defaultDenoiseDocument();
  const source = document?.denoise || fallback;
  const next = {
    schema_version: 1,
    hdr: {
      ...fallback.hdr,
      ...(source.hdr || {}),
      controls: { ...fallback.hdr.controls, ...(source.hdr?.controls || {}) },
      analysis: { ...fallback.hdr.analysis, ...(source.hdr?.analysis || {}) },
    },
    sdr: {
      ...fallback.sdr,
      ...(source.sdr || {}),
      controls: { ...fallback.sdr.controls, ...(source.sdr?.controls || {}) },
      analysis: { ...fallback.sdr.analysis, ...(source.sdr?.analysis || {}) },
    },
  };
  const sessionId = state.session?.session_id || null;
  const sameSession = state.denoiseDocumentSessionId === sessionId;
  const unchanged = JSON.stringify(next) === JSON.stringify(state.denoise);
  state.denoise = next;
  state.denoiseDocumentSessionId = sessionId;
  if (sameSession && unchanged) {
    renderDenoiseControls();
    return;
  }
  for (const lane of ["hdr", "sdr"]) {
    state.denoiseRuntime[lane] = {
      status: state.denoise[lane].enabled ? "dirty" : "off",
      dirty: Boolean(state.denoise[lane].enabled),
      generation: (state.denoiseRuntime[lane]?.generation || 0) + 1,
      showOriginal: false,
      error: "",
    };
  }
  renderDenoiseControls();
}

function renderDenoiseControls() {
  if (!els.denoiseBypass) return;
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  const enabled = Boolean(settings.enabled);
  const group = els.denoiseBypass.closest(".control-group");
  const defaults = defaultDenoiseDocument()[lane];
  const modified = !valuesEqual(settings.controls, defaults.controls) || !valuesEqual(settings.analysis, defaults.analysis);
  els.denoiseBypass.classList.toggle("bypassed", !enabled);
  els.denoiseBypass.setAttribute("aria-pressed", String(enabled));
  group?.classList.toggle("bypassed", !enabled);
  group?.classList.toggle("modified", modified);
  const analysis = settings.analysis;
  const analysisEnabled = enabled && !["preparing", "recalculating"].includes(runtime.status);
  els.denoiseMethod.value = analysis.preset;
  els.denoiseMethod.disabled = !analysisEnabled;
  els.denoiseMethodNote.dataset.tooltip = DENOISE_ANALYSIS_PRESETS[analysis.preset]?.note || DENOISE_ANALYSIS_PRESETS.custom.note;
  els.denoiseCustomSettings.hidden = analysis.preset !== "custom";
  els.denoiseLevels.value = String(analysis.levels);
  els.denoiseLevels.disabled = !analysisEnabled;
  const analysisControls = [
    [els.denoiseThreshold, els.denoiseThresholdValue, analysis.noise_threshold, 1],
    [els.denoiseLumaSigma, els.denoiseLumaSigmaValue, analysis.luma_sigma, 3],
    [els.denoiseChromaSigma, els.denoiseChromaSigmaValue, analysis.chroma_sigma, 3],
  ];
  for (const [input, output, value, digits] of analysisControls) {
    input.value = String(value);
    input.disabled = !analysisEnabled;
    output.textContent = Number(value).toFixed(digits);
    updateRangeVisual(input);
  }
  const controls = [
    [els.denoiseAmount, els.denoiseAmountValue, settings.controls.amount],
    [els.denoiseLuminance, els.denoiseLuminanceValue, settings.controls.luminance],
    [els.denoiseColor, els.denoiseColorValue, settings.controls.color_noise],
    [els.denoiseDetail, els.denoiseDetailValue, settings.controls.detail_recovery],
  ];
  for (const [input, output, value] of controls) {
    input.value = String(value);
    output.textContent = `${Math.round(value * 100)}%`;
    input.disabled = !enabled || !["ready", "dirty"].includes(runtime.status);
    updateRangeVisual(input);
  }
  els.denoiseRecalculate.disabled = !enabled || ["preparing", "recalculating"].includes(runtime.status);
  const labels = { off: "Off", preparing: "Preparing", ready: "Ready", dirty: "Dirty", recalculating: "Recalculating", error: "Error" };
  if (els.denoiseState) els.denoiseState.textContent = labels[runtime.status] || runtime.status;
  els.denoiseStatus.textContent = runtime.error || ({
    off: "Denoise is off.",
    preparing: "Preparing the denoise cache; the original remains interactive.",
    ready: "Denoise cache ready.",
    dirty: "Analysis settings changed. The previous valid result remains visible until recalculated.",
    recalculating: "Recalculating; the previous valid result remains interactive.",
    error: "Denoise could not be prepared. The original pipeline remains available.",
  }[runtime.status] || "");
}

function markDenoiseAnalysisDirty() {
  const lane = state.currentView;
  const runtime = state.denoiseRuntime[lane];
  runtime.dirty = true;
  runtime.error = "";
  runtime.status = state.denoise[lane].enabled ? "dirty" : "off";
  renderDenoiseControls();
}

function updateDenoiseAnalysisPreset(presetName) {
  const preset = DENOISE_ANALYSIS_PRESETS[presetName];
  if (!preset) return;
  const analysis = state.denoise[state.currentView].analysis;
  analysis.preset = presetName;
  if (presetName !== "custom") {
    for (const key of ["levels", "noise_threshold", "luma_sigma", "chroma_sigma"]) analysis[key] = preset[key];
  }
  markDenoiseAnalysisDirty();
  void persistDenoiseSettings();
}

function updateCustomDenoiseAnalysis(key, value, persist = true) {
  const analysis = state.denoise[state.currentView].analysis;
  analysis.preset = "custom";
  analysis[key] = key === "levels" ? clamp(Math.round(value), 1, 4) : value;
  markDenoiseAnalysisDirty();
  if (persist) void persistDenoiseSettings();
}

async function persistDenoiseSettings() {
  if (!state.session) return false;
  const applied = await queueEditCommand("set_denoise_settings", { denoise: JSON.parse(JSON.stringify(state.denoise)) }, null, { refreshPreview: false });
  if (applied) renderLaneChrome();
  return applied;
}

async function setDenoiseEnabled(enabled) {
  const lane = state.currentView;
  state.denoise[lane].enabled = Boolean(enabled);
  const runtime = state.denoiseRuntime[lane];
  runtime.error = "";
  if (!enabled) {
    runtime.generation += 1;
    runtime.status = "off";
    runtime.showOriginal = true;
    state.gpuPreview?.cancelDenoiseProcessing?.({ selectOriginal: true });
    await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    renderDenoiseControls();
    void persistDenoiseSettings();
    return;
  }
  void persistDenoiseSettings();
  const denoise = state.gpuPreview?.diagnosticsSnapshot?.().denoise;
  const sourceIdentity = gpuPreviewSourceOptions(lane)?.identity || "source";
  const expectedIdentity = `${state.session?.session_id}:${lane}:${refinementProxyLongEdge()}:${JSON.stringify(state.adjustments.shared?.geometry || {})}:${sourceIdentity}`;
  if (!runtime.dirty && denoise?.cacheReady && denoise.identity === expectedIdentity) {
    state.gpuPreview.selectDenoiseSelectorSource(true);
    runtime.status = "ready";
    runtime.showOriginal = false;
    await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    debounceOverlayAndScopes();
    renderDenoiseControls();
    return;
  }
  await recalculateDenoise();
}

async function recalculateDenoise(lane = state.currentView) {
  const settings = state.denoise[lane];
  if (!state.session || !settings.enabled || !state.gpuPreview?.available) return false;
  const runtime = state.denoiseRuntime[lane];
  const generation = ++runtime.generation;
  runtime.status = state.gpuPreview.diagnosticsSnapshot().denoise.cacheReady ? "recalculating" : "preparing";
  runtime.error = "";
  if (lane === state.currentView) renderDenoiseControls();
  try {
    const analysis = settings.analysis;
    const sourceIdentity = gpuPreviewSourceOptions(lane)?.identity || "source";
    const ready = await state.gpuPreview.analyzeDenoiseProxy(
      state.session.session_id,
      lane,
      JSON.parse(JSON.stringify(state.adjustments)),
      refinementProxyLongEdge(),
      state.editRevision,
      {
        name: settings.analysis.preset,
        levels: analysis.levels,
        noiseThreshold: analysis.noise_threshold,
        lumaSigma: analysis.luma_sigma,
        chromaSigma: analysis.chroma_sigma,
      },
      sourceIdentity,
      {
        amount: settings.controls.amount,
        luminance: settings.controls.luminance,
        colorNoise: settings.controls.color_noise,
        detailRecovery: settings.controls.detail_recovery,
      },
    );
    if (generation !== runtime.generation) return false;
    if (!ready) throw new Error("The denoise analysis was replaced before completion.");
    runtime.status = "ready";
    runtime.dirty = false;
    runtime.showOriginal = false;
    await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
    debounceOverlayAndScopes();
    if (lane === state.currentView) renderDenoiseControls();
    return true;
  } catch (error) {
    if (generation !== runtime.generation) return false;
    runtime.status = "error";
    runtime.error = error?.message || "Denoise analysis failed.";
    if (lane === state.currentView) renderDenoiseControls();
    return false;
  }
}

async function updateLiveDenoiseControl(key, value) {
  const lane = state.currentView;
  const settings = state.denoise[lane];
  const runtime = state.denoiseRuntime[lane];
  settings.controls[key] = clamp(value, 0, 1);
  renderDenoiseControls();
  if (!settings.enabled || runtime.status !== "ready" || runtime.showOriginal) return;
  const controls = settings.controls;
  const ready = await state.gpuPreview.resolveDenoiseProxy({
    amount: controls.amount,
    luminance: controls.luminance,
    colorNoise: controls.color_noise,
    detailRecovery: controls.detail_recovery,
  });
  if (!ready || lane !== state.currentView) return;
  await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge() });
  debounceOverlayAndScopes();
}

function removeToneEqualizerNode(requestedIndex = null, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  const index = requestedIndex ?? state.selectedToneEqualizerBand;
  if (nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index <= 0 || index >= nodes.length - 1) return;
  nodes.splice(index, 1);
  state.selectedToneEqualizerBand = Math.min(index, nodes.length - 2);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  renderControlState();
  invalidatePreview(lane);
  debouncePreview(lane);
}

function changeToneEqualizerRadius(delta, lane = state.currentView) {
  const current = Number(state.adjustments[lane].tone_equalizer_influence_radius || 1.5);
  state.adjustments[lane].tone_equalizer_influence_radius = clamp(Math.round((current + delta) * 4) / 4, 0.25, 12);
  syncToneEqualizerControls(lane);
  drawToneEqualizerEditor(lane);
  renderControlState();
}

function moveToneEqualizerNodeHorizontally(index, delta, lane = state.currentView) {
  const nodes = currentToneEqualizerNodes(lane);
  if (index <= 0 || index >= nodes.length - 1) return;
  nodes[index].input_ev = clamp(nodes[index].input_ev + delta, nodes[index - 1].input_ev + 0.1, nodes[index + 1].input_ev - 0.1);
  state.adjustments[lane].tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor(lane);
  invalidatePreview(lane);
  debouncePreview(lane);
}

function formatSignedEv(value, digits) {
  const numeric = Math.abs(value) < 0.0005 ? 0 : Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)} EV`;
}

function formatToneBandNits(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k nit`;
  if (value >= 10) return `${Math.round(value)} nit`;
  return `${value.toFixed(1)} nit`;
}

function bindCurveEditor() {
  const canvas = els.curveEditor;
  const beginDrag = (startEvent, pointIndex) => {
    if (!state.session) return;
    const { clientX, clientY, pointerId } = startEvent;
    state.previewScheduler?.beginInteraction();
    state.activeCurvePoint = pointIndex;
    state.selectedCurvePoint = state.activeCurvePoint;
    const dragOrigin = {
      clientX,
      clientY,
      point: [...currentCurveValues()[state.activeCurvePoint]],
    };
    const pointerDelta = createPrecisionPointerDelta(startEvent);
    let dragged = false;
    drawCurveEditor();
    let stopped = false;
    if (pointerId !== null && canvas.setPointerCapture) {
      try { canvas.setPointerCapture(pointerId); } catch {}
    }
    const move = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      event.preventDefault();
      dragged ||= Math.hypot(event.clientX - clientX, event.clientY - clientY) >= 3;
      if (!dragged) return;
      const delta = pointerDelta.update(event);
      updateCurveFromPointer(clientX + delta.x, clientY + delta.y, dragOrigin);
    };
    const stop = (event) => {
      if (stopped || (pointerId !== null && event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
      stopped = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      canvas.removeEventListener("lostpointercapture", stop);
      if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
        try { canvas.releasePointerCapture(pointerId); } catch {}
      }
      state.activeCurvePoint = null;
      drawCurveEditor();
      syncCurveControlsFromState();
      invalidatePreview(state.currentView);
      renderControlState();
      debouncePreview(state.currentView);
      state.previewScheduler?.endInteraction();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    canvas.addEventListener("lostpointercapture", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointIndex = curvePointIndexAtPointer(event.clientX, event.clientY, rect);
    if (pointIndex !== null) {
      beginDrag(event, pointIndex);
      return;
    }
    const curveHit = curveHitAtPointer(event.clientX, event.clientY, rect);
    if (!curveHit) return;
    const insertedIndex = addCurvePoint(curveHit.x);
    if (insertedIndex === null) return;
    beginDrag(event, insertedIndex);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.session) return;
    const pointIndex = curvePointIndexAtPointer(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (pointIndex === null || isLockedCurveEndpoint(pointIndex)) return;
    state.selectedCurvePoint = pointIndex;
    removeCurvePoint(pointIndex);
    drawCurveEditor();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
  canvas.addEventListener("keydown", (event) => {
    const curve = currentCurveValues();
    const index = state.selectedCurvePoint ?? Math.floor(curve.length / 2);
    if (event.key === "Enter") {
      event.preventDefault();
      addCurvePoint();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeCurvePoint();
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const point = [...curve[index]];
      const step = event.ctrlKey ? 0.001 : 0.01;
      const verticalStep = step * Math.min(1, curveVerticalAdjustmentScale(index, curve.length) / 0.35);
      if (event.key === "ArrowLeft" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] - step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowRight" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] + step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowUp") point[1] = clamp(point[1] + verticalStep, 0, 1);
      if (event.key === "ArrowDown") point[1] = clamp(point[1] - verticalStep, 0, 1);
      curve[index] = point;
      setCurveValues(state.selectedCurveChannel, curve);
    } else {
      return;
    }
    drawCurveEditor();
    syncCurveControlsFromState();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });
}

function updateCurveFromPointer(clientX, clientY, dragOrigin = null) {
  const rect = els.curveEditor.getBoundingClientRect();
  const index = state.activeCurvePoint;
  if (index === null) return;
  const curve = currentCurveValues();
  const point = [...curve[index]];
  const direct = curvePointerPosition(clientX, clientY, rect);
  const directX = direct.x;
  const directY = direct.y;
  const normalizedX = dragOrigin
    ? dragOrigin.point[0] + (clientX - dragOrigin.clientX) / Math.max(rect.width, 1)
    : directX;
  const verticalScale = curveVerticalAdjustmentScale(index, curve.length);
  const normalizedY = dragOrigin
    ? dragOrigin.point[1] - ((clientY - dragOrigin.clientY) / Math.max(rect.height, 1)) * verticalScale
    : directY;
  if (index === 0) point[0] = 0;
  else if (index === curve.length - 1) point[0] = 1;
  else point[0] = clamp(normalizedX, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
  point[1] = clamp(normalizedY, 0, 1);
  curve[index] = point;
  state.selectedCurvePoint = index;
  setCurveValues(state.selectedCurveChannel, curve);
  drawCurveEditor();
  invalidatePreview(state.currentView);
  debouncePreview(state.currentView);
}

function curveVerticalAdjustmentScale(index, pointCount) {
  if (currentCurveLane() !== "hdr" || state.selectedCurveChannel !== "luma") return 1;
  // The endpoints alter the black floor and highlight ceiling, so give them
  // roughly twice the precision of the broad middle-tone control.
  return index === 0 || index === pointCount - 1 ? 0.18 : 0.35;
}

function drawCurveEditor() {
  const canvas = els.curveEditor;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const layout = curveEditorLayout();
  const plotLeft = layout.left;
  const plotTop = layout.top;
  const plotRight = width - layout.right;
  const plotBottom = height - layout.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const curve = currentCurveValues();
  const curveSamples = sampleCurvePoints(curve, 96);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);

  if (currentCurveLane() === "hdr") {
    drawCurveExposureBands(ctx, layout, width, height);
  }

  ctx.strokeStyle = uiToken("--curve-grid");
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = plotLeft + (plotWidth * step) / 4;
    const y = plotTop + (plotHeight * step) / 4;
    if (currentCurveLane() !== "hdr") {
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
  }

  ctx.strokeStyle = uiToken("--curve-identity");
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotTop);
  ctx.stroke();

  ctx.strokeStyle = currentCurveLane() === "hdr" && state.selectedCurveChannel === "luma"
    ? curveExposureGradient(ctx, plotLeft, plotRight)
    : curveColor(state.selectedCurveChannel);
  ctx.lineWidth = uiNumberToken("--curve-line-width", 2.5);
  ctx.beginPath();
  curveSamples.forEach(([xValue, yValue], index) => {
    const x = plotLeft + xValue * plotWidth;
    const y = plotBottom - yValue * plotHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  curve.forEach(([xValue, yValue], index) => {
    const x = plotLeft + xValue * plotWidth;
    const y = plotBottom - yValue * plotHeight;
    const selected = index === state.selectedCurvePoint;
    ctx.fillStyle = currentCurveLane() === "hdr"
      ? curveExposureColorAt(xValue)
      : selected
        ? uiToken("--curve-selected")
        : index === 0 || index === curve.length - 1
          ? uiToken("--curve-endpoint")
          : uiToken("--curve-neutral");
    ctx.beginPath();
    const radius = selected
      ? uiNumberToken("--curve-selected-radius", 6)
      : index === 0 || index === curve.length - 1
        ? uiNumberToken("--curve-endpoint-radius", 4)
        : uiNumberToken("--curve-node-radius", 5);
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = uiToken("--curve-selected-ring");
      ctx.lineWidth = uiNumberToken("--curve-selected-ring-width", 1.5);
      ctx.stroke();
    }
    drawGraphHomeCue(ctx, x, y, radius, yValue - xValue);
  });
  syncCurveControlsFromState();
}

function drawGraphHomeCue(ctx, x, y, radius, deviation) {
  if (Math.abs(deviation) < uiNumberToken("--graph-home-epsilon", 0.006)) return;
  const towardIdentity = deviation > 0 ? 1 : -1;
  const gap = uiNumberToken("--graph-home-cue-gap", 1.5);
  const length = uiNumberToken("--graph-home-cue-length", 6);
  const startY = y + towardIdentity * (radius + gap);
  const capY = startY + towardIdentity * 3;
  ctx.save();
  ctx.globalAlpha = uiNumberToken("--graph-home-cue-opacity", 0.62);
  ctx.strokeStyle = uiToken("--graph-home-cue-color");
  ctx.lineWidth = uiNumberToken("--graph-home-cue-width", 1);
  ctx.beginPath();
  ctx.moveTo(x, startY);
  ctx.lineTo(x, capY);
  ctx.moveTo(x - length / 2, capY);
  ctx.lineTo(x + length / 2, capY);
  ctx.stroke();
  ctx.restore();
}

function drawCurveExposureBands(ctx, layout, width, height) {
  const plotLeft = layout.left;
  const plotTop = layout.top;
  const plotRight = width - layout.right;
  const plotBottom = height - layout.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;
  const bands = falseColorBands();

  ctx.save();
  ctx.globalAlpha = uiNumberToken("--curve-band-opacity", 0.1);
  bands.forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = curveDomainPositionForNits(upper ?? 10000);
    ctx.fillStyle = exposureBandColor(paletteIndex);
    ctx.fillRect(plotLeft + start * plotWidth, plotTop, Math.max(0, (end - start) * plotWidth), plotHeight);
  });
  ctx.restore();

  const levels = falseColorLevels();
  const labelValues = [...new Set([
    0,
    ...bands.flatMap(({ lower, upper }) => [lower, upper]),
    10000,
  ].filter((value) => value !== null && value >= 0 && value <= 10000))].sort((a, b) => a - b);

  ctx.save();
  ctx.font = '9px "Space Mono", "Cascadia Mono", Consolas';
  ctx.textBaseline = "top";
  const lastLabelRight = [-Infinity, -Infinity];
  labelValues.forEach((nits) => {
    const normalized = curveDomainPositionForNits(nits);
    const x = plotLeft + normalized * plotWidth;
    const boundaryBand = bands.find(({ upper }) => upper !== null && Math.abs(upper - nits) < 0.001);
    const boundaryColor = boundaryBand ? exposureBandColor(boundaryBand.paletteIndex) : uiToken("--quiet");
    ctx.strokeStyle = nits === levels.referenceWhite ? uiToken("--curve-reference-line") : `${boundaryColor}80`;
    ctx.lineWidth = nits === levels.referenceWhite ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();

    const label = compactCurveNitLabel(nits);
    const labelWidth = ctx.measureText(label).width;
    const labelX = clamp(x, plotLeft + labelWidth / 2, plotRight - labelWidth / 2);
    const leftEdge = labelX - labelWidth / 2;
    const row = lastLabelRight.findIndex((rightEdge) => leftEdge >= rightEdge + 5);
    if (row < 0) return;
    ctx.fillStyle = nits === levels.referenceWhite ? uiToken("--equalizer-axis") : uiToken("--curve-axis-label");
    ctx.textAlign = "center";
    ctx.fillText(label, labelX, plotBottom + 5 + row * 10);
    lastLabelRight[row] = labelX + labelWidth / 2;
  });
  ctx.restore();
}

function curveExposureGradient(ctx, plotLeft, plotRight) {
  const gradient = ctx.createLinearGradient(plotLeft, 0, plotRight, 0);
  falseColorBands().forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = curveDomainPositionForNits(upper ?? 10000);
    gradient.addColorStop(start, exposureBandColor(paletteIndex));
    gradient.addColorStop(Math.max(start, end - 0.0001), exposureBandColor(paletteIndex));
  });
  return gradient;
}

function curveExposureColorAt(normalized) {
  const nits = curveDomainNitsForPosition(normalized);
  const band = falseColorBands().find(({ upper }) => upper === null || nits < upper);
  return exposureBandColor(band?.paletteIndex ?? falseColorPaletteTokens.length - 1);
}

function curveDomainPositionForNits(value) {
  const nits = clamp(Number(value) || 0, 0, 10000);
  if (nits <= 100) return 0.5 * ((nits / 100) ** (1 / Math.log(100)));
  return clamp(0.5 + 0.5 * Math.log2(nits / 100) / Math.log2(100), 0, 1);
}

function curveDomainNitsForPosition(value) {
  const normalized = clamp(Number(value) || 0, 0, 1);
  if (normalized <= 0.5) return 100 * ((normalized * 2) ** Math.log(100));
  return 100 * (2 ** ((normalized - 0.5) * 2 * Math.log2(100)));
}

function compactCurveNitLabel(value) {
  if (value >= 1000) return `${Number((value / 1000).toFixed(value % 1000 === 0 ? 0 : 1))}K`;
  if (value >= 10) return `${Math.round(value)}`;
  return `${Number(value.toFixed(1))}`;
}

function currentCurveValues() {
  const path = curvePath(state.selectedCurveChannel);
  const values = getValueByPath(state.adjustments, path) || defaultCurvePoints();
  return values.map(([x, y]) => [x, y]);
}

function setCurveValues(channel, values) {
  const normalized = normalizeCurvePoints(values);
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, normalized.length - 1);
  setValueByPath(state.adjustments, curvePath(channel), normalized);
}

function curvePath(channel) {
  return `${currentCurveLane()}.${channel}_curve`;
}

function currentCurveLane() {
  return state.currentView === "sdr" ? "sdr" : "hdr";
}

function curveEditorLayout() {
  return { left: 18, right: 14, top: 14, bottom: 34 };
}

function toneEqualizerEditorLayout() {
  return { left: 34, right: 14, top: 16, bottom: 28 };
}

function canvasLogicalSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width >= 2 && rect.height >= 2) return { width: rect.width, height: rect.height };
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

function curvePointerPosition(clientX, clientY, rect) {
  const layout = curveEditorLayout();
  const canvasX = clientX - rect.left;
  const canvasY = clientY - rect.top;
  return {
    canvasX,
    canvasY,
    x: clamp((canvasX - layout.left) / Math.max(rect.width - layout.left - layout.right, 1), 0, 1),
    y: 1 - clamp((canvasY - layout.top) / Math.max(rect.height - layout.top - layout.bottom, 1), 0, 1),
  };
}

function curvePointCanvasPosition([x, y]) {
  const canvas = els.curveEditor;
  const { width, height } = canvasLogicalSize(canvas);
  const layout = curveEditorLayout();
  return {
    x: layout.left + x * (width - layout.left - layout.right),
    y: height - layout.bottom - y * (height - layout.top - layout.bottom),
  };
}

function curvePointIndexAtPointer(clientX, clientY, rect) {
  const pointer = curvePointerPosition(clientX, clientY, rect);
  const curve = currentCurveValues();
  let nearestIndex = null;
  let nearestDistance = 10 ** 2;
  curve.forEach((point, index) => {
    const position = curvePointCanvasPosition(point);
    const distance = ((position.x - pointer.canvasX) ** 2) + ((position.y - pointer.canvasY) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function curveHitAtPointer(clientX, clientY, rect) {
  const pointer = curvePointerPosition(clientX, clientY, rect);
  const [[, curveY]] = sampleCurvePoints(currentCurveValues(), 1, pointer.x);
  const curvePosition = curvePointCanvasPosition([pointer.x, curveY]);
  if (Math.abs(curvePosition.y - pointer.canvasY) > 8) return null;
  return { x: pointer.x, y: curveY };
}

function addCurvePoint(requestedX = null) {
  const curve = currentCurveValues();
  if (curve.length >= 16) return null;
  let insertIndex = 1;
  let widestGap = -1;
  if (requestedX === null) {
    for (let index = 0; index < curve.length - 1; index += 1) {
      const gap = curve[index + 1][0] - curve[index][0];
      if (gap > widestGap) {
        widestGap = gap;
        insertIndex = index + 1;
      }
    }
  } else {
    insertIndex = curve.findIndex(([x]) => x > requestedX);
    if (insertIndex <= 0) return null;
    widestGap = curve[insertIndex][0] - curve[insertIndex - 1][0];
  }
  const x = requestedX === null ? curve[insertIndex - 1][0] + widestGap / 2 : requestedX;
  if (x - curve[insertIndex - 1][0] < 0.02 || curve[insertIndex][0] - x < 0.02) return null;
  const [[, y]] = sampleCurvePoints(curve, 1, x);
  curve.splice(insertIndex, 0, [x, y]);
  state.selectedCurvePoint = insertIndex;
  setCurveValues(state.selectedCurveChannel, curve);
  return insertIndex;
}

function removeCurvePoint(requestedIndex = null) {
  const curve = currentCurveValues();
  const index = requestedIndex ?? state.selectedCurvePoint ?? Math.floor(curve.length / 2);
  if (curve.length <= 2 || isLockedCurveEndpoint(index)) return;
  curve.splice(index, 1);
  state.selectedCurvePoint = Math.min(index, curve.length - 2);
  setCurveValues(state.selectedCurveChannel, curve);
}

function isLockedCurveEndpoint(index) {
  const curve = currentCurveValues();
  return index <= 0 || index >= curve.length - 1;
}

function normalizeCurvePoints(points) {
  const sorted = points
    .map(([x, y]) => [clamp(Number(x), 0, 1), clamp(Number(y), 0, 1)])
    .sort((a, b) => a[0] - b[0])
    .slice(0, 16);
  if (sorted.length < 2) return defaultCurvePoints();
  sorted[0][0] = 0;
  sorted[sorted.length - 1][0] = 1;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    sorted[index][0] = clamp(sorted[index][0], sorted[index - 1][0] + 0.02, sorted[index + 1][0] - 0.02);
  }
  return sorted;
}

function curveColor(channel) {
  if (channel === "red") return uiToken("--curve-red");
  if (channel === "green") return uiToken("--curve-green");
  if (channel === "blue") return uiToken("--curve-blue");
  return uiToken("--curve-neutral");
}

function uiToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function uiNumberToken(name, fallback) {
  const value = Number.parseFloat(uiToken(name));
  return Number.isFinite(value) ? value : fallback;
}

function exposureBandColor(index) {
  return uiToken(falseColorPaletteTokens[clamp(index, 0, falseColorPaletteTokens.length - 1)]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultCurvePoints() {
  // Keep three editable controls between the fixed black and white anchors.
  return [[0, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [1, 1]];
}

function defaultToneEqualizerNodes() {
  return [-6, -3, 0, 3, 6].map((inputEv) => ({ input_ev: inputEv, adjustment_ev: 0 }));
}

function sampleCurvePoints(points, samples, forcedX = null) {
  const sampleX = forcedX === null
    ? Array.from({ length: samples }, (_, index) => samples <= 1 ? 0 : index / (samples - 1))
    : [forcedX];
  const sampleY = monotoneCurveValues(points, sampleX);
  return sampleX.map((x, index) => [x, sampleY[index]]);
}

function monotoneCurveValues(points, sampleX) {
  const x = points.map((point) => point[0]);
  const y = points.map((point) => point[1]);
  const h = x.slice(1).map((value, index) => Math.max(value - x[index], 1e-6));
  const delta = y.slice(1).map((value, index) => (value - y[index]) / h[index]);
  const slopes = y.map(() => 0);
  slopes[0] = delta[0];
  slopes[slopes.length - 1] = delta[delta.length - 1];

  for (let index = 1; index < y.length - 1; index += 1) {
    if (delta[index - 1] === 0 || delta[index] === 0 || Math.sign(delta[index - 1]) !== Math.sign(delta[index])) {
      slopes[index] = 0;
    } else {
      const w1 = 2 * h[index] + h[index - 1];
      const w2 = h[index] + 2 * h[index - 1];
      slopes[index] = (w1 + w2) / ((w1 / delta[index - 1]) + (w2 / delta[index]));
    }
  }

  return sampleX.map((sample) => {
    let segmentIndex = 0;
    while (segmentIndex < x.length - 2 && sample > x[segmentIndex + 1]) segmentIndex += 1;
    const x0 = x[segmentIndex];
    const x1 = x[segmentIndex + 1];
    const y0 = y[segmentIndex];
    const y1 = y[segmentIndex + 1];
    const m0 = slopes[segmentIndex];
    const m1 = slopes[segmentIndex + 1];
    const segment = Math.max(x1 - x0, 1e-6);
    const t = clamp((sample - x0) / segment, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = (2 * t3) - (3 * t2) + 1;
    const h10 = t3 - (2 * t2) + t;
    const h01 = (-2 * t3) + (3 * t2);
    const h11 = t3 - t2;
    return clamp((h00 * y0) + (h10 * segment * m0) + (h01 * y1) + (h11 * segment * m1), 0, 1);
  });
}

function decodePreviewImage(url) {
  return new Promise((resolve, reject) => {
    const decoder = new Image();
    decoder.onload = () => resolve(decoder);
    decoder.onerror = () => reject(new Error("Image element could not load preview data."));
    decoder.src = url;
  });
}

async function applyPreviewUrl(url, isCurrent = () => true) {
  try {
    await decodePreviewImage(url);
  } catch (error) {
    if (isCurrent()) setPreviewError(error.message || "Preview image failed to decode.");
    return false;
  }
  if (!isCurrent()) return false;
  els.previewImage.src = url;

  els.previewCanvas.style.display = "none";
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  clearInteractiveStraightenPreview();
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  updateZoomReadout();
  hidePreviewMessage();
  return true;
}

async function applyComparisonUrl(url) {
  try {
    await new Promise((resolve, reject) => {
      els.comparisonImage.onload = () => resolve();
      els.comparisonImage.onerror = () => reject(new Error("Comparison image could not load settled preview data."));
      els.comparisonImage.src = url;
    });
  } catch (error) {
    console.warn(error);
    return false;
  } finally {
    els.comparisonImage.onload = null;
    els.comparisonImage.onerror = null;
  }
  els.comparisonCanvas.style.display = "none";
  els.comparisonImage.style.display = "block";
  return true;
}

async function renderGpuDraft(
  lane = state.currentView,
  { hideStatus = true, longEdge = settledProxyLongEdge(), allowInactive = false, tier = "settled" } = {},
) {
  if (geometryDraftActive()) return false;
  if (!gpuPreviewEligible(lane)) return false;
  if (!state.session || (!allowInactive && lane !== state.currentView)) return false;
  if (state.comparePeekActive && !allowInactive) return false;
  if (state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()) return false;
  const serial = ++state.gpuRenderSerial;
  const sessionId = state.session.session_id;
  const generation = state.previewGeneration[lane];
  const requestedGeometrySignature = geometrySignature();
  const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));
  const localSnapshot = state.compareWithoutLocals
    ? []
    : JSON.parse(JSON.stringify(localAdjustments()));
  const maskOverlay = gpuLumaMaskOverlayOptions();
  const sourceOptions = {
    ...(gpuPreviewSourceOptions(lane) || {}),
    tier,
    applicationGeneration: generation,
    // WebGPU renders directly into the mounted canvas. Guard inside the
    // renderer, before it resizes or submits to that canvas, because rejecting
    // the result here after await would already be visibly too late.
    isCurrent: () => serial === state.gpuRenderSerial
      && !geometryDraftActive()
      && state.session?.session_id === sessionId
      && generation === state.previewGeneration[lane]
      && requestedGeometrySignature === geometrySignature()
      && (allowInactive || lane === state.currentView),
  };
  try {
    const result = await state.gpuPreview.render(
      sessionId,
      lane,
      adjustmentsSnapshot,
      sampleCurvePoints,
      longEdge,
      localSnapshot,
      state.editRevision,
      maskOverlay,
      projectReferenceWhiteNits(),
      { width: state.session.source.width, height: state.session.source.height },
      sourceOptions,
    );
    if (!result || !sourceOptions.isCurrent()) return false;
    state.gpuPreparedLane[lane] = true;
    setGpuSurfaceHdr(lane, result.hdr);
    els.previewImage.style.display = "none";
    els.previewCanvas.style.display = "block";
    els.emptyState.style.display = "none";
    state.previewInfo = {
      mediaType: "WebGPU canvas",
      transport: "GPU texture",
      colorSpace: result.hdr ? "Display P3 extended" : "sRGB",
      transfer: "linear canvas",
      bitDepth: result.proxyFormat === "rgba16float" ? "16-bit float proxy" : "32-bit float proxy",
      notes: `Settled WebGPU authoring preview · ${longEdge}px proxy · export quality unchanged`,
    };
      state.previewInfoByLane[lane] = state.previewInfo;
    acceptPresentation(
      lane,
      tier,
      result.width || longEdge,
      result.height || longEdge,
      "WebGPU",
      "",
      result.sourceSerial,
      generation,
    );
    setZoomMode(state.zoomMode);
    renderReadouts();
      if (hideStatus) hidePreviewMessage();
      const submittedAt = performance.now();
      requestAnimationFrame((presentedAt) => {
        if (serial !== state.gpuRenderSerial || (!allowInactive && lane !== state.currentView)) return;
        state.gpuPreview?.recordPresentation?.({
          serial,
          lane,
          longEdge,
          submittedAt,
          presentedAt,
          submitToPresentMs: presentedAt - submittedAt,
        });
        window.dispatchEvent(new CustomEvent("hdrfinisher:preview-presented", {
          detail: { serial, sourceSerial: result.sourceSerial, generation, lane, longEdge, submittedAt, presentedAt },
        }));
        if (maskOverlay) {
          window.dispatchEvent(new CustomEvent("hdrfinisher:mask-presented", {
            detail: {
              localId: maskOverlay.localId,
              generation: serial,
              longEdge,
              requestedAt: submittedAt,
              presentedAt,
              gpuResident: true,
              cpuMaskMs: null,
              byteLength: 0,
            },
          }));
        }
      });
      return true;
  } catch (error) {
    if (error?.recoverable) {
      console.debug("WebGPU authoring render deferred until geometry commit.", error);
      return false;
    }
    console.warn("WebGPU authoring render failed; using raw CPU preview.", error);
    state.gpuPreview.available = false;
    setGpuSurfaceHdr(lane, false);
    state.gpuPreview.detail = error?.message || "WebGPU draft failed";
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    return false;
  }
}

function requestSessionExport(outputPath, overwrite, pathGrant = null, overwriteTarget = null) {
  const resizeMode = els.exportResizeMode?.value || "original";
  return fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: els.exportFormat.value,
      quality: Number(els.exportQuality.value),
      jpeg_gain_map_quality: Number(els.jpegGainMapQuality.value),
      jpeg_gain_map_scale: els.jpegGainMapScale.value,
      jpeg_chroma_subsampling: els.exportFormat.value === "jpeg_ultrahdr"
        ? els.jpegUltrahdrChromaSubsampling.value
        : els.jpegChromaSubsampling.value,
      avif_bit_depth: Number(els.avifBitDepth.value),
      avif_chroma_subsampling: els.avifChromaSubsampling.value,
      avif_gain_map_chroma_subsampling: "444",
      avif_gain_map_quality: Number(els.avifGainMapQuality.value),
      avif_gain_map_scale: els.avifGainMapScale.value,
      sdr_png_bit_depth: Number(els.sdrPngBitDepth.value),
      jpegxl_precision: els.jpegxlPrecision.value,
      dithering: els.exportDithering.value,
      metadata_policy: els.exportMetadataPolicy.disabled ? "none" : els.exportMetadataPolicy.value,
      output_path: outputPath,
      path_grant: pathGrant,
      overwrite,
      overwrite_target: overwriteTarget,
      edit_revision: state.editRevision,
      output_finishing: {
        resize_mode: resizeMode,
        long_edge: resizeMode === "long_edge" ? Number(els.exportLongEdge.value) : null,
        width: resizeMode === "fit" ? Number(els.exportWidth.value) : null,
        height: resizeMode === "fit" ? Number(els.exportHeight.value) : null,
        prevent_enlargement: els.exportPreventEnlargement.checked,
        sharpening: els.exportSharpening.value,
        method: "edge_aware_multiscale",
      },
    }),
  });
}

async function applyOverlayUrl(url, isCurrent = () => true) {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      const decoder = new Image();
      decoder.onload = () => resolve();
      decoder.onerror = () => reject(new Error("Overlay image failed to decode."));
      decoder.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    if (isCurrent()) clearPreviewOverlay();
    return false;
  }
  if (!isCurrent()) {
    URL.revokeObjectURL(url);
    return false;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewOverlay.src = url;
  els.previewOverlay.dataset.objectUrl = url;
  els.previewOverlay.style.display = "block";
  syncOverlayPlacement();
  return true;
}

function clearPreviewImage() {
  els.previewImage.onload = null;
  els.previewImage.onerror = null;
  els.previewImage.removeAttribute("src");
  els.previewImage.style.display = "none";
  els.previewCanvas.style.display = "none";
  els.emptyState.style.display = "grid";
  clearPreviewOverlay();
}

function clearComparisonPreview({ keepRenderedState = false } = {}) {
  els.comparisonImage.removeAttribute("src");
  els.comparisonImage.style.display = "none";
  els.comparisonCanvas.style.display = "none";
  if (!keepRenderedState) {
    state.comparisonRenderedLane = null;
    state.comparisonRenderedGeneration = null;
    state.comparisonRenderedGeometry = null;
  }
}

function activePreviewElement() {
  if (els.chromeProofImage?.style.display !== "none") return els.chromeProofImage;
  return els.previewCanvas.style.display !== "none" ? els.previewCanvas : els.previewImage;
}

function previewIsVisible() {
  return Boolean(state.session && activePreviewElement().style.display !== "none");
}

function clearPreviewOverlay() {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewOverlay.dataset.objectUrl;
  els.previewOverlay.removeAttribute("src");
  els.previewOverlay.style.display = "none";
  els.previewOverlay.style.left = "";
  els.previewOverlay.style.top = "";
  els.previewOverlay.style.width = "";
  els.previewOverlay.style.height = "";
}

function setPreviewMessage(message, progress = 0) {
  els.previewStatusCopy.textContent = message;
  els.previewProgress.value = clamp(Number(progress) || 0, 0, 100);
  els.previewProgress.max = 100;
  els.previewProgress.setAttribute("aria-valuetext", `${Math.round(els.previewProgress.value)}% — ${message}`);
  els.previewProgress.classList.remove("hidden");
  els.previewStatus.classList.remove("hidden", "error");
}

function setIndeterminatePreviewMessage(message) {
  els.previewStatusCopy.textContent = message;
  els.previewProgress.removeAttribute("value");
  els.previewProgress.max = 100;
  els.previewProgress.setAttribute("aria-valuetext", message);
  els.previewProgress.classList.remove("hidden");
  els.previewStatus.classList.remove("hidden", "error");
}

function setPreviewError(message) {
  els.previewStatusCopy.textContent = message;
  els.previewProgress.classList.add("hidden");
  els.previewStatus.classList.remove("hidden");
  els.previewStatus.classList.add("error");
}

function setImportCancelVisible(visible) {
  if (!els.cancelImport) return;
  els.cancelImport.classList.toggle("hidden", !visible);
  els.cancelImport.disabled = false;
}

function hidePreviewMessage() {
  els.previewStatusCopy.textContent = "";
  els.previewProgress.removeAttribute("aria-valuetext");
  els.previewProgress.classList.add("hidden");
  els.previewStatus.classList.add("hidden");
  els.previewStatus.classList.remove("error");
  setImportCancelVisible(false);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function defaultInterpretationValue(session) {
  if (isDevelopedRawSession(session)) return "auto";
  const transfer = (session.source.transfer_function || "").toLowerCase();
  const colorSpace = (session.source.source_color_space || "").toLowerCase();
  if (colorSpace.includes("2020")) return "linear_bt2020";
  if (colorSpace.includes("acescg")) return "linear_acescg";
  if (colorSpace.includes("display p3") || colorSpace === "p3") return "linear_p3";
  return "linear_srgb";
}

function syncInterpretationControls(session) {
  const developedRaw = isDevelopedRawSession(session);
  const mode = session.source.interpretation_mode === "manual" ? "manual" : "auto";
  els.interpretationMode.value = mode;
  els.interpretationColorSpace.value = defaultInterpretationValue(session);
  els.interpretationTransfer.value = developedRaw ? "auto" : defaultTransferValue(session);
  els.interpretationLinearReference.value = session.source.linear_reference || "scene_0_18";
  const needsReview = session.analysis.needs_color_override && mode !== "manual";
  els.sourceSettingsNote.textContent = sourceInterpretationStatus(session);
  els.sourceSettingsNote.classList.toggle("warning", needsReview);
}

function sourceInterpretationStatus(session) {
  if (isDevelopedRawSession(session)) {
    return "Camera-native RAW developed through its camera profile into the ACEScg working space.";
  }
  if (session.source.interpretation_mode === "manual") {
    const colorSpace = session.source.source_color_space || "unknown";
    const transfer = session.source.transfer_function || "unknown";
    const reference = session.source.linear_reference === "diffuse_white_1_0"
      ? "1.0 diffuse white normalized to 0.18"
      : "0.18 scene-linear diffuse white";
    return `Manual source interpretation applied: ${colorSpace} primaries + ${transfer} transfer + ${reference}.`;
  }
  return session.analysis.needs_color_override
    ? "Auto detection found an ambiguous source interpretation."
    : "Auto detection found a consistent source interpretation.";
}

function renderSourceSettingsVisibility() {
  els.sourceSettingsPanel.classList.toggle("hidden", !state.sourceSettingsOpen || !state.session);
  els.sourceSettingsToggle.setAttribute("aria-expanded", String(state.sourceSettingsOpen && Boolean(state.session)));
}

function renderSourceSettingsControls() {
  const developedRaw = isDevelopedRawSession(state.session);
  const manual = els.interpretationMode.value === "manual" && !developedRaw;
  els.interpretationMode.disabled = developedRaw;
  els.interpretationColorSpace.disabled = !manual;
  els.interpretationTransfer.disabled = !manual;
  els.interpretationLinearReference.disabled = !manual || els.interpretationTransfer.value !== "linear";
  els.applyInterpretationButton.disabled = developedRaw;
  els.resetInterpretationButton.disabled = developedRaw;
}

function isDevelopedRawSession(session) {
  return Boolean(
    session?.metadata?.extra?.raw_input &&
      session?.metadata?.extra?.decoder_normalized_to_acescg,
  );
}

function isRawSession(session) {
  return Boolean(session && [".dng", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw"].includes(session.source.suffix));
}

function isDngImportCandidate(candidate) {
  if (!candidate) return false;
  const source = candidate.source || candidate;
  const value = source.suffix || source.path || source.name || source.filename || source.format || "";
  return String(value).toLowerCase().replace(/^dng$/, ".dng").endsWith(".dng");
}

function renderExperimentalDngNote(candidate = null) {
  els.experimentalDngNote?.classList.toggle("hidden", !isDngImportCandidate(candidate));
}

function renderRawImportControls(session) {
  const visible = isRawSession(session);
  const bridgeQualified = Boolean(
    visible &&
      session?.metadata?.extra?.raw_mosaiced !== false &&
      String(session?.metadata?.extra?.raw_pipeline || "").startsWith("camera_linear_float_bridge"),
  );
  setSourceModuleAvailability(
    els.rawSettingsSection,
    visible,
    "RAW Development is available only for RAW sources.",
  );
  setSourceModuleAvailability(
    els.rawHighlightGroup,
    bridgeQualified,
    visible
      ? "Highlight Reconstruction is unavailable for this RAW sensor or color pipeline."
      : "Highlight Reconstruction is available only for supported mosaiced RAW sources.",
  );
  if (!visible) {
    state.rawSettingsOpen = false;
    els.rawSettingsPanel?.classList.add("hidden");
    els.rawSettingsToggle?.setAttribute("aria-expanded", "false");
    return;
  }
  const settings = state.editDocument?.source?.raw_import_settings;
  const lens = settings?.lens || {};
  if (!els.rawSettingsPanel.dataset.initialized) {
    els.lensMode.value = lens.mode || (session.source.suffix === ".dng" && session.metadata.extra?.raw_mosaiced === false ? "off" : "auto");
    els.lensDistortion.checked = lens.distortion !== false;
    els.lensChromaticAberration.checked = lens.chromatic_aberration !== false;
    els.lensVignetting.checked = lens.vignetting !== false;
    els.lensFocal.value = lens.focal_length_mm || "";
    els.lensAperture.value = lens.aperture || "";
    els.lensDistance.value = lens.focus_distance_m || "";
    els.rawSettingsPanel.dataset.initialized = "true";
  }
  els.rawSettingsPanel.classList.toggle("hidden", !state.rawSettingsOpen);
  els.rawSettingsToggle.setAttribute("aria-expanded", String(state.rawSettingsOpen));
  const manual = els.lensMode.value === "manual";
  els.manualLensControls.classList.toggle("hidden", !manual);
  const applied = session.metadata.extra?.lens_correction;
  els.lensSettingsNote.dataset.tooltip = applied?.applied
    ? `Applied ${applied.profile?.lens_maker || ""} ${applied.profile?.lens_model || "selected profile"}. Re-development is required after changing these controls.`
    : applied?.warning || applied?.reason || "Auto applies only one exact profile match. Off and Manual are always available.";
  if (manual && els.lensProfile.options.length <= 1) loadLensProfiles();
  if (bridgeQualified) {
    const highlight = settings?.highlight_reconstruction || {};
    if (els.rawHighlightGroup.dataset.sessionId !== String(session.session_id)) {
      els.rawHighlightMethod.value = highlight.method || "opposed_color_v1";
      els.rawHighlightThreshold.value = String(highlight.clipping_threshold ?? 1.0);
      els.rawHighlightGroup.dataset.sessionId = String(session.session_id);
    }
    renderRawHighlightState({ enabled: highlight.enabled !== false });
  }
}

function setSourceModuleAvailability(module, available, unavailableReason) {
  if (!module) return;
  module.classList.toggle("module-unavailable", !available);
  module.setAttribute("aria-disabled", String(!available));
  module.title = available ? "" : unavailableReason;
  module.querySelectorAll("button, input, select, textarea").forEach((control) => {
    control.disabled = !available;
  });
  if (available) return;
  const toggle = module.querySelector(".group-toggle, .disclosure-trigger");
  toggle?.setAttribute("aria-expanded", "false");
  if (module.classList.contains("control-group")) module.classList.add("collapsed");
  module.querySelector(":scope > .disclosure-content")?.classList.add("hidden");
}

function renderRawHighlightState({ enabled }) {
  if (!els.rawHighlightGroup) return;
  const modified = els.rawHighlightMethod.value !== "opposed_color_v1"
    || Math.abs(Number(els.rawHighlightThreshold.value) - 1) > 1e-8;
  els.rawHighlightBypass.classList.toggle("bypassed", !enabled);
  els.rawHighlightBypass.setAttribute("aria-pressed", String(enabled));
  els.rawHighlightGroup.classList.toggle("bypassed", !enabled);
  els.rawHighlightGroup.classList.toggle("modified", modified);
  els.rawHighlightMethod.disabled = !enabled;
  els.rawHighlightThreshold.disabled = !enabled;
  els.rawHighlightThresholdValue.textContent = Number(els.rawHighlightThreshold.value).toFixed(3);
  updateRangeVisual(els.rawHighlightThreshold);
}

async function loadLensProfiles() {
  const generation = ++state.lensProfileGeneration;
  const query = els.lensProfileSearch.value.trim();
  const response = await fetch(`/api/lens-profiles?q=${encodeURIComponent(query)}&limit=250`);
  const payload = await safeJson(response);
  if (generation !== state.lensProfileGeneration) return;
  if (!response.ok) return;
  const selected = state.editDocument?.source?.raw_import_settings?.lens?.profile_id || els.lensProfile.value;
  els.lensProfile.innerHTML = "";
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = payload.profiles?.length ? "Choose a Lensfun profile" : "No matching profiles";
  els.lensProfile.append(prompt);
  for (const profile of payload.profiles || []) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.camera_maker} ${profile.camera_model} · ${profile.lens_maker} ${profile.lens_model}`.trim();
    option.title = `${profile.mount || "Unknown mount"} · ${profile.distortion ? "distortion" : "no distortion data"} · ${profile.chromatic_aberration ? "CA" : "no CA data"} · ${profile.vignetting ? "vignetting" : "no vignetting data"}`;
    els.lensProfile.append(option);
  }
  if ([...els.lensProfile.options].some((option) => option.value === selected)) els.lensProfile.value = selected;
}

function optionalPositiveNumber(element) {
  const value = Number(element.value);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function rawImportSettingsPayload() {
  return {
    white_balance: "as_shot",
    demosaic: "ahd",
    highlight_reconstruction: {
      enabled: els.rawHighlightBypass?.getAttribute("aria-pressed") === "true",
      method: els.rawHighlightMethod?.value || "opposed_color_v1",
      clipping_threshold: Number(els.rawHighlightThreshold?.value || 1.0),
    },
    lens: {
      mode: els.lensMode.value,
      profile_id: els.lensMode.value === "manual" ? els.lensProfile.value || null : null,
      database_version: null,
      distortion: els.lensDistortion.checked,
      chromatic_aberration: els.lensChromaticAberration.checked,
      vignetting: els.lensVignetting.checked,
      focal_length_mm: optionalPositiveNumber(els.lensFocal),
      aperture: optionalPositiveNumber(els.lensAperture),
      focus_distance_m: optionalPositiveNumber(els.lensDistance),
    },
  };
}

async function applyRawImportSettings() {
  if (!desktop || !isRawSession(state.session)) return;
  const sourcePath = sourcePathForClipboard();
  if (!sourcePath) {
    els.lensSettingsNote.dataset.tooltip = "Save or relink the durable source before re-development.";
    return;
  }
  if (els.lensMode.value === "manual" && !els.lensProfile.value) {
    els.lensSettingsNote.dataset.tooltip = "Choose a manual Lensfun profile or switch to Auto/Off.";
    return;
  }
  const selection = await desktop.grantSourcePath(sourcePath);
  if (!selection) return;
  els.applyRawSettings.disabled = true;
  try {
    await openStagedDesktopSource({
      ...selection,
      rawImportSettings: rawImportSettingsPayload(),
      replaceSessionId: state.session.session_id,
    });
  } finally {
    els.applyRawSettings.disabled = false;
  }
}

function defaultTransferValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  if (transfer.includes("pq")) return "pq";
  if (transfer.includes("hlg")) return "hlg";
  if (transfer.includes("srgb")) return "srgb";
  return "linear";
}

function interpretationPayload() {
  if (els.interpretationMode.value !== "manual") return { color_space: null, transfer_function: null, linear_reference: null };
  const mapped = interpretationPayloadFromColorSpace(els.interpretationColorSpace.value);
  const transfer = interpretationTransferPayload(els.interpretationTransfer.value, mapped.transfer_function);
  return {
    color_space: mapped.color_space,
    transfer_function: transfer,
    linear_reference: transfer === "LINEAR" ? els.interpretationLinearReference.value : null,
  };
}

function interpretationPayloadFromColorSpace(value) {
  if (value === "auto") return { color_space: null, transfer_function: null };
  return interpretationPayloadLegacy(value);
}

function interpretationTransferPayload(value, fallback) {
  if (value === "auto") return fallback ?? null;
  if (value === "pq") return "PQ";
  if (value === "hlg") return "HLG";
  if (value === "srgb") return "sRGB";
  return "LINEAR";
}

function interpretationPayloadLegacy(value) {
  if (value === "linear_acescg") return { color_space: "ACEScg", transfer_function: "LINEAR" };
  if (value === "linear_bt2020") return { color_space: "BT.2020", transfer_function: "LINEAR" };
  if (value === "linear_p3") return { color_space: "Display P3", transfer_function: "LINEAR" };
  return { color_space: "sRGB", transfer_function: "LINEAR" };
}

function overrideMessage(session) {
  if (session.source.interpretation_mode === "manual") return sourceInterpretationStatus(session);
  const note = session.metadata.extra?.color_space_note;
  if (note) return note;
  if (session.analysis.needs_color_override) return "This file needs a color interpretation override before export decisions are trustworthy.";
  return "Auto source interpretation looks consistent.";
}

function interpretationSummary(session) {
  if (isDevelopedRawSession(session)) return "Auto: camera-native RAW profile → ACEScg working";
  const mode = session.source.interpretation_mode === "manual" ? "Manual" : "Auto";
  const colorSpace = session.source.source_color_space || "unknown primaries";
  const transfer = session.source.transfer_function || "unknown transfer";
  return `${mode}: ${colorSpace} + ${transfer}`;
}

function buildDisplayProbe(environment = null) {
  const display = environment?.currentDisplay;
  return {
    dynamicRange: mediaQueryMatch("(dynamic-range: high)") ? "high" : "standard/unknown",
    colorGamut: mediaQueryMatch("(color-gamut: rec2020)")
      ? "rec2020"
      : mediaQueryMatch("(color-gamut: p3)")
        ? "p3"
        : mediaQueryMatch("(color-gamut: srgb)")
          ? "srgb"
          : "unknown",
    pixelRatio: String(window.devicePixelRatio || 1),
    screenDepth: display?.colorDepth ? `${display.colorDepth}-bit output` : `${window.screen?.colorDepth || "?"}-bit browser`,
    browser: navigator.userAgentData?.brands?.map((brand) => brand.brand).join(", ") || navigator.userAgent,
  };
}

function mediaQueryMatch(query) {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function previewInfoFromResponse(response, kind) {
  const mediaType = response.headers.get("content-type") || "unknown";
  if (kind === "hdr") {
    if (mediaType.startsWith("image/png")) {
      return {
        mediaType,
        transport: "PNG",
        colorSpace: "sRGB",
        transfer: "sRGB",
        bitDepth: "8-bit",
        notes: "Deterministic HDR-to-SDR preview for a standard-range display",
      };
    }
    return {
      mediaType,
      transport: "AVIF",
      colorSpace: "BT.2020",
      transfer: "PQ",
      bitDepth: "10-bit 4:4:4",
      notes: "Browser-decoded HDR preview",
    };
  }
  return {
    mediaType,
    transport: "PNG",
    colorSpace: "sRGB",
    transfer: "sRGB",
    bitDepth: "8-bit",
    notes: "Embedded or derived SDR fallback",
  };
}

function renderMetadataVisibility() {
  const open = state.metadataOpen && Boolean(state.session);
  els.metadataPanel.classList.toggle("hidden", !open);
  els.metadataToggle.setAttribute("aria-expanded", String(open));
}

function openManualInterpretation() {
  if (!state.session) return;
  revealSourceRail();
  state.sourceSettingsOpen = true;
  els.interpretationMode.value = "manual";
  renderSourceSettingsVisibility();
  renderSourceSettingsControls();
  els.interpretationColorSpace.focus();
}

function renderInterpretationGate() {
  const needsReview = Boolean(state.session?.analysis?.needs_color_override);
  const visible = needsReview && !state.interpretationGateDismissed;
  els.interpretationGate.classList.toggle("hidden", !visible);
  if (needsReview) {
    els.interpretationGateCopy.textContent = overrideMessage(state.session);
  }
}

async function switchLane(lane) {
  if (!["hdr", "sdr"].includes(lane)) return;
  const switchGeneration = ++state.laneSwitchGeneration;
  abandonPerspectiveDraft();
  if (state.rotateDraftGeometry) closeRotateMode(false);
  // A lane change is a presentation boundary. Commit the newest optimistic
  // global state before either lane renders so a round trip cannot replace a
  // settled draft with an older authoritative revision.
  if (await syncGlobalEditState() === false || switchGeneration !== state.laneSwitchGeneration) return;
  if (state.currentView === lane && cacheReady(lane)) {
    renderLaneChrome();
    renderLocalAdjustments();
    return;
  }
  state.currentView = lane;
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, currentCurveValues().length - 1);
  renderLaneChrome();
  // Local controls belong to the selected rendition too. Update them before
  // waiting for preview/scopes so rapid HDR/SDR switching never leaves the
  // previous lane's values or slider positions visible during rendering.
  renderLocalAdjustments();
  syncCurveControlsFromState();
  renderCurveChannelTabs();
  drawCurveEditor();
  renderReadouts();
  const previewTask = (async () => {
    const rendered = gpuPreviewEligible(lane)
      ? await renderGpuDraft(lane, { longEdge: settledProxyLongEdge() })
      : false;
    if (rendered) return true;
    if (cacheReady(lane)) return showCachedPreview(lane);
    return renderPreviewForLane(lane, true, settledProxyLongEdge(), { showProgress: false });
  })();
  await previewTask;
  if (switchGeneration !== state.laneSwitchGeneration || lane !== state.currentView) return;
  const denoiseIdentity = state.gpuPreview?.diagnosticsSnapshot?.().denoise?.identity || "";
  if (state.denoise[lane].enabled && !denoiseIdentity.includes(`:${lane}:`)) {
    state.denoiseRuntime[lane].status = "dirty";
    await recalculateDenoise();
    if (switchGeneration !== state.laneSwitchGeneration || lane !== state.currentView) return;
  } else if (!state.denoise[lane].enabled && denoiseIdentity && !denoiseIdentity.includes(`:${lane}:`)) {
    state.gpuPreview?.evictDenoiseCache?.();
  }
  // GPU scopes read the presented canvas. Wait until this lane has replaced
  // the previous lane's canvas before sampling it.
  await Promise.all([refreshOverlay(), refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })]);
  if (state.compareLayout !== "single") {
    const other = lane === "hdr" ? "sdr" : "hdr";
    await renderComparisonPreview(other, { force: true });
  }
  prepareInactivePreview();
  if (previewNeedsRefinement()) debouncePreview(lane);
}

function arrangeLaneControlGroups(lane) {
  const panel = els.lanePanels.find((candidate) => candidate.dataset.lanePanel === lane);
  if (!panel) return;
  const groupOrder = lane === "hdr"
    ? ["denoise", "hdr-tone", "hdr-equalizer", "hdr-zones", "hdr-highlights", "curves", "hdr-color"]
    : ["denoise", "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-zones", "curves", "sdr-color"];
  for (const groupName of groupOrder) {
    const group = document.querySelector(`.control-group[data-group="${groupName}"]`);
    if (group) panel.append(group);
  }
  const colorGrading = document.querySelector('.control-group[data-group="color-grading"]');
  const localAdjustmentsGroup = document.querySelector('.control-group[data-group="local-adjustments"]');
  if (colorGrading && localAdjustmentsGroup) colorGrading.after(localAdjustmentsGroup);
}

function renderLaneChrome() {
  const lane = state.currentView;
  arrangeLaneControlGroups(lane);
  document.body.dataset.activeLane = lane;
  els.previewStage.dataset.primaryLane = lane;
  els.previewPrimaryPane.dataset.lane = lane;
  els.previewSecondaryPane.dataset.lane = lane === "hdr" ? "sdr" : "hdr";
  els.viewButtons.forEach((button) => {
    const active = button.dataset.kind === lane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  els.lanePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.lanePanel !== lane));
  els.viewerBranchNote.textContent = branchCopy[lane];
  els.scopeKindLabel.textContent = lane.toUpperCase();
  renderScopeControlAvailability();
  state.previewInfo = state.previewInfoByLane[lane];
  renderDenoiseControls();
  els.filmLookSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.colorGradingSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.vignetteSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.detailSdrActions?.classList.toggle("hidden", lane !== "sdr");
  const match = state.editDocument?.sdr_match;
  els.sdrMatchEntireActions?.classList.toggle("hidden", lane !== "sdr");
  if (els.sdrMatchEntire) {
    els.sdrMatchEntire.textContent = match?.active ? "Convert legacy match" : "Match entire HDR grade";
    els.sdrMatchEntire.disabled = !state.session;
  }
  els.sdrMatchRevert?.classList.toggle("hidden", !match?.active);
  if (els.sdrMatchEntireStatus) {
    els.sdrMatchEntireStatus.textContent = match?.active
      ? match.stale
        ? "Legacy HDR match active · captured HDR has changed"
        : "Legacy HDR match active"
      : match?.materialized_status === "needs_review"
        ? "Match needs review · editable SDR controls populated"
        : match?.materialized_status === "matched"
          ? "Matched into editable SDR controls"
          : "";
  }
  syncControlsFromState();
  drawToneEqualizerEditor(lane);
  window.HDRProofing?.syncLane();
  renderCompareStatus();
  updateControlReadouts();
  renderControlState();
}

function invalidatePreview(lane, { local = false, markDirty = true } = {}) {
  if (markDirty && !local) markGlobalEditDirty();
  state.previewGeneration[lane] += 1;
  window.HDRProofing?.invalidate(lane);
  renderCompareStatus();
  updateExportAvailability();
}

function markGlobalEditDirty() {
  if (!state.session) return;
  state.globalEditDirty = true;
  state.globalEditGeneration += 1;
  state.documentDirty = true;
  updateExportAvailability();
}

function beginGlobalEditGesture(control) {
  if (!state.session || control?.dataset.historyGestureActive === "true") return;
  if (control) control.dataset.historyGestureActive = "true";
  state.globalEditHistorySequence += 1;
  state.globalEditHistoryGroup = `slider-${state.globalEditHistorySequence}`;
}

function endGlobalEditGesture(control) {
  if (control?.dataset.historyGestureActive !== "true") return;
  delete control.dataset.historyGestureActive;
  const group = state.globalEditHistoryGroup;
  // Flush the final optimistic value while the group is still attached. Any
  // settled syncs emitted during this drag and this final sync collapse into
  // one backend HistoryEntry.
  void syncGlobalEditState().finally(() => {
    if (state.globalEditHistoryGroup === group) state.globalEditHistoryGroup = null;
  });
}

function clearPreviewCache() {
  // Source/project replacement must retire tool transactions, without copying
  // their old snapshots into the newly loaded document.
  state.perspectiveSolveController?.abort();
  state.perspectiveSolveController = null;
  state.perspectiveMode = false;
  state.perspectiveDraftGeometry = null;
  state.perspectiveGuides = null;
  state.perspectiveGuidesDirty = false;
  state.perspectiveResetPending = false;
  state.perspectiveTool = null;
  state.perspectiveGuideDrag = null;
  state.rotateDraftGeometry = null;
  state.cropMode = false;
  state.cropDraftGeometry = null;
  state.cropEditBaseCrop = null;
  state.cropDrag = null;
  state.geometryTool = null;
  state.straightenGestureActive = false;
  state.straightenPreviewBaseAngle = null;
  state.globalEditDirty = false;
  state.globalEditSyncPending = null;
  for (const overlay of [els.cropEditorOverlay, els.perspectiveEditorOverlay, els.straightenGridOverlay]) {
    overlay?.classList.add("hidden");
    overlay?.setAttribute("aria-hidden", "true");
  }
  renderGeometryToolState();
  renderPerspectiveControls();
  state.geometryTransformHandoffSignature = null;
  state.detailInteractionRestore = null;
  clearRotateDraftTransformProperties();
  state.previewScheduler?.cancel();
  state.perspectivePreviewController?.abort();
  state.perspectivePreviewController = null;
  window.clearTimeout(state.perspectivePreviewTimer);
  state.perspectivePreviewTimer = 0;
  if (state.perspectivePreviewUrl) URL.revokeObjectURL(state.perspectivePreviewUrl);
  state.perspectivePreviewUrl = null;
  state.scopeRequestInFlight?.controller?.abort();
  state.pendingScopeRequest?.resolve(false);
  state.pendingGpuScopeRequest?.resolve(false);
  state.scopeRequestInFlight = null;
  state.pendingScopeRequest = null;
  state.pendingGpuScopeRequest = null;
  state.overlayAbortController?.abort();
  state.overlayAbortController = null;
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
    const cached = state.previewCache[lane];
    if (cached?.url) URL.revokeObjectURL(cached.url);
    state.previewCache[lane] = null;
    state.previewGeneration[lane] = 0;
  }
  state.comparePeekActive = false;
  state.comparisonRenderedLane = null;
  state.comparisonRenderedGeneration = null;
  state.comparisonRenderedGeometry = null;
  clearGpuSurfaceHdr();
  state.gpuPreparedLane = { hdr: false, sdr: false };
  // A replacement source can have a completely different orientation. Do not
  // let the previous session's fitted aspect survive until the new GPU canvas
  // has presented its first frame.
  state.zoomReferenceFrame = null;
  state.geometryPresentationPending = false;
  // Keep this monotonic across source/session replacement so an old readback
  // can never collide with the first generation of the new source.
  state.scopeGeneration += 1;
  els.scopeFreshness.textContent = "Waiting";
  els.scopeFreshness.classList.remove("updating");
  clearPreviewImage();
  clearComparisonPreview();
  window.HDRProofing?.reset();
}

function cacheReady(lane) {
  const cached = state.previewCache[lane];
  return Boolean(
    (gpuPreviewEligible(lane) && state.gpuPreparedLane[lane])
    || (cached?.generation === state.previewGeneration[lane]
      && cached.geometrySignature === geometrySignature()
      && (cached.url || cached.raw)),
  );
}

async function showCachedPreview(lane) {
  if (geometryDraftActive()) return false;
  const sessionId = state.session?.session_id;
  const cached = state.previewCache[lane];
  // Restoring a view is the final presentation, not a grading gesture. The
  // display-bounded default can replace a refined frame with a 1K proxy after
  // comparison/peek or cancelling Perspective, with no scheduler task left to
  // refine it again. Request the selected quality explicitly; geometry may
  // make the returned bitmap smaller than the requested proxy edge.
  if (gpuPreviewEligible(lane) && state.gpuPreparedLane[lane] && await renderGpuDraft(lane, {
    allowInactive: lane !== state.currentView,
    longEdge: refinementProxyLongEdge(),
    tier: "refinement",
  })) return true;
  const isCurrent = () => !geometryDraftActive() && state.session?.session_id === sessionId
    && cached === state.previewCache[lane] && cached?.generation === state.previewGeneration[lane]
    && cached.geometrySignature === geometrySignature();
  if (!cached || !isCurrent()) return false;
  if (cached.raw) applyRawPreview(cached);
  else if (cached.url) {
    if (!await applyPreviewUrl(cached.url, isCurrent)) return false;
    acceptPresentation(lane, cached.longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", cached.width, cached.height, state.previewInfoByLane[lane].transport, "CPU/backend");
  }
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
  if (lane === state.currentView && !state.comparePeekActive && (cached.longEdge || 0) < refinementProxyLongEdge()) {
    debouncePreview(lane);
  }
  return true;
}

function prepareInactivePreview() {
  if (!state.session) return;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (state.compareLayout !== "single") {
    renderComparisonPreview(other).catch(() => null);
    return;
  }
  if (cacheReady(other)) {
    renderCompareStatus();
    return;
  }
  state.previewScheduler?.scheduleInactive(other, state.previewGeneration[other]);
}

async function preloadInactiveLane(lane, generation) {
  if (!state.session || generation !== state.previewGeneration[lane] || !state.gpuPreview?.available) return;
  if (state.compareLayout !== "single" && lane !== state.currentView) {
    await renderComparisonPreview(lane);
    return;
  }
  try {
    const sourceIdentity = gpuPreviewSourceOptions(lane)?.identity || "source";
    await state.gpuPreview.loadProxy(
      state.session.session_id,
      lane,
      settledProxyLongEdge(),
      geometrySignature(),
      state.editRevision,
      sourceIdentity,
    );
    if (generation !== state.previewGeneration[lane]) return;
    state.gpuPreparedLane[lane] = true;
    renderCompareStatus();
  } catch (error) {
    console.debug("Inactive GPU lane preparation skipped.", error);
  }
}

function renderCompareStatus() {
  if (!state.session) {
    els.compareLayoutButtons.forEach((button) => { button.disabled = true; });
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  const ready = cacheReady(other);
  els.compareLayoutButtons.forEach((button) => { button.disabled = false; });
  els.compareButton.disabled = state.compareLayout === "single" && !ready;
}

function bindCompareControl() {
  els.compareLayoutButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const layout = button.dataset.compareLayout;
      if (layout === "single" && state.compareLayout === "single") {
        const other = state.currentView === "hdr" ? "sdr" : "hdr";
        if (cacheReady(other)) await switchLane(other);
        return;
      }
      await setCompareLayout(layout);
    });
  });
}

function beginCompareHold() {
  if (!state.session || state.compareHoldTimer || state.comparePeekActive) return;
  if (state.compareLayout !== "single") {
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    switchLane(other).catch(() => null);
    return;
  }
  state.compareHeld = true;
  state.compareHoldTimer = window.setTimeout(async () => {
    state.compareHoldTimer = null;
    if (!state.compareHeld) return;
    await peekOtherLane();
  }, 180);
}

async function endCompareHold() {
  if (state.compareLayout !== "single") return;
  if (!state.compareHeld) return;
  state.compareHeld = false;
  if (state.compareHoldTimer) {
    window.clearTimeout(state.compareHoldTimer);
    state.compareHoldTimer = null;
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    if (cacheReady(other)) await switchLane(other);
    return;
  }
  if (state.comparePeekActive) await restoreActiveLane();
}

async function peekOtherLane() {
  if (state.compareLayout !== "single") return;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (!cacheReady(other)) {
    return;
  }
  state.comparePeekActive = true;
  window.HDRProofing?.syncLane();
  clearPreviewOverlay();
  await showCachedPreview(other);
  els.viewerBranchNote.textContent = `${branchCopy[other]} Release V to return to the authored preview.`;
}

async function restoreActiveLane() {
  state.comparePeekActive = false;
  window.HDRProofing?.syncLane();
  await showCachedPreview(state.currentView);
  renderLaneChrome();
  await refreshOverlay();
}

async function setCompareLayout(layout) {
  if (!COMPARE_LAYOUTS.has(layout)) return;
  state.compareLayout = layout;
  state.comparePeekActive = false;
  renderCompareLayout();
  if (layout === "single") {
    await showCachedPreview(state.currentView);
    await refreshOverlay();
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  await renderComparisonPreview(other, { force: true });
}

function renderCompareLayout() {
  const layout = COMPARE_LAYOUTS.has(state.compareLayout) ? state.compareLayout : "single";
  els.previewStage.dataset.compareLayout = layout;
  els.previewSecondaryPane.setAttribute("aria-hidden", String(layout === "single"));
  els.compareLayoutButtons.forEach((button) => {
    const active = button.dataset.compareLayout === layout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (layout === "single") clearComparisonPreview({ keepRenderedState: true });
  applyZoomGeometry();
  syncOverlayPlacement();
  renderCompareStatus();
}

async function renderComparisonPreview(lane, { force = false } = {}) {
  if (!state.session || state.compareLayout === "single" || lane === state.currentView) return false;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const alreadyRendered = state.comparisonRenderedLane === lane
    && state.comparisonRenderedGeneration === generation
    && state.comparisonRenderedGeometry === signature
    && (els.comparisonCanvas.style.display !== "none" || els.comparisonImage.style.display !== "none");
  if (!force && alreadyRendered) return true;

  els.previewSecondaryPane.dataset.lane = lane;
  if (gpuPreviewEligible(lane)) {
    try {
      const result = await state.gpuPreview.renderTo(
        els.comparisonCanvas,
        state.session.session_id,
        lane,
        state.adjustments,
        sampleCurvePoints,
        settledProxyLongEdge(),
        state.compareWithoutLocals ? [] : localAdjustments(),
        state.editRevision,
        null,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        gpuPreviewSourceOptions(lane),
      );
      if (result && lane !== state.currentView && generation === state.previewGeneration[lane]) {
        state.gpuPreparedLane[lane] = true;
        els.comparisonImage.style.display = "none";
        els.comparisonCanvas.style.display = "block";
        state.comparisonRenderedLane = lane;
        state.comparisonRenderedGeneration = generation;
        state.comparisonRenderedGeometry = signature;
        applyZoomGeometry();
        renderCompareStatus();
        return true;
      }
    } catch (error) {
      console.warn("Comparison WebGPU render failed; using the settled backend preview.", error);
    }
  }

  let cached = state.previewCache[lane];
  if (!(cached?.generation === generation && cached.geometrySignature === signature && (cached.raw || cached.url))) {
    await renderPreviewForLane(lane, false, settledProxyLongEdge(), {
      showProgress: false,
      raw: !state.gpuPreview?.available,
    });
    cached = state.previewCache[lane];
  }
  if (!cached || lane === state.currentView || generation !== state.previewGeneration[lane]) return false;
  if (cached.raw) applyRawComparisonPreview(cached);
  else if (cached.url) {
    const applied = await applyComparisonUrl(cached.url);
    if (!applied) return false;
  } else return false;
  state.comparisonRenderedLane = lane;
  state.comparisonRenderedGeneration = generation;
  state.comparisonRenderedGeometry = signature;
  applyZoomGeometry();
  renderCompareStatus();
  return true;
}

function setZoomMode(mode) {
  if (mode === "actual") {
    setCustomZoom(100);
    return;
  }
  if (mode === "custom") {
    setCustomZoom(state.zoomPercent);
    return;
  }
  state.zoomMode = "fit";
  els.dropzone.scrollLeft = 0;
  els.dropzone.scrollTop = 0;
  applyZoomGeometry();
}

function shouldKeepHdrGpuSurface(lane) {
  return lane === state.currentView
    && Boolean(state.gpuPreview?.available)
    && !state.comparePeekActive;
}

function setCustomZoom(percent, anchor = null) {
  const nextPercent = clamp(Number(percent) || 100, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
  const preview = anchor?.previewElement || activePreviewElement();
  const imageVisible = previewIsVisible();
  const oldRect = imageVisible ? preview.getBoundingClientRect() : null;
  const anchorX = anchor?.clientX ?? (els.dropzone.getBoundingClientRect().left + els.dropzone.clientWidth / 2);
  const anchorY = anchor?.clientY ?? (els.dropzone.getBoundingClientRect().top + els.dropzone.clientHeight / 2);
  const normalizedX = oldRect?.width ? clamp((anchorX - oldRect.left) / oldRect.width, 0, 1) : 0.5;
  const normalizedY = oldRect?.height ? clamp((anchorY - oldRect.top) / oldRect.height, 0, 1) : 0.5;

  state.zoomMode = "custom";
  state.zoomPercent = nextPercent;
  applyZoomGeometry();

  if (oldRect) {
    const newRect = preview.getBoundingClientRect();
    els.dropzone.scrollLeft += (newRect.left + normalizedX * newRect.width) - anchorX;
    els.dropzone.scrollTop += (newRect.top + normalizedY * newRect.height) - anchorY;
  }
  syncOverlayPlacement();
}

function applyZoomGeometry() {
  const preview = activePreviewElement();
  const visible = previewIsVisible();
  els.dropzone.classList.toggle("zoom-custom", state.zoomMode === "custom");
  els.zoomFit.classList.toggle("active", state.zoomMode === "fit");
  els.zoomActual.classList.toggle("active", state.zoomMode === "custom" && Math.abs(state.zoomPercent - 100) < 0.01);
  if (!visible) {
    updateZoomReadout();
    return;
  }
  if (state.geometryPresentationPending) {
    updateZoomReadout();
    syncOverlayPlacement();
    return;
  }

  // Geometry can change the rendered frame's dimensions. Size the viewer from
  // the current bitmap, not the original source, or a crop is stretched back
  // into the source aspect ratio after it is applied.
  const renderedWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
  const renderedHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
  const renderedFrameWidth = Math.max(1, renderedWidth || state.session.source.width);
  const renderedFrameHeight = Math.max(1, renderedHeight || state.session.source.height);
  const renderedAspect = renderedFrameWidth / renderedFrameHeight;
  const interactiveRotateAngle = Number.parseFloat(
    preview.style.getPropertyValue("--interactive-rotate-angle"),
  ) || 0;
  const interactiveQuarterTurns = Math.round(Math.abs(interactiveRotateAngle) / 90) % 4;
  const interactiveRotationSwapsAxes = interactiveQuarterTurns % 2 === 1;
  const sessionId = state.session?.session_id || null;
  const geometrySignature = JSON.stringify(state.adjustments?.shared?.geometry || {});
  const previewFrameReady = preview instanceof HTMLCanvasElement
    ? Boolean(state.gpuPreparedLane[state.currentView])
    : Boolean(preview.complete && preview.naturalWidth > 0);
  if (previewFrameReady && !interactiveRotationSwapsAxes && (
    !state.zoomReferenceFrame
    || state.zoomReferenceFrame.sessionId !== sessionId
    || state.zoomReferenceFrame.geometrySignature !== geometrySignature
  )) {
    state.zoomReferenceFrame = {
      sessionId,
      geometrySignature,
      longEdge: state.zoomReferenceFrame?.sessionId === sessionId
        ? state.zoomReferenceFrame.longEdge
        : Math.max(renderedFrameWidth, renderedFrameHeight),
      aspect: renderedAspect,
    };
  }
  // Settled/local previews can replace the interactive bitmap with a slightly
  // different proxy size (for example 726px -> the 768px settled minimum).
  // CSS geometry must use one stable per-session reference or every such swap
  // looks like a zoom and shifts the scroll position at custom magnification.
  // Keep one aspect for the whole geometry state. Interactive and settled
  // proxies can differ by a pixel after crop/rotation rounding; using each
  // bitmap's aspect made ordinary grading gestures appear to shift the image.
  // A geometry-signature change captures a new aspect, while tonal/color edits
  // can freely swap proxy resolution without changing viewport placement.
  const referenceLongEdge = state.zoomReferenceFrame?.sessionId === sessionId
    ? state.zoomReferenceFrame.longEdge
    : Math.max(renderedFrameWidth, renderedFrameHeight);
  const referenceAspect = state.zoomReferenceFrame?.sessionId === sessionId
    && state.zoomReferenceFrame.geometrySignature === geometrySignature
    && Number.isFinite(state.zoomReferenceFrame.aspect)
    ? state.zoomReferenceFrame.aspect
    : renderedAspect;
  // Actual-size and custom zoom are defined in source/output pixels, including
  // while Rotate is transforming the previously committed bitmap. Falling
  // back to the smaller proxy frame during a draft makes the image zoom out;
  // accepting the authoritative frame then jumps back to source size. Use the
  // transaction's original geometry because that is the bitmap currently
  // receiving the CSS transform. A committed handoff returns above while its
  // old bitmap is still mounted.
  const sourceFrame = sourcePixelFrameDimensions(
    state.rotateDraftGeometry || state.adjustments?.shared?.geometry,
  );
  const sourceWidth = sourceFrame?.width
    || (referenceAspect >= 1 ? referenceLongEdge : referenceLongEdge * referenceAspect);
  const sourceHeight = sourceFrame?.height
    || (referenceAspect >= 1 ? referenceLongEdge / referenceAspect : referenceLongEdge);
  const frameWidth = Math.max(1, els.dropzone.clientWidth);
  const frameHeight = Math.max(1, els.dropzone.clientHeight);
  const paneWidth = state.compareLayout === "side-horizontal" ? frameWidth / 2 : frameWidth;
  const paneHeight = state.compareLayout === "side-vertical" ? frameHeight / 2 : frameHeight;
  const fitSourceWidth = interactiveRotationSwapsAxes ? sourceHeight : sourceWidth;
  const fitSourceHeight = interactiveRotationSwapsAxes ? sourceWidth : sourceHeight;
  const fitPercent = Math.min(paneWidth / fitSourceWidth, paneHeight / fitSourceHeight) * 100;
  const percent = state.zoomMode === "fit" ? fitPercent : state.zoomPercent;
  const displayWidth = Math.max(1, sourceWidth * percent / 100);
  const displayHeight = Math.max(1, sourceHeight * percent / 100);
  const visualDisplayWidth = interactiveRotationSwapsAxes ? displayHeight : displayWidth;
  const visualDisplayHeight = interactiveRotationSwapsAxes ? displayWidth : displayHeight;

  const stageContentWidth = state.compareLayout === "side-horizontal" ? visualDisplayWidth * 2 : visualDisplayWidth;
  const stageContentHeight = state.compareLayout === "side-vertical" ? visualDisplayHeight * 2 : visualDisplayHeight;
  els.previewStage.style.width = `${Math.max(frameWidth, stageContentWidth)}px`;
  els.previewStage.style.height = `${Math.max(frameHeight, stageContentHeight)}px`;
  els.previewImage.style.width = `${displayWidth}px`;
  els.previewImage.style.height = `${displayHeight}px`;
  els.previewCanvas.style.width = `${displayWidth}px`;
  els.previewCanvas.style.height = `${displayHeight}px`;
  els.comparisonImage.style.width = `${displayWidth}px`;
  els.comparisonImage.style.height = `${displayHeight}px`;
  els.comparisonCanvas.style.width = `${displayWidth}px`;
  els.comparisonCanvas.style.height = `${displayHeight}px`;
  if (els.chromeProofImage) {
    els.chromeProofImage.style.width = `${displayWidth}px`;
    els.chromeProofImage.style.height = `${displayHeight}px`;
  }
  if (els.chromeProofWatermark) {
    els.chromeProofWatermark.style.width = `${displayWidth}px`;
    els.chromeProofWatermark.style.height = `${displayHeight}px`;
  }
  state.zoomPercent = percent;
  updateZoomReadout();
  syncOverlayPlacement();
}

function updateZoomReadout() {
  const percent = Math.max(0.01, state.zoomPercent || 100);
  if (document.activeElement !== els.zoomReadout) {
    els.zoomReadout.value = formatZoomPercent(percent);
  }
  els.zoomSlider.value = String(zoomPercentToSlider(clamp(percent, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)));
  els.zoomSlider.setAttribute("aria-valuetext", state.zoomMode === "fit" ? `Fit, ${formatZoomPercent(percent)}` : formatZoomPercent(percent));
  updateRangeVisual(els.zoomSlider);
}

function formatZoomPercent(percent) {
  const digits = percent < 10 ? 1 : 0;
  return `${Number(percent).toFixed(digits)}%`;
}

function commitZoomReadout() {
  const raw = els.zoomReadout.value.trim();
  if (/^fit/i.test(raw)) {
    setZoomMode("fit");
    return;
  }
  const percent = Number.parseFloat(raw.replace("%", ""));
  if (Number.isFinite(percent)) setCustomZoom(percent);
  else updateZoomReadout();
}

function stepZoom(direction) {
  const current = state.zoomPercent || 100;
  const epsilon = 0.001;
  const next = direction > 0
    ? ZOOM_STEPS.find((value) => value > current + epsilon) ?? MAX_ZOOM_PERCENT
    : [...ZOOM_STEPS].reverse().find((value) => value < current - epsilon) ?? MIN_ZOOM_PERCENT;
  setCustomZoom(next);
}

function handleViewerWheel(event) {
  const candidates = [activePreviewElement()];
  if (state.compareLayout !== "single") {
    if (els.comparisonCanvas.style.display !== "none") candidates.push(els.comparisonCanvas);
    if (els.comparisonImage.style.display !== "none") candidates.push(els.comparisonImage);
  }
  const preview = candidates.find((candidate) => {
    if (!candidate) return false;
    const rect = candidate.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!preview) return;
  event.preventDefault();
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * els.dropzone.clientHeight
      : event.deltaY;
  const nextPercent = (state.zoomPercent || 100) * Math.exp(-delta * 0.0022);
  setCustomZoom(nextPercent, { clientX: event.clientX, clientY: event.clientY, previewElement: preview });
}

function zoomPercentToSlider(percent) {
  return Math.log(percent / MIN_ZOOM_PERCENT) / Math.log(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT) * 100;
}

function sliderToZoomPercent(value) {
  return MIN_ZOOM_PERCENT * Math.pow(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT, clamp(value, 0, 100) / 100);
}

function toggleOverlayPopover() {
  closePreviewPopover({ restoreFocus: false });
  const open = els.overlayPopover.classList.toggle("hidden") === false;
  els.overlayToggle.setAttribute("aria-expanded", String(open));
}

function closeOverlayPopover({ restoreFocus = true } = {}) {
  els.overlayPopover.classList.add("hidden");
  els.overlayToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) els.overlayToggle.focus();
}

function togglePreviewPopover() {
  closeOverlayPopover({ restoreFocus: false });
  const open = els.previewPopover.classList.toggle("hidden") === false;
  els.previewToggle.setAttribute("aria-expanded", String(open));
}

function closePreviewPopover({ restoreFocus = true } = {}) {
  els.previewPopover.classList.add("hidden");
  els.previewToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) els.previewToggle.focus();
}

function cycleOverlayMode() {
  const order = ["off", "false_color", "zebra"];
  const current = state.adjustments.shared.overlay_mode || "off";
  const next = order[(order.indexOf(current) + 1) % order.length];
  state.adjustments.shared.overlay_mode = next;
  const control = document.querySelector('[data-path="shared.overlay_mode"]');
  if (control) control.value = next;
  renderOverlayPresetNote();
  refreshOverlay();
}

function toggleAnalysisDock() {
  state.dockCollapsed = !state.dockCollapsed;
  state.layout.dockOpen = !state.dockCollapsed;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  renderDockCollapseControl();
  scheduleLayoutSettled();
}

function renderDockCollapseControl() {
  const expanded = !state.dockCollapsed;
  const action = expanded ? "Collapse" : "Expand";
  els.dockCollapse.setAttribute("aria-expanded", String(expanded));
  els.dockCollapse.setAttribute("aria-label", `${action} Scopes panel`);
  els.dockCollapse.title = `${action} Scopes`;
}

async function activateDockTab(tab) {
  state.activeDockTab = tab;
  state.dockCollapsed = false;
  state.layout.dockOpen = true;
  state.layout.dockTab = tab;
  els.analysisDock.classList.remove("collapsed");
  renderDockCollapseControl();
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = tab === "technical";
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  els.scopeMode.value = technical ? "technical" : tab === "parade" ? "waveform" : tab;
  [els.scopeChannelMode, els.scopeDetail, els.scopeZoom].forEach((control) => { if (control) control.disabled = technical; });
  scheduleLayoutSettled();
  if (technical) return;
  state.scopeMode = tab === "vectorscope" ? "vectorscope" : tab === "waveform" || tab === "parade" ? "waveform" : "histogram";
  if (tab === "parade") state.scopeChannelMode = "parade";
  els.scopeMode.value = state.scopeMode;
  els.scopeChannelMode.value = state.scopeChannelMode;
  renderScopeControlAvailability();
  await refreshScopes();
}

function renderDockSummary() {
  const stats = state.lastScope?.stats || [];
  const wanted = stats.filter((item) => /Peak|% > 1000/.test(item.label)).slice(0, 2);
  els.dockSummary.textContent = wanted.length
    ? wanted.map((item) => `${item.label} ${item.value}`).join(" · ")
    : "Full-resolution processing stats";
}

function updateControlReadouts() {
  els.valueOutputs.forEach((output) => {
    if (output.dataset.editing === "true") return;
    const path = output.dataset.valuePath;
    const value = getValueByPath(state.adjustments, path);
    if (value === undefined) return;
    const text = formatControlValue(path, value);
    output.textContent = text;
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) control.setAttribute("aria-valuetext", text);
  });
  syncTintPurityVisuals();
}

function syncTintPurityVisuals() {
  for (const lane of ["hdr", "sdr"]) {
    const control = document.querySelector(`[data-path="${lane}.tint_purity"]`);
    const track = control?.closest(".range-shell")?.querySelector(".slider-track");
    if (!track) continue;
    track.style.background = `linear-gradient(90deg, #718080, ${darktableTintHueColor(state.adjustments[lane].tint_hue)})`;
  }
}

function darktableTintHueColor(requestedHue) {
  const hue = clamp(Number(requestedHue) || 0, -180, 180);
  const upperIndex = DARKTABLE_TINT_HUE_STOPS.findIndex(([angle]) => angle >= hue);
  const lowerIndex = Math.max(0, upperIndex - 1);
  const [lowerAngle, lowerColor] = DARKTABLE_TINT_HUE_STOPS[lowerIndex];
  const [upperAngle, upperColor] = DARKTABLE_TINT_HUE_STOPS[Math.max(upperIndex, 0)];
  const mix = upperAngle === lowerAngle ? 0 : (hue - lowerAngle) / (upperAngle - lowerAngle);
  const channels = lowerColor.map((channel, index) => Math.round(channel + (upperColor[index] - channel) * mix));
  return `rgb(${channels.join(", ")})`;
}

function formatControlValue(path, value) {
  const numeric = Number(value);
  if (path.endsWith("straighten_angle")) return `${numeric.toFixed(1)}\u00b0`;
  if (path.endsWith("luminance_ev")) return `${numeric.toFixed(2)} EV`;
  if (path.includes("color_grading") || path.includes("vignette")) {
    if (path.endsWith(".hue")) return `${Math.round(numeric)}\u00b0`;
    return `${numeric > 0 && path.endsWith("balance") ? "+" : ""}${Math.round(numeric)}${path.endsWith("balance") ? "" : "%"}`;
  }
  if (path.endsWith("white_balance_kelvin")) return `${Math.round(numeric)} K`;
  if (path.endsWith("clarity_radius_percent")) return `${numeric.toFixed(2)}%`;
  if (path.endsWith("sharpen_radius_px")) return `${numeric.toFixed(2)} px`;
  if (path.includes(".detail.")) return `${numeric > 0 && !path.endsWith("sharpen_threshold") ? "+" : ""}${Math.round(numeric)}`;
  if (path.endsWith("_hue")) return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}°`;
  if (path.endsWith("_purity") || path.endsWith(".saturation") || path.endsWith(".vibrance")) return `${numeric > 0 ? "+" : ""}${Math.round(path.endsWith("_purity") ? numeric : numeric * 100)}%`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path.endsWith("_nits")) return `${Math.round(numeric)} nit`;
  if (path.endsWith("highlight_compression_start_percent") || path.endsWith("highlight_compression_manual_peak_percent")) return `${Math.round(numeric)}%`;
  if (path.endsWith("film_look.halation_radius")) return `${numeric.toFixed(2)}% 35mm gate`;
  if (path.endsWith("film_look.bloom_radius")) return `${numeric.toFixed(2)}% output diag`;
  if (path.includes("film_look")) {
    const signed = /(contrast|toe|shoulder|density|microcontrast|hue_offset)$/.test(path);
    return `${signed && numeric > 0 ? "+" : ""}${Math.round(numeric)}%`;
  }
  if (path.endsWith("highlight_compression_softness")) {
    if (numeric <= 0) return "Off";
    return `${Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(1)}%`;
  }
  if (path.endsWith("highlight_compression_peak_detail")) return `${Math.round(numeric)}%`;
  if (path.endsWith("highlight_compression_bias")) return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
  if (path.endsWith("_range") || (path.endsWith("_pivot") && !path.endsWith("contrast_pivot"))) return `${numeric.toFixed(2)} EV`;
  if (path === "shared.overlay_opacity") return `${Math.round(numeric * 100)}%`;
  if (path === "shared.overlay_threshold") return `${Math.round(numeric)} nit`;
  if (path === "sdr.tone_contrast") return numeric.toFixed(2);
  if (path === "sdr.tone_skew") return numeric > 0 ? `+${numeric.toFixed(2)}` : numeric.toFixed(2);
  if (path.endsWith("contrast_pivot")) return numeric.toFixed(path.startsWith("hdr.") ? 4 : 3);
  if (path.endsWith("contrast") || path.endsWith("lift") || path.endsWith("gain") || path.endsWith("gamma") || path.endsWith("shadow_lift")) return numeric.toFixed(3);
  return numeric.toFixed(2);
}

// Only the fields Crop & Rotate itself owns -- Perspective has its own
// independent Reset and shouldn't be swept up by this one.
function cropRotateGeometryModified(geometry, defaults) {
  return controlGroups.geometry.some((path) => {
    const key = path.split(".").pop();
    return !valuesEqual(geometry?.[key], defaults[key]);
  });
}

function renderGeometryResetState(defaults = defaultAdjustments()) {
  const geometryReset = els.groupResets.find((button) => button.dataset.resetGroup === "geometry");
  if (!geometryReset) return;
  const hasDraft = Boolean(state.cropDraftGeometry || state.rotateDraftGeometry);
  const displayedGeometry = state.cropDraftGeometry || state.adjustments.shared.geometry;
  const geometryModified = cropRotateGeometryModified(displayedGeometry, defaults.shared.geometry)
    || Boolean(state.rotateDraftGeometry && cropRotateGeometryModified(state.adjustments.shared.geometry, defaults.shared.geometry));
  geometryReset.closest(".control-group")?.classList.toggle("modified", geometryModified);
  geometryReset.disabled = !hasDraft && !geometryModified;
  geometryReset.title = "Reset all Crop & Rotate values";
  geometryReset.setAttribute("aria-label", "Reset all Crop & Rotate values");
}

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmLook = state.adjustments[state.currentView]?.film_look;
  document.querySelector("[data-film-grain-custom]")?.toggleAttribute("hidden", filmLook?.grain_film_format !== "custom");
  renderHighlightCompressionControls();
  renderSdrHighlightCompressionControls();
  els.controlRows.forEach((row) => {
    row.classList.toggle("modified", isPathModified(row.dataset.controlPath, defaults));
  });
  for (const [group, paths] of Object.entries(controlGroups)) {
    const count = paths.filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector(`[data-modified-count="${group}"]`);
    if (output) output.textContent = "";
    output?.closest(".control-group")?.classList.toggle("modified", count > 0);
  }
  renderGeometryResetState(defaults);
  for (const lane of ["hdr", "sdr"]) {
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve") && !key.endsWith("_section_enabled") && !["highlight_compression_source_peak_nits", "highlight_compression_source_peak_percent", "rendering_version", "base_section_enabled", "tone_mapper", "tone_contrast", "tone_skew", "highlight_recovery"].includes(key));
    const modified = keys.some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]))
      || laneCurvesModified(lane, defaults);
    const button = els.viewButtons.find((item) => item.dataset.kind === lane);
    button?.classList.toggle("modified", modified);
  }
  const currentLaneDefaults = defaults[state.currentView];
  els.gradeModifiedSummary.textContent = "";
  const curvesModified = laneCurvesModified(state.currentView, defaults);
  els.curveGroupState.textContent = "";
  els.curveReset.closest(".control-group")?.classList.toggle("modified", curvesModified);
  const filmModified = !valuesEqual(state.adjustments[state.currentView]?.film_look, currentLaneDefaults.film_look);
  if (els.filmLookState) els.filmLookState.textContent = "";
  els.filmLookReset?.closest(".control-group")?.classList.toggle("modified", filmModified);
  const gradingModified = !valuesEqual(state.adjustments[state.currentView]?.color_grading, currentLaneDefaults.color_grading);
  if (els.colorGradingState) els.colorGradingState.textContent = "";
  els.colorGradingReset?.closest(".control-group")?.classList.toggle("modified", gradingModified);
  const detailModified = !valuesEqual(state.adjustments[state.currentView]?.detail, currentLaneDefaults.detail);
  document.querySelector(".detail-group")?.classList.toggle("modified", detailModified);
  const vignetteModified = !valuesEqual(state.adjustments[state.currentView]?.vignette, currentLaneDefaults.vignette);
  if (els.vignetteState) els.vignetteState.textContent = "";
  els.vignetteReset?.closest(".control-group")?.classList.toggle("modified", vignetteModified);
  els.sectionBypasses.forEach((button) => {
    const path = resolveAdjustmentPath(button.dataset.sectionPath);
    const enabled = getValueByPath(state.adjustments, path) !== false;
    button.classList.toggle("bypassed", !enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.closest(".control-group")?.classList.toggle("bypassed", !enabled);
  });
  syncDesktopDocumentState();
}

function isPathModified(path, defaults = defaultAdjustments()) {
  return !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path));
}

function valuesEqual(left, right) {
  if ((left && typeof left === "object") || (right && typeof right === "object")) return JSON.stringify(left) === JSON.stringify(right);
  return left === right;
}

function initializeGroupPresetControls() {
  document.querySelectorAll(".control-group[data-group]").forEach((groupElement) => {
    if (!groupPresetContextForElement(groupElement)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-preset text-button";
    button.textContent = "Preset";
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => openGroupPresetDialog(groupElement));
    const header = groupElement.querySelector(":scope > .control-group-header");
    const reset = header?.querySelector(".group-reset");
    if (header) header.insertBefore(button, reset || header.querySelector(".section-bypass"));
  });
  els.groupPresetClose?.addEventListener("click", closeGroupPresetDialog);
  els.groupPresetDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeGroupPresetDialog();
  });
  els.groupPresetSave?.addEventListener("click", saveCurrentGroupPreset);
  els.groupPresetName?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCurrentGroupPreset();
    }
  });
}

async function openGroupPresetDialog(groupElement) {
  const context = groupPresetContextForElement(groupElement);
  if (!context) return;
  state.groupPresetContext = context;
  els.groupPresetTitle.textContent = `${context.label} Presets`;
  els.groupPresetContext.textContent = context.group === "film-look"
    ? `${context.lane.toUpperCase()} Film Look · built-ins are editable starting points; Reset returns Neutral.`
    : context.group === "denoise"
      ? `${context.lane.toUpperCase()} Denoise · presets update cached-analysis settings and live controls; use Recalculate Denoise to rebuild analysis.`
      : `${context.lane.toUpperCase()} ${context.label} · presets affect only this adjustment group.`;
  els.groupPresetName.value = "";
  els.groupPresetStatus.textContent = "";
  if (!els.groupPresetDialog.open) els.groupPresetDialog.showModal();
  await renderGroupPresetList();
  els.groupPresetName.focus();
}

function closeGroupPresetDialog() {
  if (els.groupPresetDialog?.open) els.groupPresetDialog.close();
  state.groupPresetContext = null;
}

async function listSavedGroupPresets(groupId) {
  return window.HDRApplicationShell?.listGradingPresets(groupId) || [];
}

async function persistGroupPreset(preset) {
  return window.HDRApplicationShell?.saveGradingPreset(preset);
}

async function removeGroupPreset(preset) {
  return window.HDRApplicationShell?.deleteGradingPreset(preset);
}

function builtInGroupPresets(context) {
  if (context?.group === "denoise") {
    const defaults = defaultDenoiseDocument()[context.lane];
    return [{
      id: "built-in:photo_fine",
      groupId: context.groupId,
      name: "Photo / Fine",
      builtIn: true,
      values: {
        [`denoise.${context.lane}.controls`]: JSON.parse(JSON.stringify(defaults.controls)),
        [`denoise.${context.lane}.analysis`]: JSON.parse(JSON.stringify(defaults.analysis)),
      },
    }];
  }
  if (context?.group !== "film-look") return [];
  const path = `${context.lane}.film_look`;
  return FILM_LOOK_PRESETS.map((preset) => ({
    id: `built-in:${preset.id}`,
    groupId: context.groupId,
    name: preset.name,
    description: preset.description,
    recipeVersion: preset.recipeVersion,
    builtIn: true,
    values: {
      [path]: JSON.parse(JSON.stringify(preset.recipe)),
    },
  }));
}

function appendGroupPresetSubheading(label) {
  const heading = document.createElement("div");
  heading.className = "group-preset-subheading";
  heading.textContent = label;
  els.groupPresetList.append(heading);
}

function appendGroupPresetRow(preset) {
  const row = document.createElement("div");
  row.className = `group-preset-row${preset.builtIn ? " built-in" : ""}`;
  const name = document.createElement("div");
  name.className = "group-preset-name";
  const strong = document.createElement("strong");
  strong.textContent = preset.name;
  name.append(strong);
  if (preset.description) {
    const description = document.createElement("span");
    description.textContent = preset.description;
    name.append(description);
  }
  if (preset.builtIn) {
    const kind = document.createElement("small");
    kind.textContent = "Built-in";
    name.append(kind);
  }
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "button-secondary";
  apply.textContent = "Apply";
  apply.addEventListener("click", () => applyGroupPreset(preset));
  row.append(name, apply);
  if (!preset.builtIn) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete the “${preset.name}” preset?`)) return;
      await removeGroupPreset(preset);
      await renderGroupPresetList();
    });
    row.append(remove);
  }
  els.groupPresetList.append(row);
}

async function renderGroupPresetList() {
  const context = state.groupPresetContext;
  if (!context) return;
  els.groupPresetList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "group-preset-empty";
  loading.textContent = "Loading presets…";
  els.groupPresetList.append(loading);
  try {
    const presets = await listSavedGroupPresets(context.groupId);
    const builtIns = builtInGroupPresets(context);
    if (state.groupPresetContext !== context) return;
    els.groupPresetList.replaceChildren();
    if (builtIns.length) {
      appendGroupPresetSubheading("Built-in character recipes");
      builtIns.forEach(appendGroupPresetRow);
    }
    if (presets.length) {
      appendGroupPresetSubheading("Saved presets");
      presets.forEach(appendGroupPresetRow);
    } else if (!builtIns.length) {
      const empty = document.createElement("p");
      empty.className = "group-preset-empty";
      empty.textContent = "No presets saved for this group yet.";
      els.groupPresetList.append(empty);
    }
  } catch (error) {
    els.groupPresetList.replaceChildren();
    const failure = document.createElement("p");
    failure.className = "group-preset-empty";
    failure.textContent = error?.message || "Presets could not be loaded.";
    els.groupPresetList.append(failure);
  }
}

async function saveCurrentGroupPreset() {
  const context = state.groupPresetContext;
  if (!context) return;
  const name = els.groupPresetName.value.trim().replace(/\s+/g, " ");
  if (!name) {
    els.groupPresetStatus.textContent = "Enter a preset name.";
    els.groupPresetName.focus();
    return;
  }
  if (builtInGroupPresets(context).some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    els.groupPresetStatus.textContent = "That name belongs to a built-in preset. Choose another name.";
    return;
  }
  const existing = await listSavedGroupPresets(context.groupId);
  if (existing.some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    && !window.confirm(`Replace the existing “${name}” preset?`)) return;
  const values = Object.fromEntries(context.paths.map((path) => [path, JSON.parse(JSON.stringify(groupPresetPathValue(context, path)))]));
  await persistGroupPreset({ groupId: context.groupId, name, recipeVersion: 1, values });
  els.groupPresetName.value = "";
  els.groupPresetStatus.textContent = `Saved “${name}”.`;
  await renderGroupPresetList();
}

function applyGroupPreset(preset) {
  const context = state.groupPresetContext;
  if (!context || preset.groupId !== context.groupId || !preset.values || typeof preset.values !== "object") return;
  if (context.lane === "sdr" && context.group === "film-look") prepareSdrMatchGrainOverride();
  context.paths.forEach((path) => {
    if (Object.hasOwn(preset.values, path)) setGroupPresetPathValue(context, path, JSON.parse(JSON.stringify(preset.values[path])));
  });
  if (context.group === "denoise") {
    const runtime = state.denoiseRuntime[context.lane];
    runtime.dirty = true;
    runtime.status = state.denoise[context.lane].enabled ? "dirty" : "off";
    runtime.showOriginal = !state.denoise[context.lane].enabled;
    renderDenoiseControls();
    void persistDenoiseSettings();
    closeGroupPresetDialog();
    return;
  }
  syncControlsFromState();
  syncCurveControlsFromState();
  drawCurveEditor();
  drawToneEqualizerEditor(context.lane);
  renderControlState();
  renderVignetteCenter();
  invalidatePreview(context.lane);
  debouncePreview(context.lane);
  closeGroupPresetDialog();
}

function laneCurvesModified(lane, defaults = defaultAdjustments()) {
  return ["luma_curve", "red_curve", "green_curve", "blue_curve"]
    .some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]));
}

function resetControlGroup(group) {
  if (group === "denoise") {
    const lane = state.currentView;
    const defaults = defaultDenoiseDocument()[lane];
    state.denoise[lane].controls = JSON.parse(JSON.stringify(defaults.controls));
    state.denoise[lane].analysis = JSON.parse(JSON.stringify(defaults.analysis));
    const runtime = state.denoiseRuntime[lane];
    runtime.dirty = true;
    runtime.status = state.denoise[lane].enabled ? "dirty" : "off";
    runtime.showOriginal = !state.denoise[lane].enabled;
    renderDenoiseControls();
    void persistDenoiseSettings();
    return;
  }
  const paths = controlGroups[group] || [];
  if (!paths.length) return;
  const defaults = defaultAdjustments();
  if (group === "perspective") {
    openPerspectiveMode();
    state.perspectiveSolveController?.abort();
    state.perspectiveSolveController = null;
    // perspective_horizontal, perspective_vertical, and perspective_rotate are
    // exclusively owned by this module, so Reset can zero all three outright.
    // Straighten stays untouched: it belongs to Crop & Rotate.
    state.adjustments.shared.geometry.perspective_horizontal = defaults.shared.geometry.perspective_horizontal;
    state.adjustments.shared.geometry.perspective_vertical = defaults.shared.geometry.perspective_vertical;
    state.adjustments.shared.geometry.perspective_rotate = defaults.shared.geometry.perspective_rotate;
    state.perspectiveGuideDrag = null;
    state.perspectiveGuides = defaultPerspectiveGuides();
    state.perspectiveGuidesTouched = { vertical: false, horizontal: false };
    state.perspectiveGuidesDirty = false;
    // Cancel would otherwise silently discard this reset and bring back the
    // old values -- disable it until the user makes a further edit.
    state.perspectiveResetPending = true;
    renderPerspectiveGuides();
    if (els.perspectiveStatus) els.perspectiveStatus.textContent = "Perspective values reset. Apply this draft, or make a new adjustment.";
    renderPerspectiveControls();
    renderControlState();
    schedulePerspectiveDraftPreview();
    return;
  }
  if (group === "geometry") {
    // Perspective is its own module with its own Reset now -- this one only
    // touches what Crop & Rotate owns (rotation, flip, straighten, crop rect,
    // aspect), and leaves an open Perspective draft alone entirely.
    const current = state.cropDraftGeometry || state.adjustments.shared.geometry;
    if (!cropRotateGeometryModified(current, defaults.shared.geometry) && !state.rotateDraftGeometry) return;
    if (!window.confirm("Reset all Crop & Rotate values?")) return;
    if (state.cropMode) closeCropMode(false);
    if (state.rotateDraftGeometry) closeRotateMode(false);
  }
  paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
  const sectionPath = sectionPathForGroup[group];
  if (sectionPath) setValueByPath(state.adjustments, sectionPath, true);
  syncControlsFromState();
  if (group.endsWith("-equalizer")) drawToneEqualizerEditor(group.startsWith("sdr-") ? "sdr" : "hdr");
  if (group === "geometry") {
    invalidatePreview("hdr"); invalidatePreview("sdr");
  } else invalidatePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
  renderControlState();
  if (group === "geometry" && state.perspectiveMode) {
    // Keep Reset visible inside the active draft, and preserve this separate
    // module's reset if the user subsequently cancels Perspective.
    paths.forEach((path) => {
      const key = path.replace("shared.geometry.", "");
      setValueByPath(state.perspectiveDraftGeometry, key, getValueByPath(defaults, path));
    });
    schedulePerspectiveDraftPreview();
    return;
  }
  debouncePreview(group === "geometry" ? state.currentView : group.startsWith("sdr-") ? "sdr" : "hdr");
}

function setSdrColorSliders(source) {
  if (!state.session || !source) return;
  COLOR_CONTROL_KEYS.forEach((key) => {
    state.adjustments.sdr[key] = source[key];
  });
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function matchHdrColorsToSdr() {
  setSdrColorSliders(state.adjustments.hdr);
}

function resetFilmLook() {
  const lane = state.currentView;
  if (lane === "sdr") prepareSdrMatchGrainOverride();
  state.adjustments[lane].film_look = defaultFilmLook();
  state.adjustments[lane].film_look_section_enabled = true;
  syncControlsFromState();
  invalidatePreview(lane);
  renderControlState();
  debouncePreview(lane);
}

function matchHdrFilmLookToSdr() {
  if (!state.session) return;
  prepareSdrMatchGrainOverride();
  const topLevelEnabled = state.adjustments.sdr.film_look_section_enabled;
  state.adjustments.sdr.film_look = JSON.parse(JSON.stringify(state.adjustments.hdr.film_look));
  state.adjustments.sdr.film_look_section_enabled = topLevelEnabled;
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function resetLaneObject(key, neutral) {
  const lane = state.currentView;
  state.adjustments[lane][key] = JSON.parse(JSON.stringify(neutral));
  state.adjustments[lane][`${key}_section_enabled`] = true;
  syncControlsFromState();
  invalidatePreview(lane);
  renderControlState();
  debouncePreview(lane);
}

function matchLaneObject(key) {
  if (!state.session) return;
  state.adjustments.sdr[key] = JSON.parse(JSON.stringify(state.adjustments.hdr[key]));
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
}

function renderOutputFinishingControls() {
  const mode = els.exportResizeMode?.value || "original";
  els.exportLongEdgeRow?.classList.toggle("hidden", mode !== "long_edge");
  els.exportFitRow?.classList.toggle("hidden", mode !== "fit");
  window.HDRProofing?.invalidate("settings");
}

function activateWorkflowTab(workflow, { focus = false } = {}) {
  const next = ["import", "grade", "proof", "export"].includes(workflow) ? workflow : "import";
  if (next !== "import" && !state.session) return;
  if (next !== "grade") abandonPerspectiveDraft();
  if (next !== "grade" && state.rotateDraftGeometry) closeRotateMode(false);
  if (next !== "grade" && state.cropMode) closeCropMode(true);
  state.activeWorkflow = next;
  document.body.dataset.workflow = next;
  els.workflowTabs.forEach((button) => {
    const active = button.dataset.workflowTab === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  if (next === "export") prepareExportRail();
  renderWorkflowContext();
  window.HDRProofing?.render();
  window.dispatchEvent(new CustomEvent("hdrfinisher:workflowchange", { detail: { workflow: next } }));
  renderVignetteCenter();
}

function prepareExportRail() {
  if (!state.session) return;
  if (!els.exportDirectory.value.trim()) els.exportDirectory.value = state.defaultExportDirectory;
  renderCapabilities();
  renderFormatCards();
  updateExportAvailability();
  els.exportStatus.textContent = "Choose a format and destination.";
}

function openExportSheet() {
  if (!state.session) return;
  activateWorkflowTab("export", { focus: true });
}

function renderCapabilities() {
  const keys = ["avif_gain_map_encoder", "ultrahdr_encoder", "jpegxl_export"];
  const available = keys.filter((key) => state.capabilities[key]?.status === "available").length;
  els.capabilitySummary.textContent = `${available}/3 encoders ready`;
  els.capabilitySummary.className = `capability-chip ${available >= 2 ? "ready" : "attention"}`;

  document.querySelectorAll("[data-capability-for]").forEach((element) => {
    const capability = state.capabilities[element.dataset.capabilityFor];
    const ready = capability?.status === "available";
    element.textContent = ready ? "" : capability?.status === "unverified" ? "Unverified" : "Unavailable";
    element.className = ready ? "ready" : "attention";
    element.title = capability?.detail || "Capability status unavailable.";
  });

  [...els.exportFormat.options].forEach((option) => {
    const capability = state.capabilities[capabilityForFormat[option.value]];
    const availableForExport = capability?.status === "available";
    option.disabled = !availableForExport;
    option.title = availableForExport
      ? exportFormatNotes[option.value] || ""
      : capability?.detail || "This export path is unavailable.";
  });

  if (els.exportFormat.selectedOptions[0]?.disabled) {
    const fallback = [...els.exportFormat.options].find((option) => !option.disabled);
    if (fallback) {
      els.exportFormat.value = fallback.value;
      applyExportPreset(fallback.value, "web_default", { invalidate: false });
    }
  }
  renderFormatCards();
  window.HDRProofing?.render();
}

function markExportPresetCustom() {
  const option = els.exportPreset.querySelector('option[value="custom"]');
  option.hidden = false;
  els.exportPreset.value = "custom";
}

function applyExportPreset(format, presetName, { invalidate = true } = {}) {
  const mapping = exportPresetMappings[format]?.[presetName];
  if (!mapping) return;
  const controls = { quality: els.exportQuality, ...els };
  Object.entries(mapping).forEach(([key, value]) => {
    const control = controls[key];
    if (!control) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else control.value = String(value);
  });
  els.exportResizeMode.value = "original";
  els.exportPreventEnlargement.checked = true;
  els.exportSharpening.value = "off";
  els.exportPreset.value = presetName;
  els.exportPreset.querySelector('option[value="custom"]').hidden = true;
  els.exportQualityValue.textContent = els.exportQuality.value;
  els.jpegGainMapQualityValue.textContent = els.jpegGainMapQuality.value;
  els.avifGainMapQualityValue.textContent = els.avifGainMapQuality.value;
  renderOutputFinishingControls();
  renderFormatCards();
  if (invalidate) window.HDRProofing?.invalidate("settings");
}

function annotateWebDefaultOptions(format) {
  document.querySelectorAll("#export-sheet select option").forEach((option) => {
    if (option.closest("#export-preset, #export-format")) return;
    if (!option.dataset.baseLabel) {
      option.dataset.baseLabel = option.textContent
        .replace(/ · (Recommended|Web recommended|Web Default|Web \/ privacy default)$/i, "");
    }
    option.textContent = option.dataset.baseLabel;
  });
  const webDefault = {
    ...exportPresetMappings[format]?.web_default,
    exportResizeMode: "original",
    exportSharpening: "off",
  };
  const controls = { quality: els.exportQuality, ...els };
  Object.entries(webDefault).forEach(([key, value]) => {
    const control = controls[key];
    if (!(control instanceof HTMLSelectElement)) return;
    const option = [...control.options].find((candidate) => candidate.value === String(value));
    if (option) option.textContent = `${option.dataset.baseLabel || option.textContent} · Web Default`;
  });
}

function applyExportOptionTooltips() {
  Object.entries(exportOptionTooltips).forEach(([key, descriptions]) => {
    const control = els[key];
    if (!(control instanceof HTMLSelectElement)) return;
    [...control.options].forEach((option) => {
      option.title = descriptions[option.value] || "";
    });
    control.title = descriptions[control.value] || "";
  });
  [...els.exportPreset.options].forEach((option) => {
    option.title = ({
      web_default: "Balanced recommended publishing settings.",
      web_optimized: "Smaller files while retaining acceptable publishing quality.",
      maximum_fidelity: "Highest practical precision and color fidelity.",
      custom: "One or more controls differ from the selected built-in preset.",
    })[option.value] || "";
  });
  els.exportFormat.title = els.exportFormat.selectedOptions[0]?.title || "";
  els.exportPreset.title = els.exportPreset.selectedOptions[0]?.title || "";
}

function renderFormatCards() {
  const format = els.exportFormat.value;
  const capability = state.capabilities[capabilityForFormat[format]];
  els.exportFormatNote.textContent = capability?.status === "available"
    ? exportFormatNotes[format]
    : capability?.detail || exportFormatNotes[format];
  els.exportFormat.title = els.exportFormatNote.textContent;
  els.jpegAdvancedSettings.classList.remove("hidden");
  els.avifSettings.classList.toggle("hidden", format !== "avif_gain_map");
  els.jpegUltrahdrSettings.classList.toggle("hidden", format !== "jpeg_ultrahdr");
  els.sdrJpegSettings.classList.toggle("hidden", format !== "sdr_jpeg");
  els.jpegxlSettings.classList.toggle("hidden", format !== "jpegxl_hdr");
  els.sdrPngSettings.classList.toggle("hidden", format !== "sdr_png");

  const qualityApplicable = format !== "sdr_png";
  els.exportQuality.disabled = !qualityApplicable;
  els.exportQualityRow.classList.toggle("disabled-setting", !qualityApplicable);
  els.exportQualityRow.title = qualityApplicable ? "" : "PNG compression is lossless; the Quality setting does not apply.";

  const sourceMetadataApplicable = format !== "avif_gain_map";
  els.exportMetadataPolicy.disabled = !sourceMetadataApplicable;
  els.exportMetadataPolicyField.classList.toggle("disabled-setting", !sourceMetadataApplicable);
  els.exportMetadataPolicyNote.textContent = sourceMetadataApplicable
    ? "Color, HDR, and gain-map signaling is always retained. ‘All including location’ may expose GPS coordinates."
    : "Source metadata is unavailable in the current AVIF gain-map combiner; required color and gain-map signaling is still retained.";
  els.exportMetadataPolicy.title = els.exportMetadataPolicyNote.textContent;

  const selectedBitDepth = format === "avif_gain_map"
    ? Number(els.avifBitDepth.value)
    : format === "sdr_png" ? Number(els.sdrPngBitDepth.value)
    : format === "jpegxl_hdr" ? Number(String(els.jpegxlPrecision.value).match(/\d+/)?.[0] || 12)
    : 8;
  const ditherApplicable = selectedBitDepth === 8 && format !== "jpegxl_hdr";
  els.exportDithering.disabled = !ditherApplicable;
  els.exportDitheringField.classList.toggle("disabled-setting", !ditherApplicable);
  els.exportDitheringNote.textContent = ditherApplicable
    ? "Auto applies deterministic signal-domain dithering when the selected output is quantized to 8 bits."
    : `Dithering is disabled because this ${selectedBitDepth}-bit output does not benefit from 8-bit quantization dither.`;
  els.exportDithering.title = els.exportDitheringNote.textContent;

  const encodingSummary = {
    avif_gain_map: `${els.avifBitDepth.value}-bit sRGB base · ${formatChroma(els.avifChromaSubsampling.value)} primary · 10-bit 4:4:4 gain map · ${els.avifGainMapScale.value} resolution · Rec.2020 PQ alternate`,
    jpeg_ultrahdr: `8-bit sRGB JPEG · ${formatChroma(els.jpegUltrahdrChromaSubsampling.value)} · 8-bit gain map`,
    jpegxl_hdr: `${els.jpegxlPrecision.options[els.jpegxlPrecision.selectedIndex]?.textContent || "12-bit integer"} · Rec.2020 PQ`,
    sdr_jpegxl: "8-bit sRGB JPEG XL · no gain map",
    sdr_png: `${els.sdrPngBitDepth.value}-bit sRGB PNG`,
    sdr_jpeg: `8-bit sRGB JPEG · ${formatChroma(els.jpegChromaSubsampling.value)}`,
  }[format];
  els.exportResolvedEncoding.textContent = `Resolved encoding: ${encodingSummary || "automatic"}`;
  els.exportReferenceWhite.textContent = `HDR reference white: ${projectReferenceWhiteNits()} nits`;
  annotateWebDefaultOptions(format);
  applyExportOptionTooltips();
  if (!sourceMetadataApplicable) els.exportMetadataPolicy.title = els.exportMetadataPolicyNote.textContent;
  if (!ditherApplicable) els.exportDithering.title = els.exportDitheringNote.textContent;
}

function formatChroma(value) {
  return ({ 420: "4:2:0", 422: "4:2:2", 444: "4:4:4" })[value] || value;
}

function updateExportAvailability() {
  const needsOverride = Boolean(state.session?.analysis?.needs_color_override);
  const sourceReady = Boolean(state.session) && (!needsOverride || state.interpretationGateDismissed);
  const encoderKey = capabilityForFormat[els.exportFormat.value];
  const encoderReady = state.capabilities[encoderKey]?.status === "available";
  els.exportConfirmButton.disabled = state.importInProgress || !state.session || !sourceReady || !encoderReady;
}

async function copyLastExportPath() {
  if (!state.lastExportPath) return;
  try {
    await writeClipboardText(state.lastExportPath);
    els.copyExportPath.textContent = "Copied";
  } catch {
    els.copyExportPath.textContent = "Copy failed";
  }
}

async function writeClipboardText(value) {
  if (desktop?.writeClipboardText) return desktop.writeClipboardText(value);
  return navigator.clipboard.writeText(value);
}

function defaultLocalGrade() {
  return {
    enabled: true,
    exposure: 0,
    highlights: 0,
    midtones: 0,
    shadows: 0,
    blacks: 0,
    contrast: 0,
    contrast_pivot: 0.18,
    white_balance_kelvin: 6500,
    tint: 0,
    saturation: 0,
    vibrance: 0,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
    color_grading: defaultColorGrading(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10 },
  };
}

function newMaskLeaf(type) {
  if (type === "brush") {
    return {
      type,
      strokes: [],
      brush_radius: 0.025,
      brush_hardness: 0.75,
      brush_flow: 1,
      brush_opacity: 1,
      brush_smoothing: 0.35,
      mask_shift_edge: 0,
      mask_feather: 0,
      mask_opacity: 1,
    };
  }
  if (type === "linear_gradient") {
    return {
      type,
      start: { x: 0.25, y: 0.5 },
      end: { x: 0.75, y: 0.5 },
      gradient_midpoint_1: 1 / 3,
      gradient_midpoint_2: 2 / 3,
      gradient_fan: 0,
      gradient_luma_enabled: false,
      fade_in_start_ev: -12,
      full_start_ev: -8,
      full_end_ev: 6,
      fade_out_end_ev: 10,
      mask_opacity: 1,
    };
  }
  if (type === "luminance_range") {
    return {
      type,
      fade_in_start_ev: -8.75,
      reference_start_ev: -8,
      full_start_ev: -8,
      full_end_ev: 6,
      reference_end_ev: 6,
      fade_out_end_ev: 6.75,
      mask_feather: 0,
      mask_opacity: 1,
    };
  }
  return {
    type: "path",
    nodes: [],
    feather: 0.02,
    feather_softness: 0,
    feather_mode: "outer_boundary",
    feather_nodes: [],
    mask_opacity: 1,
  };
}

function syncDesktopDocumentState() {
  if (!desktop) return;
  const displayName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "Untitled";
  const payload = { path: state.projectPath || "", dirty: Boolean(state.documentDirty), displayName };
  const key = JSON.stringify(payload);
  if (key === state.desktopDocumentStateKey) return;
  state.desktopDocumentStateKey = key;
  desktop.setDocumentState(payload).catch((error) => {
    state.desktopDocumentStateKey = "";
    console.error("Desktop document state could not be synchronized.", error);
  });
}

function sourcePathForClipboard() {
  return state.editDocument?.source?.durable_path || null;
}

function syncCopySourcePathButton() {
  const sourcePath = sourcePathForClipboard();
  els.copySourcePath.disabled = !sourcePath;
  els.copySourcePath.textContent = "Copy path";
  els.copySourcePath.title = sourcePath
    ? "Copy the full source path"
    : "The original path is unavailable for browser-uploaded files";
}

async function copySourcePath() {
  const sourcePath = sourcePathForClipboard();
  if (!sourcePath) return;
  try {
    await writeClipboardText(sourcePath);
    els.copySourcePath.textContent = "Copied";
  } catch {
    els.copySourcePath.textContent = "Copy failed";
  }
}

function renderSourceFilename(filename) {
  els.sessionName.textContent = filename;
  els.sessionNameTooltip.textContent = filename;
  requestAnimationFrame(syncSourceFilenameOverflow);
}

function syncSourceFilenameOverflow() {
  const overflowed = els.sessionName.scrollHeight > els.sessionName.clientHeight + 1;
  els.sessionNameWrap.classList.toggle("has-overflow", overflowed);
  if (overflowed) {
    els.sessionName.tabIndex = 0;
    els.sessionName.setAttribute("aria-describedby", "session-name-tooltip");
  } else {
    els.sessionName.removeAttribute("tabindex");
    els.sessionName.removeAttribute("aria-describedby");
  }
}

function newMaskExpression(type) {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    operator: "leaf",
    leaf: newMaskLeaf(type),
    children: [],
    inverted: false,
  };
}

function newLocalAdjustment(type, pending = null) {
  const number = (state.editDocument?.local_adjustments?.length || 0) + 1;
  return {
    id: pending?.id || crypto.randomUUID(),
    name: pending?.name || `Local Adjustment ${number}`,
    enabled: true,
    opacity: 1,
    mask: newMaskExpression(type),
    hdr_grade: defaultLocalGrade(),
    sdr_grade: defaultLocalGrade(),
  };
}

async function finishLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft || draft.finishing) return false;
  const local = localAdjustments().find((item) => item.id === draft.localId);
  const leaf = selectedMaskLeaf(local, "path");
  if (!local || !leaf || leaf.nodes.length < 3) {
    cancelLocalPathDraft();
    return false;
  }
  draft.finishing = true;
  state.localPathCreatePendingId = local.id;
  state.localPathDraft = null;
  state.selectedPathNode = 0;
  renderLocalAdjustments();
  const created = draft.command === "update"
    ? await commitSelectedLocal()
    : await queueEditCommand("create_local", { local: JSON.parse(JSON.stringify(local)) });
  state.localPathCreatePendingId = null;
  if (!created) {
    if (draft.command === "update" && draft.previousMask) {
      local.mask = draft.previousMask;
      state.selectedSubMaskId = null;
    } else {
      const index = localAdjustments().findIndex((item) => item.id === local.id);
      if (index >= 0) localAdjustments().splice(index, 1);
      state.selectedLocalId = localAdjustments().at(-1)?.id || null;
    }
    renderLocalAdjustments();
  }
  return created;
}

function cancelLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft) return;
  const local = localAdjustments().find((item) => item.id === draft.localId);
  if (draft.command === "update" && local && draft.previousMask) {
    local.mask = draft.previousMask;
    state.selectedSubMaskId = null;
  } else {
    const index = localAdjustments().findIndex((item) => item.id === draft.localId);
    if (index >= 0) localAdjustments().splice(index, 1);
    state.selectedLocalId = localAdjustments().at(-1)?.id || null;
  }
  state.localPathDraft = null;
  state.localPointerGesture = null;
  state.selectedPathNode = null;
  renderLocalAdjustments();
}

function beginPendingLocalAdjustment() {
  if (state.pendingLocalAdjustment) return state.pendingLocalAdjustment;
  const number = localAdjustments().length + 1;
  state.pendingLocalAdjustment = {
    id: crypto.randomUUID(),
    name: `Local Adjustment ${number}`,
  };
  state.pendingSubMask = null;
  state.selectedLocalId = state.pendingLocalAdjustment.id;
  state.selectedSubMaskId = null;
  state.localTool = null;
  return state.pendingLocalAdjustment;
}

function beginPendingSubMask(local) {
  if (!local) return null;
  const ordinal = subMaskRows(local.mask).length + 1;
  state.pendingSubMask = {
    id: crypto.randomUUID(),
    parentLocalId: local.id,
    name: `Sub-mask ${ordinal}`,
  };
  state.pendingLocalAdjustment = null;
  state.selectedLocalId = local.id;
  state.selectedSubMaskId = state.pendingSubMask.id;
  state.localCreationTool = null;
  state.localTool = null;
  renderLocalAdjustments();
  return state.pendingSubMask;
}

async function assignToolToPending(type) {
  if (!state.editDocument) await refreshEditState();
  if (!state.editDocument) return false;
  state.localCreationTool = null;
  state.localTool = type;
  state.localErase = false;
  if (["brush", "linear_gradient", "luminance_range"].includes(type)) state.localShowMask = true;

  if (state.pendingSubMask) {
    const pending = state.pendingSubMask;
    const local = localAdjustments().find((item) => item.id === pending.parentLocalId);
    if (!local) return false;
    const previousMask = JSON.parse(JSON.stringify(local.mask));
    const expression = newMaskExpression(type);
    const wrapper = {
      id: pending.id,
      enabled: true,
      operator: "union",
      leaf: null,
      children: [local.mask, expression],
      inverted: false,
    };
    local.mask = wrapper;
    state.pendingSubMask = null;
    state.selectedLocalId = local.id;
    state.selectedSubMaskId = wrapper.id;
    if (type === "path") {
      state.localPathDraft = { localId: local.id, command: "update", previousMask, finishing: false };
      state.localPathEditMode = "path";
      state.selectedPathNode = null;
      state.localShowMask = true;
      renderLocalAdjustments();
      els.localMaskOverlay?.focus({ preventScroll: true });
      return true;
    }
    renderLocalAdjustments();
    await commitSelectedLocal();
    return true;
  }

  const pending = state.pendingLocalAdjustment || beginPendingLocalAdjustment();
  const local = newLocalAdjustment(type, pending);
  state.pendingLocalAdjustment = null;
  state.selectedLocalId = local.id;
  state.selectedSubMaskId = null;
  setGradeMode("local");
  if (type === "path") {
    state.editDocument.local_adjustments.push(local);
    state.localPathDraft = { localId: local.id, command: "create", finishing: false };
    state.localPathEditMode = "path";
    state.selectedPathNode = null;
    state.localShowMask = true;
    renderLocalAdjustments();
    els.localMaskOverlay?.focus({ preventScroll: true });
    return true;
  }
  const created = await queueEditCommand("create_local", { local });
  if (!created) state.selectedLocalId = localAdjustments()[0]?.id || null;
  renderLocalAdjustments();
  return created;
}

function bindLocalAdjustmentEvents() {
  els.gradeModeGlobal?.addEventListener("click", () => setGradeMode("global"));
  els.localToolButtons.forEach((button) => button.addEventListener("click", async () => {
    if (state.localPathDraft) await finishLocalPathDraft();
    if (!state.session) {
      els.badge.textContent = "Load an image before creating a local adjustment.";
      els.badge.className = "badge warn";
      if (els.localEmpty) els.localEmpty.textContent = "Load an image, then choose a mask tool to create the first local adjustment.";
      updateLocalToolState();
      return;
    }
    const type = button.dataset.localTool;
    if (state.pendingLocalAdjustment || state.pendingSubMask) {
      await assignToolToPending(type);
      return;
    }
    state.localCreationTool = type;
    state.localErase = false;
    updateLocalToolState();
  }));
  els.localEraser?.addEventListener("click", () => {
    if (els.localEraser.disabled) return;
    state.localErase = !state.localErase;
    updateLocalToolState();
  });
  els.localAdjustmentList?.addEventListener("click", async (event) => {
    const bypassButton = event.target.closest("button[data-local-bypass-id]");
    if (bypassButton) {
      const local = localAdjustments().find((item) => item.id === bypassButton.dataset.localBypassId);
      if (!local) return;
      local.enabled = !local.enabled;
      renderLocalAdjustments();
      queueLocalMaskOverlayRender();
      await queueEditCommand("update_local", { local: JSON.parse(JSON.stringify(local)) }, local.id);
      return;
    }
    const subMaskBypassButton = event.target.closest("button[data-sub-mask-bypass-id]");
    if (subMaskBypassButton) {
      const local = localAdjustments().find((item) => item.id === subMaskBypassButton.dataset.localId);
      const entry = subMaskEntry(local, subMaskBypassButton.dataset.subMaskBypassId);
      if (!local || !entry) return;
      entry.container.enabled = entry.container.enabled === false;
      state.selectedLocalId = local.id;
      state.selectedSubMaskId = entry.id;
      renderLocalAdjustments();
      queueLocalMaskOverlayRender();
      await commitSelectedLocal();
      return;
    }
    const menuAction = event.target.closest("button[data-local-menu-action]");
    if (menuAction) {
      state.selectedLocalId = menuAction.dataset.localId;
      state.selectedSubMaskId = menuAction.dataset.subMaskId || null;
      state.localAdjustmentMenuId = null;
      renderLocalAdjustments();
      if (menuAction.dataset.localMenuAction === "add-sub-mask") beginPendingSubMask(selectedLocal());
      if (menuAction.dataset.localMenuAction === "set-sub-mask-blend") {
        const entry = subMaskEntry(selectedLocal(), menuAction.dataset.subMaskId);
        if (entry) {
          entry.container.operator = menuAction.dataset.blendMode;
          await commitSelectedLocal();
        }
      }
      return;
    }
    const menuButton = event.target.closest("button[data-local-menu-id]");
    if (menuButton) {
      const localId = menuButton.dataset.localMenuId;
      state.selectedLocalId = localId;
      state.selectedSubMaskId = menuButton.dataset.subMaskId || null;
      state.localCreationTool = null;
      state.localTool = selectedMaskLeaf()?.type || null;
      const menuId = state.selectedSubMaskId || localId;
      state.localAdjustmentMenuId = state.localAdjustmentMenuId === menuId ? null : menuId;
      renderLocalAdjustments();
      return;
    }
    const button = event.target.closest("button[data-local-id]");
    if (!button) return;
    state.selectedLocalId = button.dataset.localId;
    state.selectedSubMaskId = button.dataset.subMaskId || null;
    state.localCreationTool = null;
    state.localTool = selectedMaskLeaf()?.type || null;
    state.localAdjustmentMenuId = null;
    renderLocalAdjustments();
  });
  document.addEventListener("pointerdown", (event) => {
    if (state.localPathDraft && !event.target.closest("#local-mask-overlay")) void finishLocalPathDraft();
    if (!state.localAdjustmentMenuId || event.target.closest(".local-adjustment-menu, .local-adjustment-menu-button")) return;
    state.localAdjustmentMenuId = null;
    renderLocalAdjustments();
  });
  document.addEventListener("keydown", (event) => {
    if (state.localPathDraft && event.key === "Escape") {
      event.preventDefault();
      cancelLocalPathDraft();
      return;
    }
    if (state.localPathDraft && event.key === "Enter") {
      event.preventDefault();
      void finishLocalPathDraft();
      return;
    }
    if (event.key !== "Escape" || !state.localAdjustmentMenuId) return;
    state.localAdjustmentMenuId = null;
    renderLocalAdjustments();
  });
  els.localLaneButtons.forEach((button) => button.addEventListener("click", () => {
    void switchLane(button.dataset.localLane);
  }));
  els.localOpacity?.addEventListener("input", () => {
    const local = selectedLocal();
    if (!local) return;
    local.opacity = Number(els.localOpacity.value);
    els.localOpacityValue.textContent = `${Math.round(local.opacity * 100)}%`;
    els.localOpacity.closest(".control-row")?.classList.toggle("modified", Math.abs(local.opacity - 1) > 1e-8);
    scheduleLocalPreview();
  });
  els.localOpacity?.addEventListener("change", () => commitSelectedLocal({ refreshPreview: false }));
  bindLocalPreviewInteraction(els.localOpacity);
  els.localGradeControls.forEach((control) => {
    control.addEventListener("input", () => {
      const local = selectedLocal();
      if (!local) return;
      setValueByPath(local[`${state.currentView}_grade`], control.dataset.localGrade, Number(control.value));
      updateLocalGradeOutput(control.dataset.localGrade, Number(control.value));
      hideLocalMaskOverlayForGradePreview();
      scheduleLocalPreview();
    });
    control.addEventListener("change", () => commitSelectedLocal({ refreshPreview: false }));
    bindLocalPreviewInteraction(control);
  });
  els.localRename?.addEventListener("click", () => {
    const local = selectedLocal();
    if (!local) return;
    const name = window.prompt("Local adjustment name", local.name)?.trim();
    if (name) {
      local.name = name;
      commitSelectedLocal();
    }
  });
  els.localDuplicate?.addEventListener("click", async () => {
    const local = selectedLocal();
    if (!local) return;
    const copy = JSON.parse(JSON.stringify(local));
    copy.id = crypto.randomUUID();
    regenerateMaskExpressionIds(copy.mask);
    copy.name = `${local.name} copy`;
    const index = localAdjustments().findIndex((item) => item.id === local.id) + 1;
    state.selectedLocalId = copy.id;
    await queueEditCommand("create_local", { local: copy, index });
  });
  els.localAddAdjustment?.addEventListener("click", async () => {
    if (!state.session) return;
    beginPendingLocalAdjustment();
    const type = state.localCreationTool;
    if (type) await assignToolToPending(type);
    renderLocalAdjustments();
  });
  els.localInvert?.addEventListener("click", () => {
    const local = selectedLocal();
    if (!local) return;
    const expression = selectedMaskExpression(local);
    if (!expression) return;
    expression.inverted = !expression.inverted;
    if (gpuLumaMaskPreviewActive(local)) scheduleLocalPreview();
    commitSelectedLocal();
  });
  els.localDelete?.addEventListener("click", async () => {
    if (state.pendingLocalAdjustment && state.selectedLocalId === state.pendingLocalAdjustment.id) {
      state.pendingLocalAdjustment = null;
      state.selectedLocalId = localAdjustments()[0]?.id || null;
      renderLocalAdjustments();
      return;
    }
    if (state.pendingSubMask && state.selectedSubMaskId === state.pendingSubMask.id) {
      state.pendingSubMask = null;
      state.selectedSubMaskId = null;
      renderLocalAdjustments();
      return;
    }
    const local = selectedLocal();
    if (!local) return;
    if (state.selectedSubMaskId) {
      const entry = subMaskEntry(local, state.selectedSubMaskId);
      if (!entry) return;
      local.mask = replaceMaskExpression(local.mask, entry.container.id, entry.container.children[0]);
      state.selectedSubMaskId = null;
      state.localTool = firstMaskLeaf(local.mask)?.type || null;
      renderLocalAdjustments();
      await commitSelectedLocal();
      return;
    }
    await queueEditCommand("delete_local", {}, local.id);
    state.selectedLocalId = localAdjustments()[0]?.id || null;
    state.selectedSubMaskId = null;
    renderLocalAdjustments();
  });
  els.localMoveUp?.addEventListener("click", () => moveSelectedLocal(-1));
  els.localMoveDown?.addEventListener("click", () => moveSelectedLocal(1));
  els.localShowMask?.addEventListener("click", () => {
    state.localShowMask = !state.localShowMask;
    if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
    renderLocalAdjustments();
  });
  els.localOverlayColorButton?.addEventListener("click", () => {
    if (typeof els.localOverlayColorInput?.showPicker === "function") els.localOverlayColorInput.showPicker();
    else els.localOverlayColorInput?.click();
  });
  els.localOverlayColorInput?.addEventListener("input", () => {
    state.localOverlayColor = els.localOverlayColorInput.value.toLowerCase();
    if (els.localOverlayColorSwatch) els.localOverlayColorSwatch.style.backgroundColor = state.localOverlayColor;
    if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
    queueLocalMaskOverlayRender();
  });
  els.localCompare?.addEventListener("click", () => {
    state.compareWithoutLocals = !state.compareWithoutLocals;
    els.localCompare.setAttribute("aria-pressed", String(state.compareWithoutLocals));
    invalidatePreview("hdr", { local: true });
    invalidatePreview("sdr", { local: true });
    debouncePreview(state.currentView);
  });
  bindLocalMaskCanvas();
}

function setGradeMode(mode) {
  state.gradeMode = mode === "local" ? "local" : "global";
  document.body.dataset.gradeMode = state.gradeMode;
  els.gradeModeGlobal?.classList.toggle("active", state.gradeMode === "global");
  els.gradeModeLocal?.classList.toggle("active", state.gradeMode === "local");
  els.gradeModeGlobal?.setAttribute("aria-pressed", String(state.gradeMode === "global"));
  if (els.localAdjustmentGroup) {
    const localActive = state.gradeMode === "local";
    els.localAdjustmentGroup.classList.toggle("collapsed", !localActive);
    els.gradeModeLocal?.setAttribute("aria-expanded", String(localActive));
  }
  if (state.gradeMode === "local") void ensureGeometryCoordinateMap();
  renderLocalMaskOverlay();
}

function updateLocalToolState() {
  const local = selectedLocal();
  const assignedType = selectedMaskLeaf(local)?.type || null;
  const displayedType = state.localCreationTool || assignedType;
  const brushSelected = assignedType === "brush";
  const toolLocked = Boolean(assignedType && !state.pendingLocalAdjustment && !state.pendingSubMask);
  els.localToolButtons.forEach((button) => {
    const active = button.dataset.localTool === displayedType;
    button.classList.toggle("active", active);
    button.classList.toggle("queued", Boolean(state.localCreationTool && active));
    button.setAttribute("aria-pressed", String(active));
    button.disabled = toolLocked;
    if (!button.dataset.creationTitle) button.dataset.creationTitle = button.title;
    button.title = toolLocked
      ? (active
        ? `${localMaskTypeLabel(assignedType)} is locked to this mask`
        : `Create a new adjustment or sub-mask to use ${localMaskTypeLabel(button.dataset.localTool)}`)
      : button.dataset.creationTitle;
  });
  if (els.localEraser) {
    els.localEraser.disabled = !brushSelected;
    if (!brushSelected) state.localErase = false;
    els.localEraser.classList.toggle("active", state.localErase);
    els.localEraser.setAttribute("aria-pressed", String(state.localErase));
  }
}

function localAdjustments() {
  return state.editDocument?.local_adjustments || [];
}

function selectedLocal() {
  return localAdjustments().find((item) => item.id === state.selectedLocalId) || null;
}

function subMaskRows(expression, rows = []) {
  if (!expression || expression.operator === "leaf") return rows;
  const children = expression.children || [];
  if (children[0]) subMaskRows(children[0], rows);
  children.slice(1).forEach((child, index) => {
    rows.push({
      id: expression.id || `${rows.length}:${index}`,
      container: expression,
      expression: child,
      operator: expression.operator,
    });
  });
  return rows;
}

function subMaskEntry(local, id) {
  if (!local || !id) return null;
  return subMaskRows(local.mask).find((entry) => entry.id === id) || null;
}

function selectedChildMaskParts(local = selectedLocal()) {
  if (!local || !state.selectedSubMaskId) return null;
  if (state.pendingSubMask?.id === state.selectedSubMaskId) {
    return {
      id: state.pendingSubMask.id,
      parent: local.mask,
      child: null,
    };
  }
  const entry = subMaskEntry(local, state.selectedSubMaskId);
  if (!entry) return null;
  return {
    id: entry.id,
    parent: entry.container.children?.[0] || null,
    child: entry.expression,
  };
}

function selectedMaskExpression(local = selectedLocal()) {
  if (!local) return null;
  if (state.selectedSubMaskId) return subMaskEntry(local, state.selectedSubMaskId)?.expression || null;
  return parentMaskExpression(local.mask);
}

function parentMaskExpression(expression) {
  let current = expression;
  while (current && current.operator !== "leaf" && current.children?.[0]) current = current.children[0];
  return current || null;
}

function selectedMaskLeaf(local = selectedLocal(), type = null) {
  return firstMaskLeaf(selectedMaskExpression(local), type);
}

function replaceMaskExpression(expression, targetId, replacement) {
  if (!expression) return expression;
  if (expression.id === targetId) return replacement;
  if (expression.operator === "leaf") return expression;
  expression.children = (expression.children || []).map((child) => replaceMaskExpression(child, targetId, replacement));
  return expression;
}

function regenerateMaskExpressionIds(expression) {
  if (!expression) return;
  expression.id = crypto.randomUUID();
  (expression.children || []).forEach(regenerateMaskExpressionIds);
}

function renderLocalAdjustments() {
  if (!els.localAdjustmentList) return;
  const locals = localAdjustments();
  if (els.localAdjustmentCount) els.localAdjustmentCount.textContent = locals.length ? String(locals.length) : "0";
  if (!state.selectedLocalId && locals.length) state.selectedLocalId = locals[0].id;
  const validMenuIds = new Set(locals.flatMap((local) => [local.id, ...subMaskRows(local.mask).map((entry) => entry.id)]));
  if (state.localAdjustmentMenuId && !validMenuIds.has(state.localAdjustmentMenuId)) {
    state.localAdjustmentMenuId = null;
  }
  els.localAdjustmentList.innerHTML = "";
  const appendRow = (local, { subMask = null, pending = null } = {}) => {
    let openMenu = null;
    const item = document.createElement("li");
    item.className = "local-adjustment-item";
    item.classList.toggle("is-sub-mask", Boolean(subMask || pending?.parentLocalId));
    item.classList.toggle("is-pending", Boolean(pending));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "local-adjustment-select";
    button.dataset.localId = local?.id || pending?.id;
    if (subMask) button.dataset.subMaskId = subMask.id;
    if (pending?.parentLocalId) {
      button.dataset.localId = pending.parentLocalId;
      button.dataset.subMaskId = pending.id;
    }
    const active = pending
      ? (pending.parentLocalId ? state.selectedSubMaskId === pending.id : state.selectedLocalId === pending.id)
      : local?.id === state.selectedLocalId && (subMask ? subMask.id === state.selectedSubMaskId : !state.selectedSubMaskId);
    button.classList.toggle("active", active);
    const leaf = subMask ? firstMaskLeaf(subMask.expression) : firstMaskLeaf(local?.mask);
    const title = pending?.name || (subMask ? `Sub-mask ${subMaskRows(local.mask).findIndex((entry) => entry.id === subMask.id) + 1}` : local.name);
    const subtitle = pending ? "Pick a tool" : localMaskTypeLabel(leaf?.type || "mask");
    button.innerHTML = `<span class="local-adjustment-copy"><span>${escapeHtml(title)}</span><small>${escapeHtml(subtitle)}</small></span>`;
    if (pending) {
      els.localAdjustmentList.append(item);
      item.append(button);
      return;
    }
    const bypassButton = document.createElement("button");
    bypassButton.type = "button";
    bypassButton.className = "local-adjustment-bypass";
    const enabled = subMask ? subMask.container.enabled !== false : local.enabled !== false;
    bypassButton.classList.toggle("bypassed", !enabled);
    bypassButton.dataset.localId = local.id;
    if (subMask) bypassButton.dataset.subMaskBypassId = subMask.id;
    else bypassButton.dataset.localBypassId = local.id;
    bypassButton.setAttribute("aria-label", `${enabled ? "Bypass" : "Show"} ${title}`);
    bypassButton.setAttribute("aria-pressed", String(!enabled));
    bypassButton.title = `${enabled ? "Bypass" : "Show"} ${title}`;
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "local-adjustment-menu-button";
    menuButton.dataset.localMenuId = local.id;
    if (subMask) menuButton.dataset.subMaskId = subMask.id;
    menuButton.setAttribute("aria-label", `More actions for ${title}`);
    menuButton.setAttribute("aria-haspopup", "menu");
    const menuId = subMask?.id || local.id;
    menuButton.setAttribute("aria-expanded", String(state.localAdjustmentMenuId === menuId));
    menuButton.title = `More actions for ${title}`;
    menuButton.textContent = "⋯";
    item.append(button, bypassButton, menuButton);
    if (state.localAdjustmentMenuId === menuId) {
      const menu = document.createElement("div");
      menu.className = "local-adjustment-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", `Actions for ${title}`);
      if (subMask) {
        [
          ["union", "Union"],
          ["intersect", "Intersection"],
          ["subtract", "Subtract"],
        ].forEach(([mode, label]) => {
          const action = document.createElement("button");
          action.type = "button";
          action.setAttribute("role", "menuitemradio");
          action.setAttribute("aria-checked", String(subMask.container.operator === mode));
          action.dataset.localMenuAction = "set-sub-mask-blend";
          action.dataset.localId = local.id;
          action.dataset.subMaskId = subMask.id;
          action.dataset.blendMode = mode;
          action.textContent = label;
          menu.append(action);
        });
      } else {
        const addMask = document.createElement("button");
        addMask.type = "button";
        addMask.setAttribute("role", "menuitem");
        addMask.dataset.localMenuAction = "add-sub-mask";
        addMask.dataset.localId = local.id;
        addMask.textContent = "Create sub-mask";
        menu.append(addMask);
      }
      item.append(menu);
      openMenu = menu;
    }
    els.localAdjustmentList.append(item);
    if (openMenu) positionLocalAdjustmentMenu(openMenu, menuButton);
  };
  locals.forEach((local) => {
    appendRow(local);
    subMaskRows(local.mask).forEach((subMask) => appendRow(local, { subMask }));
    if (state.pendingSubMask?.parentLocalId === local.id) appendRow(local, { pending: state.pendingSubMask });
  });
  if (state.pendingLocalAdjustment) appendRow(null, { pending: state.pendingLocalAdjustment });
  const local = selectedLocal();
  const hasRows = Boolean(locals.length || state.pendingLocalAdjustment);
  els.localEmpty?.classList.toggle("hidden", hasRows);
  if (!hasRows && els.localEmpty) {
    els.localEmpty.textContent = state.session
      ? "Choose a mask tool, then press + — or press + first and pick a tool."
      : "Load an image to create the first local adjustment.";
  }
  const pendingSelected = state.pendingLocalAdjustment?.id === state.selectedLocalId
    || state.pendingSubMask?.id === state.selectedSubMaskId;
  els.localEditor?.classList.toggle("hidden", !local || pendingSelected);
  const selectedIndex = local ? locals.findIndex((item) => item.id === local.id) : -1;
  if (els.localAddAdjustment) els.localAddAdjustment.disabled = !state.session;
  if (els.localRename) els.localRename.disabled = !local || Boolean(state.selectedSubMaskId);
  if (els.localDuplicate) els.localDuplicate.disabled = !local || Boolean(state.selectedSubMaskId);
  if (els.localDelete) els.localDelete.disabled = !local && !pendingSelected;
  if (els.localMoveUp) els.localMoveUp.disabled = !local || Boolean(state.selectedSubMaskId) || selectedIndex <= 0;
  if (els.localMoveDown) els.localMoveDown.disabled = !local || Boolean(state.selectedSubMaskId) || selectedIndex >= locals.length - 1;
  if (els.projectSave) {
    els.projectSave.disabled = !state.session;
    els.projectSave.textContent = state.documentDirty ? "Save project *" : "Save project";
  }
  syncDesktopDocumentState();
  if (local && !pendingSelected) {
    els.localOpacity.value = String(local.opacity);
    els.localOpacityValue.textContent = `${Math.round(local.opacity * 100)}%`;
    els.localOpacity.closest(".control-row")?.classList.toggle("modified", Math.abs(Number(local.opacity) - 1) > 1e-8);
    const expression = selectedMaskExpression(local);
    const brushLeaf = firstMaskLeaf(expression, "brush");
    els.localInvert.setAttribute("aria-pressed", String(Boolean(expression?.inverted)));
    els.localInvert.textContent = expression?.inverted ? "Restore mask" : "Invert mask";
    els.localInvert.disabled = Boolean(brushLeaf && !(brushLeaf.strokes || []).length);
    syncLocalMaskOverlayControl();
    els.localLaneButtons.forEach((button) => {
      const active = button.dataset.localLane === state.currentView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const grade = local[`${state.currentView}_grade`];
    els.localGradeControls.forEach((control) => {
      control.value = String(getValueByPath(grade, control.dataset.localGrade));
      updateLocalGradeOutput(control.dataset.localGrade, Number(control.value));
    });
    renderMaskTreeEditor(local);
  } else if (els.localMaskTreeSummary) {
    els.localMaskTreeSummary.textContent = "";
    if (els.localGradientControls) {
      els.localGradientControls.textContent = "";
      els.localGradientControls.classList.add("hidden");
    }
  }
  // Selection and HDR/SDR lane changes assign range values programmatically.
  // Keep the shared track/fill component attached to the native thumb instead
  // of retaining the previous local adjustment's visual position.
  syncRangeVisuals(els.localEditor);
  updateLocalToolState();
  renderLocalMaskOverlay();
}

function positionLocalAdjustmentMenu(menu, anchor) {
  if (!menu?.isConnected || !anchor?.isConnected) return;
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 4;
  const left = clamp(
    anchorRect.right - menuRect.width,
    viewportPadding,
    Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding),
  );
  const spaceBelow = window.innerHeight - anchorRect.bottom - viewportPadding;
  const top = spaceBelow >= menuRect.height + gap
    ? anchorRect.bottom + gap
    : Math.max(viewportPadding, anchorRect.top - menuRect.height - gap);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function localMaskTypeLabel(type) {
  return ({
    brush: "Brush",
    linear_gradient: "Linear gradient",
    luminance_range: "Luma range",
    path: "Path",
  })[type] || type.replaceAll("_", " ");
}

function updateLocalGradeOutput(name, value) {
  const control = els.localGradeControls.find((candidate) => candidate.dataset.localGrade === name);
  let output = els.localGradeOutputs.find((candidate) => candidate.dataset.localGradeOutput === name);
  if (!output) {
    const heading = control?.closest(".control-row")?.querySelector(".control-heading");
    if (!heading) return;
    output = document.createElement("output");
    output.dataset.localGradeOutput = name;
    heading.append(output);
    els.localGradeOutputs.push(output);
  }
  if (name === "exposure") output.textContent = `${value.toFixed(2)} EV`;
  else if (name === "white_balance_kelvin") output.textContent = `${Math.round(value)} K`;
  else if (name.endsWith("clarity_radius_percent")) output.textContent = `${value.toFixed(2)}%`;
  else if (name.endsWith("sharpen_radius_px")) output.textContent = `${value.toFixed(2)} px`;
  else output.textContent = Math.abs(value) < 0.005 ? "0" : value.toFixed(2);
  const defaultValue = Number(control?.dataset.defaultValue ?? control?.defaultValue);
  control?.closest(".control-row")?.classList.toggle(
    "modified",
    Number.isFinite(defaultValue) && Math.abs(value - defaultValue) > 1e-8,
  );
}

function syncLocalMaskOverlayControl() {
  if (!els.localShowMask) return;
  const available = selectedLocal()?.enabled !== false;
  const visible = state.localShowMask && available;
  els.localShowMask.disabled = !available;
  els.localShowMask.setAttribute("aria-pressed", String(visible));
  els.localShowMask.innerHTML = `<span class="local-overlay-icon" aria-hidden="true"></span><span>${visible ? "Hide overlay" : "Show overlay"}</span>`;
}

function hideLocalMaskOverlayForGradePreview() {
  if (!state.localShowMask) return;
  state.localShowMask = false;
  syncLocalMaskOverlayControl();
  if (gpuLumaMaskPreviewActive()) scheduleLocalPreview();
  queueLocalMaskOverlayRender();
}

function bindLocalPreviewInteraction(control) {
  if (!control || control.dataset.previewInteractionBound === "true") return;
  control.dataset.previewInteractionBound = "true";
  control.addEventListener("pointerdown", () => {
    beginLocalDetailInteraction(control);
    state.previewScheduler?.beginInteraction();
  });
  ["pointerup", "pointercancel", "change"].forEach((eventName) => {
    control.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  control.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
      beginLocalDetailInteraction(control);
      state.previewScheduler?.beginInteraction();
    }
  });
  control.addEventListener("keyup", () => state.previewScheduler?.endInteraction());
}

function scheduleLocalPreview({ spatialMaskChanged = false } = {}) {
  if (!state.session) return;
  state.localPreviewDirty = true;
  invalidatePreview("hdr", { local: true });
  invalidatePreview("sdr", { local: true });
  // Structural mask drafts keep the previous image until an exact current mask
  // exists, but still use the shared scheduler for live reduced scopes.
  if (spatialMaskChanged) state.localMaskDraftDirty = true;
  debouncePreview(state.currentView);
}

function gpuLumaMaskPreviewActive(local = selectedLocal()) {
  return Boolean(
    state.gpuPreview?.available
    && local?.mask?.operator === "leaf"
    && local.mask.leaf?.type === "luminance_range"
    && (!local.mask.children || local.mask.children.length === 0)
    && valuesEqual(state.adjustments.shared?.geometry, defaultGeometry()),
  );
}

function scheduleSpatialMaskPreview(local) {
  if (gpuLumaMaskPreviewActive(local)) {
    scheduleLocalPreview();
    return;
  }
  state.localMaskDraftDirty = true;
  const selectedLeaf = selectedMaskLeaf(local);
  if (selectedLeaf?.type === "path") beginPathMaskProgress(local);
  if (state.selectedSubMaskId) {
    const parts = selectedChildMaskParts(local);
    if (parts?.parent) queueLocalComparisonMask(local, parts.id, "parent", parts.parent);
    if (parts?.child) queueLocalComparisonMask(local, parts.id, "child", parts.child);
  } else {
    scheduleAuthoritativeLocalMaskDraft(local);
  }
  scheduleLocalPreview({ spatialMaskChanged: true });
}

function gpuLumaMaskOverlayOptions() {
  const local = selectedLocal();
  if (
    state.gradeMode !== "local"
    || !state.localShowMask
    || local?.enabled === false
    || state.selectedSubMaskId
    || !gpuLumaMaskPreviewActive(local)
  ) return null;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(state.localOverlayColor);
  const color = match
    ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
    : [1, 38 / 255, 61 / 255];
  return { localId: local.id, color };
}

function renderMaskTreeEditor(local) {
  const leaf = selectedMaskLeaf(local);
  els.localMaskFooterActions?.append(els.localInvert);
  els.localMaskTreeSummary.textContent = "";
  if (els.localGradientControls) {
    els.localGradientControls.textContent = "";
    els.localGradientControls.classList.add("hidden");
  }
  if (state.selectedSubMaskId) appendLocalMaskComparisonLegend();
  if (!leaf) return;
  if (leaf.type === "luminance_range") {
    const panel = createLocalMaskSubpanel("Luma Controls", "Scene luminance range");
    const helper = document.createElement("p");
    helper.className = "luma-sampling-hint";
    helper.textContent = "Choose a false-color band or sample the image. Presets and samples reset refinement; Alt-sampling removes tones.";
    panel.append(helper, createLuminanceRangeControl(local, leaf));
    [
      { name: "mask_feather", label: "Feather", min: 0, max: 100, step: 1, value: Number(leaf.mask_feather || 0) * 2000, defaultValue: 0, display: (value) => `${Math.round(value)}%`, store: (value) => value / 2000 },
      { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    ].forEach((definition) => appendLocalMaskSlider(panel, leaf, definition, { authoritativePreview: true }));
    els.localMaskTreeSummary.append(panel);
  } else if (leaf.type === "linear_gradient") {
    renderGradientControls(local, leaf);
  } else if (leaf.type === "brush") {
    const settings = brushSettings(leaf);
    const hasStrokes = Boolean((leaf.strokes || []).length);
    const brushPanel = createLocalMaskSubpanel("Brush Controls", "New strokes");
    [
      { name: "brush_radius", label: "Size", min: 0.002, max: 0.2, step: 0.001, value: settings.radius, defaultValue: 0.025, display: (value) => `${(value * 200).toFixed(1)}%` },
      { name: "brush_hardness", label: "Feather", min: 0, max: 100, step: 1, value: (1 - settings.hardness) * 100, defaultValue: 25, display: (value) => `${Math.round(value)}%`, store: (value) => 1 - value / 100 },
      { name: "brush_flow", label: "Flow", min: 1, max: 100, step: 1, value: settings.flow * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
      { name: "brush_opacity", label: "Density", min: 1, max: 100, step: 1, value: settings.opacity * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    ].forEach((definition) => appendLocalMaskSlider(brushPanel, leaf, definition, {
      commit: () => commitSelectedLocal({ refreshPreview: false }),
      previewBrush: true,
    }));

    const maskPanel = createLocalMaskSubpanel("Mask Controls", hasStrokes ? "All strokes" : "Paint to enable");
    [
      { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
      { name: "mask_shift_edge", label: "Shift Edge", min: -100, max: 100, step: 1, value: Number(leaf.mask_shift_edge || 0) * 2000, defaultValue: 0, display: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}%`, store: (value) => value / 2000 },
      { name: "mask_feather", label: "Feather", min: 0, max: 100, step: 1, value: Number(leaf.mask_feather || 0) * 2000, defaultValue: 0, display: (value) => `${Math.round(value)}%`, store: (value) => value / 2000 },
    ].forEach((definition) => appendLocalMaskSlider(maskPanel, leaf, definition, {
      disabled: !hasStrokes,
      hideBrushPreview: true,
    }));
    const actions = document.createElement("div");
    actions.className = "local-brush-actions";
    const undoStroke = document.createElement("button");
    undoStroke.type = "button";
    undoStroke.textContent = "Undo stroke";
    undoStroke.disabled = !hasStrokes;
    undoStroke.addEventListener("click", () => {
      leaf.strokes.pop();
      commitSelectedLocal();
    });
    const clearStrokes = document.createElement("button");
    clearStrokes.type = "button";
    clearStrokes.textContent = "Clear brush";
    clearStrokes.disabled = !hasStrokes;
    clearStrokes.addEventListener("click", () => {
      leaf.strokes = [];
      commitSelectedLocal();
    });
    actions.append(els.localInvert, clearStrokes, undoStroke);
    els.localInvert.textContent = selectedMaskExpression(local)?.inverted ? "Restore Mask" : "Invert Mask";
    els.localInvert.disabled = !hasStrokes;
    maskPanel.append(actions);
    els.localMaskTreeSummary.append(brushPanel, maskPanel);
  } else if (leaf.type === "path") {
    renderPathControls(local, leaf);
  }
}

function renderPathControls(local, leaf) {
  const panel = createLocalMaskSubpanel("Path Controls", state.localPathDraft ? "Click for corners · drag for curves" : "Edit one boundary at a time");
  const modeSwitch = document.createElement("div");
  modeSwitch.className = "path-edit-mode";
  modeSwitch.setAttribute("role", "group");
  modeSwitch.setAttribute("aria-label", "Path boundary to edit");
  for (const mode of ["path", "feather"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "path-mode-button";
    button.textContent = mode === "path" ? "Path" : "Feather";
    button.classList.toggle("active", state.localPathEditMode === mode);
    button.setAttribute("aria-pressed", String(state.localPathEditMode === mode));
    button.disabled = Boolean(state.localPathDraft && mode === "feather");
    button.addEventListener("click", async () => {
      if (mode === "feather") {
        if (leaf.feather_mode !== "outer_boundary") leaf.feather_mode = "outer_boundary";
        materializeFeatherNodes(leaf);
      }
      state.localPathEditMode = mode;
      state.selectedPathNode = null;
      state.pathKeyboardTarget = "node";
      renderMaskTreeEditor(local);
      queueLocalMaskOverlayRender();
      if (mode === "feather") await commitSelectedLocal();
    });
    modeSwitch.append(button);
  }
  panel.append(modeSwitch);

  if (!state.localPathDraft) {
    const nodes = activePathNodes(leaf);
    const selected = state.selectedPathNode === null ? null : nodes[state.selectedPathNode];
    const status = document.createElement("p");
    status.className = "path-node-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = selected
      ? `${state.localPathEditMode === "path" ? "Path" : "Feather"} node ${state.selectedPathNode + 1} of ${nodes.length} · ${selected.node_type}`
      : "Select a node to edit its profile.";
    panel.append(status);

    const nodeModes = document.createElement("div");
    nodeModes.className = "path-node-modes";
    nodeModes.setAttribute("role", "group");
    nodeModes.setAttribute("aria-label", "Selected node profile");
    for (const nodeType of ["sharp", "smooth"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `path-node-mode path-node-mode-${nodeType}`;
      button.disabled = !selected;
      button.classList.toggle("active", selected?.node_type === nodeType);
      button.setAttribute("aria-pressed", String(selected?.node_type === nodeType));
      button.title = nodeType === "sharp" ? "Retract handles and make a sharp corner" : "Create a continuous smooth tangent";
      const icon = document.createElement("span");
      icon.className = "path-node-mode-icon";
      icon.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = nodeType === "sharp" ? "Sharp" : "Smooth";
      button.append(icon, label);
      button.addEventListener("click", () => setSelectedPathNodeType(leaf, nodeType));
      nodeModes.append(button);
    }
    panel.append(nodeModes);
  }

  panel.append(createPathFeatherControl(local, leaf));
  appendLocalMaskSlider(panel, leaf, {
    name: "feather_softness",
    label: "Softness",
    min: 0,
    max: 100,
    step: 1,
    value: Number(leaf.feather_softness || 0) * 100,
    defaultValue: 0,
    display: (value) => `${Math.round(value)}%`,
    store: (value) => value / 100,
  }, { authoritativePreview: true });
  appendLocalMaskSlider(panel, leaf, {
    name: "mask_opacity",
    label: "Opacity",
    min: 0,
    max: 100,
    step: 1,
    value: Number(leaf.mask_opacity ?? 1) * 100,
    defaultValue: 100,
    display: (value) => `${Math.round(value)}%`,
    store: (value) => value / 100,
  });
  const actions = document.createElement("div");
  actions.className = "path-feather-actions";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset feather shape";
  reset.disabled = state.localPathDraft || leaf.feather_mode !== "outer_boundary";
  reset.addEventListener("click", () => {
    leaf.feather_nodes = uniformFeatherNodes(leaf.nodes, Number(leaf.feather || 0));
    state.localPathEditMode = "feather";
    state.selectedPathNode = null;
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    queueLocalMaskOverlayRender();
    commitSelectedLocal();
  });
  actions.append(reset);
  panel.append(actions);
  els.localMaskTreeSummary.append(panel);
}

function createPathFeatherControl(local, leaf) {
  const label = document.createElement("label");
  label.className = "local-brush-control control-row instrument-slider-control";
  const heading = document.createElement("span");
  heading.className = "instrument-control-label";
  heading.textContent = "Feather";
  const output = document.createElement("output");
  output.textContent = `${Math.round(Number(leaf.feather || 0) * 200)}%`;
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: "0", max: "100", step: "1", value: String(Number(leaf.feather || 0) * 200) });
  input.dataset.defaultValue = "4";
  const status = document.createElement("span");
  status.className = "path-feather-status";
  status.setAttribute("aria-live", "polite");
  const updateStatus = (message = "") => {
    const outer = flattenPathNodes(leaf.feather_nodes || []);
    const merging = outer.length >= 3 && !simplePathPolygon(outer);
    status.textContent = message || (merging ? "Feather regions are merging." : "");
    status.classList.toggle("merging", merging && !message);
    status.classList.toggle("blocking", Boolean(message));
  };
  updateStatus();
  input.addEventListener("input", () => {
    const previous = Number(leaf.feather || 0);
    const next = Number(input.value) / 200;
    if (leaf.feather_nodes?.length) {
      const proposed = offsetBoundaryNodes(leaf.feather_nodes, next - previous);
      if (!validFeatherGeometry(leaf.nodes, proposed)) {
        input.value = String(previous * 200);
        state.pathInvalidGesture = true;
        updateStatus("Feather stopped because the guide crossed inside the Path.");
        queueLocalMaskOverlayRender();
        return;
      }
      leaf.feather_nodes = proposed;
    }
    leaf.feather = next;
    output.textContent = `${Math.round(Number(input.value))}%`;
    state.pathInvalidGesture = false;
    updateStatus();
    scheduleSpatialMaskPreview(local);
    queueLocalMaskOverlayRender();
  });
  input.addEventListener("change", () => commitSelectedLocal());
  bindLocalPreviewInteraction(input);
  label.append(heading, output, input, status);
  return label;
}

function createLuminanceRangeControl(local, leaf) {
  const minEv = referenceNitsToEv(LUMA_RANGE_MIN_NITS);
  const maxEv = referenceNitsToEv(LUMA_RANGE_MAX_NITS);
  const initialReferenceStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev))
    ? Number(leaf.reference_start_ev)
    : Number(leaf.full_start_ev);
  const initialReferenceEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev))
    ? Number(leaf.reference_end_ev)
    : Number(leaf.full_end_ev);
  leaf.reference_start_ev = clamp(initialReferenceStart, minEv, maxEv - 0.01);
  leaf.reference_end_ev = clamp(initialReferenceEnd, leaf.reference_start_ev + 0.01, maxEv);
  setLuminanceRefinedRange(
    leaf,
    clamp(Number(leaf.full_start_ev), leaf.reference_start_ev, leaf.reference_end_ev - 0.01),
    clamp(Number(leaf.full_end_ev), leaf.reference_start_ev + 0.01, leaf.reference_end_ev),
  );

  const section = document.createElement("section");
  section.className = "luma-range-control";
  const presetHeading = document.createElement("div");
  presetHeading.className = "luma-range-heading";
  const presetTitle = document.createElement("span");
  presetTitle.textContent = "Quick range";
  const presetSummary = document.createElement("output");
  presetHeading.append(presetTitle, presetSummary);

  const presetGrid = document.createElement("div");
  presetGrid.className = "luma-preset-grid";
  presetGrid.setAttribute("role", "group");
  presetGrid.setAttribute("aria-label", "False-color luminance ranges");
  const bands = falseColorBands();

  const rangeHeading = document.createElement("div");
  rangeHeading.className = "luma-range-heading luma-nit-range-heading";
  const rangeTitle = document.createElement("span");
  rangeTitle.textContent = "Reference range";
  const rangeSummary = document.createElement("output");
  rangeHeading.append(rangeTitle, rangeSummary);

  const slider = document.createElement("div");
  slider.className = "luma-nit-range luma-reference-range";
  const rail = document.createElement("span");
  rail.className = "luma-nit-range-rail";
  const fill = document.createElement("span");
  fill.className = "luma-nit-range-fill";
  slider.append(rail, fill);

  const fields = ["reference_start_ev", "reference_end_ev"];
  const labels = ["Lower reference-nit edge", "Upper reference-nit edge"];
  const inputs = fields.map((field, index) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: String(minEv), max: String(maxEv), step: "0.01", value: String(clamp(Number(leaf[field]), minEv, maxEv)) });
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", labels[index]);
    input.addEventListener("input", () => {
      const gap = 0.01;
      let start = Number(inputs[0].value);
      let end = Number(inputs[1].value);
      if (index === 0) start = Math.min(start, end - gap);
      else end = Math.max(end, start + gap);
      setLuminanceReferenceRange(leaf, start, end, { preserveRefinement: true });
      initializedLuminanceSampleLeaves.add(leaf);
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    slider.append(input);
    return input;
  });

  const values = document.createElement("div");
  values.className = "luma-nit-range-values";
  const valueOutputs = labels.map((label) => {
    const output = document.createElement("output");
    output.title = label;
    values.append(output);
    return output;
  });
  const scale = document.createElement("div");
  scale.className = "luma-range-scale luma-nit-range-scale";
  scale.innerHTML = `<span>0.1 nit</span><span>${projectReferenceWhiteNits()} nit · 0 EV</span><span>10,000 nit</span>`;

  const refineHeading = document.createElement("div");
  refineHeading.className = "luma-range-heading luma-refine-range-heading";
  const refineTitle = document.createElement("span");
  refineTitle.textContent = "Refine range";
  const refineSummary = document.createElement("output");
  refineHeading.append(refineTitle, refineSummary);

  const refineSlider = document.createElement("div");
  refineSlider.className = "luma-nit-range luma-refine-range";
  const refineRail = document.createElement("span");
  refineRail.className = "luma-nit-range-rail";
  const refineFill = document.createElement("span");
  refineFill.className = "luma-nit-range-fill";
  refineSlider.append(refineRail, refineFill);
  const refineInputs = ["Lower refined edge", "Upper refined edge"].map((label, index) => {
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "0", max: "1", step: "0.001", value: index ? "1" : "0" });
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const gap = 0.001;
      let start = Number(refineInputs[0].value);
      let end = Number(refineInputs[1].value);
      if (index === 0) start = Math.min(start, end - gap);
      else end = Math.max(end, start + gap);
      const referenceStart = Number(leaf.reference_start_ev);
      const referenceSpan = Math.max(Number(leaf.reference_end_ev) - referenceStart, 0.01);
      setLuminanceRefinedRange(
        leaf,
        referenceStart + start * referenceSpan,
        referenceStart + end * referenceSpan,
      );
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    refineSlider.append(input);
    return input;
  });
  const refineValues = document.createElement("div");
  refineValues.className = "luma-nit-range-values luma-refine-range-values";
  const refineValueOutputs = ["Refined lower bound", "Refined upper bound"].map((label) => {
    const output = document.createElement("output");
    output.title = label;
    refineValues.append(output);
    return output;
  });

  const bandButtons = bands.map(({ lower, upper, paletteIndex }, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "luma-preset-button";
    button.dataset.bandIndex = String(index);
    const swatch = document.createElement("i");
    swatch.className = "false-color-key-swatch";
    swatch.style.backgroundColor = exposureBandColor(paletteIndex);
    const label = document.createElement("span");
    label.textContent = lumaBandLabel(lower, upper);
    button.append(swatch, label);
    button.addEventListener("click", async () => {
      const start = referenceNitsToEv(lower ?? LUMA_RANGE_MIN_NITS);
      const end = referenceNitsToEv(upper ?? LUMA_RANGE_MAX_NITS);
      setLuminanceReferenceRange(leaf, start, end, { preserveRefinement: false });
      initializedLuminanceSampleLeaves.add(leaf);
      updateLuminanceRangeControl();
      scheduleSpatialMaskPreview(local);
      queueLocalMaskOverlayRender();
      await commitSelectedLocal();
    });
    presetGrid.append(button);
    return button;
  });

  function updateLuminanceRangeControl() {
    const start = clamp(Number(leaf.reference_start_ev), minEv, maxEv);
    const end = clamp(Number(leaf.reference_end_ev), minEv, maxEv);
    inputs[0].value = String(start);
    inputs[1].value = String(end);
    const startPosition = ((start - minEv) / (maxEv - minEv)) * 100;
    const endPosition = ((end - minEv) / (maxEv - minEv)) * 100;
    slider.style.setProperty("--luma-range-start", `${startPosition}%`);
    slider.style.setProperty("--luma-range-end", `${endPosition}%`);
    const lowerNits = evToReferenceNits(start);
    const upperNits = evToReferenceNits(end);
    valueOutputs[0].textContent = formatReferenceNits(lowerNits);
    valueOutputs[1].textContent = formatReferenceNits(upperNits);
    rangeSummary.textContent = `${formatReferenceNits(lowerNits)} - ${formatReferenceNits(upperNits)}`;
    const referenceSpan = Math.max(end - start, 0.01);
    const refineStart = clamp((Number(leaf.full_start_ev) - start) / referenceSpan, 0, 1);
    const refineEnd = clamp((Number(leaf.full_end_ev) - start) / referenceSpan, refineStart, 1);
    refineInputs[0].value = String(refineStart);
    refineInputs[1].value = String(refineEnd);
    refineSlider.style.setProperty("--luma-range-start", `${refineStart * 100}%`);
    refineSlider.style.setProperty("--luma-range-end", `${refineEnd * 100}%`);
    const refinedLowerNits = evToReferenceNits(leaf.full_start_ev);
    const refinedUpperNits = evToReferenceNits(leaf.full_end_ev);
    refineValueOutputs[0].textContent = formatReferenceNits(refinedLowerNits);
    refineValueOutputs[1].textContent = formatReferenceNits(refinedUpperNits);
    refineSummary.textContent = `${formatReferenceNits(refinedLowerNits)} - ${formatReferenceNits(refinedUpperNits)}`;
    let selectedLabel = "Custom";
    bandButtons.forEach((button, index) => {
      const band = bands[index];
      const bandStart = referenceNitsToEv(band.lower ?? LUMA_RANGE_MIN_NITS);
      const bandEnd = referenceNitsToEv(band.upper ?? LUMA_RANGE_MAX_NITS);
      const active = Math.abs(start - bandStart) < 0.015 && Math.abs(end - bandEnd) < 0.015;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) selectedLabel = lumaBandLabel(band.lower, band.upper);
    });
    presetSummary.textContent = selectedLabel;
  }

  section.append(presetHeading, presetGrid, rangeHeading, slider, values, scale, refineHeading, refineSlider, refineValues);
  updateLuminanceRangeControl();
  return section;
}

function setLuminanceReferenceRange(leaf, startEv, endEv, { preserveRefinement = true } = {}) {
  const start = Number(clamp(startEv, -24, 23.99).toFixed(4));
  const end = Number(clamp(endEv, start + 0.01, 24).toFixed(4));
  const previousStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev)) ? Number(leaf.reference_start_ev) : Number(leaf.full_start_ev);
  const previousEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev)) ? Number(leaf.reference_end_ev) : Number(leaf.full_end_ev);
  const previousSpan = Math.max(previousEnd - previousStart, 0.01);
  const refinedStart = preserveRefinement ? clamp((Number(leaf.full_start_ev) - previousStart) / previousSpan, 0, 1) : 0;
  const refinedEnd = preserveRefinement ? clamp((Number(leaf.full_end_ev) - previousStart) / previousSpan, refinedStart, 1) : 1;
  leaf.reference_start_ev = start;
  leaf.reference_end_ev = end;
  const span = end - start;
  setLuminanceRefinedRange(leaf, start + refinedStart * span, start + refinedEnd * span);
}

function setLuminanceRefinedRange(leaf, startEv, endEv) {
  const referenceStart = leaf.reference_start_ev !== null && leaf.reference_start_ev !== undefined && Number.isFinite(Number(leaf.reference_start_ev)) ? Number(leaf.reference_start_ev) : -24;
  const referenceEnd = leaf.reference_end_ev !== null && leaf.reference_end_ev !== undefined && Number.isFinite(Number(leaf.reference_end_ev)) ? Number(leaf.reference_end_ev) : 24;
  const start = clamp(Number(clamp(startEv, referenceStart, referenceEnd - 0.01).toFixed(4)), referenceStart, referenceEnd - 0.01);
  const end = clamp(Number(clamp(endEv, start + 0.01, referenceEnd).toFixed(4)), start + 0.01, referenceEnd);
  leaf.full_start_ev = start;
  leaf.full_end_ev = end;
  leaf.fade_in_start_ev = Number(clamp(start - LUMA_TONAL_RAMP_EV, -24, start).toFixed(4));
  leaf.fade_out_end_ev = Number(clamp(end + LUMA_TONAL_RAMP_EV, end, 24).toFixed(4));
}

function renderGradientControls(local, leaf) {
  if (!els.localGradientControls) return;
  els.localGradientControls.classList.remove("hidden");
  const panel = createLocalMaskSubpanel("Gradient Controls", "Spatial and content range");
  [
    { name: "mask_opacity", label: "Opacity", min: 0, max: 100, step: 1, value: Number(leaf.mask_opacity ?? 1) * 100, defaultValue: 100, display: (value) => `${Math.round(value)}%`, store: (value) => value / 100 },
    { name: "gradient_fan", label: "Fan", min: -100, max: 100, step: 1, value: Number(leaf.gradient_fan || 0) * 100, defaultValue: 0, display: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}%`, store: (value) => value / 100 },
  ].forEach((definition) => appendLocalMaskSlider(panel, leaf, definition, { authoritativePreview: true }));
  panel.append(createGradientLuminanceRange(local, leaf));
  els.localGradientControls.append(panel);
}

function createGradientLuminanceRange(local, leaf) {
  const section = document.createElement("section");
  section.className = "gradient-luma-control";
  const heading = document.createElement("div");
  heading.className = "gradient-luma-heading";
  const title = document.createElement("span");
  title.textContent = "Luminance range";
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "gradient-luma-toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = Boolean(leaf.gradient_luma_enabled);
  const toggleCopy = document.createElement("span");
  toggleCopy.textContent = "Enable";
  toggleLabel.append(toggle, toggleCopy);
  heading.append(title, toggleLabel);

  const ramp = document.createElement("div");
  ramp.className = "gradient-luma-ramp";
  const fields = ["fade_in_start_ev", "full_start_ev", "full_end_ev", "fade_out_end_ev"];
  const defaults = [-12, -8, 6, 10];
  fields.forEach((field, index) => {
    if (!Number.isFinite(Number(leaf[field]))) leaf[field] = defaults[index];
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: "-24", max: "24", step: "0.1", value: String(leaf[field]) });
    input.dataset.defaultValue = String(defaults[index]);
    input.dataset.rangeHandle = String(index);
    input.setAttribute("aria-label", ["Dark fade", "Dark full", "Light full", "Light fade"][index]);
    input.addEventListener("input", () => {
      const lower = index === 0 ? -24 : Number(leaf[fields[index - 1]]);
      const upper = index === fields.length - 1 ? 24 : Number(leaf[fields[index + 1]]);
      leaf[field] = Number(clamp(Number(input.value), lower, upper).toFixed(2));
      input.value = String(leaf[field]);
      leaf.gradient_luma_enabled = true;
      toggle.checked = true;
      state.localMaskDraftDirty = true;
      scheduleAuthoritativeLocalMaskDraft(local);
      scheduleLocalPreview({ spatialMaskChanged: true });
      queueLocalMaskOverlayRender();
    });
    input.addEventListener("change", () => commitSelectedLocal());
    bindLocalPreviewInteraction(input);
    ramp.append(input);
  });
  toggle.addEventListener("change", () => {
    leaf.gradient_luma_enabled = toggle.checked;
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(local);
    scheduleLocalPreview({ spatialMaskChanged: true });
    queueLocalMaskOverlayRender();
    commitSelectedLocal();
  });
  bindLocalPreviewInteraction(toggle);
  const scale = document.createElement("div");
  scale.className = "gradient-luma-scale";
  scale.innerHTML = "<span>Blacks</span><span>Midtones</span><span>Highlights</span>";
  section.append(heading, ramp, scale);
  return section;
}

function createLocalMaskSubpanel(title, note) {
  const panel = document.createElement("section");
  panel.className = "local-mask-subpanel";
  const heading = document.createElement("div");
  heading.className = "local-mask-subpanel-heading";
  const label = document.createElement("strong");
  label.textContent = title;
  const hint = document.createElement("span");
  hint.textContent = note;
  heading.append(label, hint);
  panel.append(heading);
  return panel;
}

function appendLocalMaskSlider(panel, leaf, definition, options = {}) {
  const { name, label: labelText, min, max, step, value, defaultValue = value, display, store = (next) => next } = definition;
  const label = document.createElement("label");
  label.className = "local-brush-control control-row instrument-slider-control";
  const heading = document.createElement("span");
  heading.className = "instrument-control-label";
  heading.textContent = labelText;
  const output = document.createElement("output");
  output.textContent = display(value);
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), disabled: Boolean(options.disabled) });
  input.dataset.localMaskParam = name;
  input.dataset.defaultValue = String(defaultValue);
  if (options.previewBrush) {
    input.addEventListener("focus", () => showBrushSettingsPreview(leaf));
    input.addEventListener("pointerdown", () => showBrushSettingsPreview(leaf));
  }
  if (options.hideBrushPreview) {
    input.addEventListener("focus", hideBrushSettingsPreview);
    input.addEventListener("pointerdown", hideBrushSettingsPreview);
  }
  input.addEventListener("input", () => {
    const next = Number(input.value);
    leaf[name] = store(next);
    const influenceOnly = name === "mask_opacity";
    const spatialMaskChanged = !influenceOnly && (name.startsWith("mask_") || options.authoritativePreview);
    if (spatialMaskChanged) {
      scheduleSpatialMaskPreview(selectedLocal());
    } else if (influenceOnly) {
      scheduleLocalPreview();
    }
    output.textContent = display(next);
    if (options.previewBrush) showBrushSettingsPreview(leaf);
    if (options.hideBrushPreview) hideBrushSettingsPreview();
    queueLocalMaskOverlayRender();
  });
  input.addEventListener("change", () => {
    if (options.commit) options.commit();
    else commitSelectedLocal({ refreshPreview: name !== "mask_opacity" });
  });
  bindLocalPreviewInteraction(input);
  label.append(heading, input, output);
  panel.append(label);
  enhanceRangeControl(input);
}

function brushSettings(leaf) {
  const fallback = leaf?.strokes?.at(-1) || {};
  return {
    radius: Number(leaf?.brush_radius ?? fallback.radius ?? 0.025),
    hardness: Number(leaf?.brush_hardness ?? fallback.hardness ?? 0.75),
    flow: Number(leaf?.brush_flow ?? fallback.flow ?? 1),
    opacity: Number(leaf?.brush_opacity ?? fallback.opacity ?? 1),
    smoothing: Number(leaf?.brush_smoothing ?? fallback.smoothing ?? 0.35),
  };
}

function brushStrokeSettings(leaf) {
  const settings = brushSettings(leaf);
  const feather = brushFeatherExtent(settings.hardness);
  const radius = settings.radius * (1 + feather);
  return {
    ...settings,
    radius,
    hardness: settings.radius / Math.max(radius, 1e-6),
  };
}

function brushFeatherExtent(hardness) {
  const amount = 1 - clamp(Number(hardness), 0, 1);
  // A perceptual curve keeps the first few slider points precise while still
  // reaching the full outer falloff at 100%. The result is strictly monotonic.
  return Math.pow(amount, 1.6);
}

function showBrushSettingsPreview(leaf) {
  const settings = brushSettings(leaf);
  const featherRadius = settings.radius * (1 + brushFeatherExtent(settings.hardness));
  state.localBrushCursor = {
    x: clamp(1 - featherRadius - 0.012, featherRadius, 1 - featherRadius),
    y: clamp(0.5, featherRadius, 1 - featherRadius),
  };
  state.localBrushPreviewPinned = true;
  queueLocalMaskOverlayRender();
}

function hideBrushSettingsPreview() {
  state.localBrushPreviewPinned = false;
  state.localBrushCursor = null;
  queueLocalMaskOverlayRender();
}

function firstMaskLeaf(expression, type = null) {
  if (!expression) return null;
  if (expression.operator === "leaf") return !type || expression.leaf?.type === type ? expression.leaf : null;
  for (const child of expression.children || []) {
    const found = firstMaskLeaf(child, type);
    if (found) return found;
  }
  return null;
}

async function moveSelectedLocal(direction) {
  const locals = localAdjustments();
  const index = locals.findIndex((item) => item.id === state.selectedLocalId);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= locals.length) return;
  const order = locals.map((item) => item.id);
  [order[index], order[next]] = [order[next], order[index]];
  await queueEditCommand("reorder_locals", { order });
}

async function commitSelectedLocal({ refreshPreview = true } = {}) {
  const local = selectedLocal();
  if (!local) return false;
  let committed = false;
  state.localMaskCommitDepth += 1;
  state.localMaskCommitRefreshPending ||= refreshPreview;
  try {
    // Local strokes are optimistic and may overlap a previous commit. Hold the
    // adjusted preview until the last queued commit so it cannot render an
    // intermediate mask between strokes.
    committed = await queueEditCommand("update_local", { local: JSON.parse(JSON.stringify(local)) }, local.id, { refreshPreview: false });
    if (committed) {
      window.clearTimeout(state.localMaskDraftTimer);
      state.localMaskDraftTimer = 0;
      // Let an in-flight draft finish quietly. The generation bump below makes
      // its response ineligible, while avoiding a browser-level request failure
      // at the end of a fast gradient gesture.
      state.localMaskDraftController = null;
      state.localMaskDraftPending = null;
      state.localMaskDraftGeneration += 1;
      state.localMaskDraftDirty = false;
      state.localPreviewDirty = false;
    }
  } finally {
    state.localMaskCommitDepth = Math.max(0, state.localMaskCommitDepth - 1);
    if (state.localMaskCommitDepth === 0 && state.localMaskCommitRefreshPending && !state.localPointerGesture) {
      state.localMaskCommitRefreshPending = false;
      invalidatePreview("hdr", { local: true });
      invalidatePreview("sdr", { local: true });
      debouncePreview(state.currentView);
    }
    queueLocalMaskOverlayRender();
  }
  return committed;
}

function appendLocalMaskComparisonLegend() {
  const legend = document.createElement("div");
  legend.className = "local-mask-comparison-legend";
  legend.setAttribute("aria-label", "Mask comparison colors");
  [
    ["parent", "Parent"],
    ["child", "Child"],
    ["overlap", "Overlap"],
  ].forEach(([role, label]) => {
    const item = document.createElement("span");
    item.innerHTML = `<i class="${role}" aria-hidden="true"></i>${label}`;
    legend.append(item);
  });
  els.localMaskTreeSummary.append(legend);
}

async function setSdrMatch(action) {
  if (!state.session) return false;
  if (await syncGlobalEditState() === false) return false;
  const authored = state.editDocument?.source?.luminance?.sdr_rendition === "authored";
  let consent = false;
  if (action === "match" && authored) {
    consent = window.confirm(
      "This source contains an authored SDR rendition. Match will replace it with an editable generated SDR rendition. Undo restores the authored grade. Continue?"
    );
    if (!consent) return false;
  }
  const verb = action === "revert" ? "Reverting legacy SDR match" : action === "convert" ? "Converting legacy SDR match" : "Matching HDR grade";
  setIndeterminatePreviewMessage(`${verb} · analyzing settled HDR proxy`);
  if (els.sdrMatchEntire) els.sdrMatchEntire.disabled = true;
  if (els.sdrMatchRevert) els.sdrMatchRevert.disabled = true;
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/sdr-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.editRevision,
        action,
        authored_sdr_override_consent: consent,
      }),
    });
    const result = await safeJson(response);
    if (response.status === 409) {
      await refreshEditState();
      throw new Error(result?.detail?.message || "The grade changed while Match was analyzing it. Try again.");
    }
    if (!response.ok) throw new Error(responseErrorMessage(result, "SDR Match failed."));
    state.editRevision = result.revision;
    state.editDocument = result.document;
    state.adjustments = result.document.global_adjustments;
    loadDenoiseDocument(state.editDocument);
    state.documentDirty = Boolean(result.dirty);
    state.sdrMatchGrainOverridePending = false;
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
    const gpuReady = await renderGpuDraft("sdr", {
      hideStatus: false,
      longEdge: previewLongEdge,
      allowInactive: state.currentView !== "sdr",
      tier: previewTier,
    });
    if (!gpuReady) {
      await renderPreviewForLane("sdr", state.currentView === "sdr", previewLongEdge, {
        progressSteps: [20, 60, 90],
      });
    }
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane: "sdr" });
    if (state.compareLayout !== "single") {
      const other = state.currentView === "hdr" ? "sdr" : "hdr";
      await renderComparisonPreview(other, { force: true });
    }
    syncDesktopDocumentState();
    return true;
  } catch (error) {
    console.error(error);
    els.badge.textContent = error.message;
    els.badge.className = "badge bad";
    return false;
  } finally {
    hidePreviewMessage();
    renderLaneChrome();
    if (els.sdrMatchRevert) els.sdrMatchRevert.disabled = false;
  }
}

function queueEditCommand(commandType, payload = {}, targetId = null, { refreshPreview = true, globalEditGeneration = null, historyGroup = null } = {}) {
  const sessionId = state.session?.session_id;
  if (commandType !== "set_global_adjustments" && state.globalEditDirty) {
    return syncGlobalEditState().then((applied) => state.session?.session_id === sessionId && applied && !state.globalEditDirty
      ? queueEditCommand(commandType, payload, targetId, { refreshPreview, globalEditGeneration, historyGroup })
      : false);
  }
  state.editCommandQueue = (state.editCommandQueue || Promise.resolve()).then(async () => {
    if (!sessionId || state.session?.session_id !== sessionId) return false;
    const response = await fetch(`/api/session/${state.session.session_id}/edit-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ expected_revision: state.editRevision, command_type: commandType, target_id: targetId, history_group: historyGroup, payload }] }),
    });
    const result = await safeJson(response);
    if (state.session?.session_id !== sessionId) return false;
    if (response.status === 409) {
      await refreshEditState();
      throw new Error(result?.detail?.message || "The edit state changed in another request.");
    }
    if (!response.ok) throw new Error(result?.detail || "The local edit was rejected.");
    // Do not replace the object graph that a newer optimistic stroke is still
    // mutating. A response for an earlier queued commit otherwise detaches the
    // active gesture and can make its erase disappear on pointerup.
    const optimisticLocals = (state.localMaskCommitDepth > 0 || state.localPointerGesture)
      ? state.editDocument?.local_adjustments
      : null;
    const preserveNewerGlobalEdit = globalEditGeneration !== null
      && globalEditGeneration !== state.globalEditGeneration;
    const optimisticAdjustments = preserveNewerGlobalEdit ? state.adjustments : null;
    const draftGeometry = geometryDraftActive() ? state.adjustments.shared.geometry : null;
    state.editRevision = result.revision;
    state.editDocument = result.document;
    if (commandType === "replace_document") loadDenoiseDocument(state.editDocument);
    if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
    if (optimisticAdjustments) state.editDocument.global_adjustments = optimisticAdjustments;
    state.documentDirty = preserveNewerGlobalEdit || Boolean(result.dirty);
    state.adjustments = optimisticAdjustments || result.document.global_adjustments;
    if (draftGeometry) state.adjustments.shared.geometry = draftGeometry;
    if (state.geometryTransformHandoffSignature
      && state.geometryTransformHandoffSignature !== geometrySignature()) {
      state.geometryTransformHandoffSignature = null;
      clearRotateDraftTransformProperties();
      clearInteractiveStraightenPreview();
    }
    renderLocalAdjustments();
    if (commandType === "undo" || commandType === "redo") {
      // History responses replace the complete serialized edit document. Keep
      // the visible controls in the same transaction as the state and preview;
      // otherwise the pixels move while sliders retain their pre-history values.
      loadDenoiseDocument(state.editDocument);
      if (!localAdjustments().some((local) => local.id === state.selectedLocalId)) {
        state.selectedLocalId = localAdjustments()[0]?.id || null;
        renderLocalAdjustments();
      }
      els.hdrReferenceWhite.value = String(projectReferenceWhiteNits());
      renderLaneChrome();
      syncCurveControlsFromState();
      drawCurveEditor();
      drawToneEqualizerEditor(state.currentView);
      renderOverlayPresetNote();
      updateExportAvailability();
    }
    if (refreshPreview) {
      invalidatePreview("hdr", { local: true });
      invalidatePreview("sdr", { local: true });
      debouncePreview(state.currentView);
    }
    return true;
  }).catch((error) => {
    console.error(error);
    els.badge.textContent = error.message;
    els.badge.className = "badge bad";
    return false;
  });
  return state.editCommandQueue;
}

async function syncGlobalEditState() {
  if (!state.session) return true;
  const sessionId = state.session.session_id;
  // Perspective owns a transaction-local copy represented in the shared
  // adjustment object for transient previews. Never persist it before Apply.
  if (geometryDraftActive()) return true;
  if (!state.globalEditDirty) {
    const pending = state.globalEditSyncPending;
    if (!pending) return true;
    const applied = await pending;
    if (state.session?.session_id !== sessionId) return false;
    if (!applied) return false;
    return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
  }
  state.globalEditDirty = false;
  const generation = state.globalEditGeneration;
  const historyGroup = state.globalEditHistoryGroup;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  const matchOverride = state.sdrMatchGrainOverridePending;
  const commandType = matchOverride ? "set_sdr_match" : "set_global_adjustments";
  const payload = matchOverride
    ? {
        match_state: JSON.parse(JSON.stringify(state.editDocument.sdr_match)),
        global_adjustments: adjustments,
        local_adjustments: JSON.parse(JSON.stringify(state.editDocument.local_adjustments || [])),
        authored_sdr_override_consent: true,
      }
    : { adjustments };
  const pending = queueEditCommand(commandType, payload, null, { globalEditGeneration: generation, historyGroup });
  state.globalEditSyncPending = pending;
  const applied = await pending;
  if (state.session?.session_id !== sessionId) return false;
  if (state.globalEditSyncPending === pending) state.globalEditSyncPending = null;
  if (applied && matchOverride) state.sdrMatchGrainOverridePending = false;
  if (!applied) state.globalEditDirty = true;
  if (!applied) return false;
  return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
}

async function refreshEditState({ preserveLocalDraft = false } = {}) {
  if (!state.session) return;
  const sessionId = state.session.session_id;
  const optimisticLocals = preserveLocalDraft
    ? state.editDocument?.local_adjustments
    : null;
  const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
  const result = await safeJson(response);
  if (!response.ok || state.session?.session_id !== sessionId) return;
  const draftGeometry = geometryDraftActive() ? state.adjustments.shared.geometry : null;
  state.editRevision = result.revision;
  state.editDocument = result.document;
  state.sdrMatchGrainOverridePending = false;
  loadDenoiseDocument(state.editDocument);
  if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
  state.documentDirty = state.globalEditDirty || Boolean(result.dirty);
  state.adjustments = result.document.global_adjustments;
  if (draftGeometry) state.adjustments.shared.geometry = draftGeometry;
  // Rebuilding the active range input releases pointer capture. Keep the
  // existing control alive while its optimistic local object is still in use.
  if (!preserveLocalDraft) renderLocalAdjustments();
}

function bindLocalMaskCanvas() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const local = selectedLocal();
    if (!local || state.gradeMode !== "local") return;
    const leaf = selectedMaskLeaf(local);
    if (!leaf) return;
    const displayPoint = localDisplayPointerPoint(event);
    const point = leaf.type === "luminance_range"
      ? displayPoint
      : localPointerPoint(event, displayPoint);
    if (!point) return;
    if (!["brush", "linear_gradient", "luminance_range", "path"].includes(leaf.type)) return;
    // A new structural gesture supersedes any settled preview queued by the
    // preceding commit. Its overlay remains visible while the gesture is in
    // progress, and the final commit schedules the next adjusted frame.
    state.previewScheduler?.cancel();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    if (leaf.type === "brush") {
      const source = brushStrokeSettings(leaf);
      state.localBrushCursor = point;
      state.localBrushPreviewPinned = false;
      state.localPointerGesture = { type: "brush", leaf, stroke: { ...source, erase: state.localErase || event.altKey, points: [{ ...point, pressure: brushPointerPressure(event) }] } };
    } else if (leaf.type === "linear_gradient") {
      const previewRect = activePreviewElement()?.getBoundingClientRect();
      const controls = gradientControlPoints(leaf);
      const displayPoint = sourcePointToDisplay(point);
      const nearest = Object.entries(controls).reduce((best, [handle, control]) => {
        const displayControl = sourcePointToDisplay(control);
        if (!displayPoint || !displayControl) return best;
        const distance = Math.hypot(
          (displayControl.x - displayPoint.x) * Math.max(previewRect?.width || 1, 1),
          (displayControl.y - displayPoint.y) * Math.max(previewRect?.height || 1, 1),
        );
        return distance < best.distance ? { handle, distance } : best;
      }, { handle: "end", distance: Infinity });
      if (nearest.distance <= 16) {
        state.localPointerGesture = { type: "linear_gradient", leaf, handle: nearest.handle };
      } else {
        leaf.start = point;
        leaf.end = point;
        leaf.gradient_midpoint_1 = 1 / 3;
        leaf.gradient_midpoint_2 = 2 / 3;
        // The coordinates already differ from the cached authoritative mask at
        // pointerdown. Mark the handoff dirty before the synchronous render so
        // the last exact overlay remains visible until the first draft lands.
        state.localMaskDraftDirty = true;
        state.localPointerGesture = { type: "linear_gradient", leaf, handle: "end", creating: true };
      }
    } else if (leaf.type === "luminance_range") {
      state.localPointerGesture = {
        type: "luminance_sample",
        leaf,
        localId: local.id,
        remove: event.altKey,
        points: [point],
      };
    } else if (leaf.type === "path") {
      const draft = state.localPathDraft?.localId === local.id;
      const nodes = draft ? leaf.nodes : activePathNodes(leaf);
      const target = pathTargetAtPointer(event, nodes, state.selectedPathNode);
      if (draft) {
        if (target?.type === "node" && target.index === 0 && nodes.length >= 3) {
          if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
          void finishLocalPathDraft();
          return;
        }
        const node = { x: point.x, y: point.y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" };
        nodes.push(node);
        state.selectedPathNode = nodes.length - 1;
        state.localPointerGesture = {
          type: "path_create_node",
          leaf,
          nodeIndex: nodes.length - 1,
          clientX: event.clientX,
          clientY: event.clientY,
          origin: { ...point },
        };
      } else if (target?.type === "handle") {
        state.selectedPathNode = target.index;
        state.localPointerGesture = {
          type: "path_handle",
          leaf,
          nodes,
          nodeIndex: target.index,
          handle: target.handle,
          before: JSON.parse(JSON.stringify(nodes)),
          changed: false,
        };
      } else if (target?.type === "node") {
        state.selectedPathNode = target.index;
        state.pathKeyboardTarget = "node";
        state.localPointerGesture = {
          type: "path_node",
          leaf,
          nodes,
          nodeIndex: target.index,
          before: JSON.parse(JSON.stringify(nodes)),
          origin: { ...nodes[target.index] },
          changed: false,
        };
        renderMaskTreeEditor(local);
      } else if (target?.type === "curve") {
        const before = JSON.parse(JSON.stringify(nodes));
        const inserted = splitPathSegment(nodes, target.segment, target.t);
        const valid = state.localPathEditMode === "feather"
          ? validFeatherGeometry(leaf.nodes, nodes)
          : validPathGeometry(leaf, nodes);
        if (!valid) nodes.splice(0, nodes.length, ...before);
        else {
          state.selectedPathNode = inserted;
          scheduleSpatialMaskPreview(local);
          renderMaskTreeEditor(local);
          commitSelectedLocal();
        }
      }
    }
    renderLocalMaskOverlay();
  });
  canvas.addEventListener("pointermove", (event) => {
    const gesture = state.localPointerGesture;
    const point = gesture?.type === "luminance_sample"
      ? localDisplayPointerPoint(event)
      : localPointerPoint(event);
    if (!point) return;
    const hoveredPathLeaf = selectedMaskLeaf(selectedLocal(), "path");
    if (hoveredPathLeaf) state.localPathCursor = point;
    const activeLeaf = selectedMaskLeaf(selectedLocal(), "brush");
    if (activeLeaf && state.localTool === "brush") {
      state.localBrushCursor = point;
      state.localBrushPreviewPinned = false;
    }
    if (!gesture) {
      if (activeLeaf && state.localTool === "brush") queueLocalMaskOverlayRender();
      const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
      if (pathLeaf) {
        const nodes = state.localPathDraft ? pathLeaf.nodes : activePathNodes(pathLeaf);
        const hovered = pathTargetAtPointer(event, nodes, state.selectedPathNode);
        const signature = hovered ? `${hovered.type}:${hovered.index ?? hovered.segment}:${hovered.handle || ""}` : "";
        if (signature !== state.hoveredPathTarget?.signature) {
          state.hoveredPathTarget = hovered ? { ...hovered, signature } : null;
          queueLocalMaskOverlayRender();
        }
      }
      return;
    }
    if (gesture.type === "brush") appendBrushPointerPoints(gesture.stroke, event);
    else if (gesture.type === "linear_gradient") updateGradientGesture(gesture, point);
    else if (gesture.type === "luminance_sample") appendLuminanceSamplePoint(gesture, point);
    else if (gesture.type === "path_create_node") updatePathCreationGesture(gesture, event, point);
    else if (gesture.type === "path_node") updatePathNodeGesture(gesture, point);
    else if (gesture.type === "path_handle") updatePathHandleGesture(gesture, point);
    queueLocalMaskOverlayRender();
  });
  const end = async (event) => {
    const gesture = state.localPointerGesture;
    if (!gesture) return;
    state.localPointerGesture = null;
    if (gesture.type === "brush") gesture.leaf.strokes.push(gesture.stroke);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (gesture.type === "luminance_sample") {
      await finishLuminanceSampleGesture(gesture);
      return;
    }
    if (gesture.type === "path_create_node") {
      renderMaskTreeEditor(selectedLocal());
      queueLocalMaskOverlayRender();
      return;
    }
    if ((gesture.type === "path_node" || gesture.type === "path_handle") && !gesture.changed) {
      renderMaskTreeEditor(selectedLocal());
      queueLocalMaskOverlayRender();
      return;
    }
    await commitSelectedLocal();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const local = selectedLocal();
    const leaf = selectedMaskLeaf(local, "path");
    if (!leaf || state.localPathDraft) return;
    const nodes = activePathNodes(leaf);
    const target = pathTargetAtPointer(event, nodes, state.selectedPathNode);
    if (target?.type !== "node" || nodes.length <= 3) return;
    const before = JSON.parse(JSON.stringify(nodes));
    nodes.splice(target.index, 1);
    const valid = state.localPathEditMode === "feather"
      ? validFeatherGeometry(leaf.nodes, nodes)
      : validPathGeometry(leaf, nodes);
    if (!valid) nodes.splice(0, nodes.length, ...before);
    else {
      state.selectedPathNode = Math.min(target.index, nodes.length - 1);
      scheduleSpatialMaskPreview(local);
      renderMaskTreeEditor(local);
      queueLocalMaskOverlayRender();
      commitSelectedLocal();
    }
  });
  canvas.addEventListener("keydown", (event) => handlePathCanvasKeydown(event));
  canvas.addEventListener("pointerleave", () => {
    if (state.localPointerGesture) return;
    if (!state.localBrushPreviewPinned) state.localBrushCursor = null;
    queueLocalMaskOverlayRender();
  });
}

function brushPointerPressure(event) {
  return event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 1;
}

function appendBrushPointerPoints(stroke, event) {
  const samples = event.getCoalescedEvents?.() || [event];
  for (const sample of samples) {
    const point = localPointerPoint(sample);
    if (!point) continue;
    const previous = stroke.points.at(-1);
    const minimumSpacing = Math.max(0.0005, Number(stroke.radius) * 0.04);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < minimumSpacing) continue;
    stroke.points.push({ ...point, pressure: brushPointerPressure(sample) });
  }
}

// Sampling initialization is interaction state, not part of the persisted mask
// schema. Keeping it out of edit-command payloads also lets a refreshed client
// create Luma adjustments against an already-running older backend process.
const initializedLuminanceSampleLeaves = new WeakSet();

function isLuminanceSamplingInitialized(leaf) {
  if (initializedLuminanceSampleLeaves.has(leaf)) return true;
  const start = Number(leaf.full_start_ev);
  const end = Number(leaf.full_end_ev);
  const visibleMin = referenceNitsToEv(LUMA_RANGE_MIN_NITS);
  const visibleMax = referenceNitsToEv(LUMA_RANGE_MAX_NITS);
  const defaultStart = clamp(-8, visibleMin, visibleMax - 0.01);
  const defaultEnd = clamp(6, defaultStart + 0.01, visibleMax);
  const schemaDefault = Math.abs(start - defaultStart) <= 0.011 && Math.abs(end - defaultEnd) <= 0.011;
  // Range inputs quantize against a 0.01 EV step whose origin is the dynamic
  // minimum, so their full-span endpoint can differ from the analytical value
  // by up to one step.
  const visibleDefault = Math.abs(start - visibleMin) <= 0.011 && Math.abs(end - visibleMax) <= 0.011;
  return !schemaDefault && !visibleDefault;
}

function formatSdrBandLevel(value) {
  return `${Math.round(value * 100)}%`;
}

function matchHdrBandsToSdr() {
  if (!state.session) return;
  state.adjustments.sdr.tone_equalizer_nodes = currentToneEqualizerNodes("hdr");
  state.adjustments.sdr.tone_equalizer_influence_radius = state.adjustments.hdr.tone_equalizer_influence_radius;
  state.adjustments.sdr.tone_equalizer_smoothing = state.adjustments.hdr.tone_equalizer_smoothing;
  state.adjustments.sdr.tone_equalizer_section_enabled = true;
  syncToneEqualizerControls("sdr");
  drawToneEqualizerEditor("sdr");
  renderControlState();
  invalidatePreview("sdr");
  debouncePreview("sdr");
}

function appendLuminanceSamplePoint(gesture, point) {
  const previous = gesture.points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.006) return;
  if (gesture.points.length < 512) gesture.points.push(point);
}

async function finishLuminanceSampleGesture(gesture) {
  const local = selectedLocal();
  if (!state.session || !local || local.id !== gesture.localId || !gesture.points.length) return;
  // An asynchronous preview/edit refresh can replace the selected local while
  // a pointer gesture is active. Always mutate the leaf that will actually be
  // serialized, rather than the pointerdown snapshot retained by the gesture.
  const leaf = firstMaskLeaf(local.mask, "luminance_range");
  if (!leaf) return;
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/local-luminance-sample`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: gesture.points,
        edit_revision: state.editRevision,
        long_edge: settledProxyLongEdge(),
      }),
    });
    const sample = await safeJson(response);
    if (!response.ok) throw new Error(sample.detail || "Luminance sampling failed.");
    if (!applyLuminanceSample(leaf, sample, gesture.remove)) return;
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    syncRangeVisuals(els.localEditor);
    queueLocalMaskOverlayRender();
    await commitSelectedLocal();
  } catch (error) {
    console.error(error);
    els.badge.textContent = error.message;
    els.badge.className = "badge bad";
    queueLocalMaskOverlayRender();
  }
}

function applyLuminanceSample(leaf, sample, remove = false) {
  const sampleLow = clamp(Number(sample.low_ev), -24, 24);
  const sampleHigh = clamp(Number(sample.high_ev), sampleLow, 24);
  let fullStart = Number(leaf.full_start_ev);
  let fullEnd = Number(leaf.full_end_ev);
  if (!Number.isFinite(fullStart) || !Number.isFinite(fullEnd)) return false;
  if (!remove) {
    if (!isLuminanceSamplingInitialized(leaf)) {
      fullStart = sampleLow;
      fullEnd = sampleHigh;
    } else {
      fullStart = Math.min(fullStart, sampleLow);
      fullEnd = Math.max(fullEnd, sampleHigh);
    }
  } else {
    if (sampleHigh < fullStart || sampleLow > fullEnd) return false;
    const midpoint = (fullStart + fullEnd) * 0.5;
    if (Number(sample.center_ev) <= midpoint) fullStart = Math.min(fullEnd - 0.25, Math.max(fullStart, sampleHigh));
    else fullEnd = Math.max(fullStart + 0.25, Math.min(fullEnd, sampleLow));
  }
  fullStart = Number(clamp(fullStart, -23.75, 23.75).toFixed(2));
  fullEnd = Number(clamp(fullEnd, fullStart + 0.25, 24).toFixed(2));
  // Normalize both reference and refined bounds through the same four-decimal
  // path. Otherwise an unrounded sampled reference can sit microscopically
  // inside its rounded refined edge and fail the persisted schema invariant.
  setLuminanceReferenceRange(leaf, fullStart, fullEnd, { preserveRefinement: false });
  initializedLuminanceSampleLeaves.add(leaf);
  return true;
}

function gradientControlPoints(leaf) {
  const start = leaf.start || { x: 0.25, y: 0.5 };
  const end = leaf.end || start;
  const interpolate = (amount) => ({
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  });
  return {
    start,
    midpoint_1: interpolate(Number(leaf.gradient_midpoint_1 ?? 1 / 3)),
    midpoint_2: interpolate(Number(leaf.gradient_midpoint_2 ?? 2 / 3)),
    end,
  };
}

function updateGradientGesture(gesture, point) {
  const { leaf, handle } = gesture;
  if (handle === "start" || handle === "end") {
    leaf[handle] = point;
  } else {
    const dx = Number(leaf.end.x) - Number(leaf.start.x);
    const dy = Number(leaf.end.y) - Number(leaf.start.y);
    const denominator = Math.max(dx * dx + dy * dy, 1e-8);
    const projected = ((point.x - leaf.start.x) * dx + (point.y - leaf.start.y) * dy) / denominator;
    if (handle === "midpoint_1") {
      leaf.gradient_midpoint_1 = clamp(projected, 0.02, Number(leaf.gradient_midpoint_2 ?? 2 / 3) - 0.02);
    } else {
      leaf.gradient_midpoint_2 = clamp(projected, Number(leaf.gradient_midpoint_1 ?? 1 / 3) + 0.02, 0.98);
    }
  }
  state.localMaskDraftDirty = true;
  scheduleAuthoritativeLocalMaskDraft(selectedLocal());
}

function activePathNodes(leaf) {
  if (state.localPathEditMode !== "feather") return leaf.nodes || [];
  materializeFeatherNodes(leaf);
  return leaf.feather_nodes || [];
}

function materializeFeatherNodes(leaf) {
  if (!leaf || leaf.type !== "path" || leaf.feather_nodes?.length) return;
  leaf.feather_nodes = uniformFeatherNodes(leaf.nodes || [], Number(leaf.feather || 0));
}

function pathDisplayScale() {
  const rect = activePreviewElement()?.getBoundingClientRect();
  if (!rect) return { x: 1, y: 1 };
  const short = Math.max(1, Math.min(rect.width, rect.height));
  return { x: rect.width / short, y: rect.height / short };
}

function pathNodeVector(nodes, index) {
  const count = nodes.length;
  const node = nodes[index];
  const previous = nodes[(index - 1 + count) % count];
  const next = nodes[(index + 1) % count];
  const scale = pathDisplayScale();
  const before = {
    x: (node.x - previous.x) * scale.x,
    y: (node.y - previous.y) * scale.y,
  };
  const after = {
    x: (next.x - node.x) * scale.x,
    y: (next.y - node.y) * scale.y,
  };
  const normalize = (vector) => {
    const length = Math.hypot(vector.x, vector.y) || 1;
    return { x: vector.x / length, y: vector.y / length };
  };
  return { before: normalize(before), after: normalize(after) };
}

function pathSignedArea(nodes) {
  const scale = pathDisplayScale();
  return nodes.reduce((sum, node, index) => {
    const next = nodes[(index + 1) % nodes.length];
    return sum + node.x * scale.x * next.y * scale.y - next.x * scale.x * node.y * scale.y;
  }, 0) * 0.5;
}

function pathOutwardShift(nodes, index, amount) {
  if (!nodes.length || amount === 0) return { x: 0, y: 0 };
  const orientation = pathSignedArea(nodes) >= 0 ? 1 : -1;
  const { before, after } = pathNodeVector(nodes, index);
  const beforeNormal = { x: orientation * before.y, y: -orientation * before.x };
  const afterNormal = { x: orientation * after.y, y: -orientation * after.x };
  let mx = beforeNormal.x + afterNormal.x;
  let my = beforeNormal.y + afterNormal.y;
  const length = Math.hypot(mx, my);
  if (length < 1e-6) {
    mx = afterNormal.x;
    my = afterNormal.y;
  } else {
    mx /= length;
    my /= length;
  }
  const projection = Math.max(0.25, mx * afterNormal.x + my * afterNormal.y);
  const distance = Math.min(Math.abs(amount) / projection, Math.abs(amount) * 4) * Math.sign(amount);
  const scale = pathDisplayScale();
  return { x: mx * distance / scale.x, y: my * distance / scale.y };
}

function translatedPathNode(node, shift) {
  const { feather: _unusedFeather, ...baseNode } = node;
  const translated = {
    ...baseNode,
    x: clamp(Number(node.x) + shift.x, -1, 2),
    y: clamp(Number(node.y) + shift.y, -1, 2),
  };
  for (const prefix of ["in", "out"]) {
    if (node[`${prefix}_x`] === null || node[`${prefix}_x`] === undefined) continue;
    translated[`${prefix}_x`] = clamp(Number(node[`${prefix}_x`]) + shift.x, -1, 2);
    translated[`${prefix}_y`] = clamp(Number(node[`${prefix}_y`]) + shift.y, -1, 2);
  }
  return translated;
}

function uniformFeatherNodes(nodes, amount) {
  if (!nodes?.length) return [];
  return nodes.map((node, index) => translatedPathNode(node, pathOutwardShift(nodes, index, amount)));
}

function offsetBoundaryNodes(nodes, amount) {
  if (!nodes?.length || Math.abs(amount) < 1e-9) return JSON.parse(JSON.stringify(nodes || []));
  return nodes.map((node, index) => translatedPathNode(node, pathOutwardShift(nodes, index, amount)));
}

function cubicPathPoint(first, second, t) {
  const p0 = { x: Number(first.x), y: Number(first.y) };
  const p1 = { x: Number(first.out_x ?? first.x), y: Number(first.out_y ?? first.y) };
  const p2 = { x: Number(second.in_x ?? second.x), y: Number(second.in_y ?? second.y) };
  const p3 = { x: Number(second.x), y: Number(second.y) };
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
    y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function flattenPathNodes(nodes, steps = 16) {
  const points = [];
  if (!nodes?.length) return points;
  for (let index = 0; index < nodes.length; index += 1) {
    const first = nodes[index];
    const second = nodes[(index + 1) % nodes.length];
    const curved = first.out_x !== null && first.out_x !== undefined || second.in_x !== null && second.in_x !== undefined;
    const count = curved ? steps : 1;
    for (let sample = 0; sample < count; sample += 1) points.push(cubicPathPoint(first, second, sample / count));
  }
  return points;
}

function pointInsidePathPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denominator = Math.max(dx * dx + dy * dy, 1e-12);
    const projection = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator, 0, 1);
    if (Math.hypot(point.x - (a.x + projection * dx), point.y - (a.y + projection * dy)) <= 1e-6) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y + 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

function pathSegmentsIntersect(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 1e-8 && abD < -1e-8) || (abC < -1e-8 && abD > 1e-8))
    && ((cdA > 1e-8 && cdB < -1e-8) || (cdA < -1e-8 && cdB > 1e-8));
}

function simplePathPolygon(polygon) {
  if (polygon.length < 3) return false;
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (first === 0 && secondNext === 0) continue;
      if (pathSegmentsIntersect(polygon[first], polygon[firstNext], polygon[second], polygon[secondNext])) return false;
    }
  }
  return true;
}

function validFeatherGeometry(innerNodes, outerNodes) {
  if (!innerNodes?.length || !outerNodes?.length) return false;
  const inner = flattenPathNodes(innerNodes);
  const outer = flattenPathNodes(outerNodes);
  if (!simplePathPolygon(inner)) return false;
  // Self-overlap in the outer guide is an additive merge, not invalid Path
  // geometry. A simple guide must still contain the complete inner Path.
  return !simplePathPolygon(outer) || inner.every((point) => pointInsidePathPolygon(point, outer));
}

function validPathGeometry(leaf, nodes) {
  const polygon = flattenPathNodes(nodes);
  if (!simplePathPolygon(polygon)) return false;
  return !leaf.feather_nodes?.length || validFeatherGeometry(nodes, leaf.feather_nodes);
}

function setSelectedPathNodeType(leaf, nodeType) {
  const nodes = activePathNodes(leaf);
  const index = state.selectedPathNode;
  const node = index === null ? null : nodes[index];
  if (!node) return;
  if (nodeType === "sharp") {
    node.node_type = "sharp";
    node.in_x = node.in_y = node.out_x = node.out_y = null;
  } else {
    const previous = nodes[(index - 1 + nodes.length) % nodes.length];
    const next = nodes[(index + 1) % nodes.length];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const inLength = Math.min(Math.hypot(node.x - previous.x, node.y - previous.y) / 3, 0.15);
    const outLength = Math.min(Math.hypot(next.x - node.x, next.y - node.y) / 3, 0.15);
    node.node_type = "smooth";
    node.in_x = clamp(node.x - ux * inLength, -1, 2);
    node.in_y = clamp(node.y - uy * inLength, -1, 2);
    node.out_x = clamp(node.x + ux * outLength, -1, 2);
    node.out_y = clamp(node.y + uy * outLength, -1, 2);
  }
  scheduleSpatialMaskPreview(selectedLocal());
  renderMaskTreeEditor(selectedLocal());
  queueLocalMaskOverlayRender();
  commitSelectedLocal();
}

function splitPathSegment(nodes, segmentIndex, t = 0.5) {
  const first = nodes[segmentIndex];
  const nextIndex = (segmentIndex + 1) % nodes.length;
  const second = nodes[nextIndex];
  const p0 = { x: first.x, y: first.y };
  const p1 = { x: first.out_x ?? first.x, y: first.out_y ?? first.y };
  const p2 = { x: second.in_x ?? second.x, y: second.in_y ?? second.y };
  const p3 = { x: second.x, y: second.y };
  const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(p0, p1);
  const p12 = lerp(p1, p2);
  const p23 = lerp(p2, p3);
  const p012 = lerp(p01, p12);
  const p123 = lerp(p12, p23);
  const point = lerp(p012, p123);
  const curved = Math.hypot(p1.x - p0.x, p1.y - p0.y) > 1e-8 || Math.hypot(p2.x - p3.x, p2.y - p3.y) > 1e-8;
  if (curved) {
    first.out_x = p01.x; first.out_y = p01.y;
    second.in_x = p23.x; second.in_y = p23.y;
  }
  const inserted = curved
    ? { x: point.x, y: point.y, in_x: p012.x, in_y: p012.y, out_x: p123.x, out_y: p123.y, node_type: "smooth" }
    : { x: point.x, y: point.y, in_x: null, in_y: null, out_x: null, out_y: null, node_type: "sharp" };
  const insertionIndex = segmentIndex + 1;
  nodes.splice(insertionIndex, 0, inserted);
  return insertionIndex;
}

function localDisplayPointerPoint(event) {
  const preview = activePreviewElement();
  if (!preview) return null;
  const rect = preview.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
  // A closed Path can have legal Bezier handles outside the image even though
  // its anchors remain source-bounded. Accept pointer coordinates across the
  // larger overlay canvas so those rendered handles can be acquired; node
  // movement still applies the Path [0, 1] anchor clamp downstream. Draft
  // creation remains image-bounded so an outside click cannot create a node.
  const allowOutside = Boolean(pathLeaf && (state.localPathEditMode === "feather" || !state.localPathDraft));
  if (outside && !state.localPointerGesture && !allowOutside) return null;
  return {
    x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), allowOutside ? -1 : 0, allowOutside ? 2 : 1),
    y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), allowOutside ? -1 : 0, allowOutside ? 2 : 1),
  };
}

function localPointerPoint(event, displayPoint = null) {
  const point = displayPoint || localDisplayPointerPoint(event);
  if (!point) return null;
  const coordinateMap = currentGeometryCoordinateMap();
  if (!coordinateMap) {
    void ensureGeometryCoordinateMap();
    return null;
  }
  const source = projectivePoint(coordinateMap.outputToSource, point);
  const pathLeaf = selectedMaskLeaf(selectedLocal(), "path");
  const allowOutside = Boolean(pathLeaf && (state.localPathEditMode === "feather" || !state.localPathDraft));
  return {
    x: clamp(source.x, allowOutside ? -1 : 0, allowOutside ? 2 : 1),
    y: clamp(source.y, allowOutside ? -1 : 0, allowOutside ? 2 : 1),
  };
}

function sourcePointToDisplay(point) {
  const coordinateMap = currentGeometryCoordinateMap();
  if (!coordinateMap) {
    void ensureGeometryCoordinateMap();
    return null;
  }
  return projectivePoint(coordinateMap.sourceToOutput, point);
}

function pathTargetAtPointer(event, nodes, selectedIndex) {
  const rect = activePreviewElement()?.getBoundingClientRect();
  if (!rect || !nodes?.length) return null;
  const px = event.clientX;
  const py = event.clientY;
  const screen = (point) => {
    const display = sourcePointToDisplay(point);
    return display ? { x: rect.left + display.x * rect.width, y: rect.top + display.y * rect.height } : null;
  };
  const selected = selectedIndex === null ? null : nodes[selectedIndex];
  if (selected) {
    for (const handle of ["in", "out"]) {
      if (selected[`${handle}_x`] === null || selected[`${handle}_x`] === undefined) continue;
      const position = screen({ x: selected[`${handle}_x`], y: selected[`${handle}_y`] });
      if (!position) return null;
      if (Math.hypot(px - position.x, py - position.y) <= 14) return { type: "handle", index: selectedIndex, handle };
    }
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const position = screen(nodes[index]);
    if (!position) return null;
    if (Math.hypot(px - position.x, py - position.y) <= 14) return { type: "node", index };
  }
  let nearest = null;
  for (let segment = 0; segment < nodes.length; segment += 1) {
    const first = nodes[segment];
    const second = nodes[(segment + 1) % nodes.length];
    for (let sample = 0; sample <= 32; sample += 1) {
      const t = sample / 32;
      const point = screen(cubicPathPoint(first, second, t));
      if (!point) return null;
      const distance = Math.hypot(px - point.x, py - point.y);
      if (!nearest || distance < nearest.distance) nearest = { type: "curve", segment, t, distance };
    }
  }
  return nearest?.distance <= 10 ? nearest : null;
}

function updatePathCreationGesture(gesture, event, point) {
  const node = gesture.leaf.nodes[gesture.nodeIndex];
  if (!node) return;
  const dragged = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) >= 3;
  if (!dragged) return;
  const dx = point.x - gesture.origin.x;
  const dy = point.y - gesture.origin.y;
  node.node_type = "smooth";
  node.in_x = clamp(node.x - dx, -1, 2);
  node.in_y = clamp(node.y - dy, -1, 2);
  node.out_x = clamp(node.x + dx, -1, 2);
  node.out_y = clamp(node.y + dy, -1, 2);
}

function replacePathNodes(target, source) {
  target.splice(0, target.length, ...JSON.parse(JSON.stringify(source)));
}

function updatePathNodeGesture(gesture, point) {
  const node = gesture.nodes[gesture.nodeIndex];
  if (!node) return;
  const bounds = state.localPathEditMode === "feather" ? [-1, 2] : [0, 1];
  const nextX = clamp(point.x, bounds[0], bounds[1]);
  const nextY = clamp(point.y, bounds[0], bounds[1]);
  const dx = nextX - gesture.origin.x;
  const dy = nextY - gesture.origin.y;
  const beforeNode = gesture.before[gesture.nodeIndex];
  node.x = nextX;
  node.y = nextY;
  for (const handle of ["in", "out"]) {
    if (beforeNode[`${handle}_x`] === null || beforeNode[`${handle}_x`] === undefined) continue;
    node[`${handle}_x`] = clamp(beforeNode[`${handle}_x`] + dx, -1, 2);
    node[`${handle}_y`] = clamp(beforeNode[`${handle}_y`] + dy, -1, 2);
  }
  const valid = state.localPathEditMode === "feather"
    ? validFeatherGeometry(gesture.leaf.nodes, gesture.nodes)
    : validPathGeometry(gesture.leaf, gesture.nodes);
  state.pathInvalidGesture = !valid;
  if (!valid) replacePathNodes(gesture.nodes, gesture.before);
  else {
    gesture.changed = true;
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(selectedLocal());
  }
}

function updatePathHandleGesture(gesture, point) {
  const node = gesture.nodes[gesture.nodeIndex];
  if (!node) return;
  const handle = gesture.handle;
  const opposite = handle === "in" ? "out" : "in";
  node[`${handle}_x`] = clamp(point.x, -1, 2);
  node[`${handle}_y`] = clamp(point.y, -1, 2);
  if (node.node_type === "smooth") {
    const originalOpposite = gesture.before[gesture.nodeIndex];
    const oppositeLength = Math.hypot(
      Number(originalOpposite[`${opposite}_x`] ?? node.x) - node.x,
      Number(originalOpposite[`${opposite}_y`] ?? node.y) - node.y,
    );
    const dx = node[`${handle}_x`] - node.x;
    const dy = node[`${handle}_y`] - node.y;
    const length = Math.hypot(dx, dy) || 1;
    node[`${opposite}_x`] = clamp(node.x - dx / length * oppositeLength, -1, 2);
    node[`${opposite}_y`] = clamp(node.y - dy / length * oppositeLength, -1, 2);
  }
  const valid = state.localPathEditMode === "feather"
    ? validFeatherGeometry(gesture.leaf.nodes, gesture.nodes)
    : validPathGeometry(gesture.leaf, gesture.nodes);
  state.pathInvalidGesture = !valid;
  if (!valid) replacePathNodes(gesture.nodes, gesture.before);
  else {
    gesture.changed = true;
    state.localMaskDraftDirty = true;
    scheduleAuthoritativeLocalMaskDraft(selectedLocal());
  }
}

function handlePathCanvasKeydown(event) {
  const local = selectedLocal();
  const leaf = selectedMaskLeaf(local, "path");
  if (!leaf) return;
  if (state.localPathDraft) {
    if (event.key === "Enter") { event.preventDefault(); void finishLocalPathDraft(); }
    if (event.key === "Escape") { event.preventDefault(); cancelLocalPathDraft(); }
    return;
  }
  const nodes = activePathNodes(leaf);
  if (!nodes.length) return;
  if (event.key === "[" || event.key === "]") {
    event.preventDefault();
    const direction = event.key === "]" ? 1 : -1;
    state.selectedPathNode = ((state.selectedPathNode ?? (direction > 0 ? -1 : 0)) + direction + nodes.length) % nodes.length;
    state.pathKeyboardTarget = "node";
    renderMaskTreeEditor(local);
    queueLocalMaskOverlayRender();
    return;
  }
  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    const available = ["node"];
    const selected = nodes[state.selectedPathNode ?? 0];
    if (selected?.in_x !== null && selected?.in_x !== undefined) available.push("in", "out");
    state.pathKeyboardTarget = available[(available.indexOf(state.pathKeyboardTarget) + 1) % available.length];
    return;
  }
  if (event.key.toLowerCase() === "s") { event.preventDefault(); setSelectedPathNodeType(leaf, "sharp"); return; }
  if (event.key.toLowerCase() === "m") { event.preventDefault(); setSelectedPathNodeType(leaf, "smooth"); return; }
  if (event.key === "Enter") {
    event.preventDefault();
    const index = state.selectedPathNode ?? 0;
    state.selectedPathNode = splitPathSegment(nodes, index, 0.5);
    scheduleSpatialMaskPreview(local);
    renderMaskTreeEditor(local);
    commitSelectedLocal();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    if (nodes.length <= 3 || state.selectedPathNode === null) return;
    event.preventDefault();
    const before = JSON.parse(JSON.stringify(nodes));
    nodes.splice(state.selectedPathNode, 1);
    const valid = state.localPathEditMode === "feather" ? validFeatherGeometry(leaf.nodes, nodes) : validPathGeometry(leaf, nodes);
    if (!valid) replacePathNodes(nodes, before);
    else {
      state.selectedPathNode = Math.min(state.selectedPathNode, nodes.length - 1);
      scheduleSpatialMaskPreview(local);
      renderMaskTreeEditor(local);
      commitSelectedLocal();
    }
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || state.selectedPathNode === null) return;
  event.preventDefault();
  const rect = activePreviewElement()?.getBoundingClientRect();
  if (!rect) return;
  const pixels = event.shiftKey ? 10 : 1;
  const node = nodes[state.selectedPathNode];
  const target = state.pathKeyboardTarget;
  const sourceTarget = target === "node"
    ? { x: node.x, y: node.y }
    : { x: node[`${target}_x`], y: node[`${target}_y`] };
  const displayTarget = sourcePointToDisplay(sourceTarget);
  const coordinateMap = currentGeometryCoordinateMap();
  if (!displayTarget || !coordinateMap) return;
  const displayDx = event.key === "ArrowLeft" ? -pixels / rect.width : event.key === "ArrowRight" ? pixels / rect.width : 0;
  const displayDy = event.key === "ArrowUp" ? -pixels / rect.height : event.key === "ArrowDown" ? pixels / rect.height : 0;
  const movedSource = projectivePoint(coordinateMap.outputToSource, {
    x: displayTarget.x + displayDx,
    y: displayTarget.y + displayDy,
  });
  const dx = movedSource.x - sourceTarget.x;
  const dy = movedSource.y - sourceTarget.y;
  if (target === "node") {
    const before = { ...node };
    node.x += dx; node.y += dy;
    for (const handle of ["in", "out"]) {
      if (node[`${handle}_x`] === null || node[`${handle}_x`] === undefined) continue;
      node[`${handle}_x`] += dx; node[`${handle}_y`] += dy;
    }
    const valid = state.localPathEditMode === "feather" ? validFeatherGeometry(leaf.nodes, nodes) : validPathGeometry(leaf, nodes);
    if (!valid) Object.assign(node, before);
  } else {
    updatePathHandleGesture({ leaf, nodes, nodeIndex: state.selectedPathNode, handle: target, before: JSON.parse(JSON.stringify(nodes)) }, { x: node[`${target}_x`] + dx, y: node[`${target}_y`] + dy });
  }
  scheduleSpatialMaskPreview(local);
  queueLocalMaskOverlayRender();
  commitSelectedLocal();
}

function syncLocalMaskOverlayViewport() {
  const canvas = els.localMaskOverlay;
  const pane = els.previewPrimaryPane;
  const viewport = els.dropzone;
  if (!canvas || !pane || !viewport) return;
  // During a crop/rotate handoff the overlay intentionally transforms with the
  // old bitmap. Keep its full-pane box until the authoritative frame arrives.
  if (["--interactive-rotate-angle", "--interactive-straighten-angle", "--interactive-flip-x", "--interactive-flip-y"]
    .some((property) => canvas.style.getPropertyValue(property))) {
    Object.assign(canvas.style, { inset: "0", width: "100%", height: "100%" });
    return;
  }
  const paneRect = pane.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const left = Math.max(0, viewportRect.left - paneRect.left);
  const top = Math.max(0, viewportRect.top - paneRect.top);
  const right = Math.min(paneRect.width, viewportRect.right - paneRect.left);
  const bottom = Math.min(paneRect.height, viewportRect.bottom - paneRect.top);
  Object.assign(canvas.style, {
    inset: "auto",
    left: `${left}px`,
    top: `${top}px`,
    right: "auto",
    bottom: "auto",
    width: `${Math.max(1, right - left)}px`,
    height: `${Math.max(1, bottom - top)}px`,
  });
}

function beginPathMaskProgress(local) {
  if (!local || local.mask?.leaf?.type !== "path") return;
  state.pathMaskProgressTarget = {
    localId: local.id,
    maskSignature: JSON.stringify(local.mask),
    spatialSignature: localMaskSpatialSignature(local.mask),
  };
  if (state.pathMaskProgressTimer || !els.pathMaskProgress?.classList.contains("hidden")) return;
  state.pathMaskProgressStartedAt = performance.now();
  state.pathMaskProgressTimer = window.setTimeout(() => {
    state.pathMaskProgressTimer = 0;
    if (!state.pathMaskProgressTarget) return;
    els.pathMaskProgressCopy.textContent = "Updating feather…";
    els.pathMaskProgress.classList.remove("hidden", "error");
  }, 400);
}

function finishPathMaskProgress(localId, signature, spatialOnly = false) {
  const target = state.pathMaskProgressTarget;
  if (!target || target.localId !== localId) return;
  if (signature !== (spatialOnly ? target.spatialSignature : target.maskSignature)) return;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  els.pathMaskProgress?.classList.add("hidden");
  if (window.HDRFinisherPerformance) {
    window.HDRFinisherPerformance.pathMaskLatencyMs = performance.now() - state.pathMaskProgressStartedAt;
  }
}

function cancelPathMaskProgress() {
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  els.pathMaskProgress?.classList.add("hidden");
  els.pathMaskProgress?.classList.remove("error");
}

function failPathMaskProgress(localId) {
  if (state.pathMaskProgressTarget?.localId !== localId) return;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  els.pathMaskProgressCopy.textContent = "Feather preview could not be updated.";
  els.pathMaskProgress.classList.remove("hidden");
  els.pathMaskProgress.classList.add("error");
}

function renderLocalMaskOverlay() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  const local = selectedLocal();
  if (state.pathMaskProgressTarget && state.pathMaskProgressTarget.localId !== local?.id) {
    cancelPathMaskProgress();
  }
  const active = state.gradeMode === "local" && Boolean(local) && local.enabled !== false;
  canvas.classList.toggle("editing", active);
  syncLocalMaskOverlayViewport();
  const rect = canvas.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const deviceRatio = window.devicePixelRatio || 1;
  // The canvas covers only the visible viewer intersection, so it can render at
  // device resolution without allocating a 30k-wide bitmap at extreme zoom.
  const ratio = deviceRatio;
  const bitmapWidth = Math.max(1, Math.round(rect.width * ratio));
  const bitmapHeight = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  if (!active) return;
  const preview = activePreviewElement();
  const imageRect = preview?.getBoundingClientRect();
  if (!imageRect) return;
  const offsetX = imageRect.left - rect.left;
  const offsetY = imageRect.top - rect.top;
  const gradeEdge = els.gradeSplitter?.getBoundingClientRect().left;
  state.localBrushVisibleBounds = {
    left: 0,
    top: 0,
    right: Math.min(rect.width, Number.isFinite(gradeEdge) ? gradeEdge - rect.left : rect.width),
    bottom: rect.height,
  };
  const x = (value) => offsetX + value * imageRect.width;
  const y = (value) => offsetY + value * imageRect.height;
  const childParts = selectedChildMaskParts(local);
  if (childParts) {
    renderChildMaskComparisonOverlay(context, local, childParts, x, y, imageRect, rect);
    return;
  }
  const editorExpression = selectedMaskExpression(local);
  const maskSignature = JSON.stringify(local.mask);
  const spatialSignature = localMaskSpatialSignature(local.mask);
  const authoritative = localAuthoritativeMaskCache.get(local.id);
  const authoritativeGeometryCurrent = authoritative?.geometrySignature === geometrySignature();
  const authoritativeCurrent = Boolean(authoritative
    && authoritativeGeometryCurrent
    && authoritative.signature === (authoritative.spatialOnly ? spatialSignature : maskSignature));
  const needsAuthoritativeOverlay = local.mask?.operator !== "leaf"
    || ["linear_gradient", "luminance_range"].includes(local.mask?.leaf?.type);
  const drawOptions = {
    localId: local.id,
    maskSignature,
    spatialSignature,
    // Gradient and luminance masks have no client-side mask rasterizer. Keep
    // their most recent exact frame visible across both the draft and commit
    // handoffs, then replace it atomically when the current exact frame lands.
    // Brush masks can instead fall back to their current local stroke raster.
    authoritative: authoritativeGeometryCurrent && (
      state.localMaskDraftDirty
      || needsAuthoritativeOverlay
      || authoritative.signature === (authoritative.spatialOnly ? spatialSignature : maskSignature)
    )
      ? authoritative
      : null,
    authoritativeCurrent,
    exactMaskPending: state.localMaskDraftDirty,
    gpuLumaOverlay: gpuLumaMaskPreviewActive(local),
  };
  if (local.mask?.operator !== "leaf" && authoritativeCurrent && state.localShowMask) {
    drawAuthoritativeMaskOverlay(context, authoritative.canvas, x, y, 1);
  } else {
    drawMaskExpression(context, local.mask, x, y, { ...drawOptions, renderPhase: "mask" });
  }
  const coordinateMap = currentGeometryCoordinateMap();
  if (coordinateMap) {
    if (projectiveMatrixIsAffine(coordinateMap.sourceToOutput)) {
      context.save();
      applySourceGeometryCanvasTransform(context, imageRect, rect, coordinateMap.sourceToOutput);
      drawMaskExpression(context, editorExpression, x, y, { ...drawOptions, renderPhase: "gizmo", skipBrush: true });
      context.restore();
    } else {
      drawMaskExpression(
        context,
        projectMaskExpressionToOutput(editorExpression, coordinateMap.sourceToOutput),
        x,
        y,
        { ...drawOptions, renderPhase: "gizmo", skipBrush: true },
      );
    }
    drawBrushExpressionOutputSpace(
      context,
      editorExpression,
      x,
      y,
      drawOptions,
      brushOutputSpaceMapper(imageRect, coordinateMap.sourceToOutput),
    );
  } else {
    void ensureGeometryCoordinateMap();
  }
  if (!gpuLumaMaskPreviewActive(local)) void queueAuthoritativeLocalMask(local);
}

function renderChildMaskComparisonOverlay(context, local, parts, x, y, imageRect, paneRect) {
  const parentEntry = localComparisonMaskEntry(local, parts.id, "parent");
  const childEntry = parts.child ? localComparisonMaskEntry(local, parts.id, "child") : null;
  if (state.localShowMask && parentEntry) {
    drawLocalMaskComparison(context, parentEntry, childEntry, x, y);
  }
  void queueLocalComparisonMask(local, parts.id, "parent", parts.parent);
  if (parts.child) void queueLocalComparisonMask(local, parts.id, "child", parts.child);
  if (!parts.child) return;

  const maskSignature = JSON.stringify(parts.child);
  const spatialSignature = localMaskSpatialSignature(parts.child);
  const drawOptions = {
    localId: `${local.id}:${parts.id}:child`,
    maskSignature,
    spatialSignature,
    authoritative: childEntry,
    authoritativeCurrent: Boolean(childEntry?.signature === spatialSignature),
    exactMaskPending: false,
    gpuLumaOverlay: false,
    overlayColor: "#2675ff",
  };
  const coordinateMap = currentGeometryCoordinateMap();
  if (coordinateMap) {
    if (projectiveMatrixIsAffine(coordinateMap.sourceToOutput)) {
      context.save();
      applySourceGeometryCanvasTransform(context, imageRect, paneRect, coordinateMap.sourceToOutput);
      drawMaskExpression(context, parts.child, x, y, { ...drawOptions, renderPhase: "gizmo", skipBrush: true });
      context.restore();
    } else {
      drawMaskExpression(
        context,
        projectMaskExpressionToOutput(parts.child, coordinateMap.sourceToOutput),
        x,
        y,
        { ...drawOptions, renderPhase: "gizmo", skipBrush: true },
      );
    }
    drawBrushExpressionOutputSpace(
      context,
      parts.child,
      x,
      y,
      drawOptions,
      brushOutputSpaceMapper(imageRect, coordinateMap.sourceToOutput),
    );
  } else {
    void ensureGeometryCoordinateMap();
  }
}

function projectiveMatrixIsAffine(matrix) {
  return matrix?.length === 9
    && Math.abs(Number(matrix[6])) < 1e-10
    && Math.abs(Number(matrix[7])) < 1e-10
    && Math.abs(Number(matrix[8])) > 1e-10;
}

function projectPathNodeToOutput(node, matrix) {
  const projected = { ...node, ...projectivePoint(matrix, node) };
  for (const prefix of ["in", "out"]) {
    const source = { x: node?.[`${prefix}_x`], y: node?.[`${prefix}_y`] };
    if (!Number.isFinite(Number(source.x)) || !Number.isFinite(Number(source.y))) continue;
    const handle = projectivePoint(matrix, source);
    projected[`${prefix}_x`] = handle.x;
    projected[`${prefix}_y`] = handle.y;
  }
  return projected;
}

function projectMaskExpressionToOutput(expression, matrix) {
  if (!expression) return expression;
  if (expression.operator !== "leaf") {
    return {
      ...expression,
      children: (expression.children || []).map((child) => projectMaskExpressionToOutput(child, matrix)),
    };
  }
  const leaf = expression.leaf;
  if (!leaf) return expression;
  const projectedLeaf = { ...leaf };
  if (leaf.type === "linear_gradient") {
    projectedLeaf.start = projectivePoint(matrix, leaf.start);
    projectedLeaf.end = projectivePoint(matrix, leaf.end);
  } else if (leaf.type === "path") {
    projectedLeaf.nodes = (leaf.nodes || []).map((node) => projectPathNodeToOutput(node, matrix));
    projectedLeaf.feather_nodes = (leaf.feather_nodes || []).map((node) => projectPathNodeToOutput(node, matrix));
  }
  return { ...expression, leaf: projectedLeaf };
}

function applySourceGeometryCanvasTransform(context, imageRect, paneRect, matrix) {
  const width = Math.max(imageRect.width, 1);
  const height = Math.max(imageRect.height, 1);
  const offsetX = imageRect.left - paneRect.left;
  const offsetY = imageRect.top - paneRect.top;
  const normalization = Number(matrix[8]) || 1;
  const a = matrix[0] / normalization;
  const b = matrix[3] / normalization * height / width;
  const c = matrix[1] / normalization * width / height;
  const d = matrix[4] / normalization;
  const e = offsetX - a * offsetX - c * offsetY + matrix[2] / normalization * width;
  const f = offsetY - b * offsetX - d * offsetY + matrix[5] / normalization * height;
  context.transform(a, b, c, d, e, f);
}

function queueLocalMaskOverlayRender() {
  if (localMaskOverlayFrame) return;
  localMaskOverlayFrame = window.requestAnimationFrame(() => {
    localMaskOverlayFrame = 0;
    renderLocalMaskOverlay();
  });
}

function localMaskSpatialSignature(expression) {
  if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(expression);
  return JSON.stringify({
    ...expression,
    leaf: { ...expression.leaf, mask_opacity: 1 },
  });
}

function localComparisonMaskSlot(localId, childId, role) {
  return `${localId}:${childId}:${role}`;
}

function localComparisonMaskEntry(local, childId, role) {
  const entry = localComparisonMaskCache.get(localComparisonMaskSlot(local.id, childId, role)) || null;
  return entry?.geometrySignature === geometrySignature() ? entry : null;
}

function queueLocalComparisonMask(local, childId, role, expression) {
  if (!state.session || !local || !expression) return;
  const slot = localComparisonMaskSlot(local.id, childId, role);
  const signature = localMaskSpatialSignature(expression);
  const longEdge = settledProxyLongEdge();
  const requestedGeometrySignature = geometrySignature();
  const key = `${state.session.session_id}:${slot}:${longEdge}:${requestedGeometrySignature}:${signature}`;
  if (localComparisonMaskCache.get(slot)?.key === key) return;
  const previous = localComparisonMaskRequests.get(slot);
  if (previous?.key === key) return;
  if (previous) {
    window.clearTimeout(previous.timer);
    previous.controller?.abort();
  }
  const pending = {
    key,
    signature,
    expression: JSON.parse(JSON.stringify(expression)),
    longEdge,
    requestedGeometrySignature,
    controller: null,
    timer: 0,
  };
  pending.timer = window.setTimeout(() => loadLocalComparisonMask(local, childId, role, slot, pending), 70);
  localComparisonMaskRequests.set(slot, pending);
}

async function loadLocalComparisonMask(local, childId, role, slot, pending) {
  if (localComparisonMaskRequests.get(slot) !== pending || !state.session) return;
  const controller = new AbortController();
  pending.controller = controller;
  try {
    const response = await fetch(
      `/api/session/${state.session.session_id}/local-mask/${encodeURIComponent(local.id)}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mask: pending.expression,
          adjustments: state.adjustments,
          edit_revision: state.editRevision,
          long_edge: pending.longEdge,
        }),
      },
    );
    if (!response.ok || localComparisonMaskRequests.get(slot) !== pending) return;
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const alpha = new Uint8Array(await response.arrayBuffer());
    const currentLocal = selectedLocal();
    const currentParts = selectedChildMaskParts(currentLocal);
    const currentExpression = role === "parent" ? currentParts?.parent : currentParts?.child;
    if (
      currentLocal?.id !== local.id
      || currentParts?.id !== childId
      || pending.requestedGeometrySignature !== geometrySignature()
      || pending.signature !== localMaskSpatialSignature(currentExpression)
    ) return;
    localComparisonMaskCache.set(slot, {
      key: pending.key,
      signature: pending.signature,
      geometrySignature: pending.requestedGeometrySignature,
      canvas: alphaMaskCanvas(alpha, width, height),
    });
    while (localComparisonMaskCache.size > 12) {
      localComparisonMaskCache.delete(localComparisonMaskCache.keys().next().value);
    }
    localComparisonCompositeCache.clear();
    queueLocalMaskOverlayRender();
  } catch (error) {
    if (error?.name !== "AbortError") console.warn("Local mask comparison could not be loaded.", error);
  } finally {
    if (localComparisonMaskRequests.get(slot) === pending) localComparisonMaskRequests.delete(slot);
  }
}

function drawLocalMaskComparison(context, parentEntry, childEntry, x, y) {
  const compositeKey = `${parentEntry.key}:${childEntry?.key || "no-child"}`;
  let composite = localComparisonCompositeCache.get(compositeKey);
  if (!composite) {
    const width = parentEntry.canvas.width;
    const height = parentEntry.canvas.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const canvasContext = canvas.getContext("2d");
    const parentPixels = parentEntry.canvas.getContext("2d").getImageData(0, 0, width, height).data;
    let childPixels = null;
    if (childEntry) {
      const childCanvas = document.createElement("canvas");
      childCanvas.width = width;
      childCanvas.height = height;
      childCanvas.getContext("2d").drawImage(childEntry.canvas, 0, 0, width, height);
      childPixels = childCanvas.getContext("2d").getImageData(0, 0, width, height).data;
    }
    const output = canvasContext.createImageData(width, height);
    const parentColor = LOCAL_COMPARISON_COLORS.parent;
    const childColor = LOCAL_COMPARISON_COLORS.child;
    const overlapColor = LOCAL_COMPARISON_COLORS.overlap;
    for (let index = 0; index < output.data.length; index += 4) {
      const parentAmount = parentPixels[index + 3] / 255;
      const childAmount = childPixels ? childPixels[index + 3] / 255 : 0;
      const parentOnly = parentAmount * (1 - childAmount);
      const childOnly = childAmount * (1 - parentAmount);
      const overlap = parentAmount * childAmount;
      const coverage = parentOnly + childOnly + overlap;
      if (coverage <= 0.0001) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[index + channel] = Math.round((
          parentOnly * parentColor[channel]
          + childOnly * childColor[channel]
          + overlap * overlapColor[channel]
        ) / coverage);
      }
      output.data[index + 3] = Math.round(255 * 0.58 * coverage);
    }
    canvasContext.putImageData(output, 0, 0);
    composite = canvas;
    localComparisonCompositeCache.set(compositeKey, composite);
    while (localComparisonCompositeCache.size > 8) {
      localComparisonCompositeCache.delete(localComparisonCompositeCache.keys().next().value);
    }
  }
  const left = x(0);
  const top = y(0);
  const width = Math.max(1, Math.round(x(1) - left));
  const height = Math.max(1, Math.round(y(1) - top));
  context.drawImage(composite, left, top, width, height);
}

function drawMaskExpression(context, expression, x, y, options = {}) {
  if (expression.operator !== "leaf") {
    const children = expression.enabled === false
      ? (expression.children || []).slice(0, 1)
      : (expression.children || []).filter((child) => child.enabled !== false);
    children.forEach((child) => drawMaskExpression(context, child, x, y, options));
    return;
  }
  if (expression.enabled === false) return;
  const leaf = expression.leaf;
  if (!leaf) return;
  const renderMask = options.renderPhase !== "gizmo";
  const renderGizmo = options.renderPhase !== "mask";
  context.save();
  context.strokeStyle = "rgba(238, 252, 255, .98)";
  context.fillStyle = overlayColorWithAlpha(0.22, options.overlayColor);
  context.lineWidth = 2;
  if (leaf.type === "linear_gradient") {
    if (renderMask && state.localShowMask && options.authoritative) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawLinearGradientGizmo(context, leaf, x, y);
  } else if (leaf.type === "brush" && !options.skipBrush) {
    const gesture = state.localPointerGesture;
    const activeStroke = gesture?.type === "brush" && gesture.leaf === leaf ? gesture.stroke : null;
    // Authoritative mask rasters are already in post-geometry output space,
    // while the client fallback is rebuilt from source-anchored stroke points.
    // Draw only the former in the untransformed mask phase. The latter must
    // share the source-to-output transform used by the cursor, active stroke,
    // and Path gizmos or a crop/rotate makes settled paint jump away from the
    // pointer until the authoritative mask request completes.
    if (renderMask && state.localShowMask && options.authoritative) {
      drawBrushMaskOverlay(context, leaf, null, x, y, expression.inverted, options);
    }
    if (renderGizmo && state.localShowMask && !options.authoritative) {
      drawBrushMaskOverlay(context, leaf, null, x, y, expression.inverted, options);
    }
    if (renderGizmo && state.localShowMask && activeStroke) {
      drawActiveBrushStrokeOverlay(context, activeStroke, x, y, null, options.overlayColor);
    }
    const cursor = state.localBrushCursor || activeStroke?.points?.at(-1);
    if (renderGizmo && cursor) drawBrushGizmo(context, cursor, brushSettings(leaf), x, y);
  } else if (leaf.type === "luminance_range") {
    if (renderMask && state.localShowMask && options.authoritative && !options.gpuLumaOverlay) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    const samplingGesture = state.localPointerGesture;
    if (renderMask && samplingGesture?.type === "luminance_sample" && samplingGesture.leaf === leaf) {
      drawLuminanceSamplingGesture(context, samplingGesture, x, y);
    }
  } else if (leaf.type === "path") {
    const currentAuthoritative = options.authoritativeCurrent ? options.authoritative : null;
    if (renderMask && state.localShowMask && currentAuthoritative) {
      drawAuthoritativeMaskOverlay(context, currentAuthoritative.canvas, x, y, currentAuthoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawPathMaskGizmo(context, leaf, x, y, { drawFill: !currentAuthoritative });
  }
  context.restore();
}

function beginLocalDetailInteraction(control) {
  if (!String(control?.dataset?.localGrade || "").startsWith("detail.")) {
    state.detailInteractionRestore = null;
    return;
  }
  state.detailInteractionRestore = {
    lane: state.currentView,
    longEdge: residentAuthoringLongEdge(),
  };
}

function brushOutputSpaceMapper(imageRect, matrix) {
  const width = Math.max(Number(imageRect?.width) || 0, 1);
  const height = Math.max(Number(imageRect?.height) || 0, 1);
  const mappedRadius = (radius, point = { x: 0.5, y: 0.5 }) => {
    const center = projectivePoint(matrix, point);
    const edge = projectivePoint(matrix, { x: Number(point.x) + Number(radius), y: Number(point.y) });
    return Math.hypot((edge.x - center.x) * width, (edge.y - center.y) * height) / width;
  };
  return {
    signature: `${matrix.join(",")}:${(width / height).toFixed(8)}`,
    point: (point) => projectivePoint(matrix, point),
    radius: mappedRadius,
    stroke: (stroke, points = stroke.points || []) => {
      const radiusPoint = points[Math.floor(points.length / 2)] || stroke.points?.[0] || { x: 0.5, y: 0.5 };
      return {
        ...stroke,
        radius: mappedRadius(stroke.radius, radiusPoint),
        points: points.map((point) => ({ ...projectivePoint(matrix, point), pressure: point.pressure })),
      };
    },
  };
}

function drawBrushExpressionOutputSpace(context, expression, x, y, options, mapper) {
  if (expression.operator !== "leaf") {
    const children = expression.enabled === false
      ? (expression.children || []).slice(0, 1)
      : (expression.children || []).filter((child) => child.enabled !== false);
    children.forEach((child) =>
      drawBrushExpressionOutputSpace(context, child, x, y, options, mapper));
    return;
  }
  if (expression.enabled === false) return;
  const leaf = expression.leaf;
  if (leaf?.type !== "brush") return;
  const gesture = state.localPointerGesture;
  const activeStroke = gesture?.type === "brush" && gesture.leaf === leaf ? gesture.stroke : null;
  const transformedLeaf = {
    ...leaf,
    strokes: (leaf.strokes || []).map((stroke) => mapper.stroke(stroke)),
  };
  const outputOptions = {
    ...options,
    spatialSignature: `${options.spatialSignature}:${mapper.signature}`,
  };
  if (state.localShowMask && !options.authoritative) {
    drawBrushMaskOverlay(context, transformedLeaf, null, x, y, expression.inverted, outputOptions);
  }
  if (state.localShowMask && activeStroke) {
    drawActiveBrushStrokeOverlay(context, activeStroke, x, y, mapper, options.overlayColor);
  }
  const cursor = state.localBrushCursor || activeStroke?.points?.at(-1);
  if (cursor) {
    const settings = brushSettings(leaf);
    drawBrushGizmo(context, mapper.point(cursor), { ...settings, radius: mapper.radius(settings.radius, cursor) }, x, y);
  }
}

function drawBrushMaskOverlay(context, leaf, activeStroke, x, y, inverted = false, options = {}) {
  const left = x(0);
  const top = y(0);
  const displayWidth = Math.max(1, Math.round(x(1) - left));
  const displayHeight = Math.max(1, Math.round(y(1) - top));
  const strokes = leaf.strokes || [];
  const authoritativeCanvas = options.authoritative?.canvas || null;
  const interactionLongEdge = Math.max(256, Math.min(1600, settledProxyLongEdge()));
  const fallbackScale = Math.min(1, interactionLongEdge / Math.max(displayWidth, displayHeight));
  const width = authoritativeCanvas?.width || Math.max(1, Math.round(displayWidth * fallbackScale));
  const height = authoritativeCanvas?.height || Math.max(1, Math.round(displayHeight * fallbackScale));
  const signature = `${width}x${height}:${options.spatialSignature || options.maskSignature || JSON.stringify(strokes)}`;
  const cacheKey = options.localId || leaf;
  let cached = null;
  if (!authoritativeCanvas) {
    cached = localBrushMaskCanvasCache.get(cacheKey);
    if (!cached || cached.signature !== signature) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const canvasContext = canvas.getContext("2d");
      let eraseAttenuation = null;
      for (const stroke of strokes) {
        if (stroke.erase) {
          if (!eraseAttenuation) eraseAttenuation = opaqueBrushMaskCanvas(width, height);
          drawBrushMaskStroke(eraseAttenuation.getContext("2d"), stroke, width, height);
        } else {
          drawBrushMaskStroke(canvasContext, stroke, width, height);
          if (eraseAttenuation) drawBrushMaskStroke(eraseAttenuation.getContext("2d"), stroke, width, height);
        }
      }
      // Cache the fully processed fallback too, since several overlay renders
      // can occur while the authoritative mask request is in flight after
      // pointer-up. Ordered attenuation lets paint restore an earlier erase.
      const processedCanvas = postProcessBrushMaskPreviewWithErase(
        canvas,
        eraseAttenuation,
        leaf,
        width,
        height,
        inverted,
      );
      cached = { signature, processedCanvas };
      localBrushMaskCanvasCache.set(cacheKey, cached);
    }
  }
  let maskCanvas = authoritativeCanvas
    ? authoritativeCanvas
    : cached.processedCanvas;
  if (activeStroke) {
    const baseKey = `${signature}:${options.authoritative?.key || "draft"}`;
    let gestureCanvas = localBrushGestureCanvasCache.get(activeStroke);
    if (!gestureCanvas || gestureCanvas.baseKey !== baseKey) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(maskCanvas, 0, 0, width, height);
      gestureCanvas = { baseKey, canvas, renderedPointCount: 0 };
      localBrushGestureCanvasCache.set(activeStroke, gestureCanvas);
    }
    const firstNewPoint = Math.max(0, gestureCanvas.renderedPointCount - 1);
    const pendingPoints = activeStroke.points.slice(firstNewPoint);
    if (pendingPoints.length && (gestureCanvas.renderedPointCount === 0 || pendingPoints.length > 1)) {
      const draftStroke = {
        ...activeStroke,
        points: pendingPoints,
        opacity: Number(activeStroke.opacity),
      };
      drawBrushMaskStroke(gestureCanvas.canvas.getContext("2d"), draftStroke, width, height);
      gestureCanvas.renderedPointCount = activeStroke.points.length;
    }
    maskCanvas = gestureCanvas.canvas;
  }
  // Shift/Feather generate alpha outside the painted source. Colorize only
  // after those operations so newly covered pixels cannot retain black RGB.
  maskCanvas = tintedBrushMaskCanvas(maskCanvas, !activeStroke, options.overlayColor);
  context.save();
  const influenceOpacity = options.authoritative?.spatialOnly === false
    ? 1
    : clamp(Number(leaf.mask_opacity ?? 1), 0, 1);
  context.globalAlpha = 0.52 * influenceOpacity;
  context.drawImage(maskCanvas, left, top, displayWidth, displayHeight);
  context.restore();
}

async function queueAuthoritativeLocalMask(local) {
  if (!state.session || !local || !local.mask) return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  if (state.localMaskCommitDepth > 0) return;
  if (local.mask.operator === "leaf" && local.mask.leaf?.type === "brush" && !(local.mask.leaf.strokes || []).length) return;
  if (state.localMaskDraftDirty) return;
  const signature = localMaskSpatialSignature(local.mask);
  const longEdge = settledProxyLongEdge();
  const revision = state.editRevision;
  const requestedGeometrySignature = geometrySignature();
  const key = `${state.session.session_id}:${local.id}:${longEdge}:${requestedGeometrySignature}:${signature}`;
  const cached = localAuthoritativeMaskCache.get(local.id);
  if (cached?.key === key || localAuthoritativeMaskRequests.has(key)) return;
  const request = fetch(`/api/session/${state.session.session_id}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${revision}&geometry_signature=${encodeURIComponent(requestedGeometrySignature)}&spatial_only=true`)
    .then(async (response) => {
      if (!response.ok) return;
      if (response.headers.get("X-Geometry-Signature") !== requestedGeometrySignature) return;
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const alpha = new Uint8Array(await response.arrayBuffer());
      if (
        signature !== localMaskSpatialSignature(selectedLocal()?.mask)
        || requestedGeometrySignature !== geometrySignature()
      ) return;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let sourceIndex = 0, targetIndex = 0; sourceIndex < alpha.length; sourceIndex += 1, targetIndex += 4) {
        pixels[targetIndex + 3] = alpha[sourceIndex];
      }
      canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
      localAuthoritativeMaskCache.set(local.id, {
        key,
        signature,
        geometrySignature: requestedGeometrySignature,
        canvas,
        spatialOnly: true,
      });
      finishPathMaskProgress(local.id, signature, true);
      while (localAuthoritativeMaskCache.size > 8) {
        localAuthoritativeMaskCache.delete(localAuthoritativeMaskCache.keys().next().value);
      }
      queueLocalMaskOverlayRender();
    })
    .catch((error) => console.warn("Authoritative local mask could not be loaded.", error))
    .finally(() => localAuthoritativeMaskRequests.delete(key));
  localAuthoritativeMaskRequests.set(key, request);
  await request;
}

function scheduleAuthoritativeLocalMaskDraft(local) {
  if (!state.session || !local || !local.mask) return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  const leaf = selectedMaskLeaf(local);
  if (!leaf) return;
  if (leaf.type === "brush" && local.mask.operator === "leaf" && !(leaf.strokes || []).length) return;
  const signature = JSON.stringify(local.mask);
  state.localMaskDraftPending = {
    localId: local.id,
    mask: JSON.parse(signature),
    signature,
    revision: state.editRevision,
    longEdge: leaf.type === "path"
      ? Math.min(1600, settledProxyLongEdge())
      : settledProxyLongEdge(),
    adjustments: JSON.parse(JSON.stringify(state.adjustments)),
    geometrySignature: geometrySignature(),
    generation: ++state.localMaskDraftGeneration,
  };
  if (state.localMaskDraftController) {
    return;
  }
  window.clearTimeout(state.localMaskDraftTimer);
  state.localMaskDraftTimer = window.setTimeout(flushAuthoritativeLocalMaskDraft, 90);
}

function flushAuthoritativeLocalMaskDraft() {
  state.localMaskDraftTimer = 0;
  if (state.localMaskDraftController || !state.localMaskDraftPending) return;
  const pending = state.localMaskDraftPending;
  state.localMaskDraftPending = null;
  void loadAuthoritativeLocalMaskDraft(
    pending.localId,
    pending.mask,
    pending.signature,
    pending.revision,
    pending.longEdge,
    pending.adjustments,
    pending.geometrySignature,
    pending.generation,
  );
}

function drawActiveBrushStrokeOverlay(context, stroke, x, y, mapper = null, color = state.localOverlayColor) {
  const left = x(0);
  const top = y(0);
  const displayWidth = Math.max(1, Math.round(x(1) - left));
  const displayHeight = Math.max(1, Math.round(y(1) - top));
  const longEdge = Math.max(256, Math.min(1600, settledProxyLongEdge()));
  const scale = Math.min(1, longEdge / Math.max(displayWidth, displayHeight));
  const width = Math.max(1, Math.round(displayWidth * scale));
  const height = Math.max(1, Math.round(displayHeight * scale));
  let gesture = localBrushGestureCanvasCache.get(stroke);
  if (!gesture || gesture.width !== width || gesture.height !== height) {
    const canvas = document.createElement("canvas");
    const tinted = document.createElement("canvas");
    canvas.width = tinted.width = width;
    canvas.height = tinted.height = height;
    gesture = { canvas, tinted, width, height, renderedPointCount: 0 };
    localBrushGestureCanvasCache.set(stroke, gesture);
  }
  const firstNewPoint = Math.max(0, gesture.renderedPointCount - 1);
  const pendingPoints = stroke.points.slice(firstNewPoint);
  if (pendingPoints.length && (gesture.renderedPointCount === 0 || pendingPoints.length > 1)) {
    const pendingStroke = mapper
      ? mapper.stroke(stroke, pendingPoints)
      : { ...stroke, points: pendingPoints };
    drawBrushMaskStroke(gesture.canvas.getContext("2d"), pendingStroke, width, height);
    gesture.renderedPointCount = stroke.points.length;
  }
  if (gesture.color !== color || pendingPoints.length) {
    const tintedContext = gesture.tinted.getContext("2d");
    tintedContext.clearRect(0, 0, width, height);
    tintedContext.drawImage(gesture.canvas, 0, 0);
    tintBrushMask(tintedContext, width, height, color);
    gesture.color = color;
  }
  context.save();
  context.globalAlpha = 0.52;
  context.drawImage(gesture.tinted, left, top, displayWidth, displayHeight);
  context.restore();
}

async function loadAuthoritativeLocalMaskDraft(
  localId,
  mask,
  signature,
  revision,
  longEdge,
  adjustments,
  requestedGeometrySignature,
  generation,
) {
  const controller = new AbortController();
  state.localMaskDraftController = controller;
  const requestedAt = performance.now();
  try {
    const response = await fetch(
      `/api/session/${state.session.session_id}/local-mask/${encodeURIComponent(localId)}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ mask, adjustments, edit_revision: revision, long_edge: longEdge }),
      },
    );
    if (!response.ok) return;
    const width = Number(response.headers.get("X-Image-Width"));
    const height = Number(response.headers.get("X-Image-Height"));
    const alpha = new Uint8Array(await response.arrayBuffer());
    const selected = selectedLocal();
    const currentMaskMatch = Boolean(selected?.mask)
      && localId === selected.id
      && signature === JSON.stringify(selected.mask)
      && requestedGeometrySignature === geometrySignature();
    if (
      (!currentMaskMatch && (generation !== state.localMaskDraftGeneration || revision !== state.editRevision))
      || requestedGeometrySignature !== geometrySignature()
      || localId !== state.selectedLocalId
      || signature !== JSON.stringify(selected?.mask)
    ) {
      state.previewScheduler?.recordStaleResult();
      return;
    }
    const canvas = alphaMaskCanvas(alpha, width, height);
    localAuthoritativeMaskCache.set(localId, {
      key: `draft:${revision}:${longEdge}:${requestedGeometrySignature}:${signature}`,
      signature,
      geometrySignature: requestedGeometrySignature,
      canvas,
      spatialOnly: false,
    });
    finishPathMaskProgress(localId, signature, false);
    trimAuthoritativeLocalMaskCache();
    if (state.rotateDraftGeometry && requestedGeometrySignature === geometrySignature()) {
      [els.previewOverlay, els.localMaskOverlay].forEach((overlay) => {
        overlay?.style.removeProperty("--interactive-rotate-angle");
        overlay?.style.removeProperty("--interactive-flip-x");
        overlay?.style.removeProperty("--interactive-flip-y");
        overlay?.style.removeProperty("--interactive-straighten-angle");
        overlay?.style.removeProperty("--interactive-straighten-scale");
      });
    }
    queueLocalMaskOverlayRender();
    requestAnimationFrame((presentedAt) => {
      window.dispatchEvent(new CustomEvent("hdrfinisher:mask-presented", {
        detail: {
          localId,
          generation,
          longEdge,
          requestedAt,
          presentedAt,
          cpuMaskMs: Number(response.headers.get("X-CPU-Mask-Ms")) || null,
          byteLength: alpha.byteLength,
        },
      }));
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("Authoritative local mask draft could not be loaded.", error);
      failPathMaskProgress(localId);
    }
  } finally {
    if (state.localMaskDraftController === controller) state.localMaskDraftController = null;
    if (state.localMaskDraftPending && state.localMaskDraftDirty && !state.localMaskDraftTimer) {
      state.localMaskDraftTimer = window.setTimeout(flushAuthoritativeLocalMaskDraft, 90);
    }
  }
}

function alphaMaskCanvas(alpha, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < alpha.length; sourceIndex += 1, targetIndex += 4) {
    pixels[targetIndex + 3] = alpha[sourceIndex];
  }
  canvas.getContext("2d").putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas;
}

function trimAuthoritativeLocalMaskCache() {
  while (localAuthoritativeMaskCache.size > 8) {
    localAuthoritativeMaskCache.delete(localAuthoritativeMaskCache.keys().next().value);
  }
}

function postProcessBrushMaskPreview(source, leaf, width, height) {
  let result = source;
  const shift = clamp(Number(leaf.mask_shift_edge || 0), -0.05, 0.05);
  if (Math.abs(shift) > 0) {
    const blurred = document.createElement("canvas");
    blurred.width = width;
    blurred.height = height;
    const blurredContext = blurred.getContext("2d");
    blurredContext.filter = `blur(${Math.max(0.25, Math.abs(shift) * width)}px)`;
    blurredContext.drawImage(result, 0, 0);
    const sourcePixels = result.getContext("2d").getImageData(0, 0, width, height);
    const shiftedPixels = blurredContext.getImageData(0, 0, width, height);
    const threshold = shift > 0 ? 0.158655 : 0.841345;
    const halfBand = 0.035;
    for (let index = 3; index < shiftedPixels.data.length; index += 4) {
      let level = clamp((shiftedPixels.data[index] / 255 - threshold + halfBand) / (halfBand * 2), 0, 1);
      level = level * level * (3 - 2 * level);
      const shiftedAlpha = Math.round(level * 255);
      shiftedPixels.data[index] = shift > 0
        ? Math.max(sourcePixels.data[index], shiftedAlpha)
        : Math.min(sourcePixels.data[index], shiftedAlpha);
    }
    blurredContext.filter = "none";
    blurredContext.putImageData(shiftedPixels, 0, 0);
    result = blurred;
  }

  const featherAmount = clamp(Number(leaf.mask_feather || 0) / 0.05, 0, 1);
  if (featherAmount <= 0) return result;
  const softened = document.createElement("canvas");
  softened.width = width;
  softened.height = height;
  const softenedContext = softened.getContext("2d");
  const sourcePixels = result.getContext("2d").getImageData(0, 0, width, height);
  const featherRadius = 0.18 * Math.pow(featherAmount, 0.75);
  softenedContext.filter = `blur(${Math.max(0.25, featherRadius * width)}px)`;
  softenedContext.drawImage(result, 0, 0);
  const outputPixels = softenedContext.getImageData(0, 0, width, height);
  let sourcePeak = 0;
  let blurredPeak = 0;
  for (let index = 3; index < outputPixels.data.length; index += 4) {
    sourcePeak = Math.max(sourcePeak, sourcePixels.data[index]);
    blurredPeak = Math.max(blurredPeak, outputPixels.data[index]);
  }
  // Keep the painted density stable while replacing the hard boundary with a
  // real Gaussian transition. This avoids the old solid edge plus faint halo.
  const peakScale = blurredPeak > 0 ? sourcePeak / blurredPeak : 0;
  for (let index = 3; index < outputPixels.data.length; index += 4) {
    outputPixels.data[index] = Math.min(sourcePeak, Math.round(outputPixels.data[index] * peakScale));
  }
  softenedContext.filter = "none";
  softenedContext.putImageData(outputPixels, 0, 0);
  return softened;
}

function opaqueBrushMaskCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  return canvas;
}

function postProcessBrushMaskPreviewWithErase(paintedSource, eraseAttenuation, leaf, width, height, inverted = false) {
  const processed = postProcessBrushMaskPreview(paintedSource, leaf, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(processed, 0, 0, width, height);
  const output = context.getImageData(0, 0, width, height);
  const attenuation = eraseAttenuation?.getContext("2d").getImageData(0, 0, width, height).data || null;
  for (let index = 3; index < output.data.length; index += 4) {
    const alpha = inverted ? 255 - output.data[index] : output.data[index];
    output.data[index] = attenuation
      ? Math.round(alpha * attenuation[index] / 255)
      : alpha;
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

function tintedBrushMaskCanvas(maskCanvas, cacheable = false, color = state.localOverlayColor) {
  const cached = cacheable ? localTintedMaskCanvasCache.get(maskCanvas) : null;
  if (cached?.color === color) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = maskCanvas.width;
  canvas.height = maskCanvas.height;
  const context = canvas.getContext("2d");
  context.drawImage(maskCanvas, 0, 0);
  tintBrushMask(context, canvas.width, canvas.height, color);
  if (cacheable) localTintedMaskCanvasCache.set(maskCanvas, { color, canvas });
  return canvas;
}

function tintBrushMask(context, width, height, color = state.localOverlayColor) {
  context.save();
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function overlayColorWithAlpha(alpha, color = state.localOverlayColor) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return `rgba(255, 38, 61, ${alpha})`;
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${alpha})`;
}

function drawAuthoritativeMaskOverlay(context, maskCanvas, x, y, influenceOpacity = 1) {
  const left = x(0);
  const top = y(0);
  const width = Math.max(1, Math.round(x(1) - left));
  const height = Math.max(1, Math.round(y(1) - top));
  const tinted = tintedBrushMaskCanvas(maskCanvas, true);
  context.save();
  context.globalAlpha = 0.52 * clamp(Number(influenceOpacity), 0, 1);
  context.drawImage(tinted, left, top, width, height);
  context.restore();
}

function drawBrushMaskStroke(context, stroke, width, height) {
  const points = stroke.points || [];
  if (!points.length) return;
  const baseRadius = Math.max(1, Number(stroke.radius) * width);
  const hardness = clamp(Number(stroke.hardness), 0, 1);
  const flow = clamp(Number(stroke.flow), 0, 1);
  const opacity = clamp(Number(stroke.opacity), 0, 1);
  const maximumRadius = baseRadius;
  const pointXs = points.map((point) => Number(point.x) * width);
  const pointYs = points.map((point) => Number(point.y) * height);
  const roiLeft = Math.max(0, Math.floor(Math.min(...pointXs) - maximumRadius));
  const roiRight = Math.min(width - 1, Math.ceil(Math.max(...pointXs) + maximumRadius));
  const roiTop = Math.max(0, Math.floor(Math.min(...pointYs) - maximumRadius));
  const roiBottom = Math.min(height - 1, Math.ceil(Math.max(...pointYs) + maximumRadius));
  const roiWidth = roiRight - roiLeft + 1;
  const roiHeight = roiBottom - roiTop + 1;
  if (roiWidth <= 0 || roiHeight <= 0) return;
  const strokeMask = new Float32Array(roiWidth * roiHeight);

  const applyCapsule = (first, second, pressure) => {
    const radius = Math.max(1, baseRadius * clamp(Number(pressure), 0.05, 1));
    const inner = radius * hardness;
    const featherWidth = Math.max(radius - inner, 1e-6);
    const x0 = Number(first.x) * width;
    const y0 = Number(first.y) * height;
    const x1 = Number(second.x) * width;
    const y1 = Number(second.y) * height;
    const left = Math.max(0, Math.floor(Math.min(x0, x1) - radius));
    const right = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + radius));
    const top = Math.max(0, Math.floor(Math.min(y0, y1) - radius));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + radius));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const denominator = Math.max(dx * dx + dy * dy, 1e-8);
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const projection = clamp(((column - x0) * dx + (row - y0) * dy) / denominator, 0, 1);
        const nearestX = x0 + projection * dx;
        const nearestY = y0 + projection * dy;
        const distance = Math.hypot(column - nearestX, row - nearestY);
        if (distance >= radius) continue;
        const coverage = distance <= inner ? 1 : 1 - (distance - inner) / featherWidth;
        const index = (row - roiTop) * roiWidth + column - roiLeft;
        strokeMask[index] = Math.max(strokeMask[index], coverage);
      }
    }
  };

  if (points.length === 1) {
    applyCapsule(points[0], points[0], points[0].pressure ?? 1);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      const first = points[index - 1];
      const second = points[index];
      applyCapsule(first, second, (Number(first.pressure ?? 1) + Number(second.pressure ?? 1)) * 0.5);
    }
  }

  const image = context.getImageData(roiLeft, roiTop, roiWidth, roiHeight);
  for (let index = 0; index < strokeMask.length; index += 1) {
    const coverage = strokeMask[index];
    if (coverage <= 0) continue;
    const alphaIndex = index * 4 + 3;
    const existing = image.data[alphaIndex] / 255;
    const next = stroke.erase
      ? existing * (1 - Math.min(opacity, coverage * flow))
      : Math.max(existing, Math.min(opacity, existing + coverage * flow));
    image.data[alphaIndex - 3] = 0;
    image.data[alphaIndex - 2] = 0;
    image.data[alphaIndex - 1] = 0;
    image.data[alphaIndex] = Math.round(next * 255);
  }
  context.putImageData(image, roiLeft, roiTop);
}

function tracePathBoundary(context, nodes, x, y, closed = true) {
  context.beginPath();
  if (!nodes?.length) return;
  context.moveTo(x(nodes[0].x), y(nodes[0].y));
  const segmentCount = closed ? nodes.length : Math.max(0, nodes.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const first = nodes[index];
    const second = nodes[(index + 1) % nodes.length];
    context.bezierCurveTo(
      x(first.out_x ?? first.x), y(first.out_y ?? first.y),
      x(second.in_x ?? second.x), y(second.in_y ?? second.y),
      x(second.x), y(second.y),
    );
  }
  if (closed) context.closePath();
}

function drawPathNode(context, node, index, x, y, selected, hovered, closeTarget = false) {
  const centerX = x(node.x);
  const centerY = y(node.y);
  const radius = selected ? 7 : 5;
  withScreenSpaceCanvas(context, centerX, centerY, (screenX, screenY) => {
    context.lineWidth = selected ? 2.5 : 2;
    context.strokeStyle = closeTarget ? uiToken("--ready") : selected ? uiToken("--curve-selected-ring") : uiToken("--accent");
    context.fillStyle = selected ? uiToken("--curve-selected") : uiToken("--raised");
    context.shadowColor = "rgba(0, 0, 0, .95)";
    context.shadowBlur = 3;
    context.beginPath();
    if (node.node_type === "sharp") context.rect(screenX - radius, screenY - radius, radius * 2, radius * 2);
    else context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (hovered) {
      context.beginPath();
      context.arc(screenX, screenY, radius + 4, 0, Math.PI * 2);
      context.strokeStyle = uiToken("--text");
      context.lineWidth = 1;
      context.stroke();
    }
  });
}

function drawSelectedPathHandles(context, node, nodeIndex, x, y) {
  if (!node) return;
  context.save();
  context.strokeStyle = uiToken("--accent");
  context.lineWidth = 2;
  for (const handle of ["in", "out"]) {
    if (node[`${handle}_x`] === null || node[`${handle}_x`] === undefined) continue;
    const hx = x(node[`${handle}_x`]);
    const hy = y(node[`${handle}_y`]);
    context.beginPath();
    context.moveTo(x(node.x), y(node.y));
    context.lineTo(hx, hy);
    context.strokeStyle = uiToken("--accent");
    context.lineWidth = 1.25;
    context.stroke();
    withScreenSpaceCanvas(context, hx, hy, (screenX, screenY) => {
      context.beginPath();
      context.arc(screenX, screenY, 6, 0, Math.PI * 2);
      context.fillStyle = uiToken("--raised");
      context.fill();
      context.strokeStyle = uiToken("--text");
      context.lineWidth = 2;
      context.stroke();
      if (state.hoveredPathTarget?.type === "handle" && state.hoveredPathTarget.index === nodeIndex && state.hoveredPathTarget.handle === handle) {
        context.beginPath();
        context.arc(screenX, screenY, 10, 0, Math.PI * 2);
        context.strokeStyle = uiToken("--curve-selected");
        context.lineWidth = 2;
        context.stroke();
      }
    });
  }
  context.restore();
}

function drawPathMaskGizmo(context, leaf, x, y, { drawFill = true } = {}) {
  const draft = Boolean(state.localPathDraft && state.localPathDraft.localId === selectedLocal()?.id);
  const inner = leaf.nodes || [];
  const closed = !draft && inner.length >= 3;
  const outer = leaf.feather_mode === "outer_boundary" && inner.length >= 3
    ? (leaf.feather_nodes?.length ? leaf.feather_nodes : uniformFeatherNodes(inner, Number(leaf.feather || 0)))
    : [];
  const innerPath = () => tracePathBoundary(context, inner, x, y, closed);
  if (drawFill && closed && state.localShowMask) {
    innerPath();
    context.fillStyle = overlayColorWithAlpha(0.22 * clamp(Number(leaf.mask_opacity ?? 1), 0, 1));
    context.fill();
  }
  if (inner.length) {
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = state.pathInvalidGesture ? uiToken("--blocking") : uiToken("--accent");
    context.lineWidth = 1.25;
    innerPath();
    context.stroke();
    context.restore();
  }
  if (draft && inner.length && state.localPathCursor) {
    context.save();
    context.beginPath();
    context.moveTo(x(inner.at(-1).x), y(inner.at(-1).y));
    context.lineTo(x(state.localPathCursor.x), y(state.localPathCursor.y));
    context.setLineDash([5, 5]);
    context.strokeStyle = uiToken("--text");
    context.lineWidth = 1.5;
    context.stroke();
    context.restore();
  }
  if (outer.length) {
    context.save();
    const reducedPathMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const outerPath = () => tracePathBoundary(context, outer, x, y, true);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = state.pathInvalidGesture ? "rgba(255, 92, 92, .55)" : "rgba(174, 184, 187, .4)";
    context.lineWidth = 1.25;
    context.setLineDash([5, 5]);
    context.lineDashOffset = reducedPathMotion ? 0 : -performance.now() / 70;
    outerPath(); context.stroke();
    context.restore();
    if (!reducedPathMotion && !pathMarchingAntFrame) {
      pathMarchingAntFrame = window.requestAnimationFrame(() => {
        pathMarchingAntFrame = 0;
        if (selectedMaskLeaf(selectedLocal(), "path")) queueLocalMaskOverlayRender();
      });
    }
  }

  const active = draft || state.localPathEditMode === "path" ? inner : outer;
  const selectedIndex = draft ? state.selectedPathNode : state.selectedPathNode;
  if (!draft) drawSelectedPathHandles(context, selectedIndex === null ? null : active[selectedIndex], selectedIndex, x, y);
  active.forEach((node, index) => {
    const hovered = state.hoveredPathTarget?.type === "node" && state.hoveredPathTarget.index === index;
    const closeTarget = draft && index === 0 && inner.length >= 3 && hovered;
    drawPathNode(context, node, index, x, y, index === selectedIndex, hovered, closeTarget);
  });
}

function drawLocalGizmoStroke(context, path, width = 2, color = "rgba(238, 252, 255, .98)") {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(0, 0, 0, .88)";
  context.lineWidth = width + 3;
  path();
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = width;
  path();
  context.stroke();
  context.restore();
}

function drawLocalGizmoHandle(context, centerX, centerY, radius = 7) {
  withScreenSpaceCanvas(context, centerX, centerY, (screenX, screenY) => {
    context.beginPath();
    context.arc(screenX, screenY, radius + 2, 0, Math.PI * 2);
    context.fillStyle = "rgba(0, 0, 0, .88)";
    context.fill();
    context.beginPath();
    context.arc(screenX, screenY, radius, 0, Math.PI * 2);
    context.fillStyle = "#142226";
    context.fill();
    context.strokeStyle = "#74e5ee";
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.arc(screenX, screenY, 2, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
  });
}

function withScreenSpaceCanvas(context, x, y, draw) {
  const transform = context.getTransform();
  const rect = context.canvas.getBoundingClientRect();
  const ratio = rect.width > 0
    ? Math.max(context.canvas.width / rect.width, 1e-6)
    : Math.max(window.devicePixelRatio || 1, 1e-6);
  const screenX = (transform.a * x + transform.c * y + transform.e) / ratio;
  const screenY = (transform.b * x + transform.d * y + transform.f) / ratio;
  context.save();
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw(screenX, screenY);
  context.restore();
}

function drawLinearGradientGizmo(context, leaf, x, y) {
  const start = { x: x(leaf.start.x), y: y(leaf.start.y) };
  const end = { x: x(leaf.end.x), y: y(leaf.end.y) };
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.max(1, Math.hypot(deltaX, deltaY));
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const boundaryLength = Math.max(80, Math.min(Math.abs(x(1) - x(0)), Math.abs(y(1) - y(0))) * .32);
  const boundary = (point) => {
    context.beginPath();
    context.moveTo(point.x - normalX * boundaryLength, point.y - normalY * boundaryLength);
    context.lineTo(point.x + normalX * boundaryLength, point.y + normalY * boundaryLength);
  };
  const fanBoundary = () => {
    context.beginPath();
    for (let index = 0; index <= 32; index += 1) {
      const offset = -boundaryLength + (boundaryLength * 2 * index) / 32;
      const normalized = Math.tanh(offset / length);
      const scale = clamp(1 + Number(leaf.gradient_fan || 0) * 0.8 * normalized * normalized, 0.2, 1.8);
      const pointX = start.x + (deltaX * scale) + normalX * offset;
      const pointY = start.y + (deltaY * scale) + normalY * offset;
      if (index) context.lineTo(pointX, pointY);
      else context.moveTo(pointX, pointY);
    }
  };
  context.save();
  context.setLineDash([7, 6]);
  drawLocalGizmoStroke(context, () => boundary(start), 1.5, "rgba(238, 252, 255, .82)");
  drawLocalGizmoStroke(context, fanBoundary, 1.5, "rgba(238, 252, 255, .82)");
  context.restore();
  drawLocalGizmoStroke(context, () => {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }, 2);
  const controls = gradientControlPoints(leaf);
  drawLocalGizmoHandle(context, start.x, start.y);
  drawLocalGizmoHandle(context, x(controls.midpoint_1.x), y(controls.midpoint_1.y), 5);
  drawLocalGizmoHandle(context, x(controls.midpoint_2.x), y(controls.midpoint_2.y), 5);
  drawLocalGizmoHandle(context, end.x, end.y);
}

function drawBrushGizmo(context, point, stroke, x, y) {
  const radius = Math.max(2, Math.abs(x(stroke.radius) - x(0)));
  const feather = brushFeatherExtent(stroke.hardness);
  const featherRadius = radius * (1 + feather);
  let centerX = x(point.x);
  let centerY = y(point.y);
  if (state.localBrushPreviewPinned) {
    const scale = Math.max(context.getTransform().a, 1e-6);
    const bounds = state.localBrushVisibleBounds || { left: 0, top: 0, right: context.canvas.width / scale, bottom: context.canvas.height / scale };
    const visibleLeft = Math.max(bounds.left, Math.min(x(0), x(1)));
    const visibleRight = Math.min(bounds.right, Math.max(x(0), x(1)));
    const visibleTop = Math.max(bounds.top, Math.min(y(0), y(1)));
    const visibleBottom = Math.min(bounds.bottom, Math.max(y(0), y(1)));
    centerX = visibleRight - featherRadius - 3;
    centerY = clamp(centerY, visibleTop + featherRadius + 3, visibleBottom - featherRadius - 3);
    if (visibleRight - visibleLeft < featherRadius * 2 + 6) centerX = (visibleLeft + visibleRight) / 2;
    if (visibleBottom - visibleTop < featherRadius * 2 + 6) centerY = (visibleTop + visibleBottom) / 2;
  }
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.strokeStyle = "rgba(218, 222, 223, .94)";
  context.lineWidth = 1;
  context.stroke();
  if (feather > 0.001) {
    const dashOffset = -((performance.now() / 70) % 12);
    context.beginPath();
    context.setLineDash([6, 6]);
    context.lineDashOffset = dashOffset;
    context.arc(centerX, centerY, featherRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(8, 10, 11, .94)";
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.lineDashOffset = dashOffset + 6;
    context.arc(centerX, centerY, featherRadius, 0, Math.PI * 2);
    context.strokeStyle = "rgba(245, 247, 247, .94)";
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
    queueLocalMaskOverlayRender();
  }
  context.beginPath();
  context.arc(centerX, centerY, 1.5, 0, Math.PI * 2);
  context.fillStyle = stroke.erase ? "#ff6b72" : "rgba(235, 238, 239, .96)";
  context.fill();
  context.restore();
}

function drawLuminanceSamplingGesture(context, gesture, x, y) {
  const points = gesture.points || [];
  if (!points.length) return;
  const color = gesture.remove ? "#ff8a91" : "#74e5ee";
  context.save();
  drawLocalGizmoStroke(context, () => {
    context.beginPath();
    points.forEach((point, index) => index
      ? context.lineTo(x(point.x), y(point.y))
      : context.moveTo(x(point.x), y(point.y)));
  }, 2, color);
  for (const point of [points[0], points.at(-1)]) {
    context.beginPath();
    context.arc(x(point.x), y(point.y), 8, 0, Math.PI * 2);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.moveTo(x(point.x) - 12, y(point.y));
    context.lineTo(x(point.x) + 12, y(point.y));
    context.moveTo(x(point.x), y(point.y) - 12);
    context.lineTo(x(point.x), y(point.y) + 12);
    context.stroke();
  }
  context.restore();
}

async function openDesktopSelection(selection) {
  if (!selection) return;
  if (selection.kind === "project") {
    await openProjectFromPath(selection);
    return;
  }
  renderExperimentalDngNote(selection);
  if (!await confirmUnsavedTransition("import another source")) return;
  await openStagedDesktopSource(selection);
}

async function openStagedDesktopSource(selection) {
  const generation = ++state.importGeneration;
  if (state.activeImportJobId) {
    await fetch(`/api/import-jobs/${state.activeImportJobId}`, { method: "DELETE" }).catch(() => null);
  }
  if (generation !== state.importGeneration) return;
  els.badge.textContent = "Loading image and building session...";
  state.importInProgress = true;
  updateExportAvailability();
  setIndeterminatePreviewMessage("Starting import · 0.0s elapsed");
  setImportCancelVisible(true);
  const response = await fetch("/api/import-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant: selection.grant,
      raw_import_settings: selection.rawImportSettings || undefined,
      replace_session_id: selection.replaceSessionId || null,
    }),
  });
  let job = await safeJson(response);
  if (generation !== state.importGeneration) {
    if (job?.job_id) await fetch(`/api/import-jobs/${job.job_id}`, { method: "DELETE" }).catch(() => null);
    return;
  }
  if (!response.ok || !job?.job_id) {
    state.importInProgress = false;
    setImportCancelVisible(false);
    showUploadError(job?.detail || "The source file could not be opened.");
    return;
  }
  state.activeImportJobId = job.job_id;
  const startedAt = performance.now();
  let previewShown = false;
  while (generation === state.importGeneration && state.activeImportJobId === job.job_id) {
    const elapsed = (performance.now() - startedAt) / 1000;
    const label = job.phase_label || "Preparing source";
    const reassurance = elapsed >= 10 ? " · still working normally" : "";
    setIndeterminatePreviewMessage(`${label}${reassurance} · ${elapsed.toFixed(1)}s elapsed`);
    if (job.preview_available && !previewShown && !state.session) {
      previewShown = true;
      showStagedImportPreview(`${job.preview_url}?v=${Date.now()}`, generation, job.job_id);
    }
    if (job.state === "ready" && job.session_id) {
      const sessionResponse = await fetch(`/api/session/${job.session_id}`);
      const payload = await safeJson(sessionResponse);
      if (generation !== state.importGeneration || state.activeImportJobId !== job.job_id) return;
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      if (!sessionResponse.ok || !payload?.session) {
        showUploadError(payload?.detail || "The completed source session could not be opened.");
        return;
      }
      const retainedProjectPath = selection.replaceSessionId ? state.projectPath : "";
      await activateDesktopSession(payload.session, retainedProjectPath);
      if (!selection.replaceSessionId) await recordSuccessfulMediaImport(selection.path);
      return;
    }
    if (job.state === "error" || job.state === "cancelled") {
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      if (job.state === "error") showUploadError(job.error || "The source file could not be opened.");
      else finishCancelledImport();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const poll = await fetch(`/api/import-jobs/${job.job_id}`);
    job = await safeJson(poll);
    if (!poll.ok) {
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      showUploadError(job?.detail || "Import progress could not be read.");
      return;
    }
  }
}

function showStagedImportPreview(url, generation, jobId) {
  const image = els.previewImage;
  els.previewCanvas.style.display = "none";
  image.style.display = "none";
  image.style.width = "";
  image.style.height = "";
  els.emptyState.style.display = "none";
  image.onload = () => {
    image.onload = null;
    image.onerror = null;
    if (generation !== state.importGeneration || state.activeImportJobId !== jobId) return;
    const naturalWidth = Math.max(1, image.naturalWidth);
    const naturalHeight = Math.max(1, image.naturalHeight);
    const frameWidth = Math.max(1, els.dropzone.clientWidth);
    const frameHeight = Math.max(1, els.dropzone.clientHeight);
    const scale = Math.min(frameWidth / naturalWidth, frameHeight / naturalHeight);
    image.style.width = `${naturalWidth * scale}px`;
    image.style.height = `${naturalHeight * scale}px`;
    els.previewStage.style.width = `${frameWidth}px`;
    els.previewStage.style.height = `${frameHeight}px`;
    image.style.display = "block";
  };
  image.onerror = () => {
    image.onload = null;
    image.onerror = null;
  };
  image.src = url;
}

async function cancelActiveImport() {
  if (!state.importInProgress) return;
  const jobId = state.activeImportJobId;
  state.importGeneration += 1;
  state.activeImportJobId = null;
  state.importInProgress = false;
  if (els.cancelImport) els.cancelImport.disabled = true;
  setIndeterminatePreviewMessage("Cancelling import...");
  updateExportAvailability();
  if (jobId) {
    await fetch(`/api/import-jobs/${jobId}`, { method: "DELETE" }).catch(() => null);
  }
  finishCancelledImport();
}

function finishCancelledImport() {
  state.importInProgress = false;
  setImportCancelVisible(false);
  hidePreviewMessage();
  if (!state.session) clearPreviewImage();
  els.badge.textContent = state.session ? "Import cancelled. Current image kept." : "Import cancelled.";
  els.badge.className = "badge neutral";
  updateExportAvailability();
}

async function activateDesktopSession(session, projectPath) {
  clearPreviewCache();
  state.session = session;
  state.importInProgress = false;
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = session.adjustments;
  state.editDocument = session.edit_document;
  loadDenoiseDocument(state.editDocument);
  state.editRevision = session.edit_revision || 0;
  state.documentDirty = Boolean(session.dirty);
  state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null;
  state.projectPath = projectPath || "";
  state.currentView = "hdr";
  if (!projectPath) await applyNewSessionPreferences();
  state.interpretationGateDismissed = false;
  state.gpuPreview?.resetSession(session.session_id);
  invalidatePreview("hdr", { markDirty: false });
  invalidatePreview("sdr", { markDirty: false });
  activateWorkflowTab("grade", { focus: false });
  renderSession();
  renderLocalAdjustments();
  seedExportFieldsFromSession();
  const gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
  await Promise.all([
    gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
    refreshOverlay(),
    refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
  ]);
  if (state.denoise.hdr.enabled) await recalculateDenoise();
  hidePreviewMessage();
  prepareInactivePreview();
  if (previewNeedsRefinement()) debouncePreview("hdr");
  syncDesktopDocumentState();
}

function documentTransitionToken() {
  return [
    state.session?.session_id || "",
    state.editRevision,
    state.globalEditGeneration,
    state.documentDirty ? "dirty" : "clean",
  ].join(":");
}

async function openProjectFromPath(desktopSelection = null) {
  if (!await confirmUnsavedTransition("open another project")) return;
  const confirmedDocument = documentTransitionToken();
  if (desktop) {
    const selection = desktopSelection || await chooseProjectPath(
      "project_open",
      state.appPreferences?.folders?.projectImport || "",
    );
    if (!selection) return;
    if (documentTransitionToken() !== confirmedDocument && !await confirmUnsavedTransition("open another project")) return;
    const openGeneration = ++state.projectOpenGeneration;
    state.projectOpenController?.abort();
    const controller = new AbortController();
    state.projectOpenController = controller;
    let projectActivated = false;
    els.projectOpen.disabled = true;
    const statusTimer = beginProjectOpenStatus(selection.path?.split(/[\\/]/).pop() || "loading source");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      let response = await fetch("/api/desktop/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_grant: selection.grant }),
        signal: controller.signal,
      }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
      if (!response || openGeneration !== state.projectOpenGeneration) return;
      let payload = await safeJson(response);
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
        const source = await desktop.relinkSource();
        if (!source || openGeneration !== state.projectOpenGeneration) return;
        response = await fetch("/api/desktop/project/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_grant: selection.grant, source_grant: source.grant }),
          signal: controller.signal,
        }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
        if (!response || openGeneration !== state.projectOpenGeneration) return;
        payload = await safeJson(response);
      }
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok || !payload?.session) {
        window.alert(responseErrorMessage(payload, "The project could not be opened."));
        return;
      }
      await activateDesktopSession(payload.session, selection.path);
      projectActivated = true;
      return;
    } finally {
      if (openGeneration === state.projectOpenGeneration) {
        window.clearInterval(statusTimer);
        els.projectOpen.disabled = false;
        if (!projectActivated) hidePreviewMessage();
      }
    }
  }
  const path = window.prompt("Path to a .hdrfinisher project", state.projectPath || "");
  if (!path) return;
  const statusTimer = beginProjectOpenStatus(path.split(/[\\/]/).pop() || "loading source");
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  let sourcePath = null;
  try {
    let response = await fetch("/api/project/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    let payload = await safeJson(response);
    if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
      sourcePath = window.prompt("The saved source is unavailable or changed. Select the matching original source path.", "");
      if (!sourcePath) return;
      response = await fetch("/api/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, source_path: sourcePath }),
      });
      payload = await safeJson(response);
    }
    if (!response.ok || !payload?.session) {
      window.alert(responseErrorMessage(payload, "The project could not be opened."));
      return;
    }
    await activateDesktopSession(payload.session, path);
  } finally {
    window.clearInterval(statusTimer);
    hidePreviewMessage();
  }
}

async function saveProjectToPath({ saveAs = false } = {}) {
  if (!state.session) return false;
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  if (globalsApplied === false) return false;
  if (desktop) {
    const suggestedName = `${state.session.source.filename.replace(/\.[^.]+$/, "")}.hdrfinisher`;
    let selection = null;
    if (!saveAs && state.projectPath) {
      selection = await desktop.grantProjectPath(state.projectPath, "project-save");
    } else {
      const existing = splitOutputPath(state.projectPath);
      const initialDirectory = state.projectPath
        ? existing.directory
        : state.appPreferences?.folders?.projectSave || "";
      selection = await chooseProjectPath(
        "project_save",
        initialDirectory,
        state.projectPath ? `${existing.filename}.hdrfinisher` : suggestedName,
      );
    }
    if (!selection) return false;
    const response = await fetch(`/api/desktop/session/${state.session.session_id}/project/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_grant: selection.grant }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      window.alert(responseErrorMessage(payload, "The project could not be saved."));
      return false;
    }
    state.projectPath = payload.path;
    state.editDocument = payload.document;
    loadDenoiseDocument(state.editDocument);
    state.documentDirty = false;
    syncCopySourcePathButton();
    syncDesktopDocumentState();
    els.badge.textContent = `Project saved · revision ${payload.revision}`;
    els.badge.className = "badge good";
    return true;
  }
  const path = window.prompt("Save project path", state.projectPath || `${state.session.source.filename}.hdrfinisher`);
  if (!path) return false;
  let sourcePath = state.editDocument?.source?.durable_path || null;
  if (!sourcePath) {
    sourcePath = window.prompt("Path to the durable original source (the project stores no source pixels)", "");
    if (!sourcePath) return false;
  }
  const response = await fetch(`/api/session/${state.session.session_id}/project/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, source_path: sourcePath }),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    window.alert(responseErrorMessage(payload, "The project could not be saved."));
    return false;
  }
  state.projectPath = payload.path;
  state.editDocument = payload.document;
  loadDenoiseDocument(state.editDocument);
  state.documentDirty = false;
  syncCopySourcePathButton();
  els.badge.textContent = `Project saved · revision ${payload.revision}`;
  els.badge.className = "badge good";
  return true;
}

async function confirmUnsavedTransition(actionLabel) {
  if (!state.session || !state.documentDirty) return true;
  let choice = "cancel";
  if (desktop?.confirmUnsavedTransition) {
    choice = await desktop.confirmUnsavedTransition({ actionLabel });
  } else if (window.confirm(`Save changes before you ${actionLabel}?`)) {
    choice = "save";
  } else if (window.confirm(`Discard unsaved changes and ${actionLabel}?`)) {
    choice = "discard";
  }
  if (choice === "discard") return true;
  if (choice === "save") return await saveProjectToPath({ saveAs: false });
  return false;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

renderSessionChrome();
renderCurveChannelTabs();
