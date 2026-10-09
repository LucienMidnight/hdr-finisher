const desktop = window.hdrFinisherDesktop || null;
const scopeUi = window.HDRScopeUI;
if (!scopeUi) throw new Error("HDRScopeUI is not loaded; scope presentation helpers are required");
const scopeAnalysis = window.HDRScopeAnalysis;
if (!scopeAnalysis) throw new Error("HDRScopeAnalysis is not loaded; scope payload analysis is required");
const geometryMath = window.HDRGeometryMath;
if (!geometryMath) throw new Error("HDRGeometryMath is not loaded; geometry calculations are required");
const projectIo = window.HDRProjectIO;
if (!projectIo) throw new Error("HDRProjectIO is not loaded; project transport is required");
const status = window.HDRStatus;
if (!status) throw new Error("HDRStatus is not loaded; application status reporting is required");
const maskExpression = window.HDRMaskExpression;
if (!maskExpression) throw new Error("HDRMaskExpression is not loaded; local-mask authoring is required");
const FINE_ADJUSTMENT_SCALE = 0.1;
// Deferred follow-up delays: the pan follow-up fires shortly
// after the scroll pauses; the whole-frame catch-up waits longer so it never
// competes with the pan it follows. Declared before boot() runs, because the
// coordinator is constructed during it.
const ROI_CATCH_UP_DELAY_MS = 700;
const ROI_PAN_DELAY_MS = 140;

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
  "current.vignette.amount": { min: -200, max: 200, decimals: 0 },
  "current.vignette.midpoint": { min: 0, max: 100, decimals: 0 },
  "current.vignette.roundness": { min: -100, max: 100, decimals: 0 },
  "current.vignette.feather": { min: 0, max: 100, decimals: 0 },
  "current.vignette.highlight_protection": { min: 0, max: 100, decimals: 0 },
  "current.vignette.scale_x": { min: 25, max: 300, decimals: 0 },
  "current.vignette.scale_y": { min: 25, max: 300, decimals: 0 },
  "current.black_and_white.reds": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.oranges": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.yellows": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.greens": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.aquas": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.blues": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.purples": { min: -100, max: 100, decimals: 0 },
  "current.black_and_white.magentas": { min: -100, max: 100, decimals: 0 },
  "current.detail.texture_amount": { min: -100, max: 100, decimals: 0 },
  "current.detail.softness": { min: 0, max: 100, decimals: 0 },
  "current.detail.microcontrast": { min: -100, max: 100, decimals: 0 },
  "current.detail.clarity_amount": { min: -100, max: 100, decimals: 0 },
  "current.detail.clarity_radius_percent": { min: 0.2, max: 3, decimals: 2 },
  "current.detail.sharpen_amount": { min: 0, max: 200, decimals: 0 },
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
// Lost-wake-up safety net. A deliberate retire (zoom refinement, structural
// mask gesture, geometry transaction) is expected to be re-armed by its own
// follow-up; if that follow-up is cancelled or refused, the viewer can sit in
// "Preparing" with nothing queued. The watchdog re-arms once a second while the
// viewer is not ready and no work is in flight, and gives up after this many
// consecutive attempts so a genuine refusal cannot become a submit loop.
const PREVIEW_WATCHDOG_INTERVAL_MS = 1000;
const PREVIEW_WATCHDOG_MAX_REARMS = 20;
// Matches `.bounded-help-tooltip { max-width }` so help wraps to a readable measure.
const TOOLTIP_MAX_WIDTH = 260;
const TOOLTIP_SIDE_RAILS = ".grade-rail, .workflow-side-panel";
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 200, 300, 400, 500, 600, 800, 1200, 1600, 2400, 3200];
const LAYOUT_DEFAULTS = { railW: 268, gradeW: 340, dockH: 252, dockOpen: true, dockTab: "histogram" };
const LAYOUT_LIMITS = {
  railW: [200, 380],
  gradeW: [340, 420],
  dockH: [240, 340],
};
const LAYOUT_SETTLE_DELAY = 120;
const COMPACT_WORKSPACE_QUERY = "(max-width: 1499px)";
/** @typedef {"1024"|"2048"|"4096"|"full"} PreviewResolution */
const PREVIEW_RESOLUTION_OPTIONS = new Set(["1024", "2048", "4096", "full"]);
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
const COMPARE_LAYOUTS = new Set(["single", "split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]);
const waveformCanvasCache = new WeakMap();
// Session-bound fallback brush rasters use local IDs or mask objects as keys.
// Keep only a small LRU working set and clear it whenever the active session is
// retired so deleted locals and replaced projects cannot retain canvases.
const LOCAL_BRUSH_MASK_CACHE_LIMIT = 8;
const localBrushMaskCanvasCache = new Map();
// Gesture/tint caches are weak because their owning stroke/canvas objects define
// their lifetime. The remaining mask caches are bounded Maps because their keys
// are stable IDs/signatures needed to deduplicate asynchronous requests.
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
// The full-resolution frame a geometry produces, by session and geometry. A
// coordinate map is fitted per processing size, but this part of its answer is
// the same at every size.
const geometryFullOutputFrames = new Map();
let localMaskOverlayFrame = 0;
let pathMarchingAntFrame = 0;

const defaultDenoiseDocument = () => ({
  schema_version: 1,
  hdr: { enabled: false, controls: { amount: 0.5, luminance: 0.5, color_noise: 0.5, detail_recovery: 0, finest_noise: 0.5, fine_noise: 0.5, medium_noise: 0.5, coarse_noise: 0.5 }, analysis: { algorithm_version: "adaptive-atrous-v1" } },
  sdr: { enabled: false, controls: { amount: 0.5, luminance: 0.5, color_noise: 0.5, detail_recovery: 0, finest_noise: 0.5, fine_noise: 0.5, medium_noise: 0.5, coarse_noise: 0.5 }, analysis: { algorithm_version: "adaptive-atrous-v1" } },
});

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
  // Per-adjustment editor visibility is session-only UI state. It never enters
  // edit commands, project serialization, or undo history.
  localHiddenGizmoIds: new Set(),
  // Denoise's Show noise view. View state only: never saved or exported.
  denoiseNoiseView: false,
  localOverlayColor: "#ff263d",
  navigationWindowMode: "auto",
  compareMode: "lanes",
  beforeRenderedKey: null,
  beforeStartingGrade: null,
  beforePeekWanted: false,
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
  localRenameId: null,
  localMaskDraftDirty: false,
  localMaskDraftTimer: 0,
  localMaskDraftController: null,
  localMaskDraftGeneration: 0,
  localMaskDraftPending: null,
  viewerTierStatusEntry: null,
  previewStatusEntry: null,
  previewCancelVisible: false,
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
  // Explicit opt-in during continuous authoring. A native exact-peak pass is
  // background whole-image work and must not automatically compete with the
  // foreground presentation path.
  scopeExactPeak: false,
  scopeRegionEnabled: false,
  scopeRegion: null,
  scopeRegionDrag: null,
  scopeRegionRefreshTimer: 0,
  scopeRegionSessionId: null,
  sourceSettingsOpen: false,
  rawSettingsOpen: false,
  activeImportJobId: null,
  importGeneration: 0,
  byteUploadQueue: Promise.resolve(),
  projectOpenGeneration: 0,
  projectOpenController: null,
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
  previewResolutionOverride: false,
  // The single opt-in "Faster
  // dragging on slower hardware". Off, every drag frame is exact; on, the
  // latency controller may show a softer frame while a gesture is active.
  fasterDragging: false,
  previewLatencyController: null,
  renderingMode: "auto",
  appPreferences: null,
  acceptedPresentation: null,
  // Set only when the selected tier could not be produced. It never clears the
  // retained presentation; it explains why that presentation is still the newest.
  previewUnavailableReason: "",
  // The grading render currently in flight, so refinement can wait for it.
  denoiseAdvancedOpen: false,
  gpuDraftInFlight: null,
  gpuDraftInFlightTier: null,
  gpuDraftRefusals: {},
  // Section 5.8 failure policy: only permanent initialization failure or
  // repeated unrecoverable validation failure may disable WebGPU. Everything
  // else keeps the device and the accepted frame.
  gpuFailurePolicy: null,
  gpuRebuildAttempts: 0,
  gpuRenderRetries: 0,
  // ROI rendering switch. "fit" keeps the app on whole-frame rendering (the
  // shipped behaviour); "refinement" limits the refinement-tier pass to the
  // visible region and keeps the retained frame everywhere else. Interactive
  // pan and zoom are never ROI-limited, so they cannot show a gap.
  roiPreviewMode: "fit",
  roiCatchUpError: null,
  // Display-scale pan cache. A pan is a compositor
  // operation, but a scroll can expose a strip that was never refined for the
  // current generation. The coordinator asks for a refinement pass limited to
  // the new visible region once the scroll pauses; the renderer reuses every
  // tile the cache already holds at this generation, so a pan back into a
  // refined region processes nothing.
  roiPanError: null,
  // Live Denoise reconstruction runs through one in-flight plus one latest
  // pending state (Section 5.6), so a control drag costs runs, not events.
  denoiseInputQueue: null,
  cpuFallbacks: { settle: [], refine: [] },
  // Application allocation budget for preview GPU work, not physical VRAM.
  gpuMemoryBudget: "auto",
  detailInteractionRestore: null,
  previewScheduler: null,
  inactiveSourceController: null,
  panSourceController: null,
  gpuPreparedLane: { hdr: false, sdr: false },
  scopeZoneOverlay: null,
  lastExportPath: "",
  defaultExportDirectory: "",
  desktopEnvironment: null,
  desktopDocumentStateKey: "",
  compareHoldTimer: null,
  compareHeld: false,
  comparePeekActive: false,
  // A peek asked for before the inactive lane was prepared.
  // It completes when the explicit preload lands, if the hold is still down.
  comparePendingPeek: false,
  compareLayout: "single",
  // What the comparison pane is actually showing, as opposed to what the
  // primary pane is. The two are rendered by different calls at different
  // times, and the primary pane may hold any selected tier at
  // different resolutions. Recording it is what lets the UI say so.
  comparisonPresentation: null,
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
  perspectivePhase: "",
  perspectiveApplyOperation: null,
  perspectiveFailedDraft: null,
  perspectiveGpuDraft: null,
  perspectiveGpuDraftPromise: null,
  perspectiveGpuDraftFailed: false,
  perspectiveDraftFrame: null,
  perspectiveGuideDrag: null,
  perspectiveSolveController: null,
  perspectivePreviewController: null,
  perspectivePreviewTimer: 0,
  perspectivePreviewUrl: null,
  straightenGestureActive: false,
  straightenPreviewBaseAngle: null,
  straightenPreviewFrameRect: null,
  vignettePickCenter: false,
  vignetteShowOverlay: false,
  vignetteCenterGesture: null,
  groupPresetContext: null,
  previewCache: { hdr: null, sdr: null },
  zoomRefinementTimer: 0,
  // Lost-wake-up safety net (see initializePreviewScheduler): the number of
  // consecutive automatic re-arms and the interval that makes them.
  previewWatchdogTimer: 0,
  previewWatchdogRearms: 0,
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
      use_authored_base: true,
      tone_section_enabled: true,
      highlight_section_enabled: true,
      tone_equalizer_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_compression_start_percent: 50,
      highlight_compression_softness: 0,
      highlight_compression_mode: "peak_fit",
      highlight_compression_peak_measurement: "maximum",
      highlight_compression_source_peak_percent: 100,
      highlight_compression_manual_peak_percent: 100,
      highlight_compression_peak_detail: 35,
      highlight_compression_bias: 0,
      highlight_compression_color_handling: "smooth_rolloff",
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
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    shared: {
      overlay_mode: "off",
      false_color_band_anchor: "project",
      false_color_ceiling_nits: 1000,
      overlay_opacity: 0.5,
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
  // What the exposure overlay on screen was rendered for, and the live
  // refresh loop that keeps it following edits (see requestLiveOverlay).
  overlayPresented: null,
  liveOverlay: { running: false, pending: null },
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
  proofSize: "reduced",
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
  grain_film_type: "color_negative",
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
});

// 2: Image Softness and Microcontrast left Film Look for Detail (NEXT-01 #2),
// and the presets no longer set them.
const FILM_LOOK_PRESET_RECIPE_VERSION = 2;

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
    recipe: completeFilmLookRecipe({ print_strength: 42, print_contrast: 6, print_toe: 3, print_shoulder: 10, color_density: 9, red_response: 3, blue_response: -2, highlight_desaturation: 12, shadow_desaturation: 5, grain_amount: 14, grain_size: 22, grain_softness: 50, grain_chroma: 10, grain_film_format: "65mm", grain_shadow_response: 82, grain_highlight_response: 110, film_resolution: 98, halation_amount: 6, halation_sensitivity: 84, halation_radius: 0.16, halation_saturation: 68, bloom_amount: 4, bloom_sensitivity: 88, bloom_radius: 0.32, bloom_highlight_detail: 90 }),
  }),
  Object.freeze({
    id: "soft-color-negative",
    name: "Soft Color Negative",
    description: "Gentle shoulders, soft color separation, and quiet portrait texture.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 48, print_contrast: -2, print_toe: 7, print_shoulder: 22, color_density: 12, red_response: 5, green_response: -1, blue_response: -4, highlight_desaturation: 28, shadow_desaturation: 9, grain_amount: 22, grain_size: 38, grain_softness: 52, grain_chroma: 13, grain_film_format: "35mm", grain_shadow_response: 88, grain_midtone_response: 98, grain_highlight_response: 112, film_resolution: 94, halation_amount: 9, halation_sensitivity: 78, halation_radius: 0.24, halation_saturation: 74, bloom_amount: 9, bloom_sensitivity: 76, bloom_radius: 0.62, bloom_highlight_detail: 78 }),
  }),
  Object.freeze({
    id: "dense-print",
    name: "Dense Print",
    description: "Deeper color, firmer print contrast, and a richer projected finish.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 62, print_contrast: 18, print_toe: 12, print_shoulder: 15, color_density: 26, red_response: 7, green_response: -2, blue_response: -6, highlight_desaturation: 20, shadow_desaturation: 12, grain_amount: 30, grain_size: 46, grain_softness: 34, grain_chroma: 18, grain_film_format: "35mm", grain_shadow_response: 92, grain_midtone_response: 104, grain_highlight_response: 118, film_resolution: 90, halation_amount: 13, halation_sensitivity: 72, halation_radius: 0.28, halation_hue_offset: 2, halation_saturation: 82, bloom_amount: 8, bloom_sensitivity: 78, bloom_radius: 0.5, bloom_highlight_detail: 80 }),
  }),
  Object.freeze({
    id: "high-speed-texture",
    name: "High-Speed Texture",
    description: "Coarse responsive grain, open glow, and softened fine detail for low-light character.",
    recipeVersion: FILM_LOOK_PRESET_RECIPE_VERSION,
    recipe: completeFilmLookRecipe({ print_strength: 54, print_contrast: 7, print_toe: 10, print_shoulder: 18, color_density: 17, red_response: 8, green_response: -3, blue_response: -7, highlight_desaturation: 30, shadow_desaturation: 17, grain_amount: 56, grain_size: 76, grain_softness: 29, grain_chroma: 27, grain_film_format: "16mm", grain_shadow_response: 100, grain_midtone_response: 114, grain_highlight_response: 130, film_resolution: 80, halation_amount: 16, halation_sensitivity: 66, halation_radius: 0.36, halation_hue_offset: 3, halation_saturation: 86, bloom_amount: 12, bloom_sensitivity: 70, bloom_radius: 0.7, bloom_highlight_detail: 70 }),
  }),
]);

const defaultColorGrading = () => ({
  shadows: { hue: 0, saturation: 0, luminance_ev: 0 },
  midtones: { hue: 0, saturation: 0, luminance_ev: 0 },
  highlights: { hue: 0, saturation: 0, luminance_ev: 0 },
  blending: 50,
  balance: 0,
});

const defaultVignette = () => ({ amount: 0, midpoint: 50, roundness: 0, feather: 75, highlight_protection: 0, center_x: 0.5, center_y: 0.5, scale_x: 100, scale_y: 100 });
// BW-01 Black & White: how bright each colour becomes in grey. All zero is the
// plain luminance conversion, the same as Saturation -100.
const BLACK_AND_WHITE_SLIDERS = Object.freeze(["reds", "oranges", "yellows", "greens", "aquas", "blues", "purples", "magentas"]);
const defaultBlackAndWhite = () => Object.fromEntries(BLACK_AND_WHITE_SLIDERS.map((name) => [name, 0]));
// Built-in starting points modelled on common black & white filters and film
// types. They set the sliders only, never the on/off. Values are first
// estimates, to be tuned on real pictures.
const BLACK_AND_WHITE_PRESETS = Object.freeze([
  { id: "yellow-filter", name: "Yellow filter", description: "Natural skies: blues a little darker, skin and foliage a little lighter.",
    values: { reds: 10, oranges: 15, yellows: 20, greens: 5, aquas: -15, blues: -30, purples: -20, magentas: 0 } },
  { id: "orange-filter", name: "Orange filter", description: "The landscape classic: darker skies and water, smoother skin.",
    values: { reds: 25, oranges: 35, yellows: 20, greens: -10, aquas: -35, blues: -55, purples: -35, magentas: 5 } },
  { id: "red-filter", name: "Red filter", description: "Dramatic: very dark skies, bright reds and warm tones.",
    values: { reds: 55, oranges: 45, yellows: 15, greens: -30, aquas: -60, blues: -85, purples: -50, magentas: 25 } },
  { id: "green-filter", name: "Green filter", description: "Lighter foliage, darker reds and lips; outdoor portraits.",
    values: { reds: -35, oranges: -20, yellows: 20, greens: 45, aquas: 20, blues: -15, purples: -25, magentas: -30 } },
  { id: "blue-filter", name: "Blue filter", description: "Hazy and atmospheric: warm tones darker, skies pale.",
    values: { reds: -45, oranges: -35, yellows: -25, greens: -10, aquas: 25, blues: 45, purples: 25, magentas: -10 } },
  { id: "infrared", name: "Infrared look", description: "Glowing foliage and near-black skies, like infrared film.",
    values: { reds: 10, oranges: 20, yellows: 70, greens: 90, aquas: -50, blues: -90, purples: -40, magentas: 0 } },
  { id: "orthochromatic", name: "Orthochromatic", description: "Early film blind to red: dark reds and skin, pale blues.",
    values: { reds: -80, oranges: -55, yellows: -15, greens: 10, aquas: 35, blues: 55, purples: 35, magentas: -30 } },
].map((preset) => Object.freeze(preset)));
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

const defaultAdjustments = () => ({
  hdr: {
    tone_section_enabled: true,
    highlight_section_enabled: false,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    detail_section_enabled: true,
    black_and_white_section_enabled: false,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    black_and_white: defaultBlackAndWhite(),
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10, softness: 0, microcontrast: 0 },
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
    use_authored_base: true,
    tone_section_enabled: true,
    highlight_section_enabled: true,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    detail_section_enabled: true,
    black_and_white_section_enabled: false,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    black_and_white: defaultBlackAndWhite(),
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    detail: { texture_amount: 0, clarity_amount: 0, clarity_radius_percent: 0.75, sharpen_amount: 0, sharpen_radius_px: 0.8, sharpen_threshold: 10, softness: 0, microcontrast: 0 },
    exposure: 0,
    highlight_compression_start_percent: 50,
    highlight_compression_softness: 0,
    highlight_compression_mode: "peak_fit",
    highlight_compression_peak_measurement: "maximum",
    highlight_compression_source_peak_percent: 100,
    highlight_compression_manual_peak_percent: 100,
    highlight_compression_peak_detail: 35,
    highlight_compression_bias: 0,
    highlight_compression_color_handling: "smooth_rolloff",
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
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  shared: {
    overlay_mode: "off",
    false_color_band_anchor: "project",
    false_color_ceiling_nits: 1000,
    overlay_opacity: 0.5,
    overlay_threshold: 100,
    film_grain_seed: 271828,
    local_adjustments_enabled: true,
    geometry: defaultGeometry(),
  },
});

// The Local Adjustments eye: off skips every local adjustment in the preview,
// the scopes, Proof and export.
function localsBypassed() {
  return state.adjustments?.shared?.local_adjustments_enabled === false;
}

// Keep the pre-session UI state on the same schema returned by the backend.
state.adjustments = defaultAdjustments();

const els = {
  denoiseBypass: document.getElementById("denoise-bypass"),
  denoiseShowNoise: document.getElementById("denoise-show-noise"),
  noiseViewBadge: document.getElementById("noise-view-badge"),
  denoiseAmount: document.getElementById("denoise-amount"),
  denoiseLuminance: document.getElementById("denoise-luminance"),
  denoiseColor: document.getElementById("denoise-color"),
  denoiseDetail: document.getElementById("denoise-detail"),
  denoiseFinest: document.getElementById("denoise-finest"),
  denoiseFine: document.getElementById("denoise-fine"),
  denoiseMedium: document.getElementById("denoise-medium"),
  denoiseCoarse: document.getElementById("denoise-coarse"),
  denoiseFinestValue: document.getElementById("denoise-finest-value"),
  denoiseFineValue: document.getElementById("denoise-fine-value"),
  denoiseMediumValue: document.getElementById("denoise-medium-value"),
  denoiseCoarseValue: document.getElementById("denoise-coarse-value"),
  denoiseAmountValue: document.getElementById("denoise-amount-value"),
  denoiseLuminanceValue: document.getElementById("denoise-luminance-value"),
  denoiseColorValue: document.getElementById("denoise-color-value"),
  denoiseDetailValue: document.getElementById("denoise-detail-value"),
  denoiseRecalculate: document.getElementById("denoise-recalculate"),
  denoiseAdvancedToggle: document.getElementById("denoise-advanced-toggle"),
  denoiseAdvancedPanel: document.getElementById("denoise-advanced-panel"),
  denoiseState: document.getElementById("denoise-state"),
  denoiseStatus: document.getElementById("denoise-status"),
  hdrReferenceWhite: document.getElementById("hdr-reference-white"),
  projectOpen: document.getElementById("project-open"),
  projectSave: document.getElementById("project-save"),
  fileInput: document.getElementById("file-input"),
  dropzone: document.getElementById("dropzone"),
  comparisonLabelHdr: document.querySelector(".comparison-label-hdr"),
  comparisonLabelSdr: document.querySelector(".comparison-label-sdr"),
  navigationThumb: document.getElementById("navigation-thumb"),
  navigationThumbImage: document.getElementById("navigation-thumb-image"),
  navigationThumbViewport: document.getElementById("navigation-thumb-viewport"),
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
  sdrMatchEntireStatus: document.getElementById("sdr-match-entire-status"),
  detailSdrActions: document.getElementById("detail-sdr-actions"),
  blackAndWhiteSdrActions: document.getElementById("black-and-white-sdr-actions"),
  detailMatchHdr: document.getElementById("detail-match-hdr"),
  blackAndWhiteMatchHdr: document.getElementById("black-and-white-match-hdr"),
  overlayPresetNote: document.getElementById("overlay-preset-note"),
  falseColorKey: document.getElementById("false-color-key"),
  curveReset: document.getElementById("curve-reset"),
  curveAdd: document.getElementById("curve-add"),
  curveRemove: document.getElementById("curve-remove"),
  curveChannelButtons: [...document.querySelectorAll("[data-curve-channel]")],
  metadataList: document.getElementById("metadata-list"),
  workflowContextList: document.getElementById("workflow-context-list"),
  previewOutputList: document.getElementById("preview-output-list"),
  technicalSummary: document.getElementById("technical-summary"),
  technicalDiagnostics: document.getElementById("technical-diagnostics"),
  technicalPreviewList: document.getElementById("technical-preview-list"),
  technicalDisplayList: document.getElementById("technical-display-list"),
  technicalSourceList: document.getElementById("technical-source-list"),
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
  straightenGridOverlay: document.getElementById("straighten-grid-overlay"),
  perspectiveEditorOverlay: document.getElementById("perspective-editor-overlay"),
  perspectiveGuideSvg: document.getElementById("perspective-guide-svg"),
  perspectiveGuideHandles: document.getElementById("perspective-guide-handles"),
  gradeModeGlobal: document.getElementById("grade-mode-global"),
  gradeModeLocal: document.getElementById("grade-mode-local"),
  localAdjustmentGroup: document.getElementById("local-adjustments-group"),
  localPanel: document.getElementById("local-adjustments-panel"),
  localToolButtons: [...document.querySelectorAll("[data-local-tool]")],
  localEraser: document.getElementById("local-eraser"),
  localAdjustmentList: document.getElementById("local-adjustment-list"),
  localEmpty: document.getElementById("local-empty"),
  localEditor: document.getElementById("local-editor"),
  localDuplicate: document.getElementById("local-duplicate"),
  localAddAdjustment: document.getElementById("local-add-adjustment"),
  localGizmoToggle: document.getElementById("local-gizmo-toggle"),
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
  chromeProofRefresh: document.getElementById("chrome-proof-refresh"),
  openProofExternal: document.getElementById("open-proof-external"),
  chromeProofFormat: document.getElementById("chrome-proof-format"),
  chromeProofSize: document.getElementById("chrome-proof-size"),
  chromeProofTarget: document.getElementById("chrome-proof-target"),
  chromeProofCustomField: document.getElementById("chrome-proof-custom-field"),
  chromeProofCustomNits: document.getElementById("chrome-proof-custom-nits"),
  chromeProofDisplay: document.getElementById("chrome-proof-display"),
  chromeProofStatus: document.getElementById("chrome-proof-status"),
  proofPreviewSwitch: document.getElementById("proof-preview-switch"),
  proofPreviewButtons: [...document.querySelectorAll("[data-proof-preview]")],
  emptyState: document.getElementById("empty-state"),
  proofLaneButtons: [...document.querySelectorAll("#proof-lane-switch button")],
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
  scopeExactPeak: document.getElementById("scope-exact-peak"),
  scopeZoom: document.getElementById("scope-zoom"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  analysisDock: document.getElementById("analysis-dock"),
  dockCollapse: document.getElementById("dock-collapse"),
  dockSummary: document.getElementById("dock-summary"),
  dockTabs: [...document.querySelectorAll("[data-dock-tab]")],
  scopeView: document.getElementById("scope-view"),
  technicalView: document.getElementById("technical-view"),
  previewFasterDragging: document.getElementById("preview-faster-dragging"),
  previewQualityStatus: document.getElementById("preview-quality-status"),
  exportSheet: document.getElementById("export-sheet"),
  exportConfirmButton: document.getElementById("export-confirm-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportDirectoryBrowse: document.getElementById("export-directory-browse"),
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
  vignetteShowOverlay: document.getElementById("vignette-show-overlay"),
  vignetteShapeOverlay: document.getElementById("vignette-shape-overlay"),
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
  // Black & White: its Reset returns the sliders only. It is deliberately not
  // in sectionPathForGroup, so Reset leaves the module on or off as it was.
  "hdr-black-and-white": ["hdr.black_and_white"],
  "sdr-tone": ["sdr.exposure", "sdr.contrast", "sdr.contrast_pivot", "sdr.shadow"],
  "sdr-highlights": ["sdr.highlight_compression_mode", "sdr.highlight_compression_start_percent", "sdr.highlight_compression_softness", "sdr.highlight_compression_peak_detail", "sdr.highlight_compression_peak_measurement", "sdr.highlight_compression_manual_peak_percent", "sdr.highlight_compression_bias", "sdr.highlight_compression_color_handling"],
  "sdr-equalizer": ["sdr.tone_equalizer_nodes", "sdr.tone_equalizer_influence_radius", "sdr.tone_equalizer_smoothing"],
  "sdr-color": ["sdr.white_balance_kelvin", "sdr.tint", "sdr.saturation", "sdr.vibrance", "sdr.red_hue", "sdr.red_purity", "sdr.green_hue", "sdr.green_purity", "sdr.blue_hue", "sdr.blue_purity", "sdr.tint_hue", "sdr.tint_purity"],
  "sdr-zones": ["sdr.lift", "sdr.lift_range", "sdr.lift_pivot", "sdr.gamma", "sdr.gamma_range", "sdr.gamma_pivot", "sdr.gain", "sdr.gain_range", "sdr.gain_pivot"],
  "sdr-detail": ["sdr.detail"],
  "sdr-black-and-white": ["sdr.black_and_white"],
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
  "black-and-white": "Black & White",
  "film-look": "Film Look",
  vignette: "Vignette",
  denoise: "Denoise",
};

const branchCopy = {
  hdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
  sdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
};

function projectReferenceWhiteNits() {
  return Number(state.editDocument?.hdr_reference_white_nits) === 100 ? 100 : 203;
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

function setValueByPath(target, path, value) {
  const parts = resolveAdjustmentPath(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return resolveAdjustmentPath(path).split(".").reduce((cursor, key) => cursor?.[key], target);
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

async function safeJson(response) {
  return projectIo.safeJson(response);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

