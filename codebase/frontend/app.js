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
  "current.vignette.amount": { min: -100, max: 100, decimals: 0 },
  "current.vignette.midpoint": { min: 0, max: 100, decimals: 0 },
  "current.vignette.roundness": { min: -100, max: 100, decimals: 0 },
  "current.vignette.feather": { min: 0, max: 100, decimals: 0 },
  "current.vignette.highlight_protection": { min: 0, max: 100, decimals: 0 },
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

const defaultVignette = () => ({ amount: 0, midpoint: 50, roundness: 0, feather: 75, highlight_protection: 0, center_x: 0.5, center_y: 0.5 });
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
    geometry: defaultGeometry(),
  },
});

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
  localAdjustmentCount: document.getElementById("local-adjustment-count"),
  localPanel: document.getElementById("local-adjustments-panel"),
  localToolButtons: [...document.querySelectorAll("[data-local-tool]")],
  localEraser: document.getElementById("local-eraser"),
  localAdjustmentList: document.getElementById("local-adjustment-list"),
  localEmpty: document.getElementById("local-empty"),
  localEditor: document.getElementById("local-editor"),
  localCompare: document.getElementById("local-compare"),
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
  perspectiveApplyStatus: document.getElementById("perspective-apply-status"),
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

boot();

async function boot() {
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
  state.gpuFailurePolicy = window.HDRRenderFailurePolicy ? new window.HDRRenderFailurePolicy() : null;
  state.gpuPreview = new window.HDRWebGPUPreview(els.previewCanvas);
  state.gpuPreview.featherReferenceScale = maskFeatherReferenceScale;
  state.gpuPreview.acknowledgedMaskSignature = acknowledgedMaskSignature;
  // Preferences can load before or after the renderer exists, so apply the
  // stored budget here as well as on every preferences change.
  state.gpuPreview.setMemoryBudget(state.gpuMemoryBudget ?? "auto");
  // Auto is half of the active card's dedicated video memory when the desktop
  // shell can read it; a browser, or a failed read, keeps the 2 GiB fallback.
  const videoMemory = await desktop?.videoMemory?.().catch(() => null);
  state.gpuPreview.setDetectedVideoMemory(videoMemory?.detected ? videoMemory : null);
  await state.gpuPreview.initialize();
  renderGpuMemoryAutoLabel();
  if (!state.gpuPreview.available && state.gpuFailurePolicy) {
    // Initialization failure is the one permanent failure in Section 5.8.
    state.gpuFailurePolicy.record(new Error(state.gpuPreview.detail || "WebGPU initialization failed"), { init: true });
  }
  state.displayInfo.gpu = state.gpuPreview.detail;
}

/**
 * Rebuild the GPU device after device loss, then re-render. Section 5.8 makes
 * device loss recoverable; only a rebuild that cannot initialize is permanent,
 * and that decision is recorded through the failure policy.
 */
async function rebuildGpuPreview(reason = "") {
  if (!state.gpuPreview) return false;
  try {
    const rebuilt = await state.gpuPreview.rebuild();
    if (!rebuilt) {
      state.gpuFailurePolicy?.record(
        new Error(state.gpuPreview.detail || reason || "WebGPU device rebuild failed"),
        { init: true },
      );
      markPreviewUnavailable(`WebGPU device rebuild failed: ${state.gpuPreview.detail || reason}`);
      return false;
    }
    state.gpuRebuildAttempts = 0;
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    if (state.session) await settlePreview(state.currentView);
    return true;
  } catch (error) {
    state.gpuFailurePolicy?.record(error, { init: true });
    markPreviewUnavailable(`WebGPU device rebuild failed: ${error?.message || error}`);
    return false;
  }
}

function initializeLocalOverlayColor() {
  if (els.localOverlayColorInput) els.localOverlayColorInput.value = state.localOverlayColor;
  if (els.localOverlayColorSwatch) els.localOverlayColorSwatch.style.backgroundColor = state.localOverlayColor;
}

function initializePreviewPreferences() {
  state.previewResolution = DEFAULT_PREVIEW_RESOLUTION;
  state.previewResolutionOverride = false;
  state.fasterDragging = false;
  state.previewLatencyController = window.HDRPreviewLatencyController
    ? new window.HDRPreviewLatencyController() : null;
  state.scopeMaxNits = 4000;
  state.scopeQuality = DEFAULT_SCOPE_QUALITY;
  state.scopeExactPeak = false;
  state.compareLayout = "single";
  if (els.previewFasterDragging) els.previewFasterDragging.checked = state.fasterDragging;
  if (els.scopeZoom) els.scopeZoom.value = String(state.scopeMaxNits);
  if (els.scopeDetail) els.scopeDetail.value = state.scopeQuality;
  if (els.scopeExactPeak) els.scopeExactPeak.checked = state.scopeExactPeak;
}

/**
 * Re-arm a preview that a deliberate retire left with no follow-up.
 *
 * The contract: while the viewer is not ready and no work is in flight for the
 * current lane, schedule the current generation again once a second. Every
 * guard exists to avoid competing with work that is legitimately running:
 * an active gesture, an in-flight GPU draft, a geometry transaction, an open
 * mask draft, a comparison peek, or a render coordinator lane that already has
 * an in-flight or pending request. Ordinary schedules reset the attempt budget
 * so a user-driven recovery is never counted against the bound, and the bound
 * stops a genuine refusal from becoming a submit loop.
 */
function installPreviewWatchdog() {
  stopPreviewWatchdog();
  state.previewWatchdogTimer = window.setInterval(() => {
    if (!state.session || !state.previewScheduler) return;
    const viewer = viewerState();
    if (viewer.status === "ready" || viewer.status === "unavailable") {
      state.previewWatchdogRearms = 0;
      return;
    }
    if (state.previewScheduler.interacting || state.gpuDraftInFlight) return;
    const cpuFlight = state.cpuPreviewInflight?.get(state.currentView);
    if (cpuFlight?.sessionId === state.session.session_id
      && cpuFlight.generation === state.previewGeneration[state.currentView]) return;
    if (geometryDraftActive() || state.localMaskDraftDirty || state.comparePeekActive) return;
    const laneState = state.renderCoordinator?.snapshot?.()?.lanes?.[state.currentView];
    if (laneState?.inFlight || laneState?.pending) return;
    if (state.previewWatchdogRearms >= PREVIEW_WATCHDOG_MAX_REARMS) return;
    state.previewWatchdogRearms += 1;
    state.previewScheduler.schedule(state.currentView, state.previewGeneration[state.currentView]);
  }, PREVIEW_WATCHDOG_INTERVAL_MS);
}

function stopPreviewWatchdog() {
  window.clearInterval(state.previewWatchdogTimer);
  state.previewWatchdogTimer = 0;
}

function initializePreviewScheduler() {
  if (!window.HDRPreviewScheduler) return;
  state.previewScheduler = new window.HDRPreviewScheduler({
    highQuality: () => previewNeedsRefinement(),
    onFrame: async (task) => {
      if (state.localMaskDraftDirty) return false;
      // A softer frame is only for an active gesture with Faster
      // dragging on. A frame that runs after release (a coalesced one, or an
      // edit with no gesture) is exact, so nothing coarse follows the release.
      const gesture = Boolean(state.previewScheduler?.interacting);
      let decision = interactiveScaleDecision(task.lane, { interacting: gesture });
      const tiled = interactiveDraftGuaranteedTiled(task.lane);
      if (tiled && !decision.coarse && gesture && state.fasterDragging) {
        decision = { edge: Math.max(256, Math.round(refinementProxyLongEdge() * 0.5)),
          coarse: true, scale: 0.5 };
      }
      if (decision.coarse) decision.edge = responseCoarseLongEdge(refinementProxyLongEdge());
      // The renderer refuses a whole-frame tiled drag frame, but only after
      // the source and parameters are prepared. Refuse it here, before that
      // work; the settled pass draws the edit. A magnified view is a bounded
      // region pass and goes through.
      if (tiled && !decision.coarse && state.zoomMode !== "custom") {
        const reason = "pre-dispatch-tiled";
        state.lastGpuDraftRefusal = { reason, lane: task.lane, tier: "interactive", at: performance.now() };
        const key = `interactive:${reason}`;
        state.gpuDraftRefusals[key] = (state.gpuDraftRefusals[key] || 0) + 1;
        return false;
      }
      const detailActive = gpuDetailGraphActive(task.lane);
      const detailInteraction = state.detailInteractionRestore?.lane === task.lane;
      // A queued interactive callback may become runnable only after pointerup
      // because the preceding Detail graph was GPU-backpressured. The settled
      // callback owns the final value at that point; submitting another low-res
      // frame here could overwrite the restored refined frame.
      if (detailInteraction && !state.previewScheduler?.interacting) return false;
      // Outside a gesture there is no responsiveness to win by starting a
      // second render. Superseding one that is already in flight throws away a
      // source upload and a highlight-peak measurement, and the frame that
      // replaces it is a bootstrap placeholder. During a gesture latest-wins
      // still applies, so this only stands down when nothing is being dragged.
      if (!state.previewScheduler?.interacting && state.gpuDraftInFlight) return false;
      const residentLongEdge = detailActive || detailInteraction ? residentAuthoringLongEdge() : null;
      if (residentLongEdge) {
        state.detailInteractionRestore = { lane: task.lane, longEdge: residentLongEdge };
      }
      const rendered = await renderGpuDraft(task.lane, {
        longEdge: decision.edge,
        // The interactive tier refuses tiled work. Coarse feedback at native
        // zoom must use the bounded refinement route, then settle exact.
        tier: tiled && decision.coarse ? "refinement" : "interactive",
        coarse: decision.coarse,
        // Lets the renderer drop this frame if the gesture ends before it
        // reaches the canvas (see renderGpuDraftInner's isCurrent).
        reason: decision.coarse ? "drag-coarse" : undefined,
      });
      // At most one drag frame may be on the GPU. The next frame waits for this
      // one to finish on the device, not merely to be submitted, so rapid
      // input coalesces to the newest task instead of queueing obsolete
      // frames (up to seven were measured in flight at 200%).
      if (rendered) await state.gpuPreview?.waitForSubmittedWork?.();
      return rendered;
    },
    onScope: (task) => {
      // The exposure overlay follows the same throttled, latest-wins cadence
      // as the scopes: during a drag, after settle and after refinement. It
      // runs beside them rather than inside this callback so an overlay render
      // never delays or inflates the scope pass.
      if (task.lane === state.currentView) requestLiveOverlay(task.tier);
      return refreshScopes(scopeLongEdge(task.tier), {
        tier: task.tier,
        generation: task.scopeGeneration,
        lane: task.lane,
      });
    },
    onSettle: (task) => settlePreview(task.lane, task),
    onRefine: (task) => refinePreview(task.lane, task),
    onInactive: (task) => preloadInactiveLane(task.lane, task.applicationGeneration),
  });
  // The coordinator owns generations, cancellation
  // tokens, priority, one-in-flight/one-latest coalescing, presentation
  // bookkeeping and the deferred follow-ups. app.js supplies the renderer call
  // and the state it presents, and emits intent for everything else.
  state.renderCoordinator = window.HDRRenderCoordinator
    ? new window.HDRRenderCoordinator({
      dispatch: (request) => renderGpuDraftInner(request.lane, request),
      present: (request) => (state.acceptedPresentation?.lane === request.lane
        ? state.acceptedPresentation
        : null),
      canPanRefine: () => Boolean(state.session)
        && !geometryDraftActive()
        && state.acceptedPresentation?.geometrySignature === geometrySignature(),
      onRefusal: (refusal) => {
        state.lastGpuDraftRefusal = {
          reason: refusal.reason, lane: refusal.lane, tier: refusal.tier, at: refusal.at,
        };
      },
      onError: (lane, reason, error) => {
        if (reason === "catch-up") state.roiCatchUpError = String(error?.message || error);
        else if (reason === "pan") state.roiPanError = String(error?.message || error);
      },
      onFollowUpStart: (lane, reason) => {
        if (reason === "catch-up") state.roiCatchUpError = null;
        else if (reason === "pan") state.roiPanError = null;
      },
      roiMode: state.roiPreviewMode,
      regionRoute: true,
      // The frame around a region pass is completed in the background only
      // when that costs the backend nothing. With a hard-edged mask in play it
      // would compile that mask for the whole image, which is the stall this
      // route exists to remove; the pan pass draws what the view reaches.
      canCatchUp: (lane, longEdge) => state.roiPreviewMode === "refinement" || Boolean(
        state.session && state.gpuPreview?.catchUpNeedsNoBackendMasks?.(
          state.session.session_id, lane, longEdge, geometrySignature(),
          state.compareWithoutLocals ? [] : localAdjustments(),
        ),
      ),
      catchUpDelayMs: ROI_CATCH_UP_DELAY_MS,
      panDelayMs: ROI_PAN_DELAY_MS,
    })
    : null;
  // Lost-wake-up safety net. Several flows deliberately retire the scheduler
  // before changing what the viewer must show (zoom refinement, a structural
  // mask gesture, a geometry transaction) and rely on their own follow-up to
  // schedule the next pass. When that follow-up is cancelled, refused or
  // superseded without scheduling anything else, the viewer can sit in
  // "Preparing" with no queued task, no in-flight render and no pending
  // request, and nothing wakes it until the next input. See
  // installPreviewWatchdog for the recovery contract and its bound.
  installPreviewWatchdog();
  window.HDRFinisherPerformance = {
    snapshot: () => state.previewScheduler.snapshot(),
    renderCoordinator: () => state.renderCoordinator?.snapshot() || null,
    previewWatchdog: () => ({
      active: state.previewWatchdogTimer !== 0,
      rearms: state.previewWatchdogRearms,
      maxRearms: PREVIEW_WATCHDOG_MAX_REARMS,
    }),
    // Diagnostic entry for the stall regression; disabling it reproduces the
    // pre-fix behavior for a retired scheduler with a dropped follow-up.
    previewWatchdogEnable: (enabled = true) => {
      if (enabled) installPreviewWatchdog();
      else stopPreviewWatchdog();
      return state.previewWatchdogTimer !== 0;
    },
    // Legacy-versus-ROI diagnostic A/B over the visible region.
    roiParity: (options = {}) => runRoiParity(options),
    gpuSnapshot: () => state.gpuPreview?.diagnosticsSnapshot?.() || null,
    enableGpuInstrumentation: (enabled = true) => state.gpuPreview?.setInstrumentationEnabled?.(enabled),
    // Source transport A/B: "stream" (default), "single", or legacy "strips".
    setSourceTransport: (mode) => state.gpuPreview?.setSourceTransport?.(mode) || null,
    sourceTransportMode: () => state.gpuPreview?.sourceTransportMode || null,
    renderGpuTier: (longEdge) => renderGpuDraft(state.currentView, {
      longEdge: Number(longEdge),
      tier: "settled",
    }),
    // Diagnostic entry for explicit parity and residency probes. Normal
    // user-visible renders reach the same encoder through admission planning.
    renderTiledTier: async (longEdge, options = {}) => {
      if (!state.gpuPreview || !state.session) return { rendered: false, refusals: ["no gpu session"] };
      return state.gpuPreview.renderTiledTo(
        els.previewCanvas,
        state.session.session_id,
        state.currentView,
        JSON.parse(JSON.stringify(state.adjustments)),
        sampleCurvePoints,
        Number(longEdge),
        state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
        state.editRevision,
        null,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        {
          tier: "settled",
          tileSize: Number(options.tileSize) || undefined,
          viewport: options.viewport || null,
          applicationGeneration: state.previewGeneration[state.currentView],
        },
      );
    },
    measureExactPeak: (options = {}) => measureExactScopePeak(options),
    tiledExecutionMetrics: () => state.gpuPreview?.tiledExecutionMetrics || null,
    denoiseInputStats: () => state.denoiseInputQueue?.stats || null,
    // ROI rendering switch. "fit" (default) keeps whole-frame rendering;
    // "refinement" limits the refinement-tier pass to the visible region.
    setRoiPreviewMode: (mode) => {
      state.roiPreviewMode = mode === "refinement" ? "refinement" : "fit";
      // Diagnostics flip the mode without disturbing a timer a driver may be
      // measuring; an already-armed follow-up skips itself at fire time.
      state.renderCoordinator?.setRoiMode(state.roiPreviewMode, { cancelFollowUps: false });
      return state.roiPreviewMode;
    },
    roiPreviewMode: () => state.roiPreviewMode,
    roiCatchUpState: () => ({
      timerPending: state.renderCoordinator
        ? state.renderCoordinator.catchUpPending(state.currentView)
        : false,
      mode: state.roiPreviewMode,
      generation: state.previewGeneration[state.currentView],
      inFlight: Boolean(state.gpuDraftInFlight),
      error: state.roiCatchUpError || null,
      refusal: state.lastGpuDraftRefusal,
    }),
    // The same cancellation a new edit performs, for drivers that need to
    // measure a pan without the deferred whole-frame pass arriving mid-pass.
    cancelRoiCatchUp: () => {
      cancelRoiCatchUp();
      return state.renderCoordinator
        ? !state.renderCoordinator.catchUpPending(state.currentView)
        : true;
    },
    // Deferred pan diagnostics and the cache
    // evidence the renderer reports through tiledExecutionMetrics.
    roiPanState: () => ({
      timerPending: state.renderCoordinator
        ? state.renderCoordinator.panPending(state.currentView)
        : false,
      mode: state.roiPreviewMode,
      generation: state.previewGeneration[state.currentView],
      inFlight: Boolean(state.gpuDraftInFlight),
      error: state.roiPanError || null,
      refusal: state.lastGpuDraftRefusal,
    }),
    panRefinement: () => requestRoiPanRefinement(),
    visibleOutputRect: () => visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height),
    // Diagnostic view of the immutable viewport contract. The renderer builds
    // its own frame-anchored request from the actual proxy and composed halo;
    // this app-level version uses the selected tier and is for inspection.
    // Geometry cropping is not modelled here.
    viewportRequest: (options = {}) => {
      const Request = window.HDRViewportRequest;
      if (!Request || !state.session) return null;
      const source = state.session.source;
      const targetLongEdge = Number(options.longEdge) || previewTargetLongEdge();
      const ratio = Math.min(1, targetLongEdge / Math.max(source.width, source.height));
      const output = {
        width: Math.max(1, Math.round(source.width * ratio)),
        height: Math.max(1, Math.round(source.height * ratio)),
      };
      // The request declares the processing scale the graph will
      // run at. It is the same contract the renderer and the CPU reference
      // derive, so a request can never describe a scale the pass did not use.
      const scale = window.HDRGraphScale?.processingScaleFor
        ? window.HDRGraphScale.processingScaleFor({ width: source.width, height: source.height }, output)
        : ratio;
      return Request.build({
        lane: state.currentView,
        sessionId: state.session.session_id,
        geometrySignature: geometrySignature(),
        applicationGeneration: state.previewGeneration[state.currentView],
        editRevision: state.editRevision,
        output,
        source: { width: source.width, height: source.height },
        scale,
        visible: options.visible || null,
        halo: Number(options.halo) || 0,
        minimumRoiFraction: options.minimumRoiFraction,
        tileSize: Number(options.tileSize) || undefined,
        dpr: Number(window.devicePixelRatio) || 1,
        zoom: Number(options.zoom) || 1,
      });
    },
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
    previewMode: () => `${dragLatencyPreference()}-${state.gpuPreview?.available ? "gpu" : "cpu"}`,
    authoringState: () => ({
      sessionId: state.session?.session_id || null,
      lane: state.currentView,
      adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      requestedTier: state.previewResolutionOverride ? normalizedPreviewResolution() : "display",
      presentedTier: state.acceptedPresentation?.tier || null,
      presentedGeneration: state.acceptedPresentation?.generation ?? null,
      currentGeneration: state.previewGeneration[state.currentView],
      executionMode: previewExecutionMode(),
      gpuBudget: state.gpuMemoryBudget ?? "auto",
      renderPlan: state.gpuPreview?.lastRenderPlan || null,
      allocationBackoff: state.gpuPreview?.allocationBackoff || null,
      previewResolution: state.previewResolutionOverride ? normalizedPreviewResolution() : "auto",
      previewPreference: dragLatencyPreference(),
      fasterDragging: state.fasterDragging,
      previewLatency: state.previewLatencyController?.snapshot() || null,
      previewMaxDimension: requiredProcessingLongEdge(),
      previewDimensions: previewResolutionDimensions(),
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
  els.proofLaneButtons.forEach((button) => button.addEventListener("click", () => {
    switchLane(button.dataset.proofLane);
  }));
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await importByteFile(file, "import another source");
    event.target.value = "";
  });
  els.importButton.addEventListener("click", requestSourceImport);
  els.testPatternButton.addEventListener("click", async () => {
    if (!await confirmUnsavedTransition("replace the source with a test pattern")) return;
    const confirmedDocument = documentTransitionToken();
    const importGeneration = claimSessionReplacement();
    status.post({ id: "proof", severity: "progress", message: "Generating delivery proof test pattern…", progress: "indeterminate" });
    try {
      const response = await fetch("/api/proof/test-pattern");
      if (importGeneration !== state.importGeneration) return;
      if (!response.ok) throw new Error(`Test pattern failed with HTTP ${response.status}.`);
      const file = new File([await response.blob()], "hdr_delivery_proof_pattern.tiff", { type: "image/tiff" });
      if (importGeneration !== state.importGeneration) return;
      await importByteFile(file, "replace the source with a test pattern", confirmedDocument, importGeneration);
    } catch (error) {
      status.post({ id: "proof", severity: "error", message: error?.message || "The delivery proof test pattern could not be generated." });
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
  els.previewFasterDragging?.addEventListener("change", () => {
    const enabled = els.previewFasterDragging.checked === true;
    window.HDRApplicationShell?.setFasterDragging?.(enabled);
    state.fasterDragging = enabled;
    renderReadouts();
  });
  els.scopeDetail?.addEventListener("change", async () => {
    state.scopeQuality = SCOPE_QUALITY_PROFILES[els.scopeDetail.value] ? els.scopeDetail.value : DEFAULT_SCOPE_QUALITY;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
  });
  els.scopeExactPeak?.addEventListener("change", async () => {
    state.scopeExactPeak = Boolean(els.scopeExactPeak.checked);
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
          await importByteFile(file, "import another source");
          return;
        }
        await openDesktopSelection(selection);
      } else {
        await importByteFile(file, "import another source");
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
    // Pressed-state buttons (the Film Look map views) are one click, one
    // history step, so they skip the slider gesture plumbing below.
    if (control.tagName === "BUTTON") {
      control.addEventListener("click", () => {
        beginGlobalEditGesture(control);
        const pressed = control.getAttribute("aria-pressed") !== "true";
        commitAdjustmentValue(control.dataset.path, pressed);
        syncPressedControl(control, pressed);
        endGlobalEditGesture(control);
      });
      return;
    }
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
      const value = readControlValue(control);
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
  els.denoiseShowNoise?.addEventListener("click", toggleDenoiseNoiseView);
  const denoiseSliders = [
    [els.denoiseAmount, "amount"],
    [els.denoiseLuminance, "luminance"],
    [els.denoiseColor, "color_noise"],
    [els.denoiseDetail, "detail_recovery"],
    [els.denoiseFinest, "finest_noise"],
    [els.denoiseFine, "fine_noise"],
    [els.denoiseMedium, "medium_noise"],
    [els.denoiseCoarse, "coarse_noise"],
  ];
  for (const [control, key] of denoiseSliders) {
    // Capture phase: the instrument slider's own pointerdown moves the value
    // to the click and fires `input` at once, and that first reconstruction
    // must already count as part of the drag (else it is a whole-frame one).
    control?.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction(), { capture: true });
    control?.addEventListener("input", () => updateLiveDenoiseControl(key, Number(control.value)));
    for (const eventName of ["pointerup", "pointercancel", "change"]) {
      control?.addEventListener(eventName, () => {
        state.previewScheduler?.endInteraction();
        const stale = state.denoiseWholeFrameStale;
        if (stale) {
          state.denoiseWholeFrameStale = null;
          void denoiseInputQueue().submit({ ...stale, wholeFrame: true });
        }
        if (eventName === "change") void persistDenoiseSettings();
      });
    }
  }
  els.denoiseRecalculate?.addEventListener("click", () => recalculateDenoise());
  // PRD 6.3 progressive disclosure. Purely a matter of what is on screen:
  // the controls keep their values and keep applying while the panel is shut,
  // because `renderDenoiseControls` writes to them either way.
  els.denoiseAdvancedToggle?.addEventListener("click", () => {
    state.denoiseAdvancedOpen = !state.denoiseAdvancedOpen;
    renderDenoiseAdvancedVisibility();
  });
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
      if (group.dataset.group === "perspective" && collapsed) abandonPerspectiveDraft();
      else if (group.dataset.group === "perspective" && state.perspectiveFailedDraft) {
        openPerspectiveMode();
        schedulePerspectiveDraftPreview();
      }
      else if (group.dataset.group !== "perspective" && !collapsed) abandonPerspectiveDraft();
      if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");
      renderVignetteCenter();
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(
      ["detail", "black-and-white"].includes(button.dataset.resetGroup)
        ? `${state.currentView}-${button.dataset.resetGroup}`
        : button.dataset.resetGroup
    ));
  });
  els.sdrMatchHdrColors.addEventListener("click", matchHdrColorsToSdr);
  els.sdrMatchEntire?.addEventListener("click", () => setSdrMatch());
  els.detailMatchHdr?.addEventListener("click", () => matchLaneObject("detail"));
  els.blackAndWhiteMatchHdr?.addEventListener("click", matchHdrBlackAndWhiteToSdr);
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
    setCustomZoom(sliderToZoomPercent(Number(els.zoomSlider.value)), null, { continuous: true });
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
    updateNavigationViewport();
    // The pan itself is compositor-only; this updates the coordinator's
    // viewport model and schedules the deferred follow-up that refines a newly
    // exposed strip.
    state.renderCoordinator?.noteViewport(
      state.currentView,
      visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height),
    );
    noteViewerPan();
  }, { passive: true });
  els.navigationThumb.addEventListener("click", (event) => {
    if (!state.session || state.zoomMode !== "custom") return;
    const imageBox = els.navigationThumbImage.getBoundingClientRect();
    const x = event.detail === 0 ? 0.5 : clamp((event.clientX - imageBox.left) / Math.max(1, imageBox.width), 0, 1);
    const y = event.detail === 0 ? 0.5 : clamp((event.clientY - imageBox.top) / Math.max(1, imageBox.height), 0, 1);
    els.dropzone.scrollLeft = x * els.dropzone.scrollWidth - els.dropzone.clientWidth / 2;
    els.dropzone.scrollTop = y * els.dropzone.scrollHeight - els.dropzone.clientHeight / 2;
    updateNavigationViewport();
  });
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
  // A drag frame carries the last highlight measurement instead of waiting
  // for one. When the measurement it skipped lands and differs, redraw the
  // current view so the resting frame uses the real anchor. The renderer has
  // cached it, so the redraw is one ordinary pass.
  window.addEventListener("hdrfinisher:highlight-anchor-measured", (event) => {
    const lane = event.detail?.lane;
    if (!state.session || lane !== state.currentView) return;
    invalidatePreview(lane, { markDirty: false });
    debouncePreview(lane);
  });
  window.addEventListener("hdrfinisher:highlight-anchor-needed", (event) => {
    const { lane, key, used } = event.detail || {};
    if (!state.session || lane !== state.currentView || !key) return;
    scheduleExactHighlightAnchor({ lane, key, used });
  });
  window.addEventListener("hdrfinisher:webgpulost", (event) => {
    const message = event.detail?.message || "WebGPU device lost";
    const verdict = state.gpuFailurePolicy?.record(new Error(message), { deviceLost: true });
    state.displayInfo.gpu = verdict?.recoverable === false
      ? message
      : `${message}; rebuilding the device`;
    clearGpuSurfaceHdr();
    renderReadouts();
    if (verdict?.recoverable !== false && state.gpuRebuildAttempts < 2) {
      state.gpuRebuildAttempts += 1;
      void rebuildGpuPreview(message);
      return;
    }
    markPreviewUnavailable(`${message}. WebGPU could not be rebuilt for this session.`);
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
        if (state.session) {
          invalidatePreview(state.currentView, { markDirty: false });
          settlePreview(state.currentView).catch(() => null);
        }
      });
    });
  }
}

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

function debouncePreview(lane = state.currentView) {
  state.previewWatchdogRearms = 0;
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

/**
 * Whether a refused draft is going to be answered by work that is already
 * scheduled, so this path does not have to pay for a CPU frame.
 *
 * PERF-03. At Full a settled render takes seconds and every interactive draft
 * the scheduler dispatches during a drag is refused outright by the tiled
 * encoder -- but only after it has taken the supersession token, so the
 * settled render in flight comes back `superseded-during-render`. Answering
 * that with `renderPreviewForLane` rendered the whole frame on the CPU
 * backend: measured at 7 059 ms for a 7968 px source, with nothing on the
 * canvas while it ran, to produce the stale values the supersession had just
 * rejected.
 *
 * Being superseded is not a failure, and the frame already on screen is a
 * better answer than a slow render of values the user has moved past. But
 * standing down is only safe when something else is certainly coming. An
 * earlier attempt keyed this on `gpuDraftInFlight` being non-null, which is
 * true for refusals that nothing follows, and the viewer never reached Ready
 * at all.
 *
 * So the test is the scheduler's own image generation. `schedule()` bumps it
 * and arms a settle in the same call, so a generation newer than this task's
 * means a newer settle is already armed and will present. Every other
 * refusal, and any supersession that did not come from newer input, still
 * falls back exactly as before.
 */
function supersededByScheduledWork(task) {
  if (state.lastGpuDraftRefusal?.reason !== "superseded-during-render") return false;
  const scheduler = state.previewScheduler;
  if (!scheduler || task?.imageGeneration === undefined) return false;
  return task.imageGeneration !== scheduler.generations.image;
}

/**
 * A renderer generation can lose ownership while it is awaiting a proxy,
 * mask, or highlight reduction. That is cancellation, not a reason to switch
 * execution engines. At Full the CPU fallback is deliberately bounded and
 * may refuse graphs (locals and spatial film are two examples) that the next
 * GPU generation can render exactly. Showing that CPU refusal between two GPU
 * generations turns an ordinary latest-wins race into a false Unavailable.
 */
function transientGpuRefusal() {
  const reason = String(state.lastGpuDraftRefusal?.reason || "");
  return reason === "superseded-during-render"
    || reason.startsWith("superseded-")
    // The coordinator's name for the same thing: a queued render replaced by
    // a newer one before it was dispatched.
    || reason === "coalesced-by-newer-render"
    || reason.startsWith("peak:newer-render-started")
    || reason.startsWith("peak:application-not-current")
    || (reason.startsWith("tiled-encode-failed:") && reason.includes("superseded"));
}

async function settlePreview(lane = state.currentView, task = {}) {
  // Rotate/Straighten is an explicit Apply/Cancel transaction. A scheduler
  // task left resident by an earlier grading gesture must never settle the
  // transient geometry on slider release.
  if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;
  await syncGlobalEditState();
  // A local slider's `change` handler persists its optimistic value through
  // the serialized edit queue. The scheduler's settle timer is independent of
  // that request and can otherwise snapshot the old revision while the new
  // mask/grade is still being committed. At Full that stale GPU generation is
  // cancelled, then the bounded CPU fallback truthfully refuses locals. Wait
  // for the queue that was present when settling began so the authoritative
  // pass always snapshots one coherent revision.
  const pendingEdits = state.editCommandQueue;
  if (pendingEdits && await pendingEdits === false) return false;
  if (!state.session || state.rotateDraftGeometry || state.perspectiveMode) return false;
  if (task.applicationGeneration !== undefined
    && task.applicationGeneration !== state.previewGeneration[lane]) return false;
  if (state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation.exact
    && state.acceptedPresentation.generation === state.previewGeneration[lane]
    && state.acceptedPresentation.geometrySignature === geometrySignature()
    && state.acceptedPresentation.processedLongEdge === refinementProxyLongEdge()) {
    prepareInactivePreview();
    window.HDRProofing?.settled(lane);
    return true;
  }
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
      let rendered = await renderGpuDraft(lane, { longEdge, tier });
      // Latest-wins cancellation is expected while a mask proxy or edit
      // revision changes underneath a Full render. If this is still the
      // current scheduler task, retry once after the serialized edit queue has
      // drained. One bounded retry recovers the real result without turning a
      // normal GPU handoff into an unsupported CPU Full request.
      if (!rendered && transientGpuRefusal() && !supersededByScheduledWork(task)) {
        const retryEdits = state.editCommandQueue;
        if (!retryEdits || await retryEdits !== false) {
          const schedulerCurrent = !state.previewScheduler
            || task.imageGeneration === undefined
            || state.previewScheduler.current?.imageGeneration === task.imageGeneration;
          const applicationCurrent = task.applicationGeneration === undefined
            || task.applicationGeneration === state.previewGeneration[lane];
          if (schedulerCurrent && applicationCurrent && lane === state.currentView) {
            rendered = await renderGpuDraft(lane, { longEdge, tier });
          }
        }
      }
      if (rendered) await refreshOverlay(longEdge);
      else if (!supersededByScheduledWork(task) && !transientGpuRefusal()) {
        state.cpuFallbacks.settle.push(state.lastGpuDraftRefusal?.reason || "unknown");
        await renderPreviewForLane(lane, true, longEdge, { showProgress: false });
      }
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
  // Let an in-flight render finish first. Superseding it would throw away work
  // that has already loaded its source and measured its highlight peak, and
  // that render may well leave nothing for refinement to do.
  if (state.gpuDraftInFlight) {
    await state.gpuDraftInFlight.catch(() => null);
    if (!state.session || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView) return;
    if (task.applicationGeneration !== undefined && task.applicationGeneration !== state.previewGeneration[lane]) return;
  }
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  const targetLongEdge = refinementProxyLongEdge();
  markRefining();
  const rendered = gpuPreviewEligible(lane)
    ? await renderGpuDraft(lane, { longEdge: targetLongEdge, tier: "refinement" })
    : false;
  if (rendered || geometryDraftActive() || !previewNeedsRefinement() || lane !== state.currentView || targetLongEdge !== refinementProxyLongEdge()) return;
  if (transientGpuRefusal()) return;
  state.cpuFallbacks.refine.push(state.lastGpuDraftRefusal?.reason || "unknown");
  await renderPreviewForLane(lane, true, targetLongEdge, { showProgress: false });
  if (generation !== state.previewGeneration[lane] || signature !== geometrySignature() || !previewNeedsRefinement()) return;
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
  const longEdge = window.HDRWholeImagePreviewPipe.edgeFor("fitPlaceholder", state.session?.preview?.long_edge || 1600);
  return renderPreviewForLane(state.currentView, true, longEdge, options);
}

async function renderPreviewForLane(
  lane,
  displayWhenReady,
  longEdge = 1600,
  options = {},
) {
  if (!state.session || geometryDraftActive()) return false;
  const sessionId = state.session.session_id;
  if (await syncGlobalEditState() === false || state.session?.session_id !== sessionId) return false;
  if (geometryDraftActive()) return false;
  const raw = options.raw ?? !state.gpuPreview?.available;
  const key = JSON.stringify([sessionId, state.editRevision, state.previewGeneration[lane],
    geometrySignature(), longEdge, displayWhenReady, raw, state.compareWithoutLocals,
    state.localPreviewDirty && !state.compareWithoutLocals ? localAdjustments() : null]);
  const inflight = state.cpuPreviewInflight ||= new Map();
  const previous = inflight.get(lane);
  // Scheduler settle, scopes and lane preparation can ask for the same CPU
  // image while it is still computing. Aborting and restarting that request
  // wastes the backend work and can prevent any current frame from finishing.
  if (previous?.key === key) return previous.promise;
  const record = { key, sessionId, generation: state.previewGeneration[lane], promise: null };
  record.promise = renderPreviewForLaneInner(lane, displayWhenReady, longEdge, { ...options, raw });
  inflight.set(lane, record);
  try {
    return await record.promise;
  } finally {
    if (inflight.get(lane) === record) inflight.delete(lane);
  }
}

async function renderPreviewForLaneInner(
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
  if (cached?.generation === generation && cached.geometrySignature === signature
    && (cached.requestedLongEdge || cached.longEdge || 0) >= longEdge) {
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
      execution: previewExecutionForTier(),
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
    const payload = await safeJson(response);
    if (payload?.code === "strip_execution_refused" && displayWhenReady && requestIsCurrent()) {
      const reasons = Array.isArray(payload.refusals) && payload.refusals.length
        ? ` ${payload.refusals.join(", ")}.`
        : "";
      markPreviewUnavailable(`${payload.detail || "Bounded Full preview is unavailable for this graph."}${reasons}`);
    } else if (displayWhenReady && showProgress && requestIsCurrent()) {
      setPreviewMessage("A newer adjustment replaced this render.", progressSteps[0]);
    }
    return false;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    if (displayWhenReady && requestIsCurrent()) {
      const detail = payload?.detail || "Preview failed to render.";
      setPreviewError(detail);
      // A CPU preview failure moves the
      // viewer to Unavailable and keeps the last valid presentation. Clearing
      // the image here destroyed a good frame because a later one failed.
      if (state.acceptedPresentation?.lane === lane) markPreviewUnavailable(detail);
      else {
        clearPreviewImage();
        clearPreviewOverlay();
      }
    }
    return false;
  }

  if (displayWhenReady && showProgress) setPreviewMessage("Processing complete. Decoding preview...", progressSteps[1]);
  const previewInfo = previewInfoFromResponse(response, lane);
  let width = Number(response.headers.get("X-Image-Width"));
  let height = Number(response.headers.get("X-Image-Height"));
  const scopePeakHeader = response.headers.get("X-Scope-Peak");
  const responseScopePeak = scopePeakHeader === null ? null : Number(scopePeakHeader);
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
  state.previewCache[lane] = { url, generation, longEdge: Math.max(width, height) || longEdge, requestedLongEdge: longEdge, width, height, geometrySignature: signature, scopePeak: Number.isFinite(responseScopePeak) ? responseScopePeak : null };
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
      acceptPresentation(lane, longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", width, height, previewInfo.transport, gpuPreviewEligible(lane) ? "" : "CPU/backend", null, generation, null, longEdge, responseScopePeak);
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
      execution: previewExecutionForTier(),
      hdr_display: false,
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name !== "AbortError") console.error(error);
    return null;
  });
  if (!response || controller !== state.previewControllers[lane]) return false;
  if (response.status === 409) {
    const payload = await safeJson(response);
    if (payload?.code === "strip_execution_refused" && displayWhenReady && lane === state.currentView) {
      const reasons = Array.isArray(payload.refusals) && payload.refusals.length
        ? ` ${payload.refusals.join(", ")}.`
        : "";
      markPreviewUnavailable(`${payload.detail || "Bounded Full preview is unavailable for this graph."}${reasons}`);
    }
    return false;
  }
  if (!response.ok) {
    // The raw path already retained the previous frame by returning early.
    // Reporting Unavailable is what turns a silent retention into a truthful
    // one: the viewer is told why the image it can see is still the newest.
    const payload = await safeJson(response);
    if (displayWhenReady && lane === state.currentView) {
      markPreviewUnavailable(payload?.detail || "Preview failed to render.");
    }
    return false;
  }
  const width = Number(response.headers.get("X-Image-Width"));
  const height = Number(response.headers.get("X-Image-Height"));
  const rawGeneration = Number(response.headers.get("X-Generation"));
  const scopePeakHeader = response.headers.get("X-Scope-Peak");
  const responseScopePeak = scopePeakHeader === null ? null : Number(scopePeakHeader);
  const data = new Uint8ClampedArray(await response.arrayBuffer());
  if (geometryDraftActive() || controller !== state.previewControllers[lane]
    || generation !== state.previewGeneration[lane] || rawGeneration !== generation || signature !== geometrySignature()) return false;
  const frame = { raw: data, width, height, generation, longEdge: Math.max(width, height) || longEdge, requestedLongEdge: longEdge, geometrySignature: signature, scopePeak: Number.isFinite(responseScopePeak) ? responseScopePeak : null };
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
  const rawProcessedEdge = frame.requestedLongEdge || frame.longEdge;
  acceptPresentation(state.currentView, rawProcessedEdge >= refinementProxyLongEdge() ? "refinement" : "settled", frame.width, frame.height, "Raw RGBA8", "CPU/backend", null, frame.generation, null, rawProcessedEdge, frame.scopePeak);
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

/**
 * Keep the exposure overlay following edits.
 *
 * The overlay is a backend image composited over the GPU preview, so it only
 * changes when it is asked for again. Before this it was asked for only from
 * the GPU settle path, which the refinement pass bypasses: after an exposure
 * drag the zebra stayed on the pre-drag frame indefinitely. The scheduler's
 * scope pass runs at every tier, so it drives this loop instead.
 *
 * One request in flight, newest tier pending: a drag produces a steady stream
 * of overlays at the interactive edge instead of aborting each one before it
 * lands, and the settled request that follows always runs.
 */
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

function renderGpuDraft(lane = state.currentView, options = {}) {
  const tier = options.tier || "settled";
  const longEdge = Number(options.longEdge) > 0 ? Number(options.longEdge) : settledProxyLongEdge();
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    // The visible region is measured here, where the mounted canvas is known,
    // and handed to the coordinator so the deferred pan pass can use the same
    // model without measuring DOM state from inside the state machine.
    const frame = gpuFrameSizeAt(longEdge) || approximateGpuFrameSizeAt(longEdge);
    coordinator.noteViewport(lane, visibleOutputRect(frame.width, frame.height));
    coordinator.noteScale(lane, { tier, longEdge });
  }
  const pending = coordinator
    ? coordinator.submit({
      lane,
      tier,
      longEdge,
      reason: options.reason || tier,
      priority: options.priority || "foreground",
      // The refinement pass is the expensive one at large tiers, so that is
      // where the visible region pays off. Interactive and settled passes stay
      // whole frame: pan and zoom then always show complete pixels, and the ROI
      // pass only improves a region that is already correct. A catch-up pass is
      // the whole-frame follow-up that closes the seam, so it never carries a
      // viewport.
      viewport: options.viewport !== undefined
        ? Boolean(options.viewport)
        : (state.roiPreviewMode === "refinement" && tier === "refinement" && !options.roiCatchUp)
          || (state.zoomMode === "custom" && !options.roiCatchUp),
      catchUp: Boolean(options.roiCatchUp),
      panPass: Boolean(options.panPass),
      allowInactive: Boolean(options.allowInactive),
      hideStatus: options.hideStatus !== false,
      coarse: Boolean(options.coarse),
      interactiveSnapshot: tier === "interactive" && Boolean(state.previewScheduler?.interacting)
        && Boolean(state.denoise?.[lane]?.enabled),
    })
    : renderGpuDraftInner(lane, options);
  state.gpuDraftInFlight = pending;
  // Which tier is holding the device. A settled draft at Full is a multi-second
  // tiled render; an interactive one is refused immediately. Telling them apart
  // is what lets a caller decide whether waiting is worth anything.
  state.gpuDraftInFlightTier = tier;
  void pending.catch(() => null).finally(() => {
    if (state.gpuDraftInFlight === pending) {
      state.gpuDraftInFlight = null;
      state.gpuDraftInFlightTier = null;
    }
  });
  return pending;
}

async function renderGpuDraftInner(
  lane = state.currentView,
  request = {},
) {
  const {
    hideStatus = true,
    longEdge = settledProxyLongEdge(),
    allowInactive = false,
    tier = "settled",
    roiCatchUp = false,
    panPass = false,
  } = request;
  const renderStartedAt = performance.now();
  // Record why a draft declined. A silent false is very hard to diagnose from
  // a failing browser test, and every one of these is a legitimate refusal.
  const refuse = (reason) => {
    state.lastGpuDraftRefusal = { reason, lane, tier, at: performance.now() };
    // Cumulative, because the interesting refusals arrive in bursts during a
    // drag and only the histogram distinguishes "superseded once" from the
    // repeated supersession that PERF-03 is about.
    const key = `${tier}:${reason}`;
    state.gpuDraftRefusals[key] = (state.gpuDraftRefusals[key] || 0) + 1;
    return false;
  };
  if (geometryDraftActive()) return refuse("geometry-draft-active");
  if (!gpuPreviewEligible(lane)) return refuse("gpu-not-eligible");
  if (!state.session || (!allowInactive && lane !== state.currentView)) return refuse("no-session-or-inactive-lane");
  if (state.comparePeekActive && !allowInactive) return refuse("compare-peek-active");
  if (state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()) return refuse("dirty-edit-with-stale-geometry");
  // The coordinator assigns the dispatch serial when the render actually
  // starts; a superseded or coalesced intent never consumes one.
  const serial = Number(request.dispatchSerial) || 0;
  state.gpuRenderSerial = serial;
  if (!allowInactive) state.gpuPreview?.backgroundMaskRequestCoordinator?.cancel();
  const sessionId = state.session.session_id;
  const generation = Number.isFinite(Number(request.applicationGeneration))
    ? Number(request.applicationGeneration)
    : state.previewGeneration[lane];
  const requestedGeometrySignature = geometrySignature();
  if (state.denoise?.[lane]?.enabled && !state.denoiseRuntime?.[lane]?.showOriginal) {
    const expectedIdentity = `${sessionId}:${lane}:${longEdge}:${requestedGeometrySignature}:source`;
    const denoise = state.gpuPreview?.diagnosticsSnapshot?.().denoise;
    if (state.denoiseRuntime[lane].dirty || !denoise?.cacheReady || denoise.identity !== expectedIdentity) {
      // At 100% on a large frame this is several seconds with the previous
      // picture still up, so say what the wait is.
      const waiting = "Preparing Denoise for this view…";
      if (hideStatus && lane === state.currentView) setIndeterminatePreviewMessage(waiting);
      const ready = await recalculateDenoise(lane, { longEdge, renderAfter: false });
      if (state.previewStatusEntry?.message === waiting) hidePreviewMessage();
      if (!ready) return refuse("denoise-scale-analysis-unavailable");
    }
  }
  // A magnified pass fetches a region of the frame it will produce, so it has
  // to know that frame's exact size first.
  if (request.viewport && !gpuFrameSizeAt(longEdge)) await ensureGeometryCoordinateMap(longEdge);
  const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));
  const localSnapshot = state.compareWithoutLocals
    ? []
    : JSON.parse(JSON.stringify(localAdjustments()));
  const maskOverlay = gpuLumaMaskOverlayOptions();
  const sourceOptions = {
    tier,
    applicationGeneration: generation,
    viewport: request.viewport || null,
    // The frame this pass will produce, so that the first magnified pass can
    // fetch only the region it draws.
    frameSize: geometrySignature() === requestedGeometrySignature ? gpuFrameSizeAt(longEdge) : null,
    roiCatchUp,
    panPass,
    noiseView: denoiseNoiseViewActive(lane),
    // Adaptive reconstruction reads ungraded source pixels. A slider changes
    // the render, but leaves these pixels useful to its replacement. Keep the
    // load alive while the photo and geometry remain the same.
    isSourceCurrent: state.denoise?.[lane]?.enabled
      ? () => !geometryDraftActive() && state.session?.session_id === sessionId
        && requestedGeometrySignature === geometrySignature()
      : null,
    onSourceProgress: (progress) => {
      if (progress.state !== "building" || !sourceOptions.isCurrent() || !hideStatus) return;
      const completed = Math.max(0, Number(progress.completed) || 0);
      const total = Math.max(1, Number(progress.total) || 1);
      setPreviewMessage(`Preparing source level · ${completed}/${total} channels`,
        15 + Math.round(30 * completed / total));
    },
    // WebGPU renders directly into the mounted canvas. Guard inside the
    // renderer, before it resizes or submits to that canvas, because rejecting
    // the result here after await would already be visibly too late. The
    // coordinator's token covers generations and cancellation; these are the
    // app-domain facts it cannot know.
    isCurrent: () => (typeof request.isCurrent === "function" ? request.isCurrent() : true)
      && !geometryDraftActive()
      && state.session?.session_id === sessionId
      && (generation === state.previewGeneration[lane]
        || (request.interactiveSnapshot && state.previewScheduler?.interacting))
      && requestedGeometrySignature === geometrySignature()
      && (allowInactive || lane === state.currentView)
      // A softer drag frame is never shown after release. One still on
      // the GPU when the pointer lifts is dropped before it reaches the
      // canvas; the settled pass that follows the release draws full detail.
      && !(request.coarse && request.reason === "drag-coarse" && !state.previewScheduler?.interacting),
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
    if (!result) return refuse(state.gpuPreview.lastRenderRefusal?.reason || "renderer-returned-nothing");
    if (!sourceOptions.isCurrent()) return refuse("superseded-during-render");
    state.gpuRenderRetries = 0;
    state.gpuFailurePolicy?.noteSuccess();
    // The coordinator arms the whole-frame catch-up once this pass presents,
    // so the refinement boundary stops being visible as a seam. It owns the
    // deferred follow-up and cancels it on a newer edit or a mode change.
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
      result.execution || "direct",
      result.processedLongEdge || longEdge,
      null,
      request.coarse,
    );
    const exactEdge = refinementProxyLongEdge();
    const visibleEdge = Math.min(exactEdge, Math.max(1, displayedLongEdge()));
    // Total wall time is the model input on purpose. Feeding
    // the renderer's graph-only stage time here (source and mask waits
    // excluded): at 42 MP it made the controller skip the coarse frame
    // entirely at warm 50%, because a scale change always pays a fresh source
    // upload and that upload is exactly the cost the coarse frame buys down.
    state.previewLatencyController?.record({ graph: previewGraphTimingKey(lane), edge: longEdge,
      exactEdge, visiblePixels: visibleEdge * visibleEdge, elapsedMs: performance.now() - renderStartedAt });
    setZoomMode(state.zoomMode);
    renderReadouts();
      if (hideStatus) hidePreviewMessage();
      const submittedAt = performance.now();
      requestAnimationFrame((animationFrameAt) => {
        if (serial !== state.gpuRenderSerial || (!allowInactive && lane !== state.currentView)) return;
        // rAF supplies the start of the frame, which can precede this render's
        // submission. Use the callback observation for latency, retaining the
        // frame timestamp independently for trace interpretation.
        const presentedAt = performance.now();
        state.gpuPreview?.recordPresentation?.({
          serial,
          lane,
          longEdge,
          submittedAt,
          presentedAt,
          submitToPresentMs: presentedAt - submittedAt,
          animationFrameAt,
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
    const verdict = state.gpuFailurePolicy
      ? state.gpuFailurePolicy.record(error, { superseded: Boolean(error?.recoverable) })
      : {
        kind: error?.recoverable ? "superseded" : "transport",
        recoverable: true,
        retryable: false,
        disabled: false,
        detail: error?.message || "WebGPU draft failed",
      };
    if (verdict.kind === "superseded") {
      console.debug("WebGPU authoring render deferred until geometry commit.", error);
      // Say so. A silent false leaves the previous refusal standing, and the
      // settle pass then reads an old hard refusal (stale geometry, say) as
      // this render's and draws a CPU picture for an ordinary supersession.
      return refuse("superseded-during-render");
    }
    if (verdict.recoverable && !verdict.disabled) {
      // Section 5.8: keep the device and the accepted frame. A retryable
      // transport or allocation failure is re-dispatched within a bounded
      // budget; a validation failure only counts toward the sticky threshold.
      console.warn(`WebGPU authoring render failed (${verdict.kind}); keeping the accepted frame.`, error);
      state.gpuPreview.detail = `${verdict.kind} failure: ${verdict.detail}`;
      state.displayInfo.gpu = state.gpuPreview.detail;
      renderReadouts();
      if (verdict.retryable && state.gpuRenderRetries < 2) {
        state.gpuRenderRetries += 1;
        window.setTimeout(() => {
          if (state.session) settlePreview(lane).catch(() => null);
        }, 250);
      }
      return false;
    }
    console.warn("WebGPU authoring render failed permanently; using raw CPU preview.", error);
    state.gpuPreview.available = false;
    setGpuSurfaceHdr(lane, false);
    state.gpuPreview.detail = `${verdict.kind} failure: ${verdict.detail}`;
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    return false;
  }
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

function activePreviewElement() {
  if (els.chromeProofImage?.style.display !== "none") return els.chromeProofImage;
  return els.previewCanvas.style.display !== "none" ? els.previewCanvas : els.previewImage;
}

/**
 * The part of the presented canvas the viewer can actually see, in output
 * pixels, or null when the whole frame is visible (Fit).
 *
 * Measured from the mounted canvas and the scrolling dropzone rather than from
 * the zoom model, so centering, scroll position, comparison layouts and any
 * future transform are all accounted for by construction. Returning null for a
 * fully visible frame is deliberate: a Fit viewport has no offscreen tiles to
 * skip and must keep the whole-frame path.
 */
function visibleOutputRect(outputWidth, outputHeight) {
  if (!previewIsVisible()) return null;
  const width = Math.max(1, Math.floor(Number(outputWidth) || 0));
  const height = Math.max(1, Math.floor(Number(outputHeight) || 0));
  const canvas = els.previewCanvas;
  const box = canvas.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  const viewport = els.dropzone.getBoundingClientRect();
  const left = Math.max(box.left, viewport.left);
  const top = Math.max(box.top, viewport.top);
  const right = Math.min(box.right, viewport.right);
  const bottom = Math.min(box.bottom, viewport.bottom);
  if (right <= left || bottom <= top) return null;
  const scaleX = width / box.width;
  const scaleY = height / box.height;
  const x = Math.max(0, Math.floor((left - box.left) * scaleX));
  const y = Math.max(0, Math.floor((top - box.top) * scaleY));
  const visibleWidth = Math.min(width - x, Math.ceil((right - left) * scaleX));
  const visibleHeight = Math.min(height - y, Math.ceil((bottom - top) * scaleY));
  if (!(visibleWidth > 0 && visibleHeight > 0)) return null;
  if (x === 0 && y === 0 && visibleWidth >= width && visibleHeight >= height) return null;
  return { x, y, width: visibleWidth, height: visibleHeight };
}

function previewIsVisible() {
  return Boolean(state.session && activePreviewElement().style.display !== "none");
}

async function safeJson(response) {
  return projectIo.safeJson(response);
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

function invalidatePreview(lane, { local = false, markDirty = true } = {}) {
  if (markDirty && !local) markGlobalEditDirty();
  // A newer edit makes the pending catch-up obsolete; it would render the old
  // generation into the frame. The same is true of the deferred pan pass: its
  // newly exposed strip belongs to the generation the edit just replaced.
  // The coordinator bumps the generation and cancels both follow-ups; the
  // mirror keeps every existing reader of previewGeneration valid.
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    coordinator.noteEdit(lane, {
      preserveInteractive: Boolean(state.previewScheduler?.interacting)
        && Boolean(state.denoise?.[lane]?.enabled),
    });
    state.previewGeneration[lane] = coordinator.generation(lane, "edit");
  } else {
    cancelRoiCatchUp();
    cancelRoiPanRefinement();
    state.previewGeneration[lane] += 1;
  }
  if (lane === state.currentView && state.overlayPresented
    && state.overlayPresented.generation !== state.previewGeneration[lane]) {
    // The old overlay remains fully composited while its replacement renders.
    // Dimming here made every slider input look like the overlay toggled off.
    els.previewOverlay.dataset.stale = "true";
  }
  window.HDRProofing?.invalidate(lane);
  renderCompareStatus();
  updateExportAvailability();
  // The generation bump is what moves the viewer to Updating. Reporting it
  // here is what keeps that feedback inside the 100 ms acceptance target,
  // rather than waiting for the render that follows.
  if (lane === state.currentView) renderViewerStatus();
}

function clearPreviewCache() {
  // Source/project replacement must retire tool transactions, without copying
  // their old snapshots into the newly loaded document.
  state.perspectiveSolveController?.abort();
  state.perspectiveSolveController = null;
  state.perspectiveMode = false;
  clearPerspectiveGpuDraft();
  state.perspectiveApplyOperation = null;
  state.perspectiveFailedDraft = null;
  setPerspectiveStatus("Choose a guide tool or move a slider.", "");
  state.perspectiveDraftGeometry = null;
  state.perspectiveGuides = null;
  state.perspectiveGuidesDirty = false;
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
  // The coordinator retires every lane's tokens, retained-frame facts and
  // deferred follow-ups. Its generations stay monotonic, so work already
  // queued by the browser can never publish into the replacement document.
  state.renderCoordinator?.noteSource(null);
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
    const cached = state.previewCache[lane];
    if (cached?.url) URL.revokeObjectURL(cached.url);
    state.previewCache[lane] = null;
    state.previewGeneration[lane] = state.renderCoordinator
      ? state.renderCoordinator.generation(lane, "edit")
      : 0;
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
    const cachedProcessedEdge = cached.requestedLongEdge || cached.longEdge;
    acceptPresentation(lane, cachedProcessedEdge >= refinementProxyLongEdge() ? "refinement" : "settled", cached.width, cached.height, state.previewInfoByLane[lane].transport, "CPU/backend", null, cached.generation, null, cachedProcessedEdge, cached.scopePeak);
  }
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
  if (lane === state.currentView && !state.comparePeekActive
    && (cached.requestedLongEdge || cached.longEdge || 0) < refinementProxyLongEdge()) {
    debouncePreview(lane);
  }
  return true;
}

/**
 * Whether the editor is actually idle.
 *
 * The inactive lane's preparation is a whole-frame proxy upload for a lane
 * nobody is looking at. `requestIdleCallback` fires on any quiet moment in the
 * event loop, including the gap between a settled frame and the refinement
 * that is about to follow it. This gate is the app's own answer: no draft in
 * flight, no gesture, and no pass queued or running for either lane.
 */
function previewIdleNow() {
  if (!state.session || state.gpuDraftInFlight || geometryDraftActive()) return false;
  if (state.previewScheduler?.interacting) return false;
  const coordinator = state.renderCoordinator;
  if (coordinator) {
    for (const lane of ["hdr", "sdr"]) {
      const laneState = coordinator.state(lane);
      if (laneState.inFlight || laneState.pending
        || laneState.panTimerPending || laneState.catchUpTimerPending) return false;
    }
  }
  return true;
}

function prepareInactivePreview({ immediate = false } = {}) {
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
  // An explicit comparison gesture runs now; the automatic path waits for
  // true idle so a background lane cannot compete with the edit on screen.
  if (immediate) {
    if (!state.inactiveSourceController) {
      void preloadInactiveLane(other, state.previewGeneration[other]);
    }
    return;
  }
  state.previewScheduler?.scheduleInactive(other, state.previewGeneration[other], previewIdleNow);
}

async function preloadInactiveLane(lane, generation) {
  if (!state.session || generation !== state.previewGeneration[lane] || !state.gpuPreview?.available) return;
  if (state.compareLayout !== "single" && lane !== state.currentView) {
    await renderComparisonPreview(lane);
    return;
  }
  const controller = new AbortController();
  state.inactiveSourceController?.abort();
  state.inactiveSourceController = controller;
  try {
    await state.gpuPreview.loadProxy(
      state.session.session_id,
      lane,
      settledProxyLongEdge(),
      geometrySignature(),
      state.editRevision,
      "source",
      { signal: controller.signal, isCurrent: () => !controller.signal.aborted
        && generation === state.previewGeneration[lane] },
    );
    if (controller.signal.aborted || generation !== state.previewGeneration[lane]) return;
    state.gpuPreparedLane[lane] = true;
    renderCompareStatus();
    // A held comparison gesture asked for this lane before it was ready.
    // Complete the peek now, while the user is still holding.
    if (state.comparePendingPeek && state.compareHeld
      && state.compareLayout === "single" && !state.comparePeekActive
      && lane !== state.currentView) {
      state.comparePendingPeek = false;
      await peekOtherLane();
    }
  } catch (error) {
    if (!controller.signal.aborted) console.debug("Inactive GPU lane preparation skipped.", error);
  } finally {
    if (state.inactiveSourceController === controller) state.inactiveSourceController = null;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

renderSessionChrome();
renderCurveChannelTabs();
