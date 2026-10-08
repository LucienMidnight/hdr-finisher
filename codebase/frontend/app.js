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

function gpuPreviewEligible(lane = state.currentView) {
  return state.renderingMode !== "cpu"
    && Boolean(state.gpuPreview?.available)
    && state.gpuPreview.supportsLocalAdjustments(lane, state.compareWithoutLocals ? [] : localAdjustments());
}

/** @returns {PreviewResolution} */
function normalizedPreviewResolution(value = state.previewResolution) {
  const normalized = String(value || "");
  return PREVIEW_RESOLUTION_OPTIONS.has(normalized) ? normalized : DEFAULT_PREVIEW_RESOLUTION;
}

function previewResolutionLabel(value = state.previewResolution) {
  if (value === "display") return state.zoomMode === "custom" && state.zoomPercent >= 100
    ? "Native region exact" : "Display exact";
  if (value === "native-region") return "Native region";
  const normalized = normalizedPreviewResolution(value);
  if (normalized === "full") return "Full";
  return `${Math.round(Number(normalized) / 1024)}K`;
}

function previewTargetLongEdge(value = state.previewResolution) {
  const normalized = normalizedPreviewResolution(value);
  const sourceEdge = Math.max(Number(state.session?.source?.width) || 0, Number(state.session?.source?.height) || 0);
  if (normalized === "full") return Math.max(256, sourceEdge || 256);
  const requested = Number(normalized);
  return Math.max(256, Math.min(sourceEdge || requested, requested));
}

function requiredProcessingLongEdge() {
  if (state.previewResolutionOverride === false) {
    const nativeEdge = previewTargetLongEdge("full");
    const edge = state.zoomMode !== "custom" ? displayedLongEdge()
      : state.zoomPercent >= 100 ? nativeEdge : steppedProcessingLongEdge(nativeEdge, displayedLongEdge());
    return Math.round(Math.max(256, Math.min(nativeEdge, edge)));
  }
  return state.zoomMode === "custom" && state.zoomPercent >= 100
    ? previewTargetLongEdge("full")
    : previewTargetLongEdge();
}

/**
 * The size a magnified view below 100% is processed at: the smallest of a few
 * fixed sizes (the source's long edge divided by powers of the square root of
 * two) that still covers what is displayed.
 *
 * Every distinct processing size is a resized copy of the whole source in the
 * backend and a fresh set of masks and luminance on the GPU. A wheel zoom
 * lands on arbitrary percentages, and each one used to pay all of that; at
 * 98% it built a copy barely smaller than the source itself. The steps are
 * shared by every percentage in their range, and the view is scaled from the
 * step to the screen, which at most doubles the pixels processed.
 */
function steppedProcessingLongEdge(nativeEdge, displayedEdge) {
  let edge = nativeEdge;
  for (let step = 1; step <= 16; step += 1) {
    const next = Math.round(nativeEdge / 2 ** (step / 2));
    if (next < displayedEdge || next < 1024) break;
    edge = next;
  }
  return edge;
}

function previewResolutionDimensions(value = state.previewResolution) {
  if (value === state.previewResolution && state.previewResolutionOverride === false) value = "display";
  if (value === "display") {
    const edge = requiredProcessingLongEdge();
    const sourceWidth = Math.max(1, Number(state.session?.source?.width) || edge);
    const sourceHeight = Math.max(1, Number(state.session?.source?.height) || edge);
    const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
    return { width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)), longEdge: edge, tier: "display" };
  }
  const normalized = normalizedPreviewResolution(value);
  const sourceWidth = Math.max(0, Number(state.session?.source?.width) || 0);
  const sourceHeight = Math.max(0, Number(state.session?.source?.height) || 0);
  if (!(sourceWidth > 0 && sourceHeight > 0)) {
    const edge = previewTargetLongEdge(normalized);
    return { width: edge, height: edge, longEdge: edge, tier: normalized };
  }
  if (normalized === "full") {
    return { width: sourceWidth, height: sourceHeight, longEdge: Math.max(sourceWidth, sourceHeight), tier: normalized };
  }
  const longEdge = previewTargetLongEdge(normalized);
  const scale = Math.min(1, longEdge / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    longEdge,
    tier: normalized,
  };
}

function previewExecutionForTier(value = state.previewResolution) {
  if (state.previewResolutionOverride === false && value === state.previewResolution) {
    return requiredProcessingLongEdge() >= previewTargetLongEdge("full") ? "strips" : "whole";
  }
  return normalizedPreviewResolution(value) === "full" ? "strips" : "whole";
}

function previewNeedsRefinement() {
  const accepted = state.acceptedPresentation;
  return !selectedTierReady()
    || accepted?.generation !== state.previewGeneration[state.currentView]
    || accepted?.geometrySignature !== geometrySignature()
    || accepted?.processedLongEdge !== requiredProcessingLongEdge();
}

/**
 * @typedef {"ready"|"updating"|"preparing"|"unavailable"} ViewerStatus
 */

/**
 * The four viewer states are derived, never stored. A stored status drifts out
 * of agreement with the image on screen; a derived one is always a statement
 * about the presentation the viewer can actually see.
 *
 * `detail` says why the viewer is not Ready: the reason it is unavailable,
 * or "geometry" when what is outstanding is a crop or rotation rather than a
 * grading change. Both are derived from the same snapshot; neither is stored.
 *
 * @returns {{ status: ViewerStatus, tier: PreviewResolution, presentedTier: PreviewResolution|null, detail: string }}
 */
function deriveViewerState({
  requestedTier,
  accepted,
  currentGeneration,
  lane,
  geometrySignature: currentGeometrySignature,
  requiredProcessingEdge = null,
  unavailableReason = "",
} = {}) {
  const tier = requestedTier === "display" ? "display"
    : PREVIEW_RESOLUTION_OPTIONS.has(requestedTier) ? requestedTier : DEFAULT_PREVIEW_RESOLUTION;
  const laneMatches = Boolean(accepted) && accepted.lane === lane;
  const presentedTier = laneMatches ? (accepted.tier || null) : null;
  if (unavailableReason) return { status: "unavailable", tier, presentedTier, detail: unavailableReason };
  // The selected tier owns the viewer only once it has produced an exact
  // result of its own. Anything else is still a placeholder, however good it
  // looks, and must be labeled as one.
  const selectedTierAccepted = laneMatches && accepted.exact === true && accepted.requestedTier === tier;
  if (!selectedTierAccepted) return { status: "preparing", tier, presentedTier, detail: "",
    coarse: Boolean(laneMatches && accepted.coarse && accepted.generation === currentGeneration) };
  const geometryCurrent = accepted.geometrySignature === currentGeometrySignature;
  const scaleCurrent = requiredProcessingEdge == null
    || accepted.processedLongEdge === requiredProcessingEdge;
  const current = accepted.generation === currentGeneration && geometryCurrent && scaleCurrent;
  // A geometry change is the slow one -- it invalidates the source proxy, so
  // the whole frame is fetched and re-rolled rather than re-graded. Saying so
  // is the difference between a viewer that looks busy and one that looks
  // stuck.
  return { status: current ? "ready" : "updating", tier, presentedTier,
    detail: !geometryCurrent ? "geometry" : !scaleCurrent ? "scale" : "" };
}

function viewerState(lane = state.currentView) {
  return deriveViewerState({
    requestedTier: state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution(),
    accepted: state.acceptedPresentation,
    currentGeneration: state.previewGeneration[lane],
    lane,
    geometrySignature: geometrySignature(),
    requiredProcessingEdge: requiredProcessingLongEdge(),
    unavailableReason: state.previewUnavailableReason || "",
  });
}

function viewerStatusLabel(viewer = viewerState()) {
  const tierLabel = previewResolutionLabel(viewer.tier);
  if (viewer.status === "unavailable") {
    return `${tierLabel} unavailable${viewer.detail ? ` — ${viewer.detail}` : ""}`;
  }
  if (viewer.status === "preparing") {
    if (viewer.coarse) return `Coarse — refining to ${tierLabel}`;
    const showing = viewer.presentedTier
      ? ` — showing previous ${previewResolutionLabel(viewer.presentedTier)} result`
      : "";
    return `Preparing ${tierLabel}${showing}`;
  }
  if (viewer.status === "updating") {
    if (viewer.detail === "geometry") return `Applying crop & rotation — ${tierLabel}`;
    if (viewer.detail === "scale") return `Preparing view — ${tierLabel}`;
    return `Updating — ${tierLabel}`;
  }
  return `Ready — ${tierLabel}`;
}

function renderViewerStatus() {
  const viewer = viewerState();
  const label = state.perspectiveApplyOperation && state.perspectivePhase === "applying"
    ? `Applying perspective — ${previewResolutionLabel(viewer.tier)}`
    : state.perspectiveMode ? "Perspective draft — Apply or Cancel" : viewerStatusLabel(viewer);
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = label;
  // Ready is the quiet state. Active viewer work occupies the same fixed status
  // slot as import/render progress instead of opening a second row beneath it.
  state.viewerTierStatusEntry = viewer.status === "ready" && !state.perspectiveMode
    && !(state.perspectiveApplyOperation && state.perspectivePhase === "applying") ? null : {
    nodeId: "viewer-tier-status",
    severity: viewer.status === "unavailable" ? "error" : "progress",
    message: label,
  };
  syncViewerStatusEntry();
  return viewer;
}

function selectedTierReady(lane = state.currentView) {
  // PRD 2.2: after the selected tier has produced a valid result, interaction
  // keeps processing at that resolution. It never drops to a smaller proxy and
  // then jumps back up once the control settles.
  const accepted = state.acceptedPresentation;
  return Boolean(accepted
    && accepted.lane === lane
    && accepted.exact === true
    && accepted.requestedTier === (state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution()));
}

function applyPreviewResolution(value, { schedule = true } = {}) {
  const previous = `${state.previewResolutionOverride}:${state.previewResolution}`;
  state.previewResolutionOverride = value !== "auto";
  if (state.previewResolutionOverride) state.previewResolution = normalizedPreviewResolution(value);
  if (previous !== `${state.previewResolutionOverride}:${state.previewResolution}`) state.previewUnavailableReason = "";
  if (previous !== `${state.previewResolutionOverride}:${state.previewResolution}`) {
    // The denoise selector is bound to one long edge -- its identity contains
    // it -- and the renderer pins every render to the retained original's edge
    // so that live denoise controls keep hitting the evidence they were
    // analysed against. That pin outranks the requested tier, so leaving a
    // selector from the outgoing tier in place made this selector inert: the
    // renderer was asked for 1024 and kept returning the 7968 frame, while the
    // viewer reported "Ready - 1K" over it.
    //
    // A tier change invalidates a resolution-bound cache by definition, the
    // same way a lane change does where renderPreviewForLane already evicts.
    state.gpuPreview?.evictDenoiseCache?.();
  }
  // PRD 8: changing tiers must not reset the GPU session or clear the current
  // preview. Proxy levels are keyed by long edge and trimmed by the renderer's
  // own LRU, so the outgoing tier is retired only when the budget requires it.
  if (state.denoise?.[state.currentView]?.enabled) {
    state.denoiseRuntime[state.currentView].status = "dirty";
    state.denoiseRuntime[state.currentView].dirty = true;
    if (schedule) window.setTimeout(() => recalculateDenoise(), 300);
  }
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    if (schedule) debouncePreview(state.currentView);
  }
  renderReadouts();
  renderCurrentPreviewSize();
  renderViewerStatus();
}

function acceptPresentation(lane, schedulerTier, width, height, transport, fallbackReason = "", sourceSerial = null, generation = state.previewGeneration[lane], execution = null, processedLongEdge = null, scopePeak = null, coarse = false) {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  const requestedTier = state.previewResolutionOverride === false ? "display" : normalizedPreviewResolution();
  // Exactness is a fact about the resolution this frame was processed at, not
  // about how large the picture that came out of it is. Geometry trims the
  // frame: a 1.8 degree straighten at the 4K tier processes every pixel at
  // 4096 and presents 4011. Judging by the presented edge therefore left any
  // straightened or cropped image permanently "Preparing", dropped every
  // gesture back to the bootstrap proxy, and missed the preview cache on each
  // request -- all three of the symptoms reported for a tier change.
  const processedEdge = Number(processedLongEdge) > 0 ? Number(processedLongEdge) : longEdge;
  // `tier` is what this image actually is, not what the user asked for. A
  // bootstrap proxy accepted while the selected tier is still preparing must
  // never be labeled with the selected tier.
  //
  // The test is equality, not "at least". A frame processed above the selected
  // tier is not that tier either: selecting 1K while a Full frame is resident
  // used to satisfy `>=` and report "Ready - 1K" over 7968 pixels of Full.
  // Someone who picks a smaller tier is asking for less work, and saying it
  // happened when it did not is the same lie in the other direction. If a
  // render ever does overshoot, this reports Preparing and the scheduler
  // renders the tier properly, which self-heals instead of misreporting.
  const exact = longEdge > 0 && processedEdge === requiredProcessingLongEdge();
  // The size a Fit view was last processed at: the mask bitmaps of that size
  // are the ones every zoom level reuses (see maskOverviewLongEdge).
  if (state.zoomMode === "fit" && exact) state.fitProcessingLongEdge = processedEdge;
  state.acceptedPresentation = {
    lane,
    generation,
    geometrySignature: geometrySignature(),
    requestedTier,
    tier: exact ? (requestedTier === "display" ? "display"
      : processedEdge === previewTargetLongEdge(requestedTier) ? requestedTier : "native-region") : null,
    exact,
    coarse: Boolean(coarse) && !exact,
    processedLongEdge: processedEdge,
    schedulerTier,
    width: Number(width) || null,
    height: Number(height) || null,
    longEdge,
    transport,
    execution,
    sourceSerial,
    scopePeak: Number.isFinite(scopePeak) ? scopePeak : null,
    fallbackReason,
  };
  // Start the source's measurement once a picture is visible, before Denoise
  // is enabled or the first zoom asks for it. No source upload or reconstruction.
  if (transport === "WebGPU" && state.gpuPreview?.warmDenoiseModel) {
    const native = Math.max(state.session?.source?.width || 0, state.session?.source?.height || 0);
    void state.gpuPreview?.warmDenoiseModel?.(state.session.session_id, "hdr", native);
  }
  if (exact) state.previewUnavailableReason = "";
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
  renderCurrentPreviewSize();
  renderReadouts();
  finishPerspectivePresentation();
  renderViewerStatus();
  // The coordinator keeps the same record, so its follow-up decisions (pan
  // candidate, catch-up freshness) read one source of truth.
  state.renderCoordinator?.noteAccepted(state.acceptedPresentation);
}

function markPreviewUnavailable(reason) {
  if (state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus(`Perspective saved, but the preview failed: ${reason}. Change preview tier or try again.`, "previewFailed");
  }
  // Unavailable keeps the last valid presentation on screen. It reports that
  // the selected tier could not be produced; it never blanks the viewer.
  state.previewUnavailableReason = String(reason || "").trim() || "Preview failed to render";
  // A geometry commit normally hands its temporary CSS transform to the first
  // accepted authoritative frame. If this tier is truthfully unavailable,
  // that frame will never arrive. End the handoff here so the retained last
  // frame remains usable and the user can select another tier or keep editing.
  if (state.geometryTransformHandoffSignature === geometrySignature()) {
    state.geometryTransformHandoffSignature = null;
    state.geometryPresentationPending = false;
    clearRotateDraftTransformProperties();
    clearInteractiveStraightenPreview();
    applyZoomGeometry();
  }
  renderCurrentPreviewSize();
  renderReadouts();
  renderViewerStatus();
}

function markRefining() {
  renderCurrentPreviewSize();
  renderViewerStatus();
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

function interactiveDraftGuaranteedTiled(lane = state.currentView) {
  const accepted = state.acceptedPresentation;
  // An edit bumps the generation before this prediction runs. The previous
  // exact frame still describes the same viewport and allocation footprint.
  if (!state.gpuPreview?.available || accepted?.lane !== lane
    || accepted.geometrySignature !== geometrySignature()
    || accepted.processedLongEdge !== requiredProcessingLongEdge()
    || !(accepted.width > 0 && accepted.height > 0)) return false;
  return accepted.execution === "tiled" || state.gpuPreview.minimumExecutionDecision(
    accepted.width,
    accepted.height,
    state.previewResolutionOverride ? normalizedPreviewResolution() : "display",
  )?.mode === "tiled";
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
  const technical = readoutDockTab(state.activeDockTab);
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  renderReadoutPanelMode(state.activeDockTab);
  if (technical) {
    els.scopeMode.value = state.activeDockTab;
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

/**
 * Technical and Diagnostics are readouts, not scopes; they share one panel.
 *
 * Technical is a short
 * plain-language list that fits the panel at its minimum height. Diagnostics
 * is the full list it used to be.
 */
function readoutDockTab(tab) {
  return tab === "technical" || tab === "diagnostics";
}

function renderReadoutPanelMode(tab) {
  els.technicalSummary?.classList.toggle("hidden", tab === "diagnostics");
  els.technicalDiagnostics?.classList.toggle("hidden", tab !== "diagnostics");
}

function renderScopeControlAvailability() {
  const technical = state.scopeMode === "technical" || readoutDockTab(state.activeDockTab);
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

function claimSessionReplacement() {
  state.projectOpenGeneration += 1;
  state.projectOpenController?.abort();
  state.projectOpenController = null;
  return ++state.importGeneration;
}

async function importByteFile(file, actionLabel = "import another source", confirmedDocument = null, ownershipGeneration = null) {
  if (confirmedDocument === null) {
    if (!await confirmUnsavedTransition(actionLabel)) return false;
    confirmedDocument = documentTransitionToken();
  } else if (documentTransitionToken() !== confirmedDocument) {
    if (!await confirmUnsavedTransition(actionLabel)) return false;
    confirmedDocument = documentTransitionToken();
  }
  return uploadFile(file, { confirmedDocument, ownershipGeneration });
}

async function uploadFile(file, { confirmedDocument = documentTransitionToken(), ownershipGeneration = null } = {}) {
  const generation = ownershipGeneration ?? claimSessionReplacement();
  if (generation !== state.importGeneration) return false;
  const activeJobId = state.activeImportJobId;
  state.activeImportJobId = null;
  if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
  if (generation !== state.importGeneration) return false;
  const previousUpload = state.byteUploadQueue;
  let releaseUpload;
  state.byteUploadQueue = new Promise((resolve) => { releaseUpload = resolve; });
  await previousUpload.catch(() => null);
  if (generation !== state.importGeneration) {
    releaseUpload();
    return false;
  }
  if (documentTransitionToken() !== confirmedDocument && !await confirmUnsavedTransition("import another source")) {
    releaseUpload();
    return false;
  }
  renderExperimentalDngNote(file);
  const formData = new FormData();
  formData.append("file", file);
  status.post({ id: "import", severity: "progress", message: "Loading image and building session…", progress: "indeterminate" });
  state.importInProgress = true;
  updateExportAvailability();
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
    const { response, payload } = await projectIo.uploadSource(fetch, formData);
    if (generation !== state.importGeneration) return false;
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return false;
    }
    retireActiveSession();
    state.session = payload.session;
    state.renderCoordinator?.noteSource(payload.session.session_id);
    if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
    setPreviewMessage("Source decoded. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    recordAcknowledgedLocals(state.editDocument);
    state.documentDirty = Boolean(payload.session.dirty);
    state.selectedLocalId = null;
    state.projectPath = "";
    state.currentView = "hdr";
    await applyNewSessionPreferences();
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    activateWorkflowTab("grade", { focus: false });
    state.interpretationGateDismissed = false;
    state.gpuPreview?.resetSession(payload.session.session_id);
    invalidatePreview("hdr", { markDirty: false });
    invalidatePreview("sdr", { markDirty: false });
    renderSession();
    renderLocalAdjustments();
    seedExportFieldsFromSession();
    const gpuReady = await renderGpuDraft("hdr", { hideStatus: false, longEdge: settledProxyLongEdge() });
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    await Promise.all([
      gpuReady ? Promise.resolve(true) : refreshPreview({ progressSteps: [36, 76, 92] }),
      refreshOverlay(),
      refreshScopes(scopeLongEdge("settled"), { tier: "settled" }),
    ]);
    if (generation !== state.importGeneration || state.session?.session_id !== payload.session.session_id) return false;
    hidePreviewMessage();
    prepareInactivePreview();
    if (previewNeedsRefinement()) debouncePreview("hdr");
    status.post({ id: "import", severity: "success", message: "Source imported." });
    return true;
  } catch (error) {
    if (generation !== state.importGeneration) return false;
    console.error(error);
    // The upload response can be lost after the backend has already activated
    // the new session. Reconcile with backend truth before reporting failure so
    // the frontend never continues editing a session whose owned source was
    // retired by a completed upload.
    const currentResult = await projectIo.fetchCurrentSession(fetch).catch(() => null);
    const currentResponse = currentResult?.response;
    const currentPayload = currentResult?.payload;
    if (
      generation === state.importGeneration
      && currentResponse?.ok
      && currentPayload?.session
      && currentPayload.session.session_id !== state.session?.session_id
    ) {
      await activateDesktopSession(currentPayload.session, "");
      hidePreviewMessage();
      return true;
    }
    showUploadError("The upload could not reach the local HDR Finisher server.");
    return false;
  } finally {
    window.clearInterval(ticker);
    releaseUpload();
    if (generation === state.importGeneration) {
      state.importInProgress = false;
      updateExportAvailability();
    }
  }
}

function showUploadError(message) {
  status.post({ id: "import", severity: "error", message });
  if (state.session) {
    hidePreviewMessage();
    renderSession();
  } else {
    setPreviewError(message);
    clearPreviewImage();
    clearPreviewOverlay();
  }
}

async function ejectCurrentSession() {
  if (!state.session) return;
  if (!await confirmUnsavedTransition("eject the current image")) return;
  const generation = claimSessionReplacement();
  const activeJobId = state.activeImportJobId;
  state.activeImportJobId = null;
  if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
  await state.byteUploadQueue.catch(() => null);
  if (generation !== state.importGeneration) return;
  await projectIo.ejectCurrentSession(fetch).catch(() => null);
  retireActiveSession();
  state.session = null;
  state.renderCoordinator?.noteSource(null);
  renderExperimentalDngNote();
  renderRawImportControls(null);
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = defaultAdjustments();
  state.editDocument = null;
  loadDenoiseDocument(null);
  els.hdrReferenceWhite.value = String(state.appPreferences?.defaultReferenceWhiteNits || 203);
  els.hdrReferenceWhite.disabled = false;
  state.editRevision = 0;
  recordAcknowledgedLocals(null);
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
  syncProjectBadge();
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
  syncProjectBadge();
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

function currentPreviewSizeLabel() {
  const target = previewResolutionLabel(state.previewResolutionOverride ? state.previewResolution : "display");
  const presentation = state.acceptedPresentation;
  if (!presentation?.width || !presentation?.height || presentation.lane !== state.currentView) return `${target} · Waiting`;
  // A presentation that is not yet the selected tier says so. Reporting the
  // selected tier next to a smaller pixel count is the exact misreport the
  // stable-tier contract exists to prevent.
  const qualifier = presentation.exact ? "" : " · placeholder";
  return `${target} · ${presentation.width} × ${presentation.height}${qualifier}`;
}

function renderCurrentPreviewSize(options) {
  const value = document.getElementById("metadata-current-preview-size");
  if (value) value.textContent = currentPreviewSizeLabel(options);
}

function renderReadouts() {
  renderPresentationCapability();
  if (els.technicalPreviewList) {
    const technical = technicalSummaryEntries();
    renderKeyValueList(els.technicalPreviewList, technical.preview);
    renderKeyValueList(els.technicalDisplayList, technical.display);
    renderKeyValueList(els.technicalSourceList, technical.source);
  }
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
    if (state.session) {
      invalidatePreview(state.currentView, { markDirty: false });
      settlePreview(state.currentView).catch(() => null);
    }
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
  if (command === "revert-hdr") return revertRendition("hdr");
  if (command === "revert-sdr") return revertRendition("sdr");
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
      const preferredPreviewResolution = preferences.previewResolution === "auto"
        ? "auto" : normalizedPreviewResolution(preferences.previewResolution);
      const selectablePreviewResolution = preferredPreviewResolution;
      state.fasterDragging = preferences.fasterDragging === true;
      if (els.previewFasterDragging) els.previewFasterDragging.checked = state.fasterDragging;
      if (options.initial) {
        state.previewResolutionOverride = selectablePreviewResolution !== "auto";
        if (state.previewResolutionOverride) state.previewResolution = selectablePreviewResolution;
      } else if (selectablePreviewResolution !== (state.previewResolutionOverride ? state.previewResolution : "auto")) {
        applyPreviewResolution(selectablePreviewResolution);
      }
      applyGpuMemoryBudget(preferences.maximumGpuMemoryGiB);
      applyExecutionOverride(preferences.executionOverride);
      applyRoiPreview(preferences.roiPreview);
      if (options.initial) state.renderingMode = preferences.renderingMode;
      else if (preferences.renderingMode !== state.renderingMode) void applyRenderingMode(preferences.renderingMode);
    },
  });
}

/**
 * Force one execution route, for comparing the two on the same grade.
 *
 * Diagnostic. Direct and Tiled are required to produce identical pixels, so
 * this exists to make that difference observable rather than to give the two
 * routes different jobs. Admission still refuses a forced Direct it cannot
 * hold: a diagnostic switch has no business overriding the memory guard.
 */
function applyExecutionOverride(value) {
  const setting = value === "direct" || value === "tiled" ? value : null;
  state.executionOverride = setting;
  if (state.gpuPreview) state.gpuPreview.executionOverride = setting;
  state.gpuPreview?.clearAllocationBackoff?.();
  renderReadouts();
  // Re-render so the change is visible immediately rather than at the next
  // edit, which is the whole point of a switch you flip to compare routes.
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
}

/**
 * Limit the refinement pass to the visible region, or process the whole frame.
 *
 * Experimental and off by default. Pan and zoom are never limited, so a newly
 * exposed region always has complete pixels; this only decides whether the
 * expensive refinement pass spends its time on tiles the viewer cannot see.
 */
function applyRoiPreview(value) {
  state.roiPreviewMode = value === "refinement" ? "refinement" : "fit";
  state.renderCoordinator?.setRoiMode(state.roiPreviewMode);
  cancelRoiCatchUp();
  cancelRoiPanRefinement();
  renderReadouts();
  if (state.session) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
}

function cancelRoiCatchUp() {
  state.renderCoordinator?.cancelCatchUp(state.currentView);
}

function cancelRoiPanRefinement() {
  state.renderCoordinator?.cancelPan(state.currentView);
}

/**
 * A pan never waits on a render: the compositor moves the accepted frame
 * immediately. What a pan can do is expose a strip that was never refined for
 * the current generation, so once the scroll pauses the coordinator asks for a
 * refinement pass over the new visible region. The renderer's display-scale pan
 * cache answers every tile it already holds at this generation, so panning back
 * into a refined region costs nothing and only a newly exposed strip is
 * rendered. The pass it starts re-arms the whole-frame catch-up, so stopping
 * after a pan still converges the rest of the image.
 */
function noteViewerPan() {
  state.renderCoordinator?.notePan(state.currentView);
}

async function requestRoiPanRefinement() {
  return state.renderCoordinator
    ? state.renderCoordinator.requestPanRefinement(state.currentView)
    : false;
}

/**
 * The legacy-versus-ROI diagnostic A/B path.
 *
 * Renders the same edit both ways at the same tier and compares the visible
 * region pointwise through the frozen request contract. The generation is
 * bumped between the two passes so the ROI pass re-renders the region instead
 * of reusing the legacy pass's accepted tiles; the graph and edit state are
 * identical, so the route is the only difference under test. The tolerance is
 * supplied by the caller because each module's tolerance is
 * still outstanding.
 */
async function runRoiParity(options = {}) {
  const lane = state.currentView;
  if (!state.session) return { ok: false, reason: "no-session" };
  if (!gpuPreviewEligible(lane)) return { ok: false, reason: "gpu-not-eligible" };
  if (geometryDraftActive()) return { ok: false, reason: "geometry-draft-active" };
  if (!state.gpuPreview?.readPresentationRegion) return { ok: false, reason: "no-readback" };
  const longEdge = Number(options.longEdge) > 0 ? Number(options.longEdge) : refinementProxyLongEdge();
  const visible = visibleOutputRect(els.previewCanvas.width, els.previewCanvas.height);
  if (!visible) return { ok: false, reason: "fit-has-no-roi" };
  const capture = () => state.gpuPreview.readPresentationRegion(
    visible.width,
    visible.height,
    visible.x,
    visible.y,
  );
  const accepted = () => {
    const record = state.acceptedPresentation;
    return record
      ? {
        generation: record.generation ?? null,
        execution: record.execution || null,
        processedLongEdge: record.processedLongEdge ?? null,
      }
      : null;
  };

  const legacy = await renderGpuDraft(lane, { tier: "refinement", longEdge, viewport: false });
  if (!legacy) return { ok: false, reason: "legacy-render-refused", refusal: state.lastGpuDraftRefusal };
  const legacyPixels = await capture();
  if (!legacyPixels) return { ok: false, reason: "legacy-readback-failed" };
  const legacyAccepted = accepted();

  // A newer generation forces the ROI pass to re-render the region rather than
  // reuse the legacy pass's tiles. The graph and edit state are unchanged.
  invalidatePreview(lane, { markDirty: false });
  const roi = await renderGpuDraft(lane, { tier: "refinement", longEdge });
  if (!roi) return { ok: false, reason: "roi-render-refused", refusal: state.lastGpuDraftRefusal };
  const roiPixels = await capture();
  if (!roiPixels) return { ok: false, reason: "roi-readback-failed" };
  const roiAccepted = accepted();

  const comparison = window.HDRViewportRequest?.compareWithLegacy
    ? window.HDRViewportRequest.compareWithLegacy({
      roiPixels: roiPixels.values,
      legacyPixels: legacyPixels.values,
      roiRect: { x: 0, y: 0, width: roiPixels.width, height: roiPixels.height },
      legacyRect: { x: 0, y: 0, width: legacyPixels.width, height: legacyPixels.height },
      roiWidth: roiPixels.width,
      legacyWidth: legacyPixels.width,
      channels: 4,
      tolerance: Number(options.tolerance) || 0,
    })
    : null;
  return {
    ok: true,
    visible,
    longEdge,
    legacy: { ...legacyAccepted, pixels: { width: legacyPixels.width, height: legacyPixels.height } },
    roi: { ...roiAccepted, pixels: { width: roiPixels.width, height: roiPixels.height } },
    comparison,
  };
}

function applyGpuMemoryBudget(value) {
  // PRD 4.2: the budget decides Direct versus Tiled execution and cache
  // eviction. It never decides whether a resolution option is visible, so
  // nothing here touches the preview-resolution selector.
  const setting = value === "auto" || value === undefined || value === null ? "auto" : value;
  const previousBytes = state.gpuPreview?.memoryBudgetBytes?.() ?? null;
  state.gpuMemoryBudget = setting;
  const bytes = state.gpuPreview?.setMemoryBudget?.(setting)
    ?? window.HDRWebGPUPreview?.normalizeGpuBudgetBytes?.(setting)
    ?? null;
  // A larger budget can re-admit Direct execution that an earlier allocation
  // failure backed off from, so let the next render re-plan from scratch.
  state.gpuPreview?.clearAllocationBackoff?.();
  renderReadouts();
  // A new budget can change the route. Re-plan and re-render the current view
  // now, so the readout never shows a route that the next edit would change.
  if (state.session && state.gpuPreview?.available && bytes !== previousBytes) {
    invalidatePreview(state.currentView, { markDirty: false });
    debouncePreview(state.currentView);
  }
  return bytes;
}

/** Settings shows what Auto means on this machine, not a fixed number. */
function renderGpuMemoryAutoLabel() {
  const option = document.querySelector('#settings-gpu-memory-limit option[value="auto"]');
  const calibration = state.gpuPreview?.gpuBudget || null;
  if (option && calibration && window.HDRGpuBudget?.autoLabel) {
    option.textContent = window.HDRGpuBudget.autoLabel(calibration);
  }
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

function previewExecutionMode() {
  // The four modes in PRD 8. Execution is a renderer decision; it is tracked
  // separately from the tier so neither can be read off the other.
  const accepted = state.acceptedPresentation;
  const gpu = accepted ? accepted.transport === "WebGPU" : Boolean(state.gpuPreview?.available);
  const tiled = accepted ? accepted.execution === "tiled" : state.gpuPreview?.lastRenderPlan?.decision?.mode === "tiled";
  if (!gpu) return "direct-cpu";
  return tiled ? "tiled-gpu" : "direct-gpu";
}

function previewExecutionLabel() {
  const execution = previewExecutionMode();
  const engine = execution === "direct-cpu" ? "CPU" : "GPU";
  const mode = execution === "tiled-gpu" ? "Tiled" : "Direct";
  const budget = state.gpuMemoryBudget === "auto" || state.gpuMemoryBudget === undefined
    ? (window.HDRGpuBudget?.autoLabel?.(state.gpuPreview?.gpuBudget) || "Auto")
    : `${state.gpuMemoryBudget} GiB`;
  if (engine !== "GPU") return `Direct CPU · budget ${budget}`;
  const backoff = state.gpuPreview?.allocationBackoff ? " · allocation backoff" : "";
  return `${mode} GPU · budget ${budget}${backoff}`;
}

/**
 * The Technical readout: what the preview is showing and why, in plain words.
 *
 * Thirteen rows chosen by the owner (ledger 9.6). Everything else, including
 * generations, caches and the controller's state, lives under Diagnostics.
 */
function technicalSummaryEntries() {
  const viewer = viewerState();
  const accepted = state.acceptedPresentation;
  const lane = state.currentView === "sdr" ? "SDR" : "HDR";
  const zoom = state.zoomMode === "fit" ? "Fit" : `${Math.round(state.zoomPercent)}%`;
  const status = viewer.status === "ready" ? "Ready"
    : viewer.status === "unavailable" ? `Unavailable${viewer.detail ? ` — ${viewer.detail}` : ""}`
      : viewer.coarse ? "Coarse — sharpening"
        : viewer.status === "updating" ? "Updating" : "Preparing";
  const detail = !state.session || !accepted ? "Waiting"
    : accepted.exact ? "Full detail"
      : accepted.coarse ? "Softer while dragging" : "Placeholder";
  const setting = state.fasterDragging ? " · faster dragging on" : "";
  const execution = previewExecutionMode();
  const route = execution === "direct-cpu" ? "On the processor (CPU)" : execution === "tiled-gpu" ? "In tiles" : "Whole image";
  const memory = state.gpuMemoryBudget === "auto" || state.gpuMemoryBudget === undefined
    ? (window.HDRGpuBudget?.autoLabel?.(state.gpuPreview?.gpuBudget) || "Auto")
    : `${state.gpuMemoryBudget} GiB`;
  const presentation = state.presentationCapability || presentationCapabilityState();
  const display = state.desktopEnvironment?.currentDisplay;
  const preview = [
    ["View", `${lane} · ${zoom}`],
    ["Status", status],
    ["Detail", `${detail}${setting}`],
    ["Processing", `${route} · memory ${memory}`],
  ];
  const displayRows = [
    ["HDR on this display", presentation.qualified ? "Yes" : "No · SDR simulation"],
    ["Monitor", display?.label || "This display"],
  ];
  if (!state.session) {
    return { preview, display: displayRows, source: [
      ["File", "No image open"], ["Interpretation", "—"], ["Encoding", "—"], ["Signal", "—"],
      ["Source peak", "—"], ["Reference white", `${projectReferenceWhiteNits()} nit`], ["Bit depth", "—"],
    ] };
  }
  const source = state.session.source;
  const luminance = state.editDocument?.source?.luminance || {};
  const mode = source.interpretation_mode === "manual" ? "Manual" : "Auto";
  return {
    preview,
    display: displayRows,
    source: [
      ["File", source.filename || source.suffix || "—"],
      ["Interpretation", isDevelopedRawSession(state.session) ? `${mode} · camera RAW profile` : mode],
      ["Encoding", source.source_color_space || source.transfer_function
        ? `${source.source_color_space || "Unknown colours"} · ${source.transfer_function || "unknown curve"}`
        : "Not declared by the file"],
      ["Signal", {
        HDR_TRUE: "HDR",
        HDR_ENCODED: "HDR-encoded file",
        HDR_LINEAR_UNCONFIRMED: "Linear, HDR not confirmed",
        SDR_ONLY: "SDR",
      }[state.session.analysis?.classification] || state.session.analysis?.classification || "—"],
      ["Source peak", luminance.source_peak_nits ? `${luminance.source_peak_nits} nit` : "Not declared"],
      ["Reference white", `${projectReferenceWhiteNits()} nit`],
      ["Bit depth", String(state.session.metadata?.bit_depth || "Unknown")],
    ],
  };
}

function previewOutputEntries() {
  const target = previewResolutionDimensions();
  const live = state.acceptedPresentation?.execution === "tiled"
    ? state.gpuPreview?.tiledExecutionMetrics || null : null;
  const viewport = state.renderCoordinator?.state(state.currentView)?.viewport || null;
  return [
    ["View", state.currentView.toUpperCase()],
    ["Rendering", state.renderingMode === "cpu" ? "CPU Compatibility" : state.renderingMode === "gpu" ? "GPU Preferred" : "Auto"],
    ["Preview Target", `${previewResolutionLabel(state.previewResolutionOverride ? state.previewResolution : "display")} · ${target.width} × ${target.height}`],
    ["Faster dragging", state.fasterDragging ? "On · softer while dragging" : "Off · full detail while dragging"],
    ["Legacy override", state.previewResolutionOverride ? previewResolutionLabel() : "Off"],
    ["Controller", JSON.stringify(state.previewLatencyController?.snapshot()?.decisions || {})],
    ["Viewport", viewport ? `${viewport.x},${viewport.y} · ${viewport.width} × ${viewport.height}` : "Fit"],
    ["Processing scale", live?.processingScale ?? (state.session
      ? (requiredProcessingLongEdge() / Math.max(state.session.source.width, state.session.source.height)).toFixed(3) : "Waiting")],
    ["Source mip", `${state.acceptedPresentation?.processedLongEdge || target.longEdge}px`],
    ["Generation", `${state.acceptedPresentation?.generation ?? "—"} / ${state.previewGeneration[state.currentView]}`],
    ["Detail cache", live ? `${live.detailCacheHits} hits · ${live.detailCacheMisses} misses` : "Direct / waiting"],
    ["GPU working", live ? `${(live.workingSetBytes / 1048576).toFixed(1)} MiB` : "Direct / waiting"],
    ["Presented", state.acceptedPresentation?.longEdge
      ? `${state.acceptedPresentation.tier ? previewResolutionLabel(state.acceptedPresentation.tier) : "Placeholder"} · ${state.acceptedPresentation.longEdge}px · ${state.acceptedPresentation.transport}`
      : "Waiting"],
    ["Status", viewerStatusLabel()],
    ["Execution", previewExecutionLabel()],
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
      ["Size", !state.proofArtifact
        ? (state.proofSize === "full" ? "Full size" : "Reduced")
        : `${state.proofArtifact.full_size ? "Full size" : "Reduced"} · ${state.proofArtifact.width} × ${state.proofArtifact.height}`],
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
    // A narrow column may shorten a long value; the full text is on hover.
    dd.title = String(value ?? "");
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

function displayedLongEdge() {
  const rect = els.dropzone.getBoundingClientRect();
  const paneWidth = state.compareLayout === "side-horizontal" ? rect.width / 2 : rect.width;
  const paneHeight = state.compareLayout === "side-vertical" ? rect.height / 2 : rect.height;
  // Keep this calculation independent of the geometry coordinate-map cache:
  // that cache keys itself by settledProxyLongEdge(), which calls this helper.
  const source = { width: state.session?.source?.width || 1, height: state.session?.source?.height || 1 };
  const geometry = state.adjustments?.shared?.geometry || {};
  const rotated = [90, 270].includes(Number(geometry.rotation) || 0);
  const crop = geometry.crop || {};
  const frame = {
    width: Math.max(1, (rotated ? source.height : source.width) * (Number(crop.width) || 1)),
    height: Math.max(1, (rotated ? source.width : source.height) * (Number(crop.height) || 1)),
  };
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const fitScale = Math.min(paneWidth * dpr / frame.width, paneHeight * dpr / frame.height);
  return Math.max(source.width, source.height) * (state.zoomMode === "fit"
    ? fitScale : Math.min(1, state.zoomPercent / 100));
}

function residentAuthoringLongEdge() {
  const accepted = state.acceptedPresentation;
  const target = requiredProcessingLongEdge();
  if (!gpuPreviewEligible(state.currentView)
    || accepted?.transport !== "WebGPU"
    || accepted.lane !== state.currentView
    || accepted.geometrySignature !== geometrySignature()
    || (accepted.processedLongEdge ?? accepted.longEdge) !== target
    || els.previewCanvas.style.display === "none") return null;
  return target;
}

function bootstrapProxyLongEdge() {
  // Used only while the selected tier is still Preparing, so the viewer has
  // something truthful to show instead of an empty surface. It is labeled as a
  // placeholder and is never accepted as the selected tier.
  return Math.round(Math.min(requiredProcessingLongEdge(), clamp(displayedLongEdge(), 512, 1024)));
}

function interactiveProxyLongEdge() {
  // Once the selected tier has produced a
  // valid result, a gesture may not change the processing resolution. The
  // previous display-bounded 512-1024 proxy is now the bootstrap path only.
  if (selectedTierReady()) return requiredProcessingLongEdge();
  return bootstrapProxyLongEdge();
}

function previewGraphTimingKey(lane = state.currentView) {
  const film = state.adjustments?.[lane]?.film_look || {};
  return [lane, Boolean(state.denoise?.[lane]?.enabled), gpuDetailGraphActive(lane),
    localAdjustments().filter((item) => item.enabled !== false).length,
    Number(film.grain_amount) > 0, Number(film.bloom_amount) > 0,
    Number(film.halation_amount) > 0,
    Number(state.adjustments?.[lane]?.detail?.softness) > 0 || (Number(state.adjustments?.[lane]?.detail?.microcontrast) || 0) !== 0,
    state.zoomMode === "custom" ? "zoom" : "fit"].join(":");
}

/**
 * The latency controller's preference for the current setting.
 *
 * The preview policy uses
 * response menu with one opt-in. Off is the old Precise: every frame exact,
 * no coarse pass. On is the old Balanced: the controller may choose a coarse
 * scale when its timing evidence says an exact frame would be slow.
 */
function dragLatencyPreference() {
  return state.fasterDragging ? "balanced" : "precise";
}

function interactiveScaleDecision(lane = state.currentView, { interacting = true } = {}) {
  const exactEdge = refinementProxyLongEdge();
  const visibleEdge = Math.min(exactEdge, Math.max(1, displayedLongEdge()));
  return state.previewLatencyController?.choose({
    preference: dragLatencyPreference(),
    graph: previewGraphTimingKey(lane),
    exactEdge,
    visiblePixels: visibleEdge * visibleEdge,
    interacting,
  }) || { edge: interactiveProxyLongEdge(), coarse: false, scale: 1 };
}

function responseCoarseLongEdge(exactEdge) {
  // Reuse one small source level across nearby zooms and graph changes. Exact
  // output remains at the display-required edge in the mandatory follow-up.
  const edge = Math.min(2048, Math.max(256, exactEdge - 1));
  return edge >= 1024 ? (edge >= 2048 ? 2048 : 1024)
    : edge >= 512 ? 512 : 256;
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
  // The settled pass always aims at the selected tier. Stopping short of it
  // here is what produced the old "low while dragging, high once it settles"
  // jump that the current policy prevents.
  return Math.round(requiredProcessingLongEdge());
}

function refinementProxyLongEdge() {
  return Math.round(requiredProcessingLongEdge());
}

// One measured peak per edit state, so a scope refresh that changes nothing
// about the picture does not pay for the pass again.
const exactScopePeakCache = new Map();
const exactScopePeakInflight = new Map();
const exactHighlightAnchorInflight = new Map();

function exactScopePeakKey(lane = state.currentView) {
  return [
    state.session?.session_id || "none",
    lane,
    state.editRevision,
    state.previewGeneration?.[lane] ?? 0,
    geometrySignature(),
    projectReferenceWhiteNits(),
    JSON.stringify(state.adjustments?.[lane] || {}),
    JSON.stringify(state.compareWithoutLocals ? [] : localAdjustments()),
  ].join("|");
}

/**
 * Estimate the finished peak from bounded source evidence and native patches.
 * A downsample alone can erase isolated speculars. Real source candidates
 * locate those pixels; the GPU ranks them and evaluates a fixed patch budget
 * with bounded masks. This remains an estimate, labelled in the scopes.
 * Export and full-size Proof measure the entire finished image exactly.
 * The historical function/cache names remain for performance-driver callers.
 * Returns null on refusal or when foreground work supersedes the measurement.
 */
async function measureExactScopePeak({ lane = state.currentView, force = false } = {}) {
  if (!state.gpuPreview?.available || !state.session) return null;
  // Background measurement paints nothing and yields to foreground work.
  // Importing a source replaces the session this would be measuring, so there
  // is nothing to measure and every reason not to compete for the network and
  // the device while it happens.
  if (state.importInProgress) return null;
  const key = exactScopePeakKey(lane);
  if (!force && exactScopePeakCache.has(key)) return exactScopePeakCache.get(key);
  if (exactScopePeakInflight.has(key)) return exactScopePeakInflight.get(key);
  const run = measureExactScopePeakInner(lane, key);
  exactScopePeakInflight.set(key, run);
  try {
    return await run;
  } finally {
    if (exactScopePeakInflight.get(key) === run) exactScopePeakInflight.delete(key);
  }
}

async function measureExactScopePeakInner(lane, key) {
  const started = performance.now();
  // Never attribute a completed estimate to a replaced session or edit.
  const sessionId = state.session.session_id;
  const importGeneration = state.importGeneration;
  const foregroundSerial = state.gpuRenderSerial;
  let measured = null;
  const generation = state.previewGeneration[lane];
  const revision = state.editRevision;
  const requestedEdge = requiredProcessingLongEdge();
  const current = () => state.session?.session_id === sessionId
    && state.importGeneration === importGeneration && !state.importInProgress
    && state.gpuRenderSerial === foregroundSerial
    && state.previewGeneration[lane] === generation && state.editRevision === revision
    && requiredProcessingLongEdge() === requestedEdge;
  try {
    const result = await state.gpuPreview.measureEditingPeak(
      els.previewCanvas,
      state.session.session_id,
      lane,
      JSON.parse(JSON.stringify(state.adjustments)),
      sampleCurvePoints,
      state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
      state.editRevision,
      projectReferenceWhiteNits(),
      { width: state.session.source.width, height: state.session.source.height },
      {
        tier: "settled",
        measureOnly: true,
        applicationGeneration: state.previewGeneration[lane],
        isCurrent: current,
      },
    );
    if (!current() || exactScopePeakKey(lane) !== key) {
      return null;
    }
    if (result?.rendered && Number.isFinite(result.metrics?.exactPeak)) {
      measured = {
        peak: result.metrics.exactPeak,
        longEdge: result.metrics.exactPeakLongEdge,
        exact: false,
        bounded: true,
        tiles: result.metrics.tileCount,
        durationMs: performance.now() - started,
      };
    } else if (result && !result.rendered) {
      measured = { peak: null, exact: false, refusals: result.refusals || [] };
    }
  } catch (error) {
    measured = { peak: null, exact: false, refusals: [String(error?.message || error)] };
  }
  // Only cache against a session that is still the one in hand, or a later
  // session could read this answer as its own.
  if (!current() || exactScopePeakKey(lane) !== key) return null;
  // Refused measurements remain retryable; valid estimates are reused.
  if (Number.isFinite(measured?.peak)) {
    recordEditingMeasurement(lane, {peak: measured.peak});
    exactScopePeakCache.set(key, measured);
    while (exactScopePeakCache.size > 8) exactScopePeakCache.delete(exactScopePeakCache.keys().next().value);
  }
  return measured;
}

/**
 * Resolve Peak Fit's shoulder anchor with bounded editing measurement.
 *
 * HDR measures the finished picture before output highlights. SDR measures
 * its prefix before display grading and locals. The key excludes preview
 * resolution, so every zoom reuses the same value for an unchanged recipe.
 */
const pendingHighlightAnchors = new Map();
function scheduleExactHighlightAnchor(request) {
  const { lane, key } = request;
  const previous = pendingHighlightAnchors.get(lane);
  if (previous) window.clearTimeout(previous.timer);
  // Renderer deduplication covers dispatched work. Pending work belongs to
  // this latest-input queue and must not suppress a later generation's event.
  state.gpuPreview?.requestedCanonicalHighlightKeys?.delete(key);
  const pending = { request, sessionId: state.session?.session_id, timer: null };
  const dispatch = () => {
    if (pendingHighlightAnchors.get(lane) !== pending) return;
    if (state.session?.session_id !== pending.sessionId || state.currentView !== lane || state.importInProgress) {
      pendingHighlightAnchors.delete(lane);
      return;
    }
    const scheduler = state.previewScheduler;
    if (scheduler?.interacting || scheduler?.frameInFlight || scheduler?.framePending
      || state.gpuDraftInFlight || !state.acceptedPresentation?.exact
      || state.acceptedPresentation?.generation !== state.previewGeneration[lane]) {
      pending.timer = window.setTimeout(dispatch, 200);
      return;
    }
    pendingHighlightAnchors.delete(lane);
    void measureExactHighlightAnchor(pending.request);
  };
  pendingHighlightAnchors.set(lane, pending);
  pending.timer = window.setTimeout(dispatch, 200);
}

async function measureExactHighlightAnchor({ lane, key, used }) {
  if (!state.gpuPreview?.available || !state.session || !key || state.importInProgress) return null;
  if (exactHighlightAnchorInflight.has(key)) return exactHighlightAnchorInflight.get(key);
  const sessionId = state.session.session_id;
  const importGeneration = state.importGeneration;
  const foregroundSerial = state.gpuRenderSerial;
  const previewGeneration = state.previewGeneration[lane];
  const revision = state.editRevision;
  const requestedEdge = requiredProcessingLongEdge();
  const run = (async () => {
    try {
      const result = await state.gpuPreview.measureEditingPeak(
        els.previewCanvas,
        sessionId,
        lane,
        JSON.parse(JSON.stringify(state.adjustments)),
        sampleCurvePoints,
        state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
        state.editRevision,
        projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        {
          tier: "settled",
          measureOnly: true,
          highlightAnchorOnly: true,
          applicationGeneration: previewGeneration,
          isCurrent: () => state.session?.session_id === sessionId
            && state.importGeneration === importGeneration && !state.importInProgress
            && state.gpuRenderSerial === foregroundSerial
            && state.currentView === lane && state.editRevision === revision
            && state.previewGeneration[lane] === previewGeneration
            && requiredProcessingLongEdge() === requestedEdge,
        },
      );
      if (state.session?.session_id !== sessionId || state.importGeneration !== importGeneration
        || state.editRevision !== revision || state.currentView !== lane
        || state.previewGeneration[lane] !== previewGeneration) return null;
      if (!Number.isFinite(result?.highlightAnchor?.value)) return null;
      const measured = result.highlightAnchor.value;
      // A request queued during a drag can carry an earlier input's key. The
      // measurement is of the recipe in hand all the same (the checks above),
      // so it is kept as evidence; `used` then belongs to that earlier input
      // and the frame is redrawn.
      recordEditingMeasurement(lane, {anchor: measured});
      // One redraw per measured key: if the redraw asks again under a key the
      // measurement can never answer, repeating it would never settle.
      const mismatched = result.highlightAnchor.key !== key;
      if (mismatched && state.lastMismatchedAnchorKey === result.highlightAnchor.key) return measured;
      if (mismatched) state.lastMismatchedAnchorKey = result.highlightAnchor.key;
      if (mismatched
        || Math.abs(measured / Math.max(Number(used) || measured, 1e-9) - 1) > 0.0001) {
        invalidatePreview(lane, { markDirty: false });
        debouncePreview(lane);
      }
      return measured;
    } catch (error) {
      console.warn("Editing highlight anchor measurement failed", error);
      return null;
    } finally {
      exactHighlightAnchorInflight.delete(key);
    }
  })();
  exactHighlightAnchorInflight.set(key, run);
  return run;
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
function requestLiveOverlay(tier) {
  if (!state.session || state.adjustments.shared.overlay_mode === "off") return;
  const loop = state.liveOverlay;
  loop.pending = tier;
  if (loop.running) return;
  loop.running = true;
  void (async () => {
    try {
      while (loop.pending) {
        const next = loop.pending;
        loop.pending = null;
        const interim = next === "interactive";
        const longEdge = interim
          ? Math.min(interactiveProxyLongEdge(), settledProxyLongEdge())
          : settledProxyLongEdge();
        const presented = state.overlayPresented;
        const lane = state.currentView;
        // The settle path may already have delivered this exact overlay.
        if (!interim && presented && !presented.interim
          && presented.lane === lane
          && presented.generation === state.previewGeneration[lane]
          && presented.revision === state.editRevision
          && presented.signature === geometrySignature()
          && presented.longEdge === longEdge) continue;
        await refreshOverlay(longEdge, { interim }).catch(() => null);
      }
    } finally {
      loop.running = false;
    }
  })();
}

async function refreshOverlay(longEdge = state.session?.preview?.long_edge || 1600, { interim = false } = {}) {
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
  // The overlay must describe the image underneath it. editRevision alone does
  // not move for local-only invalidations or geometry changes, so a response
  // could be painted over a different generation of the picture.
  const overlayGeneration = state.previewGeneration[lane];
  const overlaySignature = geometrySignature();
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
  // A settled overlay must describe exactly the picture under it. An interim
  // one, requested while a drag is still moving the picture, is allowed to lag
  // it by the overlay's own render time -- that is what live means here -- but
  // never to go backwards, change lane or geometry, or outlive the overlay
  // being switched off. The settled pass that follows every drag replaces it.
  const requestIsCurrent = () => controller === state.overlayAbortController
    && state.session?.session_id === sessionId
    && state.currentView === lane
    && geometrySignature() === overlaySignature
    && state.adjustments.shared.overlay_mode !== "off"
    && (interim
      ? (state.overlayPresented?.lane !== lane
        || (state.overlayPresented.generation ?? -1) <= overlayGeneration)
      : state.editRevision === revision && state.previewGeneration[lane] === overlayGeneration);
  if (!requestIsCurrent()) return;
  if (response.status === 204) {
    // Keep the last valid overlay continuously composited until a replacement
    // arrives. A transient empty response must not flash the bare image.
    return;
  }
  if (!response.ok) {
    // A refused request (typically a revision the backend has already moved
    // past) keeps the last overlay; the next valid generation replaces it.
    await response.body?.cancel?.().catch(() => null);
    return;
  }

  const blob = await response.blob();
  if (!requestIsCurrent()) return;
  const url = URL.createObjectURL(blob);
  if (await applyOverlayUrl(url, requestIsCurrent)) {
    state.overlayPresented = {
      lane, generation: overlayGeneration, revision, signature: overlaySignature, longEdge, interim,
    };
  }
}

function refreshScopes(longEdge = 960, { tier = "settled", generation = null, lane = state.currentView } = {}) {
  if (!state.session || geometryDraftActive()) return Promise.resolve(false);
  // Scopes describe the lane on screen. A request left over from the lane just
  // switched away from could only be a whole-picture CPU grade, and its answer
  // is discarded on arrival.
  if (lane !== state.currentView) return Promise.resolve(false);
  // A live GPU scope during a drag reads the presented canvas, not the
  // backend's copy, so it does not wait for a save round trip. Waiting put its
  // readback on the GPU beside the next drag frame. The save still runs at
  // release and in the settled pass, and a CPU scope still saves first.
  const liveGpuScope = tier === "interactive" && gpuScopeEligible(lane);
  if (state.globalEditDirty && !liveGpuScope) {
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
  const effectiveLongEdge = window.HDRWholeImagePreviewPipe.edgeFor("scopes",
    mode === "waveform" ? waveformScopeLongEdge(tier, longEdge) : longEdge);
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
  // A live scope never shares the GPU with a drag frame. The scheduler
  // starts it in the gap after a frame; if a frame has started since, this
  // pass stands down and the next one (at most 100 ms later) runs instead.
  if (tier === "interactive" && state.previewScheduler?.frameInFlight) {
    state.previewScheduler.recordStaleResult();
    return false;
  }
  const accepted = state.acceptedPresentation;
  const isCurrent = () => state.acceptedPresentation?.lane === lane
    && state.acceptedPresentation?.generation === accepted?.generation
    && state.acceptedPresentation?.geometrySignature === accepted?.geometrySignature
    && (accepted?.execution === "tiled" || state.acceptedPresentation?.sourceSerial === accepted?.sourceSerial)
    && accepted?.generation === state.previewGeneration[lane]
    && generation === state.scopeGeneration
    && request.sessionId === state.session?.session_id
    && lane === state.currentView && mode === state.scopeMode;
  let scopeCanvas = els.previewCanvas;
  let sourceSerial = accepted?.sourceSerial;
  if (accepted?.execution === "tiled") {
    // A tiled canvas retains only the viewport. Its scopes still describe the
    // entire picture, so grade a bounded proxy on a separate GPU canvas after
    // settlement. Live input keeps the last scope until its settled request;
    // it never starts an extra grading graph beside the gesture's tiles.
    if (tier === "interactive") return false;
    const renderProxy = async () => {
      while (isCurrent() && (state.gpuDraftInFlight || state.gpuPreview.activeRenderCount > 0)) {
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
      if (!isCurrent()) return null;
      return state.gpuPreview.renderScopeProxy(
        request.sessionId, lane, state.adjustments, sampleCurvePoints,
        request.longEdge, request.include_locals ? localAdjustments() : [],
        request.edit_revision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: accepted.generation, isCurrent },
      ).catch((error) => {
        // A newer generation stopping this one's source load is not a failure;
        // the scope that replaces it is already on its way.
        if (error?.superseded || !isCurrent() || request.edit_revision !== state.editRevision) return null;
        throw error;
      });
    };
    const startedAt = performance.now();
    let rendered = await renderProxy();
    if (!isCurrent()) return false;
    // A pan or catch-up pass of the same generation can start meanwhile and
    // take this pass's masks. That is not the GPU refusing the scope, and no
    // later request replaces it: wait for that pass and ask once more.
    const refusal = state.gpuPreview.lastRenderRefusal;
    if (!rendered && refusal?.at >= startedAt && String(refusal.reason).startsWith("superseded")) {
      rendered = await renderProxy();
    }
    if (!isCurrent()) return false;
    if (!rendered) {
      // The accepted tiled picture is current, but an auxiliary GPU graph
      // can still be refused under memory pressure. Keep the same generation
      // guards and settle through the established CPU scope fallback.
      return new Promise(resolve => enqueueScopeRequest({...request,resolve}));
    }
    scopeCanvas = rendered.canvas;
    sourceSerial = rendered.sourceSerial;
  }
  const analysis = await state.gpuPreview.analyzeScope(scopeCanvas, {
    width: sampleWidth,
    height: sampleHeight,
    generation,
    tier,
  });
  // A saturated two-buffer readback pool is intentional backpressure. Keep
  // the last valid scope visible and let the next scheduled generation win;
  // never fall back to an image-sized CPU request merely because the GPU is busy.
  if (!analysis) return false;
  if (analysis.sessionId !== request.sessionId
    || analysis.sourceSerial !== sourceSerial
    || analysis.applicationGeneration !== accepted?.generation
    || accepted?.generation !== state.previewGeneration[lane]
    || analysis.geometrySignature !== accepted?.geometrySignature
    || generation !== state.scopeGeneration
    || lane !== state.currentView
    || mode !== state.scopeMode
    || request.sessionId !== state.session?.session_id
    || !isCurrent()) {
    state.previewScheduler?.recordStaleResult();
    return false;
  }
  // The peak is the one scope number a delivery decision is made on, so on a
  // settled read it uses bounded peak evidence rather than just the proxy
  // the rest of the scope is drawn from. Only settled: during a drag the
  // proxy peak is the right trade, and it is labelled as such.
  let exactPeak = null;
  if (tier === "settled" && !scopeRegion) {
    exactPeak = await measureExactScopePeak({ lane });
    // The measurement is a render of its own and takes time. Anything that
    // moved underneath it invalidates this payload exactly as it would have
    // above, so the same question is asked again rather than presenting a
    // number against a generation that is no longer on screen.
    if (generation !== state.scopeGeneration
      || lane !== state.currentView
      || state.previewGeneration[lane] !== accepted?.generation
      || !isCurrent()) {
      state.previewScheduler?.recordStaleResult();
      return false;
    }
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
    exactPeak,
  });
  applyEditingScopePeak(payload, exactPeak, lane);
  recordDisplayedScopePeak(payload, request);
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

function markScopeUpdating() {
  els.scopeFreshness.textContent = "Updating";
  els.scopeFreshness.classList.add("updating");
}

function scopeFreshnessLabel(tier) {
  return scopeUi.freshnessLabel(tier);
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
    if (tier === "settled" && !request.scopeRegion) {
      const measured = await measureExactScopePeak({lane});
      if (generation !== state.scopeGeneration || request.sessionId !== state.session?.session_id) return false;
      applyEditingScopePeak(payload, measured, lane);
    }
    applyAcceptedCpuScopePeak(payload, request);
    recordDisplayedScopePeak(payload, request);
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

function applyAcceptedCpuScopePeak(payload, request) {
  const accepted = state.acceptedPresentation;
  if (payload?.peak_exact === false || !state.scopeExactPeak || request.scopeRegion || payload?.preview_kind !== "hdr"
    || accepted?.transport === "WebGPU" || accepted?.lane !== request.lane
    || accepted?.generation !== state.previewGeneration[request.lane]
    || accepted?.geometrySignature !== geometrySignature() || !accepted?.exact
    || !Number.isFinite(accepted?.scopePeak)) return;
  const peak = accepted.scopePeak;
  payload.peak_value = peak;
  payload.peak_exact = false;
  payload.peak_measured_long_edge = accepted.processedLongEdge;
  if (Array.isArray(payload.stats) && payload.stats.length) {
    payload.stats[0] = {
      label: "Peak (preview)",
      value: peak >= 1000 ? `${peak.toFixed(0)} nit` : peak >= 99.995 ? `${peak.toFixed(1)} nit` : `${peak.toFixed(2)} nit`,
    };
  }
}

function applyEditingScopePeak(payload, measured, lane) {
  if (!Number.isFinite(measured?.peak)) {
    // A refused bounded measurement leaves only the proxy's scope value.
    // It must not inherit the label reserved for the measured estimate.
    payload.peak_exact = false;
    if (payload.stats?.length) payload.stats[0] = {...payload.stats[0], label: "Peak (preview)"};
    return;
  }
  const peak = lane === "hdr" ? measured.peak / .18 * projectReferenceWhiteNits() : measured.peak;
  payload.peak_value = peak;
  payload.peak_exact = false;
  payload.peak_measured_long_edge = measured.longEdge;
  if (payload.stats?.length) payload.stats[0] = {
    label: "Peak (estimate)",
    value: lane === "hdr" ? `${peak >= 1000 ? peak.toFixed(0) : peak.toFixed(1)} nit` : `${(peak*100).toFixed(1)}%`,
  };
}

function recordDisplayedScopePeak(payload, { tier, lane, scopeRegion }) {
  // Compare delivery with the full-image number the owner actually saw,
  // including a preview-only fallback after bounded measurement was refused.
  // A live drag or a selected scope region is not delivery evidence.
  if (tier !== "settled" || scopeRegion || !Number.isFinite(payload?.peak_value)) return;
  const peak = lane === "hdr" ? payload.peak_value * .18 / projectReferenceWhiteNits() : payload.peak_value;
  recordEditingMeasurement(lane, { peak });
}

function editingMeasurementRecipe() {
  return JSON.stringify([state.session?.session_id, state.editRevision, state.adjustments, localAdjustments(),
    state.denoise, state.editDocument?.sdr_match, state.compareWithoutLocals]);
}

function recordEditingMeasurement(lane, values) {
  state.editingMeasurementEvidence ||= {};
  const recipe = editingMeasurementRecipe();
  const previous = state.editingMeasurementEvidence[lane];
  state.editingMeasurementEvidence[lane] = {recipe, values:{...(previous?.recipe === recipe ? previous.values : {}), ...values}};
}

function editingMeasurementsForDelivery() {
  const recipe = editingMeasurementRecipe();
  return Object.fromEntries(Object.entries(state.editingMeasurementEvidence || {})
    .filter(([,evidence]) => evidence.recipe === recipe && !state.compareWithoutLocals)
    .map(([lane,evidence]) => [lane,evidence.values]));
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
  return scopeUi.requestResolution(tier, state.scopeQuality);
}

function scopeQualityProfile() {
  return scopeUi.qualityProfile(SCOPE_QUALITY_PROFILES, state.scopeQuality, DEFAULT_SCOPE_QUALITY);
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
  return scopeUi.guidesForDisplay(scope);
}

function compactScopeGuideLabel(scope, guide) {
  return scopeUi.compactGuideLabel(scope, guide);
}

function scopeGuideTooltip(scope) {
  return scopeUi.guideTooltip(scope);
}

function guidePosition(scope, value) {
  return scopeUi.guidePosition(scope, value);
}

function scopeHdrCeiling(scope) {
  return scopeUi.hdrCeiling(scope);
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
  return scopeUi.filteredChannels(channels, state.scopeChannelMode);
}

function scopeTitleFor(scope) {
  return scopeUi.titleFor(scope, state.scopeChannelMode);
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
  status.post({ id: "export", severity: "progress", message: "Export queued…", progress: "indeterminate" });
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  const editsApplied = globalsApplied === false
    ? false
    : await (state.editCommandQueue || Promise.resolve(true));
  if (editsApplied === false) {
    status.post({ id: "export", severity: "error", message: "Export paused because the latest edit could not be saved. Review the edit error and try again." });
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
      status.post({ id: "export", severity: "success", message: "Export cancelled." });
      return;
    }
    outputPath = selection.path;
    pathGrant = selection.grant;
    nativeOverwrite = selection.overwriteTarget || null;
  }
  els.exportConfirmButton.disabled = true;
  status.post({ id: "export", severity: "progress", message: "Rendering full-resolution HDR and SDR endpoints…", progress: "indeterminate" });
  els.exportResult.classList.add("hidden");
  const exportStartedAt = performance.now();
  let lastExportExpectation = "Rendering full-resolution HDR and SDR endpoints";
  const exportTicker = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((performance.now() - exportStartedAt) / 1000));
    const expectation = elapsedSeconds < 20
      ? "Rendering full-resolution HDR and SDR endpoints"
      : elapsedSeconds < 60
        ? "Encoding gain-map media; large sources can take a minute or more"
        : "Still working locally; the final file will be validated before completion";
    if (expectation !== lastExportExpectation) {
      lastExportExpectation = expectation;
      status.update("export", { severity: "progress", message: expectation, progress: "indeterminate" });
    }
  }, 1000);
  try {
    desktop?.setOperationProgress({ kind: "export", value: 0.01, state: "indeterminate" });
    let response = await requestSessionExport(outputPath, Boolean(nativeOverwrite), pathGrant, nativeOverwrite);
    let payload = await safeJson(response);
    if (response.status === 409 && payload?.detail?.code === "overwrite_required") {
      const detail = payload.detail;
      const approved = await window.HDRDialogs.confirm(
        `${detail.message}\n\n${detail.output_path}`,
        { title: "Overwrite file", confirmLabel: "Overwrite", destructive: true },
      );
      if (!approved) {
        status.post({ id: "export", severity: "success", message: "Export cancelled; the existing file was left unchanged." });
        return;
      }
      status.post({ id: "export", severity: "progress", message: "Replacing the existing file and validating the result…", progress: "indeterminate" });
      response = await requestSessionExport(outputPath, true, pathGrant, null);
      payload = await safeJson(response);
    }
    if (!response.ok) {
      status.post({ id: "export", severity: "error", message: responseErrorMessage(payload, "Export failed.") });
      return;
    }
    const exportMessage = payload.message || "Export request finished.";
    const totalExportMs = Number(payload.timings_ms?.total);
    const completedMessage = Number.isFinite(totalExportMs)
      ? `${exportMessage} Completed in ${(totalExportMs / 1000).toFixed(1)}s.`
      : exportMessage;
    const measurementWarning = (payload.measurement_warnings || []).join(" ");
    status.post({ id: "export", severity: measurementWarning ? "warning" : "success", message: `${completedMessage}${measurementWarning ? ` ${measurementWarning}` : ""}` });
    els.exportStatus.textContent = measurementWarning || "The completed export is available below.";
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
    status.post({ id: "export", severity: "error", message: "Export could not reach the local HDR Finisher server." });
  } finally {
    window.clearInterval(exportTicker);
    els.exportConfirmButton.disabled = false;
    desktop?.setOperationProgress({ kind: "export", value: -1, state: "normal" });
  }
}

async function chooseExportDirectory() {
  await openMediaBrowser("export_directory", els.exportDirectory.value);
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
  status.post({ id: "interpretation", severity: "progress", message: "Re-interpreting source file…", progress: "indeterminate" });
  setPreviewMessage("Re-interpreting source file...", 8);
  try {
    const response = await fetch(`/api/session/${state.session.session_id}/interpretation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(override),
    });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      status.post({ id: "interpretation", severity: "error", message: payload?.detail || "Interpretation override failed." });
      setPreviewError(payload?.detail || "Interpretation override failed.");
      return;
    }
    state.session = payload.session;
    state.renderCoordinator?.noteSource(payload.session.session_id);
    setPreviewMessage("Interpretation applied. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    loadDenoiseDocument(state.editDocument);
    state.editRevision = payload.session.edit_revision || 0;
    recordAcknowledgedLocals(state.editDocument);
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
    status.post({ id: "interpretation", severity: "success", message: "Source interpretation applied." });
  } catch (error) {
    console.error(error);
    const message = "Interpretation override could not reach the local HDR Finisher server.";
    status.post({ id: "interpretation", severity: "error", message });
    setPreviewError(message);
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

function setValueByPath(target, path, value) {
  const parts = resolveAdjustmentPath(path).split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return resolveAdjustmentPath(path).split(".").reduce((cursor, key) => cursor?.[key], target);
}

function projectOpenNeedsSourceRelink(payload) {
  return projectIo.needsSourceRelink(payload);
}

function beginProjectOpenStatus(label) {
  status.post({
    id: "project-open",
    severity: "progress",
    message: `Opening project · ${label}`,
    progress: "indeterminate",
  });
  return 0;
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

function buildGpuScopePayload(analysis, options) {
  return scopeAnalysis.buildGpuScopePayload(analysis, {
    ...options,
    channelMode: state.scopeChannelMode,
    referenceWhite: projectReferenceWhiteNits(),
  });
}

function resolveAdjustmentPath(path) {
  return path?.startsWith("current.") ? `${state.currentView}.${path.slice("current.".length)}` : path;
}

// Select elements always report strings; numeric paths must not send "4000" where the backend expects 4000.
function readControlValue(control) {
  if (control.type === "checkbox") return control.checked;
  const numeric = control.type === "range" || control.type === "number" || control.dataset.valueType === "number";
  return numeric ? Number(control.value) : control.value;
}

function commitAdjustmentValue(path, value, { manual = false } = {}) {
  const resolvedPath = resolveAdjustmentPath(path);
  if (manual) {
    beginGlobalDetailInteraction(resolvedPath);
    state.previewScheduler?.beginInteraction();
  }
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

function syncPressedControl(control, pressed) {
  control.setAttribute("aria-pressed", String(pressed));
  control.lastElementChild.textContent = pressed ? control.dataset.hideLabel : control.dataset.showLabel;
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.tagName === "BUTTON") syncPressedControl(control, Boolean(value));
    else if (control.type === "checkbox") control.checked = Boolean(value);
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
    // The stylesheet's readable measure is the cap; the viewport only narrows
    // it further. An inline viewport-wide max-width let copy run on one line.
    tooltip.style.maxWidth = `${Math.max(80, Math.min(TOOLTIP_MAX_WIDTH, viewport.width - margin * 2))}px`;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const tooltipRect = tooltip.getBoundingClientRect();
    const minimumLeft = viewport.left + margin;
    const maximumLeft = viewport.left + viewport.width - margin - tooltipRect.width;
    const minimumTop = viewport.top + margin;
    const maximumTop = viewport.top + viewport.height - margin - tooltipRect.height;
    // Help for anything inside a side rail opens beside the rail, so it never
    // covers the neighbouring module headers or controls the user is scanning.
    const rail = activeTrigger.closest(TOOLTIP_SIDE_RAILS);
    const railRect = rail?.getBoundingClientRect();
    const besideRail = railRect && railRect.left - gap - tooltipRect.width >= minimumLeft;
    let left;
    let top;
    if (besideRail) {
      left = railRect.left - gap - tooltipRect.width;
      top = clamp(triggerRect.top, minimumTop, Math.max(minimumTop, maximumTop));
    } else {
      left = clamp(
        triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2,
        minimumLeft,
        Math.max(minimumLeft, maximumLeft),
      );
      const below = triggerRect.bottom + gap;
      const above = triggerRect.top - gap - tooltipRect.height;
      const preferredTop = below <= maximumTop ? below : above;
      top = clamp(preferredTop, minimumTop, Math.max(minimumTop, maximumTop));
    }
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
  // Clicking is acting, not asking: any press dismisses help, including a
  // press on the trigger itself (twirling a module open changes the layout
  // the tooltip was placed against).
  document.addEventListener("pointerdown", () => {
    if (activeTrigger || pendingTrigger) hide();
  }, true);
  document.addEventListener("pointerout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger.contains(event.relatedTarget)) return;
    // Only keyboard focus keeps help open after the pointer leaves; a click
    // also focuses the trigger and must not pin the tooltip.
    if (trigger.matches(":focus-visible")) return;
    if (activeTrigger === trigger || pendingTrigger === trigger) hide();
  });
  document.addEventListener("focusin", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger && trigger.matches(":focus-visible")) schedule(trigger);
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
      control.disabled = !hasSession || Boolean(unavailableModule) || bypassedRawHighlightControl
        || (control.id === "film-grain-chroma" && filmGrainChromaInactive());
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

/**
 * Track the render in flight for the current lane.
 *
 * Two grading renders racing means the loser is abandoned after it has already
 * paid for its source upload and its highlight-peak measurement. Refinement is
 * the one caller that can start while another render is still running, so it
 * waits on this instead of superseding it.
 */
/**
 * The exact size of the frame a render at `longEdge` produces, or null until
 * the coordinate map for that size has said what geometry makes of it.
 */
function gpuFrameSizeAt(longEdge) {
  return geometryMath.frameSizeAtEdge(
    state.session?.source,
    state.adjustments?.shared?.geometry,
    longEdge,
    geometryCoordinateMapCache.get(geometryCoordinateMapKey(geometrySignature(), longEdge)),
  );
}

/**
 * About the size of that frame: the full-resolution output scaled by the
 * processing edge over the source's. Good for placing the view, not for
 * addressing pixels.
 */
function approximateGpuFrameSizeAt(longEdge) {
  const source = { width: state.session?.source?.width || 1, height: state.session?.source?.height || 1 };
  const frame = sourcePixelFrameDimensions(state.adjustments?.shared?.geometry) || source;
  const scale = Math.min(1, longEdge / Math.max(1, source.width, source.height));
  return {
    width: Math.max(1, Math.round(frame.width * scale)),
    height: Math.max(1, Math.round(frame.height * scale)),
  };
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

function requestSessionExport(outputPath, overwrite, pathGrant = null, overwriteTarget = null) {
  const resizeMode = els.exportResizeMode?.value || "original";
  return fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: els.exportFormat.value,
      editing_measurements: editingMeasurementsForDelivery(),
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
    return false;
  }
  if (!isCurrent()) {
    URL.revokeObjectURL(url);
    return false;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewOverlay.src = url;
  els.previewOverlay.dataset.objectUrl = url;
  delete els.previewOverlay.dataset.stale;
  els.previewOverlay.style.opacity = "1";
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

function clearPreviewOverlay() {
  state.overlayPresented = null;
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  delete els.previewOverlay.dataset.objectUrl;
  delete els.previewOverlay.dataset.stale;
  els.previewOverlay.removeAttribute("src");
  els.previewOverlay.style.display = "none";
  els.previewOverlay.style.opacity = "";
  els.previewOverlay.style.left = "";
  els.previewOverlay.style.top = "";
  els.previewOverlay.style.width = "";
  els.previewOverlay.style.height = "";
}

function syncViewerStatusEntry() {
  const next = state.previewStatusEntry || state.viewerTierStatusEntry;
  if (!next) {
    status.clear("viewer");
    return;
  }
  const normalized = {
    id: "viewer",
    ...next,
    actions: state.previewStatusEntry && state.previewCancelVisible
      ? [{ id: "cancel-import", label: "Cancel import", run: cancelActiveImport }]
      : [],
    cancelVisible: Boolean(state.previewStatusEntry && state.previewCancelVisible),
  };
  const current = status.get("viewer");
  if (current
    && current.message === normalized.message
    && current.severity === normalized.severity
    && current.progress === normalized.progress
    && current.nodeId === normalized.nodeId
    && current.cancelVisible === normalized.cancelVisible) return;
  status.post(normalized);
}

function setPreviewMessage(message, progress = 0) {
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    progressId: "preview-progress",
    severity: "progress",
    message,
    progress: clamp(Number(progress) || 0, 0, 100),
  };
  syncViewerStatusEntry();
}

function setIndeterminatePreviewMessage(message) {
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    progressId: "preview-progress",
    severity: "progress",
    message,
    progress: "indeterminate",
  };
  syncViewerStatusEntry();
}

function setPreviewError(message) {
  if (state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus(`Perspective saved, but the preview failed: ${message}. Change preview tier or try again.`, "previewFailed");
  }
  state.previewStatusEntry = {
    nodeId: "preview-status",
    copyId: "preview-status-copy",
    severity: "error",
    message,
  };
  syncViewerStatusEntry();
}

function setImportCancelVisible(visible) {
  state.previewCancelVisible = Boolean(visible);
  syncViewerStatusEntry();
}

function hidePreviewMessage() {
  state.previewStatusEntry = null;
  state.previewCancelVisible = false;
  syncViewerStatusEntry();
}

async function safeJson(response) {
  return projectIo.safeJson(response);
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
  if (!visible) return status.clear("source-interpretation");
  status.post({
    id: "source-interpretation",
    nodeId: "interpretation-gate",
    copyId: "interpretation-gate-copy",
    severity: "attention",
    message: `Source interpretation needs review — ${overrideMessage(state.session)}`,
    persistent: true,
    actions: [
      {
        label: "Use assumption",
        id: "accept-interpretation",
        run: () => {
          state.interpretationGateDismissed = true;
          renderInterpretationGate();
          updateExportAvailability();
        },
      },
      { label: "Set manually", id: "manual-interpretation", run: openManualInterpretation },
    ],
  });
}

async function switchLane(lane) {
  if (!["hdr", "sdr"].includes(lane)) return;
  const switchGeneration = ++state.laneSwitchGeneration;
  state.comparePendingPeek = false;
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
  state.renderCoordinator?.noteActiveLane(lane);
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
  // HDR runs Highlight Compression as the output limiter, so it reads after the
  // tone and curve work it compresses and before Color. SDR keeps its shoulder
  // early, where it is the scene-to-display placement rather than a limiter.
  const groupOrder = lane === "hdr"
    ? ["denoise", "hdr-tone", "hdr-equalizer", "hdr-zones", "curves", "hdr-highlights", "hdr-color"]
    : ["denoise", "sdr-tone", "sdr-highlights", "sdr-equalizer", "sdr-zones", "curves", "sdr-color"];
  for (const groupName of groupOrder) {
    const group = document.querySelector(`.control-group[data-group="${groupName}"]`);
    if (group) panel.append(group);
  }
  const colorGrading = document.querySelector('.control-group[data-group="color-grading"]');
  const blackAndWhiteGroup = document.querySelector('.control-group[data-group="black-and-white"]');
  const localAdjustmentsGroup = document.querySelector('.control-group[data-group="local-adjustments"]');
  // Panel order after Color: 12 Color Grading, 13 Black & White, 14 Local
  // Adjustments. Only the panel order: Black & White still processes straight
  // after Color, so the Color Grading wheels can tone the grey picture.
  if (colorGrading && blackAndWhiteGroup) colorGrading.after(blackAndWhiteGroup);
  const beforeLocals = blackAndWhiteGroup || colorGrading;
  if (beforeLocals && localAdjustmentsGroup) beforeLocals.after(localAdjustmentsGroup);
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
  els.proofLaneButtons.forEach((button) => {
    const active = button.dataset.proofLane === lane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
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
  els.blackAndWhiteSdrActions?.classList.toggle("hidden", lane !== "sdr");
  const match = state.editDocument?.sdr_match;
  els.sdrMatchEntireActions?.classList.toggle("hidden", lane !== "sdr");
  if (els.sdrMatchEntire) els.sdrMatchEntire.disabled = !state.session;
  if (els.sdrMatchEntireStatus) {
    els.sdrMatchEntireStatus.textContent = match?.materialized_status === "needs_review"
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

function markGlobalEditDirty() {
  if (!state.session) return;
  state.globalEditDirty = true;
  state.globalEditGeneration += 1;
  state.documentDirty = true;
  syncProjectBadge();
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

function retireActiveSession() {
  // End every document-owned timer, controller, selection, draft, and cache
  // before a replacement document is installed. Generations remain monotonic
  // so callbacks already queued by the browser cannot publish into the next
  // session even after their controller has been aborted.
  cancelRoiCatchUp();
  cancelRoiPanRefinement();
  clearNavigationThumbnail();
  window.clearTimeout(state.localMaskDraftTimer);
  state.localMaskDraftTimer = 0;
  state.localMaskDraftController?.abort();
  state.localMaskDraftController = null;
  state.localMaskDraftPending = null;
  state.localMaskDraftGeneration += 1;
  state.localMaskDraftDirty = false;
  for (const pending of localComparisonMaskRequests.values()) {
    window.clearTimeout(pending.timer);
    pending.controller?.abort();
  }
  for (const pending of localAuthoritativeMaskRequests.values()) pending.controller?.abort();
  localAuthoritativeMaskRequests.clear();
  localComparisonMaskRequests.clear();
  localAuthoritativeMaskCache.clear();
  localComparisonMaskCache.clear();
  localComparisonCompositeCache.clear();
  localBrushMaskCanvasCache.clear();
  if (localMaskOverlayFrame) window.cancelAnimationFrame(localMaskOverlayFrame);
  localMaskOverlayFrame = 0;
  if (pathMarchingAntFrame) window.cancelAnimationFrame(pathMarchingAntFrame);
  pathMarchingAntFrame = 0;
  window.clearTimeout(state.pathMaskProgressTimer);
  state.pathMaskProgressTimer = 0;
  state.pathMaskProgressTarget = null;
  state.pathMaskProgressStartedAt = 0;
  state.selectedLocalId = null;
  state.selectedSubMaskId = null;
  state.pendingLocalAdjustment = null;
  state.pendingSubMask = null;
  state.localTool = null;
  state.localCreationTool = null;
  state.localPointerGesture = null;
  state.localPathDraft = null;
  state.localPathCreatePendingId = null;
  state.selectedPathNode = null;
  state.hoveredPathTarget = null;
  state.localPathCursor = null;
  state.pathInvalidGesture = false;
  state.localBrushCursor = null;
  state.localBrushPreviewPinned = false;
  state.localBrushVisibleBounds = null;
  state.localAdjustmentMenuId = null;
  state.localShowMask = false;
  state.localHiddenGizmoIds.clear();
  state.denoiseNoiseView = false;
  state.compareWithoutLocals = false;
  state.localPreviewDirty = false;
  state.localMaskCommitDepth = 0;
  state.localMaskCommitRefreshPending = false;
  state.localErase = false;
  clearPreviewCache();
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

function renderCompareStatus() {
  if (!state.session) {
    els.compareLayoutButtons.forEach((button) => { button.disabled = true; });
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  const ready = cacheReady(other);
  els.compareLayoutButtons.forEach((button) => { button.disabled = false; });
  // Readiness does not gate the control. Inactive-lane work
  // is deferred to true idle, so disabling the control would make the
  // deferral unreachable; an explicit click or held comparison starts the
  // load now instead. `dataset.prepared` keeps the state observable to
  // diagnostics and tests.
  els.compareButton.dataset.prepared = String(ready);
}

function bindCompareControl() {
  els.compareLayoutButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const layout = button.dataset.compareLayout;
      if (layout === "single" && state.compareLayout === "single") {
        const other = state.currentView === "hdr" ? "sdr" : "hdr";
        // Explicit comparison intent: warm the other lane now. `switchLane`
        // renders it either way, but the preload marks the lane prepared so a
        // following hold-to-peek is instant.
        if (!cacheReady(other)) prepareInactivePreview({ immediate: true });
        await switchLane(other);
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
    // `false` means the lane is not prepared: an explicit preload has started
    // and the peek completes when it lands, if the hold is still down.
    if (await peekOtherLane() === false && state.compareHeld) state.comparePendingPeek = true;
  }, 180);
}

async function endCompareHold() {
  if (state.compareLayout !== "single") return;
  if (!state.compareHeld) return;
  state.compareHeld = false;
  state.comparePendingPeek = false;
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
  if (state.compareLayout !== "single") return false;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (!cacheReady(other)) {
    // Explicit comparison intent: prepare the lane now instead of leaving the
    // gesture inert, and let the preload complete it.
    prepareInactivePreview({ immediate: true });
    return false;
  }
  state.comparePeekActive = true;
  window.HDRProofing?.syncLane();
  clearPreviewOverlay();
  await showCachedPreview(other);
  els.viewerBranchNote.textContent = `${branchCopy[other]} Release V to return to the authored preview.`;
  return true;
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
  state.comparePendingPeek = false;
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
      );
      if (result && lane !== state.currentView && generation === state.previewGeneration[lane]) {
        state.gpuPreparedLane[lane] = true;
        els.comparisonImage.style.display = "none";
        els.comparisonCanvas.style.display = "block";
        state.comparisonRenderedLane = lane;
        state.comparisonRenderedGeneration = generation;
        state.comparisonRenderedGeometry = signature;
        state.comparisonPresentation = {
          lane,
          generation,
          longEdge: settledProxyLongEdge(),
          transport: "WebGPU",
          exact: true,
        };
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
  state.comparisonPresentation = {
    lane,
    generation,
    longEdge: settledProxyLongEdge(),
    transport: cached.raw ? "CPU" : "CPU (encoded)",
    exact: true,
  };
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
  const changed = state.zoomMode !== "fit";
  state.zoomMode = "fit";
  els.dropzone.scrollLeft = 0;
  els.dropzone.scrollTop = 0;
  applyZoomGeometry();
  scheduleNavigationThumbnail();
  if (changed) scheduleZoomRefinement();
}

const navigationThumbnail = { timer: 0, controller: null, key: "", url: "", inflightKey: "" };

function clearNavigationThumbnail() {
  window.clearTimeout(navigationThumbnail.timer);
  navigationThumbnail.timer = 0;
  navigationThumbnail.controller?.abort();
  navigationThumbnail.controller = null;
  navigationThumbnail.key = "";
  if (navigationThumbnail.url) URL.revokeObjectURL(navigationThumbnail.url);
  navigationThumbnail.url = "";
  els.navigationThumbImage.removeAttribute("src");
  els.navigationThumb.classList.add("hidden");
}

function updateNavigationViewport() {
  const visible = state.session && state.zoomMode === "custom" && state.zoomPercent >= 100
    && Boolean(els.navigationThumbImage.src);
  els.navigationThumb.classList.toggle("hidden", !visible);
  if (!visible) return;
  const preview = activePreviewElement();
  const frameWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
  const frameHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
  if (!(frameWidth > 0 && frameHeight > 0)) return;
  const rect = visibleOutputRect(frameWidth, frameHeight)
    || { x: 0, y: 0, width: frameWidth, height: frameHeight };
  const outline = els.navigationThumbViewport.style;
  outline.left = `${rect.x / frameWidth * 100}%`;
  outline.top = `${rect.y / frameHeight * 100}%`;
  outline.width = `${rect.width / frameWidth * 100}%`;
  outline.height = `${rect.height / frameHeight * 100}%`;
}

function scheduleNavigationThumbnail() {
  updateNavigationViewport();
  window.clearTimeout(navigationThumbnail.timer);
  if (!state.session || state.zoomMode !== "custom" || state.zoomPercent < 100) return;
  navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
}

function navigationThumbnailWorkReady() {
  const lane = state.currentView;
  const accepted = state.acceptedPresentation;
  return !state.importInProgress && !state.zoomRefinementTimer
    && !state.gpuDraftInFlight && !state.previewScheduler?.interacting
    && !state.gpuScopeRequestInFlight && !state.scopeRequestInFlight
    && !(state.gpuPreview?.activeRenderCount > 0)
    && !(state.gpuPreview?.activeScopeCount > 0)
    && accepted?.lane === lane && accepted.exact
    && accepted.generation === state.previewGeneration[lane]
    && accepted.geometrySignature === geometrySignature()
    && accepted.processedLongEdge >= requiredProcessingLongEdge();
}

async function refreshNavigationThumbnail() {
  if (!state.session || state.zoomMode !== "custom" || state.zoomPercent < 100) return;
  // Overview work starts only after the requested picture and scopes settle.
  // The GPU route grades a separate 512-edge canvas; CPU mode keeps its small
  // fallback here, outside foreground refinement.
  if (!navigationThumbnailWorkReady()) {
    navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
    return;
  }
  const sessionId = state.session.session_id;
  const lane = state.currentView;
  if (await syncGlobalEditState() === false || state.session?.session_id !== sessionId) return;
  if (!navigationThumbnailWorkReady()) {
    navigationThumbnail.timer = window.setTimeout(() => { void refreshNavigationThumbnail(); }, 300);
    return;
  }
  const request = window.HDRWholeImagePreviewPipe.request("navigation", state.session.source.width,
    { sessionId, lane, editRevision: state.editRevision, generation: state.previewGeneration[lane],
      geometrySignature: geometrySignature(), includeLocals: !state.compareWithoutLocals });
  const key = JSON.stringify(request);
  if (navigationThumbnail.key === key && navigationThumbnail.url) return;
  if (navigationThumbnail.inflightKey === key && navigationThumbnail.controller) return;
  navigationThumbnail.controller?.abort();
  const controller = new AbortController();
  navigationThumbnail.controller = controller;
  navigationThumbnail.inflightKey = key;
  const isCurrent = () => controller === navigationThumbnail.controller
    && state.session?.session_id === sessionId && state.currentView === lane
    && state.editRevision === request.editRevision && !state.globalEditDirty
    && state.previewGeneration[lane] === request.generation
    && geometrySignature() === request.geometrySignature
    && state.zoomMode === "custom" && state.zoomPercent >= 100
    && request.includeLocals === !state.compareWithoutLocals
    && !state.previewScheduler?.interacting && !state.gpuDraftInFlight;
  try {
    let blob;
    if (gpuPreviewEligible(lane) && state.activeWorkflow !== "proof") {
      blob = await state.gpuPreview.renderNavigationProxy(sessionId, lane, state.adjustments, sampleCurvePoints,
        request.includeLocals ? localAdjustments() : [], request.editRevision, projectReferenceWhiteNits(),
        { width: state.session.source.width, height: state.session.source.height },
        { applicationGeneration: request.generation, isCurrent });
    } else {
      const response = await fetch(`/api/session/${sessionId}/preview/${lane}?purpose=navigation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edit_revision: request.editRevision, include_locals: !state.compareWithoutLocals,
          long_edge: request.longEdge, execution: "whole", hdr_display: false }),
        signal: controller.signal,
      });
      if (!response.ok) return;
      blob = await response.blob();
    }
    if (!blob || !isCurrent()) return;
    const url = URL.createObjectURL(blob);
    const previous = navigationThumbnail.url;
    navigationThumbnail.url = url;
    navigationThumbnail.key = key;
    els.navigationThumbImage.onload = updateNavigationViewport;
    els.navigationThumbImage.src = url;
    if (previous) URL.revokeObjectURL(previous);
  } catch (error) {
    if (error.name !== "AbortError") console.warn("Navigation thumbnail unavailable", error);
  } finally {
    if (navigationThumbnail.controller === controller) {
      navigationThumbnail.controller = null;
      navigationThumbnail.inflightKey = "";
    }
  }
}

function scheduleZoomRefinement({ continuous = false } = {}) {
  if (!state.session || !gpuPreviewEligible(state.currentView)) return;
  window.clearTimeout(state.zoomRefinementTimer);
  // A pending adjustment settle from the previous scale can otherwise race
  // this zoom and start a whole-frame CPU fallback at the new edge.
  state.previewScheduler?.cancel();
  state.inactiveSourceController?.abort();
  state.inactiveSourceController = null;
  // Zoom changes the requested processing scale without changing the edit
  // generation. Recompute the visible status before the replacement starts.
  renderViewerStatus();
  // Single navigation actions need no gesture debounce. Retain it for wheel
  // and slider input so a gesture replaces pending work instead of flooding it.
  state.zoomRefinementTimer = window.setTimeout(async () => {
    state.zoomRefinementTimer = 0;
    if (!state.session || !gpuPreviewEligible(state.currentView)) return;
    const target = requiredProcessingLongEdge();
    const lane = state.currentView;
    const sessionId = state.session.session_id;
    if (state.acceptedPresentation?.processedLongEdge !== target) {
      const decision = interactiveScaleDecision(lane);
      if (decision.coarse && decision.edge < target) {
        // Zoom can require the tiled renderer even for its reduced pass.
        // Interactive tier explicitly refuses tiles; refinement tier accepts
        // them while the coarse flag keeps the presentation truthful.
        await renderGpuDraft(lane, { tier: "refinement", longEdge: responseCoarseLongEdge(target),
          coarse: true, reason: "zoom-current-coarse" });
      }
      // A failed, cancelled, or superseded coarse pass never cancels the exact
      // obligation. A newer zoom owns its own request and wins at presentation.
      if (state.session?.session_id !== sessionId || state.currentView !== lane
        || requiredProcessingLongEdge() !== target) return;
      if (state.acceptedPresentation?.processedLongEdge !== target
        || !state.acceptedPresentation.exact) {
        await renderGpuDraft(lane, { tier: "refinement", longEdge: target, reason: "zoom-scale" });
      }
    } else {
      noteViewerPan();
    }
    // Zoom cancels the adjustment scheduler, including its scope obligation.
    // Restore scopes only after the replacement frame is exact and current;
    // a superseded zoom must not analyze the next zoom's old canvas.
    const accepted = state.acceptedPresentation;
    if (state.session?.session_id === sessionId && state.currentView === lane
      && requiredProcessingLongEdge() === target && accepted?.lane === lane
      && accepted.generation === state.previewGeneration[lane]
      && accepted.exact && accepted.processedLongEdge === target) {
      await refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane });
    }
  }, continuous ? 80 : 0);
}

function shouldKeepHdrGpuSurface(lane) {
  return lane === state.currentView
    && Boolean(state.gpuPreview?.available)
    && !state.comparePeekActive;
}

function setCustomZoom(percent, anchor = null, { continuous = false } = {}) {
  const nextPercent = clamp(Number(percent) || 100, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
  const changed = state.zoomMode !== "custom" || Math.abs(state.zoomPercent - nextPercent) > 0.001;
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
  scheduleNavigationThumbnail();
  if (changed) scheduleZoomRefinement({ continuous });
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
  if (state.geometryPresentationPending && !state.perspectiveDraftFrame) {
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
  const draftFrame = state.perspectiveDraftFrame?.signature === geometrySignature
    ? state.perspectiveDraftFrame : null;
  const draftScale = Math.min(1, perspectiveDraftLongEdge() / Math.max(state.session.source.width, state.session.source.height));
  const sourceFrame = draftFrame
    ? { width: draftFrame.width / draftScale, height: draftFrame.height / draftScale }
    : sourcePixelFrameDimensions(state.rotateDraftGeometry || state.adjustments?.shared?.geometry);
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
  const deviceRatio = Math.max(1, Number(window.devicePixelRatio) || 1);
  const fitPercent = Math.min(paneWidth * deviceRatio / fitSourceWidth,
    paneHeight * deviceRatio / fitSourceHeight) * 100;
  const percent = state.zoomMode === "fit" ? fitPercent : state.zoomPercent;
  const displayWidth = Math.max(1, sourceWidth * percent / (100 * deviceRatio));
  const displayHeight = Math.max(1, sourceHeight * percent / (100 * deviceRatio));
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
  // Past 100% one source pixel covers more than one device pixel. Show it as
  // a flat square, the way an inspection zoom should; at and below 100% the
  // compositor keeps its smooth filtering so Fit does not alias.
  const magnified = percent > 100.5;
  for (const element of [els.previewCanvas, els.comparisonCanvas, els.previewImage, els.comparisonImage]) {
    element.classList.toggle("pixel-magnified", magnified);
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
  setCustomZoom(nextPercent, { clientX: event.clientX, clientY: event.clientY, previewElement: preview }, { continuous: true });
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
  const technical = readoutDockTab(tab);
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  renderReadoutPanelMode(tab);
  els.scopeMode.value = technical ? tab : tab === "parade" ? "waveform" : tab;
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
  if (path.includes(".black_and_white.")) return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}`;
  if (path.includes(".detail.")) return `${numeric > 0 && !path.endsWith("sharpen_threshold") ? "+" : ""}${Math.round(numeric)}`;
  if (path.endsWith("_hue")) return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}°`;
  if (path.endsWith("_purity") || path.endsWith(".saturation") || path.endsWith(".vibrance")) return `${numeric > 0 ? "+" : ""}${Math.round(path.endsWith("_purity") ? numeric : numeric * 100)}%`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path.endsWith("_nits")) return `${Math.round(numeric)} nit`;
  if (path.endsWith("highlight_compression_start_percent") || path.endsWith("highlight_compression_manual_peak_percent")) return `${Math.round(numeric)}%`;
  if (path.endsWith("film_look.halation_radius")) return `${numeric.toFixed(2)}% 35mm gate`;
  if (path.endsWith("film_look.bloom_radius")) return `${numeric.toFixed(2)}% output diag`;
  if (path.includes("film_look")) {
    const signed = /(contrast|toe|shoulder|density|hue_offset)$/.test(path);
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
  if (path.endsWith("contrast_pivot")) return numeric.toFixed(path.startsWith("hdr.") ? 4 : 3);
  if (path.endsWith("contrast") || path.endsWith("lift") || path.endsWith("gain") || path.endsWith("gamma") || path.endsWith("shadow_lift")) return numeric.toFixed(3);
  return numeric.toFixed(2);
}

// Only the fields Crop & Rotate itself owns -- Perspective has its own
// independent Reset and shouldn't be swept up by this one.
function filmGrainChromaInactive() {
  return state.adjustments?.[state.currentView]?.film_look?.grain_film_type === "black_and_white";
}

function renderFilmGrainChroma() {
  const chroma = document.getElementById("film-grain-chroma");
  if (!chroma) return;
  if (state.session) chroma.disabled = filmGrainChromaInactive();
}

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmLook = state.adjustments[state.currentView]?.film_look;
  document.querySelector("[data-film-grain-custom]")?.toggleAttribute("hidden", filmLook?.grain_film_format !== "custom");
  renderFilmGrainChroma();
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
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve") && !key.endsWith("_section_enabled") && !["highlight_compression_source_peak_nits", "highlight_compression_source_peak_percent"].includes(key));
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
  const blackAndWhiteModified = state.adjustments[state.currentView]?.black_and_white_section_enabled === true
    || !valuesEqual(state.adjustments[state.currentView]?.black_and_white, currentLaneDefaults.black_and_white);
  document.querySelector(".black-and-white-group")?.classList.toggle("modified", blackAndWhiteModified);
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

function laneCurvesModified(lane, defaults = defaultAdjustments()) {
  return ["luma_curve", "red_curve", "green_curve", "blue_curve"]
    .some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]));
}

function resetControlGroup(group) {
  if (group === "denoise") {
    const lane = state.currentView;
    const defaults = defaultDenoiseDocument()[lane];
    state.denoise[lane].controls = JSON.parse(JSON.stringify(defaults.controls));
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
    if (state.perspectiveApplyOperation?.saving) return;
    if (state.perspectiveMode) closePerspectiveMode(false);
    state.perspectiveFailedDraft = null;
    const changed = paths.some((path) => !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path)));
    paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
    if (!changed && !state.globalEditDirty) {
      setPerspectiveStatus("Perspective reset.", "applied");
      renderPerspectiveControls();
      return;
    }
    const signature = geometrySignature();
    state.perspectiveApplyOperation = { sessionId: state.session?.session_id, saving: false, signature };
    state.geometryTransformHandoffSignature = signature;
    state.geometryPresentationPending = true;
    state.gpuPreparedLane = { hdr: false, sdr: false };
    syncControlsFromState();
    setPerspectiveStatus("Perspective reset. Updating the preview…", "applying");
    renderPerspectiveControls();
    renderControlState();
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
    return;
  }
  if (group === "geometry") {
    // Perspective is its own module with its own Reset now -- this one only
    // touches what Crop & Rotate owns (rotation, flip, straighten, crop rect,
    // aspect), and leaves an open Perspective draft alone entirely.
    const current = state.cropDraftGeometry || state.adjustments.shared.geometry;
    if (!cropRotateGeometryModified(current, defaults.shared.geometry) && !state.rotateDraftGeometry) return;
    // No confirmation. Every other Reset in the panel acts immediately and is
    // undoable, and this one was the only native `confirm` in the authoring
    // surface -- which on Windows left the renderer unable to open a <select>
    // popup until the window lost and regained focus.
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
  state.adjustments[lane].film_look = defaultFilmLook();
  state.adjustments[lane].film_look_section_enabled = true;
  syncControlsFromState();
  invalidatePreview(lane);
  renderControlState();
  debouncePreview(lane);
}

function matchHdrFilmLookToSdr() {
  if (!state.session) return;
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

/** Copy HDR's Black & White, sliders and on/off, to SDR once (BW-01). */
function matchHdrBlackAndWhiteToSdr() {
  if (!state.session) return;
  state.adjustments.sdr.black_and_white = JSON.parse(JSON.stringify(state.adjustments.hdr.black_and_white));
  state.adjustments.sdr.black_and_white_section_enabled = state.adjustments.hdr.black_and_white_section_enabled === true;
  syncControlsFromState();
  invalidatePreview("sdr");
  renderControlState();
  debouncePreview("sdr");
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
  if (next === "proof" && state.currentView !== "hdr") switchLane("hdr");
  renderWorkflowContext();
  window.HDRProofing?.render();
  window.dispatchEvent(new CustomEvent("hdrfinisher:workflowchange", { detail: { workflow: next } }));
  renderVignetteCenter();
  renderLocalMaskOverlay();
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

function syncProjectBadge() {
  if (!els.badge) return;
  const projectName = state.projectPath
    ? String(state.projectPath).split(/[/\\]/).pop()
    : state.session?.source?.filename || "No project";
  els.badge.textContent = state.documentDirty ? `${projectName} · Unsaved` : projectName;
  els.badge.className = `badge ${state.documentDirty ? "warn" : "neutral"}`;
}

function syncDesktopDocumentState() {
  syncProjectBadge();
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
function recordAcknowledgedLocals(documentState) {
  const signatures = new Map();
  const signature = window.HDRWebGPUPreview?.spatialMaskSignature;
  if (signature) {
    const visit = (localId, expression, path) => {
      if (!expression) return;
      signatures.set(`${localId}|${path}`, signature(expression));
      (expression.children || []).forEach((child, index) => visit(localId, child, path ? `${path}.${index}` : String(index)));
    };
    for (const local of documentState?.local_adjustments || []) visit(local.id, local.mask, "");
  }
  state.acknowledgedMaskSignatures = signatures;
}

/** Acknowledged spatial signature, null for a local the backend has not seen. */
function acknowledgedMaskSignature(localId, maskPath = "") {
  if (!state.acknowledgedMaskSignatures) return undefined;
  return state.acknowledgedMaskSignatures.get(`${localId}|${maskPath || ""}`) ?? null;
}

function stablePreviewJson(value) {
  return JSON.stringify(value ?? null, (key, entry) => (entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map((name) => [name, entry[name]]))
    : entry));
}

/**
 * `refreshPreview` is true (always re-render on success), false, or
 * "if-changed": re-render only when the acknowledged document changes what the
 * preview draws. The optimistic edit already rendered its own values, so an
 * acknowledgement that matches them has nothing new to show.
 */
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
    const shownInputs = refreshPreview === "if-changed"
      ? stablePreviewJson([state.adjustments, state.editDocument?.local_adjustments]) : null;
    state.editRevision = result.revision;
    state.editDocument = result.document;
    recordAcknowledgedLocals(result.document);
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
    if (commandType === "undo" || commandType === "redo" || commandType === "revert_rendition") {
      // History and revert responses replace the complete serialized edit document. Keep
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
    // A global-edit save used to
    // start a new render generation for values already on screen, both during
    // a drag (the scope pass saves) and after release, where it cost a
    // duplicate render and the settle debounce before the settled pass.
    const previewInputsChanged = refreshPreview === "if-changed"
      ? stablePreviewJson([state.adjustments, state.editDocument?.local_adjustments]) !== shownInputs
      : refreshPreview;
    if (previewInputsChanged) {
      invalidatePreview("hdr", { local: true });
      invalidatePreview("sdr", { local: true });
      debouncePreview(state.currentView);
    }
    if (status.get("edit")?.severity === "error") {
      status.post({ id: "edit", severity: "success", message: "Edits saved." });
    }
    return true;
  }).catch((error) => {
    console.error(error);
    status.post({ id: "edit", severity: "error", message: error.message });
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
  // A plain global save only re-renders if the backend's document differs from
  // the optimistic values already drawn.
  const pending = queueEditCommand("set_global_adjustments", { adjustments }, null, {
    globalEditGeneration: generation, historyGroup, refreshPreview: "if-changed",
  });
  state.globalEditSyncPending = pending;
  const applied = await pending;
  if (state.session?.session_id !== sessionId) return false;
  if (state.globalEditSyncPending === pending) state.globalEditSyncPending = null;
  if (!applied) state.globalEditDirty = true;
  if (!applied && state.perspectiveApplyOperation?.signature === geometrySignature()) {
    setPerspectiveStatus("Perspective changes could not be saved. Try Reset again or review the edit error.", "failed");
  }
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
  recordAcknowledgedLocals(result.document);
  loadDenoiseDocument(state.editDocument);
  if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
  state.documentDirty = state.globalEditDirty || Boolean(result.dirty);
  state.adjustments = result.document.global_adjustments;
  if (draftGeometry) state.adjustments.shared.geometry = draftGeometry;
  // Rebuilding the active range input releases pointer capture. Keep the
  // existing control alive while its optimistic local object is still in use.
  if (!preserveLocalDraft) renderLocalAdjustments();
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
  const generation = claimSessionReplacement();
  if (state.activeImportJobId) {
    await projectIo.cancelImportJob(fetch, state.activeImportJobId).catch(() => null);
  }
  if (generation !== state.importGeneration) return;
  await state.byteUploadQueue.catch(() => null);
  if (generation !== state.importGeneration) return;
  status.post({ id: "import", severity: "progress", message: "Loading image and building session…", progress: "indeterminate" });
  state.importInProgress = true;
  updateExportAvailability();
  setIndeterminatePreviewMessage("Starting import · 0.0s elapsed");
  setImportCancelVisible(true);
  const { response, payload: initialJob } = await projectIo.createImportJob(fetch, {
    grant: selection.grant,
    rawImportSettings: selection.rawImportSettings,
    replaceSessionId: selection.replaceSessionId,
  });
  let job = initialJob;
  if (generation !== state.importGeneration) {
    if (job?.job_id) await projectIo.cancelImportJob(fetch, job.job_id).catch(() => null);
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
  while (generation === state.importGeneration && state.activeImportJobId === job.job_id) {
    const elapsed = (performance.now() - startedAt) / 1000;
    const label = job.phase_label || "Preparing source";
    const reassurance = elapsed >= 10 ? " · still working normally" : "";
    setIndeterminatePreviewMessage(`${label}${reassurance} · ${elapsed.toFixed(1)}s elapsed`);
    if (job.state === "ready" && job.session_id) {
      const { response: sessionResponse, payload } = await projectIo.fetchSession(fetch, job.session_id);
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
      status.post({ id: "import", severity: "success", message: "Source imported." });
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
    const { response: poll, payload } = await projectIo.pollImportJob(fetch, job.job_id);
    job = payload;
    if (!poll.ok) {
      state.activeImportJobId = null;
      state.importInProgress = false;
      setImportCancelVisible(false);
      showUploadError(job?.detail || "Import progress could not be read.");
      return;
    }
  }
}

async function cancelActiveImport() {
  if (!state.importInProgress) return;
  const jobId = state.activeImportJobId;
  state.importGeneration += 1;
  state.activeImportJobId = null;
  state.importInProgress = false;
  setImportCancelVisible(false);
  setIndeterminatePreviewMessage("Cancelling import...");
  updateExportAvailability();
  if (jobId) {
    await projectIo.cancelImportJob(fetch, jobId).catch(() => null);
  }
  finishCancelledImport();
}

function finishCancelledImport() {
  state.importInProgress = false;
  setImportCancelVisible(false);
  hidePreviewMessage();
  if (!state.session) clearPreviewImage();
  status.post({
    id: "import",
    severity: "success",
    message: state.session ? "Import cancelled. Current image kept." : "Import cancelled.",
  });
  updateExportAvailability();
}

async function activateDesktopSession(session, projectPath) {
  retireActiveSession();
  state.session = session;
  state.renderCoordinator?.noteSource(session.session_id);
  state.importInProgress = false;
  if (els.rawSettingsPanel) delete els.rawSettingsPanel.dataset.initialized;
  state.adjustments = session.adjustments;
  state.editDocument = session.edit_document;
  loadDenoiseDocument(state.editDocument);
  state.editRevision = session.edit_revision || 0;
  recordAcknowledgedLocals(state.editDocument);
  state.documentDirty = Boolean(session.dirty);
  state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null;
  state.projectPath = projectPath || "";
  state.currentView = "hdr";
  // A source replacement starts as a new viewing task. Carrying an Actual or
  // custom zoom across differently-sized files makes the first authoritative
  // frame arrive cropped or far off-screen, so every import begins at Fit.
  state.zoomMode = "fit";
  state.zoomPercent = 100;
  state.zoomReferenceFrame = null;
  if (!projectPath) await applyNewSessionPreferences();
  state.interpretationGateDismissed = false;
  state.gpuPreview?.resetSession(session.session_id);
  if (state.gpuPreview?.warmDenoiseModel) {
    const native = Math.max(session.source.width, session.source.height);
    void state.gpuPreview.warmDenoiseModel(session.session_id, "hdr", native);
  }
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
    const replacementGeneration = ++state.importGeneration;
    const activeJobId = state.activeImportJobId;
    state.activeImportJobId = null;
    if (activeJobId) await projectIo.cancelImportJob(fetch, activeJobId).catch(() => null);
    await state.byteUploadQueue.catch(() => null);
    if (replacementGeneration !== state.importGeneration) return;
    const openGeneration = ++state.projectOpenGeneration;
    state.projectOpenController?.abort();
    const controller = new AbortController();
    state.projectOpenController = controller;
    let projectActivated = false;
    els.projectOpen.disabled = true;
    const statusTimer = beginProjectOpenStatus(selection.path?.split(/[\\/]/).pop() || "loading source");
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    try {
      let result = await projectIo.openDesktopProject(fetch, {
        projectGrant: selection.grant,
        signal: controller.signal,
      }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
      if (!result || openGeneration !== state.projectOpenGeneration) return;
      let { response, payload } = result;
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
        const source = await desktop.relinkSource();
        if (!source || openGeneration !== state.projectOpenGeneration) {
          status.clear("project-open");
          return;
        }
        result = await projectIo.openDesktopProject(fetch, {
          projectGrant: selection.grant,
          sourceGrant: source.grant,
          signal: controller.signal,
        }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
        if (!result || openGeneration !== state.projectOpenGeneration) return;
        ({ response, payload } = result);
      }
      if (openGeneration !== state.projectOpenGeneration) return;
      if (!response.ok || !payload?.session) {
        status.post({
          id: "project-open",
          severity: "error",
          message: responseErrorMessage(payload, "The project could not be opened."),
        });
        return;
      }
      await activateDesktopSession(payload.session, selection.path);
      projectActivated = true;
      status.post({ id: "project-open", severity: "success", message: "Project opened." });
      return;
    } catch (error) {
      if (error?.name !== "AbortError") {
        status.post({ id: "project-open", severity: "error", message: error?.message || "The project could not be opened." });
      }
      return;
    } finally {
      if (openGeneration === state.projectOpenGeneration) {
        window.clearInterval(statusTimer);
        els.projectOpen.disabled = false;
        if (!projectActivated) hidePreviewMessage();
        if (!projectActivated && status.get("project-open")?.severity === "progress") status.clear("project-open");
      }
    }
  }
  const path = await window.HDRDialogs.prompt(
    "Path to a .hdrfinisher project", state.projectPath || "",
    { title: "Open project", confirmLabel: "Open" },
  );
  if (!path) return;
  const replacementGeneration = ++state.importGeneration;
  await state.byteUploadQueue.catch(() => null);
  if (replacementGeneration !== state.importGeneration) return;
  const statusTimer = beginProjectOpenStatus(path.split(/[\\/]/).pop() || "loading source");
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  let sourcePath = null;
  try {
    let result = await projectIo.openPathProject(fetch, { path });
    let { response, payload } = result;
    if (!response.ok && projectOpenNeedsSourceRelink(payload)) {
      sourcePath = await window.HDRDialogs.prompt(
        "The saved source is unavailable or changed. Select the matching original source path.",
        "", { title: "Relink source" },
      );
      if (!sourcePath) {
        status.clear("project-open");
        return;
      }
      result = await projectIo.openPathProject(fetch, { path, sourcePath });
      ({ response, payload } = result);
    }
    if (!response.ok || !payload?.session) {
      status.post({
        id: "project-open",
        severity: "error",
        message: responseErrorMessage(payload, "The project could not be opened."),
      });
      return;
    }
    await activateDesktopSession(payload.session, path);
    status.post({ id: "project-open", severity: "success", message: "Project opened." });
  } catch (error) {
    status.post({ id: "project-open", severity: "error", message: error?.message || "The project could not be opened." });
  } finally {
    window.clearInterval(statusTimer);
    hidePreviewMessage();
    if (status.get("project-open")?.severity === "progress") status.clear("project-open");
  }
}

async function saveProjectToPath({ saveAs = false } = {}) {
  if (!state.session) return false;
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  if (globalsApplied === false) {
    status.post({ id: "project-save", severity: "error", message: "The project could not be saved because the latest edit failed." });
    return false;
  }
  if (desktop) {
    const suggestedName = `${state.session.source.filename.replace(/\.[^.]+$/, "")}.hdrfinisher`;
    let selection = null;
    try {
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
    } catch (error) {
      status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
      return false;
    }
    if (!selection) return false;
    status.post({ id: "project-save", severity: "progress", message: "Saving project…", progress: "indeterminate" });
    let response;
    let payload;
    try {
      ({ response, payload } = await projectIo.saveDesktopProject(fetch, {
        sessionId: state.session.session_id,
        projectGrant: selection.grant,
      }));
    } catch (error) {
      status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
      return false;
    }
    if (!response.ok) {
      status.post({
        id: "project-save",
        severity: "error",
        message: responseErrorMessage(payload, "The project could not be saved."),
      });
      return false;
    }
    state.projectPath = payload.path;
    state.editDocument = payload.document;
    loadDenoiseDocument(state.editDocument);
    state.documentDirty = false;
    syncCopySourcePathButton();
    syncDesktopDocumentState();
    syncProjectBadge();
    status.post({ id: "project-save", severity: "success", message: `Project saved · revision ${payload.revision}` });
    return true;
  }
  const path = await window.HDRDialogs.prompt(
    "Save project path", state.projectPath || `${state.session.source.filename}.hdrfinisher`,
    { title: "Save project", confirmLabel: "Save" },
  );
  if (!path) return false;
  let sourcePath = state.editDocument?.source?.durable_path || null;
  if (!sourcePath) {
    sourcePath = await window.HDRDialogs.prompt(
      "Path to the durable original source (the project stores no source pixels)",
      "", { title: "Durable source path" },
    );
    if (!sourcePath) return false;
  }
  status.post({ id: "project-save", severity: "progress", message: "Saving project…", progress: "indeterminate" });
  let response;
  let payload;
  try {
    ({ response, payload } = await projectIo.savePathProject(fetch, {
      sessionId: state.session.session_id,
      path,
      sourcePath,
    }));
  } catch (error) {
    status.post({ id: "project-save", severity: "error", message: error?.message || "The project could not be saved." });
    return false;
  }
  if (!response.ok) {
    status.post({
      id: "project-save",
      severity: "error",
      message: responseErrorMessage(payload, "The project could not be saved."),
    });
    return false;
  }
  state.projectPath = payload.path;
  state.editDocument = payload.document;
  loadDenoiseDocument(state.editDocument);
  state.documentDirty = false;
  syncCopySourcePathButton();
  syncProjectBadge();
  status.post({ id: "project-save", severity: "success", message: `Project saved · revision ${payload.revision}` });
  return true;
}

async function confirmUnsavedTransition(actionLabel) {
  if (!state.session || !state.documentDirty) return true;
  let choice = "cancel";
  if (desktop?.confirmUnsavedTransition) {
    choice = await desktop.confirmUnsavedTransition({ actionLabel });
  } else {
    // One three-way question, not two yes-or-no ones. Asking "save?" and then
    // "discard?" makes Cancel the answer to a question the user was never
    // shown, and it put two native modals in a row on the path that broke the
    // renderer's <select> handling.
    choice = await window.HDRDialogs.choose(
      `Save changes before you ${actionLabel}?`,
      [
        { label: "Cancel", value: "cancel", cancel: true },
        { label: "Discard", value: "discard", destructive: true },
        { label: "Save", value: "save", primary: true },
      ],
      { title: "Unsaved changes" },
    ) || "cancel";
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
