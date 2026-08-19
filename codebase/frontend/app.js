const desktop = window.hdrFinisherDesktop || null;

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
    "sdr.highlight_recovery": [0, 2, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
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
    "sdr.highlight_recovery": [0, 1.5, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
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
    "sdr.highlight_recovery": [0, 1, 0.01],
    "sdr.tone_contrast": [0.5, 1.5, 0.01],
    "sdr.tone_skew": [-1, 1, 0.01],
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
  "sdr.tone_contrast": { min: 0.5, max: 1.5, decimals: 2 },
  "sdr.tone_skew": { min: -1, max: 1, decimals: 2 },
  "sdr.exposure": { min: -8, max: 8, decimals: 2 },
  "sdr.highlight_recovery": { min: 0, max: 4, decimals: 2 },
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
  "current.film_look.look_strength": { min: 0, max: 100, decimals: 0 },
  "current.film_look.print_strength": { min: 0, max: 100, decimals: 0 },
  "current.film_look.print_contrast": { min: -100, max: 100, decimals: 0 },
  "current.film_look.print_toe": { min: -100, max: 100, decimals: 0 },
  "current.film_look.print_shoulder": { min: -100, max: 100, decimals: 0 },
  "current.film_look.color_density": { min: -100, max: 100, decimals: 0 },
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
const TONE_EQUALIZER_PQ_MAX_EV = Math.log2(10000 / 100);
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
const LAYOUT_DEFAULTS = { railW: 268, gradeW: 320, dockH: 252, dockOpen: true, dockTab: "histogram" };
const LAYOUT_LIMITS = {
  railW: [200, 380],
  gradeW: [300, 420],
  dockH: [240, 340],
};
const LAYOUT_SETTLE_DELAY = 120;
const COMPACT_WORKSPACE_QUERY = "(max-width: 1499px)";
const LEGACY_UI_PREFERENCE_KEYS = new Set([
  "hdr-finisher:high-quality-preview:v1",
  "hdr-finisher:scope-zoom:v1",
  "hdr-finisher:compare-layout:v1",
  "hdr-finisher-source-collapsed",
  "hdr-finisher-chrome-proof-v1",
]);
const COMPARE_LAYOUTS = new Set(["single", "split-vertical", "split-horizontal", "side-horizontal", "side-vertical"]);
const waveformCanvasCache = new WeakMap();
const localBrushMaskCanvasCache = new Map();
const localBrushGestureCanvasCache = new WeakMap();
const localTintedMaskCanvasCache = new WeakMap();
const localAuthoritativeMaskCache = new Map();
const localAuthoritativeMaskRequests = new Map();
const geometryCoordinateMapCache = new Map();
const geometryCoordinateMapRequests = new Map();
let localMaskOverlayFrame = 0;
let pathMarchingAntFrame = 0;

const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  activeWorkflow: "import",
  gradeMode: "global",
  editDocument: null,
  editRevision: 0,
  selectedLocalId: null,
  localTool: null,
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
  localPreviewDirty: false,
  localMaskCommitDepth: 0,
  localMaskCommitRefreshPending: false,
  localErase: false,
  projectPath: "",
  globalEditDirty: false,
  globalEditGeneration: 0,
  globalEditSyncPending: null,
  documentDirty: false,
  scopeMode: "histogram",
  scopeChannelMode: "composite",
  scopeMaxNits: 4000,
  sourceSettingsOpen: false,
  metadataOpen: false,
  interpretationGateDismissed: false,
  zoomMode: "fit",
  zoomPercent: 100,
  zoomReferenceFrame: null,
  activeDockTab: "histogram",
  dockCollapsed: false,
  lastScope: null,
  scopeGeneration: 0,
  highQualityPreview: false,
  renderingMode: "auto",
  acceptedPresentation: null,
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
  cropOpening: false,
  cropDraftGeometry: null,
  rotateDraftGeometry: null,
  rotateDraftPreviewController: null,
  rotateDraftPreviewSerial: 0,
  rotateDraftPreviewTimer: null,
  rotateDraftPresentedSignature: null,
  rotateDraftPresentedGeometry: null,
  rotateDraftPreviewUrl: null,
  cropEditBaseCrop: null,
  cropGuide: "none",
  cropGridDensity: 8,
  cropDrag: null,
  geometryTool: null,
  straightenGestureActive: false,
  straightenPreviewBaseAngle: null,
  straightenPreviewFrameRect: null,
  vignettePickCenter: false,
  vignetteCenterGesture: null,
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
      highlight_section_enabled: true,
      tone_equalizer_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_compression_start_nits: 400,
      highlight_compression_target_nits: 1000,
      highlight_compression_softness: 0,
      highlight_compression_mode: "off",
      highlight_compression_peak_measurement: "maximum",
      highlight_compression_source_peak_nits: 1000,
      highlight_compression_manual_peak_nits: 1000,
      highlight_compression_peak_detail: 35,
      highlight_compression_bias: 0,
      highlight_compression_color_handling: "preserve_color",
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
      base_section_enabled: true,
      tone_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_recovery: 0.6,
      tone_contrast: 1,
      tone_skew: 0,
      shadow: 0,
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
      overlay_preset: "web_1000_100",
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
  refreshTimer: null,
  settleTimer: null,
  gpuRenderSerial: 0,
  laneSwitchGeneration: 0,
  gpuRenderFrame: null,
  gpuQueuedLane: null,
  gpuPreview: null,
  gpuSurfaceHdr: false,
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
  viewerOptionsOpen: false,
  proofEnabled: false,
  proofArtifact: null,
  proofReconstruction: null,
  proofSdrReconstruction: null,
  proofPreview: "hdr",
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
  grain_enabled: true,
  grain_amount: 0,
  grain_size: 50,
  grain_softness: 25,
  grain_chroma: 0,
  grain_shadow_response: 100,
  grain_midtone_response: 100,
  grain_highlight_response: 100,
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

const FILM_LOOK_PRESETS = {
  large_format_fine: { print_strength: 44, print_contrast: 7, print_toe: 4, print_shoulder: 10, color_density: 10, grain_amount: 16, grain_size: 22, grain_softness: 48, grain_chroma: 12, grain_shadow_response: 82, grain_midtone_response: 100, grain_highlight_response: 112, film_resolution: 98, halation_amount: 7, halation_sensitivity: 82, halation_radius: 0.16, halation_hue_offset: 0, halation_saturation: 70, bloom_amount: 5, bloom_sensitivity: 86, bloom_radius: 0.34, bloom_highlight_detail: 88, image_softness: 3, microcontrast: -3 },
  "35mm_fine": { print_strength: 48, print_contrast: 9, print_toe: 6, print_shoulder: 12, color_density: 13, grain_amount: 24, grain_size: 35, grain_softness: 40, grain_chroma: 16, grain_shadow_response: 86, grain_midtone_response: 100, grain_highlight_response: 116, film_resolution: 95, halation_amount: 9, halation_sensitivity: 78, halation_radius: 0.2, halation_hue_offset: 0, halation_saturation: 76, bloom_amount: 6, bloom_sensitivity: 82, bloom_radius: 0.42, bloom_highlight_detail: 84, image_softness: 5, microcontrast: -4 },
  "35mm_balanced": { print_strength: 52, print_contrast: 10, print_toe: 7, print_shoulder: 14, color_density: 16, grain_amount: 34, grain_size: 50, grain_softness: 34, grain_chroma: 20, grain_shadow_response: 90, grain_midtone_response: 104, grain_highlight_response: 120, film_resolution: 92, halation_amount: 11, halation_sensitivity: 74, halation_radius: 0.24, halation_hue_offset: 0, halation_saturation: 80, bloom_amount: 8, bloom_sensitivity: 78, bloom_radius: 0.5, bloom_highlight_detail: 80, image_softness: 7, microcontrast: -5 },
  "35mm_fast": { print_strength: 55, print_contrast: 8, print_toe: 9, print_shoulder: 16, color_density: 18, grain_amount: 48, grain_size: 68, grain_softness: 28, grain_chroma: 28, grain_shadow_response: 96, grain_midtone_response: 110, grain_highlight_response: 126, film_resolution: 86, halation_amount: 14, halation_sensitivity: 68, halation_radius: 0.3, halation_hue_offset: 3, halation_saturation: 84, bloom_amount: 10, bloom_sensitivity: 72, bloom_radius: 0.62, bloom_highlight_detail: 74, image_softness: 10, microcontrast: -7 },
  "16mm_fine": { print_strength: 50, print_contrast: 6, print_toe: 8, print_shoulder: 15, color_density: 15, grain_amount: 54, grain_size: 78, grain_softness: 32, grain_chroma: 24, grain_shadow_response: 100, grain_midtone_response: 112, grain_highlight_response: 128, film_resolution: 80, halation_amount: 13, halation_sensitivity: 70, halation_radius: 0.34, halation_hue_offset: 2, halation_saturation: 82, bloom_amount: 9, bloom_sensitivity: 74, bloom_radius: 0.58, bloom_highlight_detail: 76, image_softness: 13, microcontrast: -9 },
};

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
  crop: { x: 0, y: 0, width: 1, height: 1 },
  ratio_mode: "free",
  custom_ratio: { width: 1, height: 1 },
});

function geometrySignature() {
  return JSON.stringify(state.adjustments.shared?.geometry || defaultGeometry());
}

const IDENTITY_GEOMETRY_COORDINATE_MAP = Object.freeze({
  outputToSource: Object.freeze([1, 0, 0, 0, 1, 0]),
  sourceToOutput: Object.freeze([1, 0, 0, 0, 1, 0]),
});

function geometryTransformIsNeutral(geometry = state.adjustments.shared?.geometry) {
  const crop = geometry?.crop || {};
  return (Number(geometry?.rotation) || 0) === 0
    && !geometry?.flip_horizontal
    && !geometry?.flip_vertical
    && Math.abs(Number(geometry?.straighten_angle) || 0) < 1e-8
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

function affinePoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + matrix[2],
    y: matrix[3] * point.x + matrix[4] * point.y + matrix[5],
  };
}

async function ensureGeometryCoordinateMap() {
  if (!state.session || geometryTransformIsNeutral()) return IDENTITY_GEOMETRY_COORDINATE_MAP;
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
    if (signature !== geometrySignature()) return null;
    const result = {
      outputToSource: payload.output_to_source,
      sourceToOutput: payload.source_to_output,
      outputWidth: payload.output_width,
      outputHeight: payload.output_height,
    };
    geometryCoordinateMapCache.set(key, result);
    while (geometryCoordinateMapCache.size > 12) {
      geometryCoordinateMapCache.delete(geometryCoordinateMapCache.keys().next().value);
    }
    queueLocalMaskOverlayRender();
    return result;
  }).catch((error) => {
    console.warn("Source-anchored editor geometry is unavailable.", error);
    return null;
  }).finally(() => geometryCoordinateMapRequests.delete(key));
  geometryCoordinateMapRequests.set(key, request);
  return request;
}

function gpuPreviewEligible() {
  return state.renderingMode !== "cpu"
    && Boolean(state.gpuPreview?.available);
}

function acceptPresentation(lane, tier, width, height, transport, fallbackReason = "") {
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  state.acceptedPresentation = {
    lane,
    generation: state.previewGeneration[lane],
    geometrySignature: geometrySignature(),
    tier,
    width: Number(width) || null,
    height: Number(height) || null,
    longEdge,
    transport,
    fallbackReason,
  };
  const sourceEdge = Math.max(Number(state.session?.source?.width) || 0, Number(state.session?.source?.height) || 0);
  const label = tier === "refinement"
    ? `${sourceEdge && longEdge >= sourceEdge ? "Source-limited" : "High-res"} · ${longEdge}px`
    : `${fallbackReason ? "Fallback" : "Standard"}${longEdge ? ` · ${longEdge}px` : ""}`;
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = label;
  renderReadouts();
}

function markRefining() {
  if (els.previewQualityStatus) els.previewQualityStatus.textContent = "Refining…";
}

const defaultAdjustments = () => ({
  hdr: {
    tone_section_enabled: true,
    highlight_section_enabled: true,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    exposure: 0,
    highlight_compression_start_nits: 400,
    highlight_compression_target_nits: 1000,
    highlight_compression_softness: 0,
    highlight_compression_mode: "off",
    highlight_compression_peak_measurement: "maximum",
    highlight_compression_source_peak_nits: 1000,
    highlight_compression_manual_peak_nits: 1000,
    highlight_compression_peak_detail: 35,
    highlight_compression_bias: 0,
    highlight_compression_color_handling: "preserve_color",
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
    base_section_enabled: true,
    tone_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    film_look_section_enabled: true,
    color_grading_section_enabled: true,
    vignette_section_enabled: true,
    film_look: defaultFilmLook(),
    color_grading: defaultColorGrading(),
    vignette: defaultVignette(),
    exposure: 0,
    highlight_recovery: 0.6,
    tone_contrast: 1,
    tone_skew: 0,
    shadow: 0,
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
    overlay_preset: "web_1000_100",
    overlay_opacity: 0.72,
    overlay_threshold: 100,
    film_grain_seed: 271828,
    geometry: defaultGeometry(),
  },
});

// Keep the pre-session UI state on the same schema returned by the backend.
state.adjustments = defaultAdjustments();

const els = {
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
  sourceSettingsNote: document.getElementById("source-settings-note"),
  applyInterpretationButton: document.getElementById("apply-interpretation"),
  resetInterpretationButton: document.getElementById("reset-interpretation"),
  metadataToggle: document.getElementById("metadata-toggle"),
  metadataPanel: document.getElementById("metadata-panel"),
  interpretationGate: document.getElementById("interpretation-gate"),
  interpretationGateCopy: document.getElementById("interpretation-gate-copy"),
  acceptInterpretation: document.getElementById("accept-interpretation"),
  manualInterpretation: document.getElementById("manual-interpretation"),
  curveEditor: document.getElementById("curve-editor"),
  toneEqualizerEditor: document.getElementById("tone-equalizer-editor"),
  highlightCompressionGraph: document.getElementById("highlight-compression-graph"),
  highlightCompressionSummary: document.getElementById("highlight-compression-summary"),
  toneEqualizerBandValue: document.getElementById("tone-equalizer-band-value"),
  toneEqualizerBandLabel: document.getElementById("tone-equalizer-band-label"),
  toneEqualizerBandOutput: document.getElementById("tone-equalizer-band-output"),
  toneEqualizerAdd: document.getElementById("tone-equalizer-add"),
  toneEqualizerRemove: document.getElementById("tone-equalizer-remove"),
  toneEqualizerRadiusDown: document.getElementById("tone-equalizer-radius-down"),
  toneEqualizerRadiusUp: document.getElementById("tone-equalizer-radius-up"),
  toneEqualizerRadius: document.getElementById("tone-equalizer-radius"),
  curveStatus: document.getElementById("curve-status"),
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
  previewPrimaryPane: document.getElementById("preview-primary-pane"),
  previewSecondaryPane: document.getElementById("preview-secondary-pane"),
  previewCanvas: document.getElementById("preview-canvas"),
  previewImage: document.getElementById("preview-image"),
  comparisonCanvas: document.getElementById("comparison-canvas"),
  comparisonImage: document.getElementById("comparison-image"),
  previewOverlay: document.getElementById("preview-overlay"),
  localMaskOverlay: document.getElementById("local-mask-overlay"),
  straightenGridOverlay: document.getElementById("straighten-grid-overlay"),
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
  viewerOptionsToggle: document.getElementById("viewer-options-toggle"),
  viewerOptionsPopover: document.getElementById("viewer-options-popover"),
  scopeTitle: document.getElementById("scope-title"),
  scopeNote: document.getElementById("scope-note"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  scopeFreshness: document.getElementById("scope-freshness"),
  scopeMode: document.getElementById("scope-mode"),
  scopeChannelMode: document.getElementById("scope-channel-mode"),
  scopeZoom: document.getElementById("scope-zoom"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  analysisDock: document.getElementById("analysis-dock"),
  dockCollapse: document.getElementById("dock-collapse"),
  dockSummary: document.getElementById("dock-summary"),
  dockTabs: [...document.querySelectorAll("[data-dock-tab]")],
  scopeView: document.getElementById("scope-view"),
  technicalView: document.getElementById("technical-view"),
  highQualityPreview: document.getElementById("high-quality-preview"),
  previewQualityStatus: document.getElementById("preview-quality-status"),
  exportSheet: document.getElementById("export-sheet"),
  exportConfirmButton: document.getElementById("export-confirm-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportDirectoryBrowse: document.getElementById("export-directory-browse"),
  directoryBrowser: document.getElementById("directory-browser"),
  directoryBrowserPath: document.getElementById("directory-browser-path"),
  directoryBrowserGo: document.getElementById("directory-browser-go"),
  directoryBrowserUp: document.getElementById("directory-browser-up"),
  directoryBrowserStatus: document.getElementById("directory-browser-status"),
  directoryBrowserList: document.getElementById("directory-browser-list"),
  directoryBrowserClose: document.getElementById("directory-browser-close"),
  directoryBrowserCancel: document.getElementById("directory-browser-cancel"),
  directoryBrowserSelect: document.getElementById("directory-browser-select"),
  exportFormat: document.getElementById("export-format"),
  exportQuality: document.getElementById("export-quality"),
  exportQualityValue: document.getElementById("export-quality-value"),
  jpegAdvancedSettings: document.getElementById("jpeg-advanced-settings"),
  jpegGainMapQuality: document.getElementById("jpeg-gain-map-quality"),
  jpegGainMapQualityValue: document.getElementById("jpeg-gain-map-quality-value"),
  jpegGainMapScale: document.getElementById("jpeg-gain-map-scale"),
  exportResult: document.getElementById("export-result"),
  exportResultPath: document.getElementById("export-result-path"),
  copyExportPath: document.getElementById("copy-export-path"),
  revealExportPath: document.getElementById("reveal-export-path"),
  openExportPath: document.getElementById("open-export-path"),
  exportFormatChoices: [...document.querySelectorAll('input[name="export-format-choice"]')],
  formatCards: [...document.querySelectorAll("[data-format-card]")],
  preflightItems: [...document.querySelectorAll("[data-preflight]")],
  exportProofStatus: document.getElementById("export-proof-status"),
  reviewChromeProof: document.getElementById("review-chrome-proof"),
  viewButtons: [...document.querySelectorAll("[data-kind]")],
  controls: [...document.querySelectorAll("[data-path]")],
  valueOutputs: [...document.querySelectorAll("[data-value-path]")],
  lanePanels: [...document.querySelectorAll("[data-lane-panel]")],
  groupToggles: [...document.querySelectorAll(".group-toggle")],
  groupResets: [...document.querySelectorAll("[data-reset-group]")],
  sdrMatchHdrColors: document.getElementById("sdr-match-hdr-colors"),
  sdrResetColors: document.getElementById("sdr-reset-colors"),
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

const overlayPresetNotes = {
  web_1000_100: "Built for web-HDR finishing with 100 nit diffuse white and a 1000 nit highlight ceiling. Best default for AVIF gain-map work and common consumer HDR displays.",
  bt2408_1000_203: "Uses the ITU-R BT.2408 style 203 nit HDR reference white with a 1000 nit peak target. Useful when you want false color to align with PQ/HLG reference-white practice.",
  bt2408_4000_203: "Keeps the 203 nit BT.2408 reference white but stretches warning bands toward a 4000 nit mastering ceiling. Good for checking very bright highlight intent.",
  sdr_100: "Treats 100 nits as both white and ceiling. Handy when judging the SDR fallback or when you want the overlay to behave like an SDR exposure aid.",
};

const controlGroups = {
  geometry: ["shared.geometry"],
  "hdr-tone": ["hdr.exposure", "hdr.contrast", "hdr.contrast_pivot", "hdr.shadow_lift"],
  "hdr-highlights": ["hdr.highlight_compression_mode", "hdr.highlight_compression_start_nits", "hdr.highlight_compression_target_nits", "hdr.highlight_compression_softness", "hdr.highlight_compression_peak_detail", "hdr.highlight_compression_peak_measurement", "hdr.highlight_compression_manual_peak_nits", "hdr.highlight_compression_bias", "hdr.highlight_compression_color_handling"],
  "hdr-equalizer": ["hdr.tone_equalizer_nodes", "hdr.tone_equalizer_influence_radius", "hdr.tone_equalizer_smoothing"],
  "hdr-color": ["hdr.white_balance_kelvin", "hdr.tint", "hdr.saturation", "hdr.vibrance", "hdr.red_hue", "hdr.red_purity", "hdr.green_hue", "hdr.green_purity", "hdr.blue_hue", "hdr.blue_purity", "hdr.tint_hue", "hdr.tint_purity"],
  "hdr-zones": ["hdr.lift", "hdr.lift_range", "hdr.lift_pivot", "hdr.gamma", "hdr.gamma_range", "hdr.gamma_pivot", "hdr.gain", "hdr.gain_range", "hdr.gain_pivot"],
  "sdr-base": ["sdr.tone_mapper", "sdr.tone_contrast", "sdr.tone_skew"],
  "sdr-tone": ["sdr.exposure", "sdr.highlight_recovery", "sdr.contrast", "sdr.contrast_pivot", "sdr.shadow"],
  "sdr-color": ["sdr.white_balance_kelvin", "sdr.tint", "sdr.saturation", "sdr.vibrance", "sdr.red_hue", "sdr.red_purity", "sdr.green_hue", "sdr.green_purity", "sdr.blue_hue", "sdr.blue_purity", "sdr.tint_hue", "sdr.tint_purity"],
  "sdr-zones": ["sdr.lift", "sdr.lift_range", "sdr.lift_pivot", "sdr.gamma", "sdr.gamma_range", "sdr.gamma_pivot", "sdr.gain", "sdr.gain_range", "sdr.gain_pivot"],
};

const overlayPresetLevels = {
  web_1000_100: { referenceWhite: 100, peak: 1000 },
  bt2408_1000_203: { referenceWhite: 203, peak: 1000 },
  bt2408_4000_203: { referenceWhite: 203, peak: 4000 },
  sdr_100: { referenceWhite: 100, peak: 100 },
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
  "sdr-base": "sdr.base_section_enabled",
  "sdr-tone": "sdr.tone_section_enabled",
  "sdr-color": "sdr.color_section_enabled",
  "sdr-zones": "sdr.primaries_section_enabled",
};

const branchCopy = {
  hdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
  sdr: "Displays the active HDR grade or SDR fallback with current adjustments applied. Switch renditions in the Control Panel or use the layout buttons to view them side-by-side.",
};

const capabilityForFormat = {
  avif_gain_map: "avif_gain_map_encoder",
  jpeg_ultrahdr: "ultrahdr_encoder",
  sdr_png: "pillow",
};

boot();

async function boot() {
  clearLegacyUiPreferences();
  initializeLocalOverlayColor();
  initializePreviewPreferences();
  initializeInstrumentShell();
  initializePreviewScheduler();
  activateWorkflowTab("import", { focus: false });
  await initializeDesktopBridge();
  bindEvents();
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
  renderExportPreflight();
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
  state.highQualityPreview = false;
  state.scopeMaxNits = 4000;
  state.compareLayout = "single";
  if (els.highQualityPreview) els.highQualityPreview.checked = state.highQualityPreview;
  if (els.scopeZoom) els.scopeZoom.value = String(state.scopeMaxNits);
}

function initializePreviewScheduler() {
  if (!window.HDRPreviewScheduler) return;
  state.previewScheduler = new window.HDRPreviewScheduler({
    highQuality: () => state.highQualityPreview,
    onFrame: (task) => state.localMaskDraftDirty
      ? false
      : renderGpuDraft(task.lane, { longEdge: interactiveProxyLongEdge() }),
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
    sessionId: () => state.session?.session_id || null,
    previewMode: () => state.highQualityPreview ? "high-quality" : state.gpuPreview?.available ? "fast" : "cpu-fallback",
    authoringState: () => ({
      sessionId: state.session?.session_id || null,
      lane: state.currentView,
      adjustments: JSON.parse(JSON.stringify(state.adjustments)),
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
    state.viewerOptionsOpen = false;
    closeOverlayPopover({ restoreFocus: false });
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
  els.sourceRailExpand.textContent = collapsed ? "Show" : "Hide";
  els.viewerOptionsPopover.classList.toggle("open", state.compactWorkspace && state.viewerOptionsOpen);
  els.viewerOptionsToggle.setAttribute("aria-expanded", String(state.compactWorkspace && state.viewerOptionsOpen));
}

function toggleSourceRail() {
  if (state.compactWorkspace) state.compactSourceOpen = !state.compactSourceOpen;
  else state.wideSourceCollapsed = !state.wideSourceCollapsed;
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

function toggleViewerOptions() {
  if (!state.compactWorkspace) return;
  state.viewerOptionsOpen = !state.viewerOptionsOpen;
  applyResponsiveWorkspaceState();
}

function closeViewerOptions({ restoreFocus = false } = {}) {
  if (!state.viewerOptionsOpen) return;
  state.viewerOptionsOpen = false;
  applyResponsiveWorkspaceState();
  if (restoreFocus) els.viewerOptionsToggle.focus();
}

function initializeLayoutState() {
  state.layout = { ...LAYOUT_DEFAULTS };
  applyLayoutState();
}

function applyLayoutState() {
  els.appShell.style.setProperty("--rail-w", `${state.layout.railW}px`);
  els.appShell.style.setProperty("--grade-w", `${state.layout.gradeW}px`);
  els.appShell.style.setProperty("--dock-h", `${state.layout.dockH}px`);
  state.dockCollapsed = !state.layout.dockOpen;
  state.activeDockTab = state.layout.dockTab;
  els.analysisDock.classList.toggle("collapsed", state.dockCollapsed);
  els.dockCollapse.textContent = state.dockCollapsed ? "Open" : "Collapse";
  els.dockCollapse.setAttribute("aria-expanded", String(!state.dockCollapsed));
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === state.activeDockTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = state.activeDockTab === "technical";
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  if (!technical) {
    state.scopeMode = state.activeDockTab === "vectorscope"
      ? "vectorscope"
      : state.activeDockTab === "waveform" || state.activeDockTab === "parade" ? "waveform" : "histogram";
    state.scopeChannelMode = state.activeDockTab === "parade" ? "parade" : "composite";
    els.scopeMode.value = state.scopeMode;
    els.scopeChannelMode.value = state.scopeChannelMode;
  }
  updateSplitterAria();
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
      els.appShell.style.setProperty(cssVar, `${pendingValue}px`);
      element.setAttribute("aria-valuenow", String(Math.round(pendingValue)));
    });
  };

  const commit = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
      state.layout[stateKey] = pendingValue;
      els.appShell.style.setProperty(cssVar, `${pendingValue}px`);
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

function enhanceRangeControl(control) {
  if (!control || control.closest(".range-shell")) return;
  const shell = document.createElement("span");
  shell.className = "range-shell";
  const track = document.createElement("span");
  track.className = "slider-track";
  const fill = document.createElement("span");
  fill.className = "slider-fill";
  const ticks = document.createElement("span");
  ticks.className = "slider-ticks";
  ticks.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 9; index += 1) ticks.append(document.createElement("i"));
  control.before(shell);
  shell.append(track, fill, ticks, control);
  updateRangeVisual(control);
  control.addEventListener("input", () => updateRangeVisual(control));
  bindInstrumentRangePointer(control, shell);
}

function enhanceEditableGradeValues() {
  els.valueOutputs.forEach((output) => {
    const path = output.dataset.valuePath;
    const rule = MANUAL_VALUE_RULES[path];
    if (!rule || !output.closest("#grade-workflow-panel")) return;
    bindEditableValue(output, {
      getValue: () => getValueByPath(state.adjustments, path),
      normalize: (text) => normalizeManualControlValue(path, text),
      commit: ({ value }) => commitAdjustmentValue(path, value, { manual: true }),
      label: () => `${output.closest(".control-heading")?.querySelector("label")?.textContent?.trim() || path} value`,
      range: () => manualRangeLabel(path, rule),
    });
  });

  bindEditableValue(els.toneEqualizerBandOutput, {
    getValue: () => currentToneEqualizerNodes()[state.selectedToneEqualizerBand]?.adjustment_ev ?? 0,
    normalize: (text) => normalizeManualNumber(text, {
      min: toneEqualizerBandLimits(state.selectedToneEqualizerBand)[0],
      max: toneEqualizerBandLimits(state.selectedToneEqualizerBand)[1],
      decimals: 2,
    }),
    commit: ({ value }) => setToneEqualizerBand(state.selectedToneEqualizerBand, value),
    label: () => "Selected Exposure Band adjustment",
    range: () => {
      const [minimum, maximum] = toneEqualizerBandLimits(state.selectedToneEqualizerBand);
      return `${formatSignedEv(minimum, 2)} to ${formatSignedEv(maximum, 2)}`;
    },
  });

  bindEditableValue(els.toneEqualizerRadius, {
    getValue: () => state.adjustments.hdr.tone_equalizer_influence_radius,
    normalize: (text) => normalizeManualNumber(text, { min: 0.25, max: 12, decimals: 2 }),
    commit: ({ value }) => {
      state.adjustments.hdr.tone_equalizer_influence_radius = value;
      syncToneEqualizerControls();
      drawToneEqualizerEditor();
      renderControlState();
    },
    label: () => "Exposure Band influence",
    range: () => "0.25 EV to 12.00 EV",
  });
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
  shell.style.setProperty("--pos", `${percent}%`);
  shell.style.setProperty("--fill-w", `${percent}%`);
}

function syncRangeVisuals(root = document) {
  root.querySelectorAll?.('input[type="range"]').forEach(updateRangeVisual);
}

function bindInstrumentRangePointer(control, shell) {
  control.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || control.disabled) return;
    event.preventDefault();
    control.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const rect = control.getBoundingClientRect();
    const minimum = Number(control.min);
    const maximum = Number(control.max);
    const step = Number(control.step) || (maximum - minimum) / 100;
    const startX = event.clientX;
    const startValue = Number(control.value);
    const precision = event.altKey ? 0.05 : event.shiftKey ? 0.2 : 1;
    shell.classList.add("dragging");
    control.setPointerCapture(pointerId);

    const quantize = (requested) => {
      const clamped = clamp(requested, minimum, maximum);
      const steps = Math.round((clamped - minimum) / step);
      return clamp(minimum + steps * step, minimum, maximum);
    };
    const setFromPointer = (clientX) => {
      const requested = precision < 1
        ? startValue + ((clientX - startX) / Math.max(rect.width, 1)) * (maximum - minimum) * precision
        : minimum + clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1) * (maximum - minimum);
      const next = quantize(requested);
      if (Number(control.value) === next) return;
      control.value = String(next);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    };

    setFromPointer(event.clientX);
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      setFromPointer(moveEvent.clientX);
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
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await uploadFile(file);
    event.target.value = "";
  });
  els.importButton.addEventListener("click", requestSourceImport);
  els.testPatternButton.addEventListener("click", async () => {
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
  els.projectOpen?.addEventListener("click", openProjectFromPath);
  els.projectSave?.addEventListener("click", saveProjectToPath);
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
  els.metadataToggle.addEventListener("click", () => {
    state.metadataOpen = !state.metadataOpen;
    renderMetadataVisibility();
  });
  els.acceptInterpretation.addEventListener("click", () => {
    state.interpretationGateDismissed = true;
    renderInterpretationGate();
    renderExportPreflight();
  });
  els.manualInterpretation.addEventListener("click", openManualInterpretation);
  els.interpretationMode.addEventListener("change", () => {
    renderSourceSettingsControls();
  });
  els.scopeMode.addEventListener("change", async () => {
    state.scopeMode = els.scopeMode.value;
    await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
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
  els.highQualityPreview?.addEventListener("change", () => {
    state.highQualityPreview = els.highQualityPreview.checked;
    state.gpuPreview?.resetSession(state.session?.session_id || null);
    state.gpuPreparedLane = { hdr: false, sdr: false };
    if (state.session) {
      invalidatePreview(state.currentView);
      if (state.highQualityPreview) markRefining();
      debouncePreview(state.currentView);
    }
    renderReadouts();
  });

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
          await uploadFile(file);
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
    control.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
    ["pointerup", "pointercancel", "change"].forEach((eventName) => {
      control.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
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
  els.directoryBrowserGo.addEventListener("click", () => loadExportDirectory(els.directoryBrowserPath.value));
  els.directoryBrowserUp.addEventListener("click", () => loadExportDirectory(els.directoryBrowser.dataset.parent));
  els.directoryBrowserPath.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadExportDirectory(els.directoryBrowserPath.value);
  });
  [els.directoryBrowserClose, els.directoryBrowserCancel].forEach((button) => {
    button.addEventListener("click", closeExportDirectoryBrowser);
  });
  els.directoryBrowserSelect.addEventListener("click", selectExportDirectory);
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
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
      if (group === els.localAdjustmentGroup) setGradeMode(collapsed ? "global" : "local");
      renderVignetteCenter();
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(button.dataset.resetGroup));
  });
  els.sdrMatchHdrColors.addEventListener("click", matchHdrColorsToSdr);
  els.sdrResetColors.addEventListener("click", resetSdrColorSliders);
  els.filmLookReset?.addEventListener("click", resetFilmLook);
  els.filmLookMatchHdr?.addEventListener("click", matchHdrFilmLookToSdr);
  els.colorGradingReset?.addEventListener("click", () => resetLaneObject("color_grading", defaultColorGrading()));
  els.colorGradingMatchHdr?.addEventListener("click", () => matchLaneObject("color_grading"));
  els.vignetteReset?.addEventListener("click", () => resetLaneObject("vignette", defaultVignette()));
  els.vignetteMatchHdr?.addEventListener("click", () => matchLaneObject("vignette"));
  bindColorWheels();
  bindCropEditor();
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
  els.overlayToggle.addEventListener("click", toggleOverlayPopover);
  els.overlayClose.addEventListener("click", closeOverlayPopover);
  els.viewerOptionsToggle.addEventListener("click", toggleViewerOptions);
  document.addEventListener("pointerdown", (event) => {
    if (state.compactSourceOpen && !event.target.closest(".source-rail")) closeCompactSourceRail();
    if (state.viewerOptionsOpen && !event.target.closest("#viewer-options-popover, #viewer-options-toggle, #overlay-popover")) closeViewerOptions();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.overlayPopover.classList.contains("hidden")) {
      event.preventDefault();
      closeOverlayPopover();
      return;
    }
    if (state.viewerOptionsOpen) {
      event.preventDefault();
      closeViewerOptions({ restoreFocus: true });
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
  els.exportFormatChoices.forEach((choice) => {
    choice.addEventListener("change", () => {
      if (!choice.checked) return;
      els.exportFormat.value = choice.value;
      renderFormatCards();
      renderExportPreflight();
      renderWorkflowContext();
    });
  });
  els.exportQuality.addEventListener("input", () => {
    els.exportQualityValue.textContent = els.exportQuality.value;
    window.HDRProofing?.invalidate("settings");
  });
  els.jpegGainMapQuality.addEventListener("input", () => {
    els.jpegGainMapQualityValue.textContent = els.jpegGainMapQuality.value;
    window.HDRProofing?.invalidate("settings");
  });
  els.jpegGainMapScale.addEventListener("change", () => window.HDRProofing?.invalidate("settings"));
  els.exportResizeMode?.addEventListener("change", renderOutputFinishingControls);

  bindCompareControl();
  bindKeyboardShortcuts();
  window.addEventListener("hdrfinisher:webgpulost", (event) => {
    state.displayInfo.gpu = event.detail?.message || "WebGPU device lost; using CPU fallback";
    state.gpuSurfaceHdr = false;
    renderReadouts();
    if (state.session) settlePreview(state.currentView).catch(() => null);
  });
  if (window.matchMedia) {
    ["(dynamic-range: high)", "(color-gamut: p3)", "(color-gamut: rec2020)"].forEach((query) => {
      const media = window.matchMedia(query);
      media.addEventListener?.("change", () => {
        state.displayInfo = buildDisplayProbe();
        state.displayInfo.gpu = state.gpuPreview?.detail || "Backend fallback";
        renderReadouts();
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
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Reading source file...", 8);
  try {
    const response = await fetch("/api/session", { method: "POST", body: formData });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return;
    }
    state.session = payload.session;
    setPreviewMessage("Source decoded. Preparing preview...", 28);
    state.adjustments = payload.session.adjustments;
    state.editDocument = payload.session.edit_document;
    state.editRevision = payload.session.edit_revision || 0;
    state.documentDirty = Boolean(payload.session.dirty);
    state.selectedLocalId = null;
    state.projectPath = "";
    state.currentView = "hdr";
    activateWorkflowTab("grade", { focus: false });
    state.interpretationGateDismissed = false;
    clearPreviewCache();
    state.gpuPreview?.resetSession(payload.session.session_id);
    invalidatePreview("hdr");
    invalidatePreview("sdr");
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
  } catch (error) {
    console.error(error);
    showUploadError("The upload could not reach the local HDR Finisher server.");
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
  await fetch("/api/session/current", { method: "DELETE" }).catch(() => null);
  state.session = null;
  state.adjustments = defaultAdjustments();
  state.editDocument = null;
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
  clearPreviewCache();
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
  renderExportPreflight();
}

function renderSession() {
  const session = state.session;
  renderSourceFilename(session.source.filename);
  clearPreviewOverlay();
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  syncCopySourcePathButton();
  syncInterpretationControls(session);
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
  renderExportPreflight();
  window.HDRProofing?.reset();
}

function renderMetadata(session) {
  const entries = [
    ["Size", `${session.source.width} x ${session.source.height}`],
    ["Format", session.source.suffix],
    ["Working space", session.source.working_space],
    ["Source space", session.source.source_color_space || "unknown"],
    ["Transfer", session.source.transfer_function || "unknown"],
    ["Interpretation", session.source.interpretation_mode || "auto"],
    ["Confidence", session.source.color_space_confident ? "confirmed" : "review"],
    ["Bit depth", session.metadata.bit_depth || "unknown"],
    ["Camera", session.metadata.camera_model || "n/a"],
    ["Lens", session.metadata.lens || "n/a"],
  ];
  els.metadataList.innerHTML = "";
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    els.metadataList.append(dt, dd);
  }
}

function renderReadouts() {
  renderKeyValueList(els.previewOutputList, previewOutputEntries());
  renderKeyValueList(els.displayInfoList, displayProbeEntries());
  renderKeyValueList(els.sourcePreviewList, sourceInterpretationEntries());
  renderWorkflowContext();
  const lane = currentCurveLane().toUpperCase();
  els.curveStatus.textContent = `Curve edits affect only the ${lane} preview/export branch.`;
}

function renderOverlayPresetNote() {
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  els.overlayPresetNote.textContent = overlayPresetNotes[preset] || overlayPresetNotes.web_1000_100;
  const mode = state.adjustments.shared.overlay_mode || "off";
  const label = mode === "false_color" ? "False color" : mode === "zebra" ? "Zebra" : "Off";
  els.overlayToggle.textContent = `Overlays: ${label}`;
  renderFalseColorKey(preset, mode);
  els.falseColorLegend.classList.toggle("hidden", mode !== "false_color" || !state.session);
}

function renderFalseColorKey(preset, mode) {
  if (!els.falseColorKey) return;
  els.falseColorKey.classList.toggle("hidden", mode !== "false_color");
  const items = falseColorBandsForPreset(preset)
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

function falseColorBandsForPreset(preset) {
  const levels = overlayPresetLevels[preset] || overlayPresetLevels.web_1000_100;
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
  if (!desktop) return;
  state.desktopEnvironment = await desktop.environment();
  state.renderingMode = ["auto", "gpu", "cpu"].includes(state.desktopEnvironment.renderingMode)
    ? state.desktopEnvironment.renderingMode
    : "auto";
  desktop.onMenuCommand(({ command, payload }) => handleDesktopCommand(command, payload));
  desktop.onOpenRequest((selection) => openDesktopSelection(selection));
}

async function handleDesktopCommand(command, payload = null) {
  if (command === "open-source") return requestSourceImport();
  if (command === "open-project") return openProjectFromPath();
  if (command === "save") return saveProjectToPath({ saveAs: false });
  if (command === "save-as") return saveProjectToPath({ saveAs: true });
  if (command === "export") return openExportSheet();
  if (command === "undo") return queueEditCommand("undo");
  if (command === "redo") return queueEditCommand("redo");
  if (command === "rendering-mode") return applyRenderingMode(payload?.mode);
}

async function applyRenderingMode(mode) {
  if (!["auto", "gpu", "cpu"].includes(mode)) return false;
  state.renderingMode = mode;
  state.gpuPreparedLane = { hdr: false, sdr: false };
  state.gpuPreview?.resetSession(state.session?.session_id || null);
  if (state.session) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
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
  const selection = await desktop.openSource();
  if (selection) await openDesktopSelection({ kind: "source", ...selection });
}

const LUMA_RANGE_MIN_NITS = 0.1;
const LUMA_RANGE_MAX_NITS = 10000;
const LUMA_TONAL_RAMP_EV = 0.75;

function referenceNitsToEv(value) {
  return Math.log2(clamp(Number(value), LUMA_RANGE_MIN_NITS, LUMA_RANGE_MAX_NITS) / 100);
}

function evToReferenceNits(value) {
  return 100 * (2 ** Number(value));
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
    ["Preview Mode", state.acceptedPresentation?.tier === "refinement" ? "High-res presented" : state.highQualityPreview ? "High-res requested" : "Standard"],
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
  return [
    ["Dynamic Range", state.displayInfo.dynamicRange],
    ["Color Gamut", state.displayInfo.colorGamut],
    ["Pixel Ratio", state.displayInfo.pixelRatio],
    ["Screen Depth", state.displayInfo.screenDepth],
    ["Browser", state.displayInfo.browser],
    ["GPU Preview", state.displayInfo.gpu || "Backend fallback"],
  ];
}

function renderWorkflowContext() {
  if (!els.workflowContextList) return;
  const selectedDisplay = (state.displayTelemetry?.displays || [])
    .find((display) => display.id === state.proofDisplayId);
  const proofFormat = state.proofFormat === "avif_gain_map" ? "AVIF + gain map" : "JPEG Ultra HDR";
  const exportFormat = {
    avif_gain_map: "AVIF + gain map",
    jpeg_ultrahdr: "JPEG Ultra HDR",
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
      control.step = step;
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
  if (!state.session) return;
  await syncGlobalEditState();
  const display = lane === state.currentView;
  const longEdge = settledProxyLongEdge();
  if (display) {
    if (gpuPreviewEligible()) {
      const rendered = await renderGpuDraft(lane, { longEdge });
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
  if (!state.session || !state.highQualityPreview || lane !== state.currentView) return;
  if (task.applicationGeneration !== undefined && task.applicationGeneration !== state.previewGeneration[lane]) return;
  const generation = state.previewGeneration[lane];
  const signature = geometrySignature();
  markRefining();
  const rendered = gpuPreviewEligible()
    ? await renderGpuDraft(lane, { longEdge: refinementProxyLongEdge(), tier: "refinement" })
    : false;
  if (rendered || !state.highQualityPreview || lane !== state.currentView) return;
  await renderPreviewForLane(lane, true, refinementProxyLongEdge(), { showProgress: false });
  if (generation !== state.previewGeneration[lane] || signature !== geometrySignature() || !state.highQualityPreview) return;
}

function displayedLongEdge() {
  const rect = els.dropzone.getBoundingClientRect();
  const paneWidth = state.compareLayout === "side-horizontal" ? rect.width / 2 : rect.width;
  const paneHeight = state.compareLayout === "side-vertical" ? rect.height / 2 : rect.height;
  return Math.max(paneWidth, paneHeight) * Math.max(1, window.devicePixelRatio || 1);
}

function interactiveProxyLongEdge() {
  return Math.round(clamp(displayedLongEdge(), 512, 1024));
}

function settledProxyLongEdge() {
  return Math.round(clamp(displayedLongEdge(), 768, state.highQualityPreview ? 1200 : 1200));
}

function refinementProxyLongEdge() {
  return Math.round(clamp(displayedLongEdge() * 1.5, 1600, 2000));
}

function scopeLongEdge(tier) {
  // Interactive scopes favor visible motion; the settled pass restores the
  // denser authoring result immediately after the drag ends.
  if (tier === "interactive") return Math.min(384, interactiveProxyLongEdge());
  if (tier === "refinement") return Math.min(1600, refinementProxyLongEdge());
  return Math.min(1200, settledProxyLongEdge());
}

function debounceOverlayAndScopes() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    renderOverlayPresetNote();
    await refreshOverlay();
    await refreshScopes();
  }, 120);
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
  if (!state.session) return false;
  if (await syncGlobalEditState() === false) return false;
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
  if (response.status === 409) {
    if (displayWhenReady && showProgress) setPreviewMessage("A newer adjustment replaced this render.", progressSteps[0]);
    return false;
  }
  if (!response.ok) {
    const payload = await safeJson(response);
    if (displayWhenReady) {
      setPreviewError(payload?.detail || "Preview failed to render.");
      clearPreviewImage();
      clearPreviewOverlay();
    }
    return false;
  }

  if (displayWhenReady && showProgress) setPreviewMessage("Processing complete. Decoding preview...", progressSteps[1]);
  const previewInfo = previewInfoFromResponse(response, lane);
  const width = Number(response.headers.get("X-Image-Width"));
  const height = Number(response.headers.get("X-Image-Height"));
  const blob = await response.blob();
  if (generation !== state.previewGeneration[lane] || signature !== geometrySignature()) return false;
  const url = URL.createObjectURL(blob);
  const previous = state.previewCache[lane];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.previewCache[lane] = { url, generation, longEdge: Math.max(width, height) || longEdge, width, height, geometrySignature: signature };
  if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) {
    if (showProgress) setPreviewMessage("Presenting preview...", progressSteps[2]);
    const keptGpuSurface = shouldKeepHdrGpuSurface(lane)
      && await renderGpuDraft(lane)
      && state.gpuSurfaceHdr;
    if (!keptGpuSurface) {
      state.previewInfoByLane[lane] = previewInfo;
      await applyPreviewUrl(url);
      state.previewInfo = previewInfo;
      acceptPresentation(lane, longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", width, height, previewInfo.transport, gpuPreviewEligible() ? "" : "CPU/backend");
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
  if (!response.ok) return false;
  const width = Number(response.headers.get("X-Image-Width"));
  const height = Number(response.headers.get("X-Image-Height"));
  const rawGeneration = Number(response.headers.get("X-Generation"));
  const data = new Uint8ClampedArray(await response.arrayBuffer());
  if (generation !== state.previewGeneration[lane] || rawGeneration !== generation || signature !== geometrySignature()) return false;
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
  state.gpuSurfaceHdr = false;
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
  await syncGlobalEditState();
  if (!state.session) return;
  if (state.adjustments.shared.overlay_mode === "off") {
    clearPreviewOverlay();
    return;
  }
  if (state.overlayAbortController) state.overlayAbortController.abort();
  state.overlayAbortController = new AbortController();
  const response = await fetch(`/api/session/${state.session.session_id}/overlay/${state.currentView}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edit_revision: state.editRevision, include_locals: !state.compareWithoutLocals, long_edge: longEdge }),
    signal: state.overlayAbortController.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return { aborted: true };
    console.error(error);
    return null;
  });
  if (!response || response.aborted) return;
  if (response.status === 204) {
    clearPreviewOverlay();
    return;
  }
  if (!response.ok) {
    clearPreviewOverlay();
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  await applyOverlayUrl(url);
}

function refreshScopes(longEdge = 960, { tier = "settled", generation = null, lane = state.currentView } = {}) {
  if (!state.session) return Promise.resolve(false);
  if (state.globalEditDirty) {
    return syncGlobalEditState().then(() => refreshScopes(longEdge, { tier, generation, lane }));
  }
  // Scheduler generations and direct refreshes originate in different
  // counters. Normalize both into one strictly increasing presentation serial
  // so an older response can never become current again.
  const requestGeneration = Math.max(state.scopeGeneration + 1, generation ?? 0);
  state.scopeGeneration = requestGeneration;
  const mode = state.scopeMode;
  const resolution = mode === "waveform"
    ? waveformRequestResolution(tier)
    : mode === "vectorscope" ? { bins: tier === "interactive" ? 96 : 128, columns: tier === "interactive" ? 96 : 128 }
      : { bins: 256, columns: 256 };
  const effectiveLongEdge = mode === "waveform" ? waveformScopeLongEdge(tier, longEdge) : longEdge;
  const includeLocals = !state.compareWithoutLocals;

  const request = {
    sessionId: state.session.session_id,
    lane,
    mode,
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
    resolve: null,
    controller: null,
  };

  if (gpuScopeEligible(lane)) {
    return runGpuScopeRequest(request);
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
    && els.previewCanvas.style.display !== "none"
    && valuesEqual(state.adjustments.shared?.geometry, defaultGeometry())
    && !state.comparePeekActive
    && state.activeWorkflow !== "proof"
  );
}

async function runGpuScopeRequest(request) {
  const { lane, mode, tier, generation, resolution, maxNits } = request;
  markScopeUpdating();
  const sampleWidth = tier === "interactive"
    ? Math.max(64, Math.min(192, resolution.columns))
    : Math.max(256, Math.min(384, resolution.columns));
  const sampleHeight = tier === "interactive" ? 128 : 256;
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
  if (generation !== state.scopeGeneration || lane !== state.currentView || mode !== state.scopeMode) {
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
  });
  presentScopePayload(payload, { generation, tier, lane, mode, source: "gpu", metric: analysis.metric });
  return true;
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
  return `${request.sessionId}:${request.lane}:${request.mode}:${request.maxNits}`;
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
    const { sessionId, lane, mode, tier, generation, longEdge, resolution, maxNits, edit_revision, include_locals, localAdjustments: requestLocals } = request;
    const resolutionQuery = `&bins=${resolution.bins}&columns=${resolution.columns}`;
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
  return {
    // Keep horizontal resolution nearly constant across refresh tiers. The old
    // 192-column interactive grid expanded each bucket into a conspicuous bar
    // before the denser settled result replaced it.
    columns: Math.round(clamp(width / 2, 320, 384)),
    // Vertical density dominates waveform payload and JSON parsing cost, while
    // contributing much less to perceived positional detail than columns do.
    bins: tier === "interactive" ? 64 : tier === "refinement" ? 160 : 128,
  };
}

function waveformScopeLongEdge(tier, requestedLongEdge) {
  if (tier === "interactive") return Math.min(requestedLongEdge, 512);
  if (tier === "refinement") return Math.min(requestedLongEdge, 960);
  return Math.min(requestedLongEdge, 768);
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
      ? "HDR waveform plots horizontal image position against reference nits. Reference nits use the app's internal model: 0.18 scene-linear equals 100 nits."
      : "HDR histogram plots reference luminance from left to right on a logarithmic nit scale. Density is log-scaled to retain fine tonal detail."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against normalized tone-mapped output."
      : "SDR histogram plots display-safe values from black to white. Density is log-scaled so small tonal populations remain visible.";
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

  ctx.font = '11px "IBM Plex Mono", "Cascadia Mono", Consolas';
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
  ctx.strokeStyle = "rgba(224,232,235,.18)";
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
    if (canvas === els.toneEqualizerEditor) drawToneEqualizerEditor();
  };
  if (!window.ResizeObserver) {
    window.addEventListener("resize", () => {
      redraw(els.curveEditor);
      redraw(els.toneEqualizerEditor);
    });
    return;
  }
  graphEditorResizeObserver = new ResizeObserver((entries) => {
    entries.forEach(({ target }) => redraw(target));
  });
  graphEditorResizeObserver.observe(els.curveEditor);
  graphEditorResizeObserver.observe(els.toneEqualizerEditor);
}

function drawScopeGrid(ctx, scope, isWaveform, plotLeft, plotTop, plotWidth, plotHeight, canvasHeight) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(224, 232, 235, 0.08)";
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
    ctx.strokeStyle = showLabel ? "rgba(224, 232, 235, 0.17)" : "rgba(224, 232, 235, 0.08)";
    ctx.fillStyle = "rgba(224, 232, 235, 0.62)";
    if (isWaveform) {
      const y = plotTop + plotHeight - normalized * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = "right";
        ctx.fillText(waveformGuideLabel(scope, guide), plotLeft - 7, clamp(y, plotTop + 6, plotTop + plotHeight - 6));
      }
    } else {
      const x = plotLeft + normalized * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      if (showLabel) {
        ctx.textAlign = normalized <= 0.02 ? "left" : normalized >= 0.98 ? "right" : "center";
        ctx.fillText(guide.label, x, canvasHeight - 7);
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

function waveformGuideLabel(scope, guide) {
  if (scope.preview_kind !== "hdr") return guide.label;
  const labels = {
    1: "1 nit",
    10: "10",
    100: "100 white",
    203: "203",
    1000: "1K peak",
    4000: "4K peak",
    10000: "10K PQ",
  };
  return labels[Number(guide.value)] || guide.label;
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
  ctx.globalCompositeOperation = channels.length > 1 ? "lighter" : "source-over";
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
  ctx.globalCompositeOperation = channels.length > 1 ? "screen" : "source-over";
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
  const cacheKey = `${color.r},${color.g},${color.b}:${peak}:${rowCount}x${columnCount}:h3`;
  const cached = waveformCanvasCache.get(channel);
  if (cached?.key === cacheKey) return cached.canvas;
  const surface = document.createElement("canvas");
  surface.width = columnCount;
  surface.height = rowCount;
  const surfaceContext = surface.getContext("2d");
  const pixels = surfaceContext.createImageData(columnCount, rowCount);
  grid.forEach((row, rowIndex) => {
    row.forEach((_value, columnIndex) => {
      const value = smoothedWaveformPopulation(row, columnIndex);
      if (value <= 0) return;
      const density = Math.min(1, value / Math.max(1, peak));
      const offset = (((rowCount - 1 - rowIndex) * columnCount) + columnIndex) * 4;
      pixels.data[offset] = color.r;
      pixels.data[offset + 1] = color.g;
      pixels.data[offset + 2] = color.b;
      pixels.data[offset + 3] = Math.round(0.62 * Math.pow(density, 0.7) * 255);
    });
  });
  surfaceContext.putImageData(pixels, 0, 0);
  waveformCanvasCache.set(channel, { key: cacheKey, canvas: surface });
  return surface;
}

function smoothedWaveformPopulation(row, columnIndex) {
  const center = Number(row[columnIndex]) || 0;
  const left = columnIndex > 0 ? Number(row[columnIndex - 1]) || 0 : center;
  const right = columnIndex + 1 < row.length ? Number(row[columnIndex + 1]) || 0 : center;
  return (left + 2 * center + right) * 0.25;
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

function syncOverlayPlacement() {
  const preview = activePreviewElement();
  if (!previewIsVisible()) return;
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
  renderVignetteCenter();
  // The local-mask canvas spans the zoomable preview stage. Its bitmap must be
  // rebuilt whenever that stage changes size; otherwise CSS stretches the old
  // bitmap and the mask/gizmo drifts until some unrelated edit redraws it.
  queueLocalMaskOverlayRender();
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
  if (format === "sdr_png") return ".png";
  if (format === "jpeg_ultrahdr") return ".jpg";
  if (format === "jpegxl_gain_map") return ".jxl";
  return ".avif";
}

function splitOutputPath(path) {
  const normalized = String(path || "");
  const separator = normalized.includes("\\") && !normalized.includes("/") ? "\\" : "/";
  const parts = normalized.split(/[/\\]/);
  const filename = parts.pop() || "";
  return {
    filename: filename.replace(/\.[^.]+$/, ""),
    directory: parts.join(separator),
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
      formatName: els.exportFormat.value === "avif_gain_map" ? "AVIF gain map" : els.exportFormat.value === "sdr_png" ? "PNG image" : "JPEG Ultra HDR",
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
    els.exportStatus.textContent = payload.message || "Export request finished.";
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
  if (desktop) {
    const directory = await desktop.chooseExportDirectory(els.exportDirectory.value);
    if (directory) {
      els.exportDirectory.value = directory;
      els.exportStatus.textContent = `Save folder set to ${directory}`;
    }
    return;
  }
  if (!els.directoryBrowser.open) els.directoryBrowser.showModal();
  await loadExportDirectory(els.exportDirectory.value);
}

async function loadExportDirectory(path) {
  els.directoryBrowserStatus.textContent = "Loading folders…";
  els.directoryBrowserList.replaceChildren();
  els.directoryBrowserGo.disabled = true;
  els.directoryBrowserUp.disabled = true;
  els.directoryBrowserSelect.disabled = true;
  try {
    const query = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
    const response = await fetch(`/api/export-directories${query}`);
    const payload = await safeJson(response);
    if (!response.ok) {
      els.directoryBrowserStatus.textContent = responseErrorMessage(payload, "Could not open that folder.");
      return;
    }

    els.directoryBrowserPath.value = payload.current;
    els.directoryBrowser.dataset.parent = payload.parent || "";
    els.directoryBrowserUp.disabled = !payload.parent;
    els.directoryBrowserSelect.disabled = false;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "directory-browser-empty";
      empty.textContent = "This folder is empty.";
      els.directoryBrowserList.append(empty);
    } else {
      entries.forEach((entry) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = `directory-browser-entry ${entry.kind}`;
        button.textContent = entry.name;
        button.title = entry.path;
        if (entry.kind === "directory") {
          button.addEventListener("click", () => loadExportDirectory(entry.path));
        } else {
          button.disabled = true;
          button.setAttribute("aria-label", `${entry.name}, file`);
        }
        item.append(button);
        els.directoryBrowserList.append(item);
      });
    }
    const folderCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = entries.length - folderCount;
    els.directoryBrowserStatus.textContent = `${folderCount} folder${folderCount === 1 ? "" : "s"}, ${fileCount} file${fileCount === 1 ? "" : "s"}`;
  } catch (error) {
    console.error(error);
    els.directoryBrowserStatus.textContent = "Could not reach the local HDR Finisher server.";
  } finally {
    els.directoryBrowserGo.disabled = false;
  }
}

function closeExportDirectoryBrowser() {
  if (els.directoryBrowser.open) els.directoryBrowser.close();
}

function selectExportDirectory() {
  const directory = els.directoryBrowserPath.value.trim();
  if (!directory) return;
  els.exportDirectory.value = directory;
  els.exportStatus.textContent = `Save folder set to ${directory}`;
  closeExportDirectoryBrowser();
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
  renderSourceSettingsControls();
  await applyInterpretationOverride();
}

function badgeClass(classification) {
  if (classification === "HDR_TRUE") return "badge good";
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
    if (state.cropMode) closeCropMode(true);
    if (state.geometryTool === "rotate") {
      closeRotateMode(false);
      return;
    }
    state.rotateDraftGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
    state.geometryTool = "rotate";
    renderRotateDraftTransform();
    renderGeometryToolState();
  });
  els.cropDone?.addEventListener("click", () => closeCropMode(true));
  els.cropCancel?.addEventListener("click", () => closeCropMode(false));
  els.cropResetFrame?.addEventListener("click", () => {
    if (!state.cropDraftGeometry) return;
    state.cropDraftGeometry.crop = { x: 0, y: 0, width: 1, height: 1 };
    constrainCropToRatio();
    renderCropFrame();
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
  });
  els.cropBox?.addEventListener("pointerdown", beginCropDrag);
  window.addEventListener("pointermove", moveCropDrag);
  window.addEventListener("pointerup", endCropDrag);
  els.cropStraighten?.addEventListener("pointerdown", beginStraightenGesture);
  els.cropStraighten?.addEventListener("keydown", beginStraightenGesture);
  ["pointerup", "pointercancel", "change", "keyup"].forEach((eventName) => {
    els.cropStraighten?.addEventListener(eventName, finishStraightenGesture);
  });
  renderGeometryToolState();
}

async function openCropMode() {
  if (!state.session || state.cropMode || state.cropOpening) return;
  state.cropOpening = true;
  try {
    // Straightening changes the largest valid source rectangle. Do not author
    // crop coordinates against the pre-straighten bitmap while that geometry
    // is still settling, or the same normalized frame targets a different
    // aspect ratio when applied by the backend.
    if (state.straightenPreviewBaseAngle !== null || state.globalEditDirty || state.globalEditSyncPending) {
      if (await syncGlobalEditState() === false) return;
      await renderPreviewForLane(state.currentView, true, settledProxyLongEdge(), { showProgress: false });
    }
  } finally {
    state.cropOpening = false;
  }
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
  }
  syncControlsFromState();
  renderGeometryToolState();
  renderLocalAdjustments();
  if (commit && draft) {
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
  renderRotateDraftTransform();
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

function renderRotateDraftTransform() {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const current = state.adjustments.shared.geometry;
  const visualBase = state.rotateDraftPresentedGeometry || original;
  const delta = ((Number(current.rotation) || 0) - (Number(visualBase.rotation) || 0) + 360) % 360;
  const flipX = Boolean(current.flip_horizontal) === Boolean(visualBase.flip_horizontal) ? 1 : -1;
  const flipY = Boolean(current.flip_vertical) === Boolean(visualBase.flip_vertical) ? 1 : -1;
  const straightenDelta = (Number(current.straighten_angle) || 0) - (Number(visualBase.straighten_angle) || 0);
  if (useHdrSafeGeometryDraft()) {
    if (!valuesEqual(original, current)) queueHdrGeometryDraft();
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

function useHdrSafeGeometryDraft() {
  return state.currentView === "hdr" && mediaQueryMatch("(dynamic-range: high)");
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

function queueHdrGeometryDraft() {
  window.clearTimeout(state.rotateDraftPreviewTimer);
  const signature = geometrySignature();
  if (state.rotateDraftPresentedSignature === signature) return;
  state.rotateDraftPreviewTimer = window.setTimeout(() => {
    void renderHdrGeometryDraft(signature).catch((error) => {
      console.warn("HDR geometry draft render failed; keeping the committed HDR frame.", error);
    });
  }, 80);
}

async function renderHdrGeometryDraft(signature) {
  if (!state.rotateDraftGeometry || signature !== geometrySignature() || !useHdrSafeGeometryDraft()) return false;
  state.rotateDraftPreviewController?.abort();
  const controller = new AbortController();
  state.rotateDraftPreviewController = controller;
  const serial = ++state.rotateDraftPreviewSerial;
  const response = await fetch(`/api/session/${state.session.session_id}/preview/hdr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adjustments: JSON.parse(JSON.stringify(state.adjustments)),
      transient_adjustments: true,
      edit_revision: state.editRevision,
      include_locals: !state.compareWithoutLocals,
      local_adjustments: state.compareWithoutLocals ? [] : JSON.parse(JSON.stringify(localAdjustments())),
      long_edge: settledProxyLongEdge(),
      hdr_display: true,
    }),
    signal: controller.signal,
  }).catch((error) => error.name === "AbortError" ? null : Promise.reject(error));
  if (!response || !response.ok || serial !== state.rotateDraftPreviewSerial
    || !state.rotateDraftGeometry || signature !== geometrySignature()) return false;
  const blob = await response.blob();
  if (!blob.type.startsWith("image/avif")) return false;
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      els.previewImage.onload = resolve;
      els.previewImage.onerror = () => reject(new Error("HDR geometry draft could not be decoded."));
      els.previewImage.src = url;
    });
  } finally {
    els.previewImage.onload = null;
    els.previewImage.onerror = null;
  }
  if (serial !== state.rotateDraftPreviewSerial || !state.rotateDraftGeometry || signature !== geometrySignature()) {
    URL.revokeObjectURL(url);
    return false;
  }
  if (state.rotateDraftPreviewUrl) URL.revokeObjectURL(state.rotateDraftPreviewUrl);
  state.rotateDraftPreviewUrl = url;
  state.rotateDraftPresentedSignature = signature;
  state.rotateDraftPresentedGeometry = JSON.parse(JSON.stringify(state.adjustments.shared.geometry));
  clearRotateDraftTransformProperties();
  applySourceOverlayGeometryTransform(state.rotateDraftGeometry, state.adjustments.shared.geometry);
  els.previewCanvas.style.display = "none";
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  const local = selectedLocal();
  if (local) scheduleAuthoritativeLocalMaskDraft(local);
  updateZoomReadout();
  return true;
}

function closeRotateMode(commit) {
  if (!state.rotateDraftGeometry) return;
  const original = state.rotateDraftGeometry;
  const presentedDraft = Boolean(state.rotateDraftPresentedSignature);
  state.rotateDraftGeometry = null;
  state.geometryTool = null;
  window.clearTimeout(state.rotateDraftPreviewTimer);
  state.rotateDraftPreviewTimer = null;
  state.rotateDraftPreviewController?.abort();
  state.rotateDraftPreviewController = null;
  state.rotateDraftPresentedSignature = null;
  state.rotateDraftPresentedGeometry = null;
  if (!commit) state.adjustments.shared.geometry = original;
  clearRotateDraftTransformProperties();
  clearInteractiveStraightenPreview();
  syncControlsFromState();
  renderGeometryToolState();
  renderControlState();
  if (commit && !valuesEqual(original, state.adjustments.shared.geometry)) {
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    debouncePreview(state.currentView);
  } else if (!commit && presentedDraft) {
    void renderGpuDraft(state.currentView, { longEdge: settledProxyLongEdge() })
      .then((rendered) => rendered || showCachedPreview(state.currentView));
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
  const source = state.session?.source;
  if (!source?.width || !source?.height) {
    return Math.max(0.01, els.cropEditorOverlay.clientWidth / Math.max(1, els.cropEditorOverlay.clientHeight));
  }
  let width = Number(source.width);
  let height = Number(source.height);
  if ([90, 270].includes(geometry.rotation)) [width, height] = [height, width];
  const angle = Math.abs(Number(geometry.straighten_angle) || 0) * Math.PI / 180;
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
  renderExportPreflight();
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

function buildGpuScopePayload(analysis, { lane, mode, tier, generation, bins, columns, maxNits }) {
  const hdr = lane === "hdr";
  const ceiling = maxNits === 1000 ? 1000 : maxNits === 10000 ? 10000 : 4000;
  const channelNames = ["R", "G", "B", "Y"];
  if (mode === "vectorscope") return buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins });
  const binEdges = hdr
    ? Array.from({ length: bins + 1 }, (_, index) => 10 ** (Math.log10(ceiling) * index / bins))
    : Array.from({ length: bins + 1 }, (_, index) => index / bins);
  const counts = channelNames.map(() => new Int32Array(mode === "waveform" ? bins * columns : bins));
  const lumaValues = new Float32Array(analysis.width * analysis.height);
  let peak = 0;
  let clipped = false;
  let above100 = 0;
  let above203 = 0;
  let above1000 = 0;
  for (let pixel = 0; pixel < lumaValues.length; pixel += 1) {
    const offset = pixel * 3;
    const r = Math.max(0, analysis.pixels[offset]);
    const g = Math.max(0, analysis.pixels[offset + 1]);
    const b = Math.max(0, analysis.pixels[offset + 2]);
    const luma = hdr ? 0.2722287 * r + 0.6740818 * g + 0.0536895 * b : 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const values = hdr
      ? [r, g, b, luma].map((value) => value / 0.18 * 100)
      : [r, g, b, luma].map((value) => clamp(value, 0, 1));
    lumaValues[pixel] = values[3];
    peak = Math.max(peak, values[3]);
    clipped ||= values[3] >= (hdr ? 10000 : 1);
    if (hdr) {
      above100 += values[3] > 100 ? 1 : 0;
      above203 += values[3] > 203 ? 1 : 0;
      above1000 += values[3] > 1000 ? 1 : 0;
    }
    const sourceX = pixel % analysis.width;
    const column = Math.min(columns - 1, Math.floor(sourceX / analysis.width * columns));
    values.forEach((value, channel) => {
      const bin = hdr
        ? Math.min(bins - 1, Math.max(0, Math.floor(Math.log10(clamp(value, 1, ceiling)) / Math.log10(ceiling) * bins)))
        : Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
      counts[channel][mode === "waveform" ? bin * columns + column : bin] += 1;
    });
  }
  const sortedLuma = Array.from(lumaValues).sort((left, right) => left - right);
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
  const channels = channelNames.map((name, index) => ({
    name,
    bins: mode === "waveform" ? [] : Array.from(counts[index]),
    grid: mode === "waveform"
      ? Array.from({ length: bins }, (_, row) => Array.from(counts[index].subarray(row * columns, (row + 1) * columns)))
      : [],
  }));
  const populationPeak = Math.max(1, ...counts.map((channel) => channel.reduce((maximum, value) => Math.max(maximum, value), 0)));
  const hdrGuides = [[1, "1 nit"], [10, "10"], [25, "25"], [50, "50"], [100, "100 white"], [203, "203 BT.2408"], [400, "400"], [600, "600"], [1000, "1000 peak"], [2000, "2000"], [4000, "4000"], [10000, "10000 PQ peak"]];
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
    guides: hdr ? hdrGuides.filter(([value]) => value <= ceiling).map(([value, label]) => ({ value, label })) : [{ value: 0.18, label: "18%" }, { value: 0.5, label: "50%" }, { value: 1, label: "100%" }],
    stats,
    channels,
  };
}

function buildGpuVectorscopePayload(analysis, { lane, tier, generation, bins }) {
  const hdr = lane === "hdr";
  const grid = Array.from({ length: bins }, () => new Int32Array(bins));
  let peak = 0;
  for (let pixel = 0; pixel < analysis.width * analysis.height; pixel += 1) {
    const offset = pixel * 3;
    const r = Math.max(0, analysis.pixels[offset]);
    const g = Math.max(0, analysis.pixels[offset + 1]);
    const b = Math.max(0, analysis.pixels[offset + 2]);
    const [kr, kg, kb] = hdr ? [0.2722287, 0.6740818, 0.0536895] : [0.2126, 0.7152, 0.0722];
    const y = kr * r + kg * g + kb * b;
    peak = Math.max(peak, hdr ? y / 0.18 * 100 : y);
    const u = clamp(0.5 + 0.5 * (b - y) / (2 * (1 - kb)), 0, 1);
    const v = clamp(0.5 + 0.5 * (r - y) / (2 * (1 - kr)), 0, 1);
    grid[Math.min(bins - 1, Math.floor(v * bins))][Math.min(bins - 1, Math.floor(u * bins))] += 1;
  }
  const normalizationPeak = Math.max(1, ...grid.map((row) => row.reduce((maximum, value) => Math.max(maximum, value), 0)));
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

function commitAdjustmentValue(path, value, { manual = false } = {}) {
  if (manual) state.previewScheduler?.beginInteraction();
  setValueByPath(state.adjustments, path, value);
  const resolvedPath = resolveAdjustmentPath(path);
  if (resolvedPath.endsWith(".film_look.reference_model") && value !== "custom") applyFilmLookPreset(value);
  if (resolvedPath.startsWith("hdr.highlight_compression_")) normalizeHighlightCompressionControls(resolvedPath);
  if (path === "shared.overlay_preset") {
    renderOverlayPresetNote();
    drawCurveEditor();
    renderLocalAdjustments();
  }
  if (path.startsWith("hdr.tone_equalizer_")) drawToneEqualizerEditor();
  syncRangeControlFromState(path);
  updateControlReadouts();
  renderControlState();
  if (path.startsWith("shared.overlay_")) {
    debounceOverlayAndScopes();
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
  if (changedPath.endsWith("peak_measurement") || changedPath.endsWith("manual_peak_nits")) {
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
  const linear = hdr.highlight_compression_peak_measurement === "robust"
    ? (analysis?.robust_peak_luma_linear ?? analysis?.peak_luma_linear ?? analysis?.peak_linear)
    : (analysis?.peak_luma_linear ?? analysis?.peak_linear);
  if (Number.isFinite(Number(linear))) {
    hdr.highlight_compression_source_peak_nits = Math.max(1, Number(linear) * 100 / 0.18);
  }
}

function toneAdjustedHighlightPeakNits(hdr) {
  let peakLinear = Math.max(1, Number(hdr.highlight_compression_source_peak_nits) || 1000) * 0.18 / 100;
  if (hdr.tone_section_enabled === false) return Math.max(1, peakLinear * 100 / 0.18);
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
  return Math.max(1, peakLinear * 100 / 0.18);
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
  const mode = hdr.highlight_compression_mode || "off";
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
  const mode = hdr.highlight_compression_mode || "off";
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
    els.highlightCompressionSummary.textContent = "Compression is off. The cyan identity line leaves highlights unchanged.";
  } else if (mode === "soft_ceiling") {
    els.highlightCompressionSummary.textContent = `Soft Ceiling approaches ${Math.round(hdr.highlight_compression_target_nits)} nit without a hard peak anchor.`;
  } else {
    const info = peakFitCurveInfo(hdr);
    const effective = 2 ** info.effectiveStartStop;
    const adjusted = effective < Number(hdr.highlight_compression_start_nits) * 0.99;
    const colorNote = hdr.highlight_compression_color_handling === "path_to_white"
      ? "; saturated highlights fade toward white"
      : "; color ratios are preserved";
    els.highlightCompressionSummary.textContent = `Peak Fit maps the ${Math.round(info.peak)}-nit peak after Tone controls to ${Math.round(info.target)} nit${adjusted ? `; smoothness widens the shoulder to ${Math.round(effective)} nit` : ""}${colorNote}.`;
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
      control.disabled = !hasSession;
    }
  });
  els.viewButtons.forEach((button) => {
    button.disabled = !hasSession;
  });
  els.toneEqualizerEditor.setAttribute("aria-disabled", String(!hasSession));
  els.toneEqualizerEditor.tabIndex = hasSession ? 0 : -1;
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
  const canvas = els.toneEqualizerEditor;
  const beginDrag = (clientX, clientY, bandIndex) => {
    if (!state.session) return;
    state.previewScheduler?.beginInteraction();
    const rect = canvas.getBoundingClientRect();
    state.activeToneEqualizerBand = bandIndex;
    state.selectedToneEqualizerBand = state.activeToneEqualizerBand;
    const startingNodes = currentToneEqualizerNodes();
    drawToneEqualizerEditor();
    const move = (event) => {
      event.preventDefault();
      updateToneEqualizerFromPointer(event.clientX, event.clientY, rect, startingNodes);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      state.activeToneEqualizerBand = null;
      renderControlState();
      state.previewScheduler?.endInteraction();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.session) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, rect);
    if (bandIndex !== null) {
      beginDrag(event.clientX, event.clientY, bandIndex);
      return;
    }
    const curveHit = toneEqualizerCurveHitAtPointer(event.clientX, event.clientY, rect);
    if (curveHit) addToneEqualizerNode(curveHit.inputEv);
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!state.session) return;
    const bandIndex = toneEqualizerNodeIndexAtPointer(event.clientX, event.clientY, canvas.getBoundingClientRect());
    if (bandIndex === null) return;
    state.selectedToneEqualizerBand = bandIndex;
    removeToneEqualizerNode(bandIndex);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state.session) return;
    changeToneEqualizerRadius(event.deltaY < 0 ? 0.25 : -0.25);
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (!state.session) return;
    const index = state.selectedToneEqualizerBand;
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      changeToneEqualizerRadius(event.key === "]" ? 0.25 : -0.25);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      moveToneEqualizerNodeHorizontally(index, event.key === "ArrowRight" ? 0.1 : -0.1);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      removeToneEqualizerNode();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nodes = currentToneEqualizerNodes();
      if (event.key === "ArrowLeft") state.selectedToneEqualizerBand = Math.max(0, index - 1);
      if (event.key === "ArrowRight") state.selectedToneEqualizerBand = Math.min(nodes.length - 1, index + 1);
      if (event.key === "Home") state.selectedToneEqualizerBand = 0;
      if (event.key === "End") state.selectedToneEqualizerBand = nodes.length - 1;
      syncToneEqualizerControls();
      drawToneEqualizerEditor();
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const step = event.shiftKey ? 0.25 : 0.05;
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setToneEqualizerBand(index, currentToneEqualizerNodes()[index].adjustment_ev + direction * step);
    renderControlState();
  });

  els.toneEqualizerBandValue.addEventListener("input", () => {
    if (!state.session) return;
    setToneEqualizerBand(state.selectedToneEqualizerBand, Number(els.toneEqualizerBandValue.value));
  });
  els.toneEqualizerBandValue.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
  ["pointerup", "pointercancel"].forEach((eventName) => {
    els.toneEqualizerBandValue.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  els.toneEqualizerBandValue.addEventListener("change", () => {
    renderControlState();
  });
  els.toneEqualizerAdd.addEventListener("click", () => addToneEqualizerNode());
  els.toneEqualizerRemove.addEventListener("click", () => removeToneEqualizerNode());
  els.toneEqualizerRadiusDown.addEventListener("click", () => changeToneEqualizerRadius(-0.25));
  els.toneEqualizerRadiusUp.addEventListener("click", () => changeToneEqualizerRadius(0.25));
}

function updateToneEqualizerFromPointer(clientX, clientY, rect, startingNodes) {
  const layout = toneEqualizerEditorLayout();
  const paddingTop = layout.top / Math.max(rect.height, 1);
  const paddingBottom = layout.bottom / Math.max(rect.height, 1);
  const normalizedY = clamp((clientY - rect.top) / rect.height, paddingTop, 1 - paddingBottom);
  const graphY = (normalizedY - paddingTop) / Math.max(1 - paddingTop - paddingBottom, 1e-6);
  const value = TONE_EQUALIZER_MAX_ADJUSTMENT_EV - graphY * TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2;
  const index = state.activeToneEqualizerBand ?? state.selectedToneEqualizerBand;
  const nodes = startingNodes.map((node) => ({ ...node }));
  const selected = nodes[index];
  const radius = Number(state.adjustments.hdr.tone_equalizer_influence_radius || 1.5);
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
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  syncControlsFromState();
  drawToneEqualizerEditor();
  invalidatePreview("hdr");
  debouncePreview("hdr");
}

function toneEqualizerPointerPosition(clientX, clientY, rect) {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function toneEqualizerCanvasPosition(inputEv, adjustmentEv) {
  const canvas = els.toneEqualizerEditor;
  const { width, height } = canvasLogicalSize(canvas);
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  return {
    x: left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (TONE_EQUALIZER_PQ_MAX_EV - TONE_EQUALIZER_MIN_EV)) * (width - left - right),
    y: top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - adjustmentEv) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * (height - top - bottom),
  };
}

function toneEqualizerNodeIndexAtPointer(clientX, clientY, rect) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  let nearestIndex = null;
  let nearestDistance = 10 ** 2;
  currentToneEqualizerNodes().forEach((node, index) => {
    const position = toneEqualizerCanvasPosition(node.input_ev, node.adjustment_ev);
    const distance = ((position.x - pointer.x) ** 2) + ((position.y - pointer.y) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function toneEqualizerCurveHitAtPointer(clientX, clientY, rect) {
  const pointer = toneEqualizerPointerPosition(clientX, clientY, rect);
  const inputEv = toneEqualizerEvFromPointer(clientX, rect);
  const adjustmentEv = sampleToneEqualizerAdjustment(
    inputEv,
    currentToneEqualizerNodes(),
    Number(state.adjustments.hdr.tone_equalizer_smoothing || 0.5),
  );
  const curvePosition = toneEqualizerCanvasPosition(inputEv, adjustmentEv);
  return Math.abs(curvePosition.y - pointer.y) <= 8 ? { inputEv, adjustmentEv } : null;
}

function setToneEqualizerBand(index, requestedValue) {
  const nodes = currentToneEqualizerNodes();
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const rounded = Math.round(clamp(Number(requestedValue) || 0, minimum, maximum) * 100) / 100;
  nodes[index].adjustment_ev = clamp(rounded, Math.ceil(minimum * 100) / 100, Math.floor(maximum * 100) / 100);
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  state.selectedToneEqualizerBand = index;
  syncControlsFromState();
  drawToneEqualizerEditor();
  invalidatePreview("hdr");
  debouncePreview("hdr");
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

function syncToneEqualizerControls() {
  const nodes = currentToneEqualizerNodes();
  const index = clamp(state.selectedToneEqualizerBand ?? 2, 0, nodes.length - 1);
  state.selectedToneEqualizerBand = index;
  const inputEv = nodes[index].input_ev;
  const value = nodes[index].adjustment_ev;
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  els.toneEqualizerBandValue.setAttribute("aria-valuemin", String(Math.ceil(minimum * 100) / 100));
  els.toneEqualizerBandValue.setAttribute("aria-valuemax", String(Math.floor(maximum * 100) / 100));
  els.toneEqualizerBandValue.value = String(value);
  updateRangeVisual(els.toneEqualizerBandValue);
  els.toneEqualizerBandLabel.textContent = `${formatSignedEv(inputEv, 0)} · ${formatToneBandNits(100 * (2 ** inputEv))}`;
  if (els.toneEqualizerBandOutput.dataset.editing !== "true") {
    els.toneEqualizerBandOutput.textContent = formatSignedEv(value, 2);
  }
  if (els.toneEqualizerRadius.dataset.editing !== "true") {
    els.toneEqualizerRadius.textContent = `Influence ${Number(state.adjustments.hdr.tone_equalizer_influence_radius || 1.5).toFixed(2)} EV`;
  }
  els.toneEqualizerRemove.disabled = nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index === 0 || index === nodes.length - 1;
  els.toneEqualizerAdd.disabled = nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT;
}

function drawToneEqualizerEditor() {
  const canvas = els.toneEqualizerEditor;
  const surface = resizeCanvasSurface(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const { left, right, top, bottom } = toneEqualizerEditorLayout();
  const graphWidth = width - left - right;
  const graphHeight = height - top - bottom;
  const nodes = currentToneEqualizerNodes();
  const smoothing = clamp(Number(state.adjustments.hdr?.tone_equalizer_smoothing ?? 0.5), 0, 1);
  const enabled = state.adjustments.hdr?.tone_equalizer_section_enabled !== false;
  const xForEv = (inputEv) => left + ((inputEv - TONE_EQUALIZER_MIN_EV) / (TONE_EQUALIZER_PQ_MAX_EV - TONE_EQUALIZER_MIN_EV)) * graphWidth;
  const yForAdjustment = (value) => top + ((TONE_EQUALIZER_MAX_ADJUSTMENT_EV - value) / (TONE_EQUALIZER_MAX_ADJUSTMENT_EV * 2)) * graphHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);
  ctx.font = '9px "IBM Plex Mono", "Cascadia Mono", monospace';
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
  const pqX = xForEv(TONE_EQUALIZER_PQ_MAX_EV);
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = uiToken("--equalizer-pq");
  ctx.beginPath();
  ctx.moveTo(pqX, top);
  ctx.lineTo(pqX, height - bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = uiToken("--attention");
  ctx.textAlign = "right";
  ctx.fillText("10K", pqX, 3);

  ctx.strokeStyle = enabled ? uiToken("--equalizer-curve") : uiToken("--equalizer-disabled");
  ctx.lineWidth = uiNumberToken("--equalizer-line-width", 2.25);
  ctx.beginPath();
  for (let sample = 0; sample < 180; sample += 1) {
    const inputEv = TONE_EQUALIZER_MIN_EV + (sample / 179) * (TONE_EQUALIZER_PQ_MAX_EV - TONE_EQUALIZER_MIN_EV);
    const adjustment = sampleToneEqualizerAdjustment(inputEv, nodes, smoothing);
    const x = xForEv(inputEv);
    const y = yForAdjustment(adjustment);
    if (sample === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const selectedNode = nodes[state.selectedToneEqualizerBand];
  if (selectedNode) {
    const radius = Number(state.adjustments.hdr?.tone_equalizer_influence_radius || 1.5);
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
  syncToneEqualizerControls();
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

function currentToneEqualizerNodes() {
  return normalizeToneEqualizerNodes(state.adjustments.hdr?.tone_equalizer_nodes).map((node) => ({ ...node }));
}

function toneEqualizerEvFromPointer(clientX, rect) {
  const layout = toneEqualizerEditorLayout();
  const paddingLeft = layout.left / Math.max(rect.width, 1);
  const paddingRight = layout.right / Math.max(rect.width, 1);
  const normalizedX = clamp((clientX - rect.left) / rect.width, paddingLeft, 1 - paddingRight);
  const graphX = (normalizedX - paddingLeft) / Math.max(1 - paddingLeft - paddingRight, 1e-6);
  return TONE_EQUALIZER_MIN_EV + graphX * (TONE_EQUALIZER_PQ_MAX_EV - TONE_EQUALIZER_MIN_EV);
}

function addToneEqualizerNode(preferredEv = null) {
  const nodes = currentToneEqualizerNodes();
  if (nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT) return;
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
  if (nodes.some((node) => Math.abs(node.input_ev - inputEv) < 0.1)) return;
  const adjustmentEv = sampleToneEqualizerAdjustment(inputEv, nodes, Number(state.adjustments.hdr.tone_equalizer_smoothing || 0.5));
  nodes.push({ input_ev: inputEv, adjustment_ev: adjustmentEv });
  nodes.sort((left, right) => left.input_ev - right.input_ev);
  state.selectedToneEqualizerBand = nodes.findIndex((node) => node.input_ev === inputEv);
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor();
  renderControlState();
  invalidatePreview("hdr");
  debouncePreview("hdr");
}

function removeToneEqualizerNode(requestedIndex = null) {
  const nodes = currentToneEqualizerNodes();
  const index = requestedIndex ?? state.selectedToneEqualizerBand;
  if (nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index <= 0 || index >= nodes.length - 1) return;
  nodes.splice(index, 1);
  state.selectedToneEqualizerBand = Math.min(index, nodes.length - 2);
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor();
  renderControlState();
  invalidatePreview("hdr");
  debouncePreview("hdr");
}

function changeToneEqualizerRadius(delta) {
  const current = Number(state.adjustments.hdr.tone_equalizer_influence_radius || 1.5);
  state.adjustments.hdr.tone_equalizer_influence_radius = clamp(Math.round((current + delta) * 4) / 4, 0.25, 12);
  syncToneEqualizerControls();
  drawToneEqualizerEditor();
  renderControlState();
}

function moveToneEqualizerNodeHorizontally(index, delta) {
  const nodes = currentToneEqualizerNodes();
  if (index <= 0 || index >= nodes.length - 1) return;
  nodes[index].input_ev = clamp(nodes[index].input_ev + delta, nodes[index - 1].input_ev + 0.1, nodes[index + 1].input_ev - 0.1);
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  drawToneEqualizerEditor();
  invalidatePreview("hdr");
  debouncePreview("hdr");
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
  const beginDrag = (clientX, clientY, pointIndex, pointerId = null) => {
    if (!state.session) return;
    state.previewScheduler?.beginInteraction();
    state.activeCurvePoint = pointIndex;
    state.selectedCurvePoint = state.activeCurvePoint;
    const dragOrigin = {
      clientX,
      clientY,
      point: [...currentCurveValues()[state.activeCurvePoint]],
    };
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
      updateCurveFromPointer(event.clientX, event.clientY, dragOrigin);
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
      beginDrag(event.clientX, event.clientY, pointIndex, event.pointerId);
      return;
    }
    const curveHit = curveHitAtPointer(event.clientX, event.clientY, rect);
    if (!curveHit) return;
    const insertedIndex = addCurvePoint(curveHit.x);
    if (insertedIndex === null) return;
    beginDrag(event.clientX, event.clientY, insertedIndex, event.pointerId);
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
      const step = event.shiftKey ? 0.05 : 0.01;
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
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  const bands = falseColorBandsForPreset(preset);

  ctx.save();
  ctx.globalAlpha = uiNumberToken("--curve-band-opacity", 0.1);
  bands.forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = curveDomainPositionForNits(upper ?? 10000);
    ctx.fillStyle = exposureBandColor(paletteIndex);
    ctx.fillRect(plotLeft + start * plotWidth, plotTop, Math.max(0, (end - start) * plotWidth), plotHeight);
  });
  ctx.restore();

  const levels = overlayPresetLevels[preset] || overlayPresetLevels.web_1000_100;
  const labelValues = [...new Set([
    0,
    ...bands.flatMap(({ lower, upper }) => [lower, upper]),
    10000,
  ].filter((value) => value !== null && value >= 0 && value <= 10000))].sort((a, b) => a - b);

  ctx.save();
  ctx.font = '9px "IBM Plex Mono", "Cascadia Mono", Consolas';
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
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  const gradient = ctx.createLinearGradient(plotLeft, 0, plotRight, 0);
  falseColorBandsForPreset(preset).forEach(({ lower, upper, paletteIndex }) => {
    const start = curveDomainPositionForNits(lower ?? 0);
    const end = curveDomainPositionForNits(upper ?? 10000);
    gradient.addColorStop(start, exposureBandColor(paletteIndex));
    gradient.addColorStop(Math.max(start, end - 0.0001), exposureBandColor(paletteIndex));
  });
  return gradient;
}

function curveExposureColorAt(normalized) {
  const nits = curveDomainNitsForPosition(normalized);
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  const band = falseColorBandsForPreset(preset).find(({ upper }) => upper === null || nits < upper);
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

async function applyPreviewUrl(url) {
  try {
    await new Promise((resolve, reject) => {
      els.previewImage.onload = () => resolve();
      els.previewImage.onerror = () => reject(new Error("Image element could not load preview data."));
      els.previewImage.src = url;
    });
  } catch (error) {
    setPreviewError(error.message || "Preview image failed to decode.");
    return;
  } finally {
    els.previewImage.onload = null;
    els.previewImage.onerror = null;
  }

  if (state.rotateDraftPreviewUrl && state.rotateDraftPreviewUrl !== url) {
    URL.revokeObjectURL(state.rotateDraftPreviewUrl);
    state.rotateDraftPreviewUrl = null;
  }

  els.previewCanvas.style.display = "none";
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  clearInteractiveStraightenPreview();
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  updateZoomReadout();
  hidePreviewMessage();
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
  if (!gpuPreviewEligible()) return false;
  if (!state.session || (!allowInactive && lane !== state.currentView)) return false;
  if (state.comparePeekActive && !allowInactive) return false;
  if (state.globalEditDirty && state.acceptedPresentation?.geometrySignature !== geometrySignature()) return false;
  const serial = ++state.gpuRenderSerial;
  const adjustmentsSnapshot = JSON.parse(JSON.stringify(state.adjustments));
  const localSnapshot = state.compareWithoutLocals
    ? []
    : JSON.parse(JSON.stringify(localAdjustments()));
  const maskOverlay = gpuLumaMaskOverlayOptions();
  try {
    const result = await state.gpuPreview.render(
      state.session.session_id,
      lane,
      adjustmentsSnapshot,
      sampleCurvePoints,
      longEdge,
      localSnapshot,
      state.editRevision,
      maskOverlay,
    );
    if (!result || serial !== state.gpuRenderSerial || (!allowInactive && lane !== state.currentView)) return false;
    state.gpuPreparedLane[lane] = true;
    state.gpuSurfaceHdr = Boolean(result.hdr);
    if (state.rotateDraftPreviewUrl) {
      URL.revokeObjectURL(state.rotateDraftPreviewUrl);
      state.rotateDraftPreviewUrl = null;
    }
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
    acceptPresentation(lane, tier, result.width || longEdge, result.height || longEdge, "WebGPU");
    setZoomMode(state.zoomMode);
    renderReadouts();
      if (hideStatus) hidePreviewMessage();
      const submittedAt = performance.now();
      requestAnimationFrame((presentedAt) => {
        if (serial !== state.gpuRenderSerial || (!allowInactive && lane !== state.currentView)) return;
        window.dispatchEvent(new CustomEvent("hdrfinisher:preview-presented", {
          detail: { serial, lane, longEdge, submittedAt, presentedAt },
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
    state.gpuSurfaceHdr = false;
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

async function applyOverlayUrl(url) {
  const previousUrl = els.previewOverlay.dataset.objectUrl;
  try {
    await new Promise((resolve, reject) => {
      els.previewOverlay.onload = () => resolve();
      els.previewOverlay.onerror = () => reject(new Error("Overlay image failed to decode."));
      els.previewOverlay.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    clearPreviewOverlay();
    return;
  } finally {
    els.previewOverlay.onload = null;
    els.previewOverlay.onerror = null;
  }

  if (previousUrl) URL.revokeObjectURL(previousUrl);
  els.previewOverlay.dataset.objectUrl = url;
  els.previewOverlay.style.display = "block";
  syncOverlayPlacement();
}

function clearPreviewImage() {
  if (state.rotateDraftPreviewUrl) URL.revokeObjectURL(state.rotateDraftPreviewUrl);
  state.rotateDraftPreviewUrl = null;
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

function setPreviewError(message) {
  els.previewStatusCopy.textContent = message;
  els.previewProgress.classList.add("hidden");
  els.previewStatus.classList.remove("hidden");
  els.previewStatus.classList.add("error");
}

function hidePreviewMessage() {
  els.previewStatusCopy.textContent = "";
  els.previewProgress.removeAttribute("aria-valuetext");
  els.previewProgress.classList.add("hidden");
  els.previewStatus.classList.add("hidden");
  els.previewStatus.classList.remove("error");
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function defaultInterpretationValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  const colorSpace = (session.source.source_color_space || "").toLowerCase();
  if (colorSpace.includes("2020")) return "linear_bt2020";
  if (colorSpace.includes("acescg")) return "linear_acescg";
  if (colorSpace.includes("display p3") || colorSpace === "p3") return "linear_p3";
  return "linear_srgb";
}

function syncInterpretationControls(session) {
  const mode = session.source.interpretation_mode === "manual" ? "manual" : "auto";
  els.interpretationMode.value = mode;
  els.interpretationColorSpace.value = defaultInterpretationValue(session);
  els.interpretationTransfer.value = defaultTransferValue(session);
  const needsReview = session.analysis.needs_color_override && mode !== "manual";
  els.sourceSettingsNote.textContent = sourceInterpretationStatus(session);
  els.sourceSettingsNote.classList.toggle("warning", needsReview);
}

function sourceInterpretationStatus(session) {
  if (session.source.interpretation_mode === "manual") {
    const colorSpace = session.source.source_color_space || "unknown";
    const transfer = session.source.transfer_function || "unknown";
    return `Manual source interpretation applied: ${colorSpace} primaries + ${transfer} transfer.`;
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
  const manual = els.interpretationMode.value === "manual";
  els.interpretationColorSpace.disabled = !manual;
  els.interpretationTransfer.disabled = !manual;
}

function defaultTransferValue(session) {
  const transfer = (session.source.transfer_function || "").toLowerCase();
  if (transfer.includes("pq")) return "pq";
  if (transfer.includes("hlg")) return "hlg";
  if (transfer.includes("srgb")) return "srgb";
  return "linear";
}

function interpretationPayload() {
  if (els.interpretationMode.value !== "manual") return { color_space: null, transfer_function: null };
  const mapped = interpretationPayloadFromColorSpace(els.interpretationColorSpace.value);
  const transfer = interpretationTransferPayload(els.interpretationTransfer.value, mapped.transfer_function);
  return { color_space: mapped.color_space, transfer_function: transfer };
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
  const mode = session.source.interpretation_mode === "manual" ? "Manual" : "Auto";
  const colorSpace = session.source.source_color_space || "unknown primaries";
  const transfer = session.source.transfer_function || "unknown transfer";
  return `${mode}: ${colorSpace} + ${transfer}`;
}

function buildDisplayProbe() {
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
    screenDepth: `${window.screen?.colorDepth || "?"}-bit`,
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
  // A lane change is a presentation boundary. Commit the newest optimistic
  // global state before either lane renders so a round trip cannot replace a
  // settled draft with an older authoritative revision.
  if (await syncGlobalEditState() === false || switchGeneration !== state.laneSwitchGeneration) return;
  if (state.rotateDraftGeometry) closeRotateMode(false);
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
    const rendered = gpuPreviewEligible()
      ? await renderGpuDraft(lane, { longEdge: settledProxyLongEdge() })
      : false;
    if (rendered) return true;
    if (cacheReady(lane)) return showCachedPreview(lane);
    return renderPreviewForLane(lane, true, settledProxyLongEdge(), { showProgress: false });
  })();
  await previewTask;
  if (switchGeneration !== state.laneSwitchGeneration || lane !== state.currentView) return;
  // GPU scopes read the presented canvas. Wait until this lane has replaced
  // the previous lane's canvas before sampling it.
  await Promise.all([refreshOverlay(), refreshScopes(scopeLongEdge("settled"), { tier: "settled", lane })]);
  if (state.compareLayout !== "single") {
    const other = lane === "hdr" ? "sdr" : "hdr";
    await renderComparisonPreview(other, { force: true });
  }
  prepareInactivePreview();
}

function renderLaneChrome() {
  const lane = state.currentView;
  document.body.dataset.activeLane = lane;
  els.previewStage.dataset.primaryLane = lane;
  els.previewPrimaryPane.dataset.lane = lane;
  els.previewSecondaryPane.dataset.lane = lane === "hdr" ? "sdr" : "hdr";
  els.viewButtons.forEach((button) => {
    const active = button.dataset.kind === lane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.lanePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.lanePanel !== lane));
  els.viewerBranchNote.textContent = branchCopy[lane];
  els.scopeKindLabel.textContent = lane.toUpperCase();
  state.previewInfo = state.previewInfoByLane[lane];
  els.filmLookSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.colorGradingSdrActions?.classList.toggle("hidden", lane !== "sdr");
  els.vignetteSdrActions?.classList.toggle("hidden", lane !== "sdr");
  syncControlsFromState();
  window.HDRProofing?.syncLane();
  renderCompareStatus();
  updateControlReadouts();
  renderControlState();
}

function invalidatePreview(lane, { local = false } = {}) {
  if (!local && state.session) {
    state.globalEditDirty = true;
    state.globalEditGeneration += 1;
    state.documentDirty = true;
  }
  state.previewGeneration[lane] += 1;
  window.HDRProofing?.invalidate(lane);
  renderCompareStatus();
  renderExportPreflight();
}

function clearPreviewCache() {
  window.clearTimeout(state.rotateDraftPreviewTimer);
  state.rotateDraftPreviewTimer = null;
  state.rotateDraftPreviewController?.abort();
  state.rotateDraftPreviewController = null;
  state.rotateDraftPresentedSignature = null;
  state.rotateDraftPresentedGeometry = null;
  state.previewScheduler?.cancel();
  state.scopeRequestInFlight?.controller?.abort();
  state.pendingScopeRequest?.resolve(false);
  state.scopeRequestInFlight = null;
  state.pendingScopeRequest = null;
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
  state.gpuSurfaceHdr = false;
  state.gpuPreparedLane = { hdr: false, sdr: false };
  // A replacement source can have a completely different orientation. Do not
  // let the previous session's fitted aspect survive until the new GPU canvas
  // has presented its first frame.
  state.zoomReferenceFrame = null;
  state.scopeGeneration = 0;
  els.scopeFreshness.textContent = "Waiting";
  els.scopeFreshness.classList.remove("updating");
  clearPreviewImage();
  clearComparisonPreview();
  window.HDRProofing?.reset();
}

function cacheReady(lane) {
  const cached = state.previewCache[lane];
  return Boolean(
    (gpuPreviewEligible() && state.gpuPreparedLane[lane])
    || (cached?.generation === state.previewGeneration[lane]
      && cached.geometrySignature === geometrySignature()
      && (cached.url || cached.raw)),
  );
}

async function showCachedPreview(lane) {
  const cached = state.previewCache[lane];
  if (gpuPreviewEligible() && state.gpuPreparedLane[lane] && await renderGpuDraft(lane, { allowInactive: lane !== state.currentView })) return true;
  if (!cached || cached.generation !== state.previewGeneration[lane] || cached.geometrySignature !== geometrySignature()) return false;
  if (cached.raw) applyRawPreview(cached);
  else if (cached.url) {
    await applyPreviewUrl(cached.url);
    acceptPresentation(lane, cached.longEdge >= refinementProxyLongEdge() ? "refinement" : "settled", cached.width, cached.height, state.previewInfoByLane[lane].transport, "CPU/backend");
  }
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
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
    await state.gpuPreview.loadProxy(
      state.session.session_id,
      lane,
      settledProxyLongEdge(),
      geometrySignature(),
      state.editRevision,
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
  if (gpuPreviewEligible()) {
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

function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && key === "s") {
      event.preventDefault();
      saveProjectToPath({ saveAs: event.shiftKey });
    } else if (commandKey && key === "o") {
      event.preventDefault();
      if (event.shiftKey) openProjectFromPath();
      else requestSourceImport();
    } else if (commandKey && key === "z") {
      event.preventDefault();
      queueEditCommand(event.shiftKey ? "redo" : "undo");
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      queueEditCommand("redo");
    } else if (key === "v") {
      event.preventDefault();
      beginCompareHold();
    } else if (key === "f") {
      event.preventDefault();
      setZoomMode("fit");
    } else if (key === "a") {
      event.preventDefault();
      setZoomMode("actual");
    } else if (key === "s") {
      event.preventDefault();
      toggleAnalysisDock();
    } else if (key === "c") {
      event.preventDefault();
      cycleOverlayMode();
    } else if (key === "o" && state.cropMode) {
      event.preventDefault();
      const guides = ["none", "thirds", "golden", "grid", "x", "diagonals"];
      state.cropGuide = guides[(guides.indexOf(state.cropGuide) + 1) % guides.length];
      renderCropOptions();
    } else if (key === "d") {
      event.preventDefault();
      requestSourceImport();
    } else if (key === "x") {
      event.preventDefault();
      openExportSheet();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() === "v" && !isTypingTarget(event.target)) {
      event.preventDefault();
      endCompareHold();
    }
  });
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
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
  const preview = activePreviewElement();
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

  // Geometry can change the rendered frame's dimensions. Size the viewer from
  // the current bitmap, not the original source, or a crop is stretched back
  // into the source aspect ratio after it is applied.
  const renderedWidth = preview instanceof HTMLCanvasElement ? preview.width : preview.naturalWidth;
  const renderedHeight = preview instanceof HTMLCanvasElement ? preview.height : preview.naturalHeight;
  const renderedFrameWidth = Math.max(1, renderedWidth || state.session.source.width);
  const renderedFrameHeight = Math.max(1, renderedHeight || state.session.source.height);
  const renderedAspect = renderedFrameWidth / renderedFrameHeight;
  const sessionId = state.session?.session_id || null;
  const geometrySignature = JSON.stringify(state.adjustments?.shared?.geometry || {});
  const previewFrameReady = preview instanceof HTMLCanvasElement
    ? Boolean(state.gpuPreparedLane[state.currentView])
    : Boolean(preview.complete && preview.naturalWidth > 0);
  if (previewFrameReady && (
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
  const sourceWidth = referenceAspect >= 1 ? referenceLongEdge : referenceLongEdge * referenceAspect;
  const sourceHeight = referenceAspect >= 1 ? referenceLongEdge / referenceAspect : referenceLongEdge;
  const frameWidth = Math.max(1, els.dropzone.clientWidth);
  const frameHeight = Math.max(1, els.dropzone.clientHeight);
  const paneWidth = state.compareLayout === "side-horizontal" ? frameWidth / 2 : frameWidth;
  const paneHeight = state.compareLayout === "side-vertical" ? frameHeight / 2 : frameHeight;
  const fitPercent = Math.min(paneWidth / sourceWidth, paneHeight / sourceHeight) * 100;
  const percent = state.zoomMode === "fit" ? fitPercent : state.zoomPercent;
  const displayWidth = Math.max(1, sourceWidth * percent / 100);
  const displayHeight = Math.max(1, sourceHeight * percent / 100);

  const stageContentWidth = state.compareLayout === "side-horizontal" ? displayWidth * 2 : displayWidth;
  const stageContentHeight = state.compareLayout === "side-vertical" ? displayHeight * 2 : displayHeight;
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
  if (!previewIsVisible()) return;
  const imageRect = activePreviewElement().getBoundingClientRect();
  if (event.clientX < imageRect.left || event.clientX > imageRect.right || event.clientY < imageRect.top || event.clientY > imageRect.bottom) return;
  event.preventDefault();
  const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? event.deltaY * 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? event.deltaY * els.dropzone.clientHeight
      : event.deltaY;
  const nextPercent = (state.zoomPercent || 100) * Math.exp(-delta * 0.0022);
  setCustomZoom(nextPercent, { clientX: event.clientX, clientY: event.clientY });
}

function zoomPercentToSlider(percent) {
  return Math.log(percent / MIN_ZOOM_PERCENT) / Math.log(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT) * 100;
}

function sliderToZoomPercent(value) {
  return MIN_ZOOM_PERCENT * Math.pow(MAX_ZOOM_PERCENT / MIN_ZOOM_PERCENT, clamp(value, 0, 100) / 100);
}

function toggleOverlayPopover() {
  const open = els.overlayPopover.classList.toggle("hidden") === false;
  els.overlayToggle.setAttribute("aria-expanded", String(open));
}

function closeOverlayPopover({ restoreFocus = true } = {}) {
  els.overlayPopover.classList.add("hidden");
  els.overlayToggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) els.overlayToggle.focus();
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
  els.dockCollapse.textContent = state.dockCollapsed ? "Open" : "Collapse";
  els.dockCollapse.setAttribute("aria-expanded", String(!state.dockCollapsed));
  scheduleLayoutSettled();
}

async function activateDockTab(tab) {
  state.activeDockTab = tab;
  state.dockCollapsed = false;
  state.layout.dockOpen = true;
  state.layout.dockTab = tab;
  els.analysisDock.classList.remove("collapsed");
  els.dockCollapse.textContent = "Collapse";
  els.dockCollapse.setAttribute("aria-expanded", "true");
  els.dockTabs.forEach((button) => {
    const active = button.dataset.dockTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const technical = tab === "technical";
  els.scopeView.classList.toggle("hidden", technical);
  els.technicalView.classList.toggle("hidden", !technical);
  scheduleLayoutSettled();
  if (technical) return;
  state.scopeMode = tab === "vectorscope" ? "vectorscope" : tab === "waveform" || tab === "parade" ? "waveform" : "histogram";
  state.scopeChannelMode = tab === "parade" ? "parade" : "composite";
  els.scopeMode.value = state.scopeMode;
  els.scopeChannelMode.value = state.scopeChannelMode;
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
  if (path.endsWith("_hue")) return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}°`;
  if (path.endsWith("_purity") || path.endsWith(".saturation") || path.endsWith(".vibrance")) return `${numeric > 0 ? "+" : ""}${Math.round(path.endsWith("_purity") ? numeric : numeric * 100)}%`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path.endsWith("_nits")) return `${Math.round(numeric)} nit`;
  if (path.includes("film_look") && path.endsWith("_radius")) return `${numeric.toFixed(2)}% diag`;
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

function renderControlState() {
  const defaults = defaultAdjustments();
  const filmicEnabled = state.adjustments.sdr?.tone_mapper === "filmic";
  document.querySelectorAll("[data-filmic-control]").forEach((row) => {
    row.classList.toggle("control-disabled", !filmicEnabled);
    row.querySelectorAll("input").forEach((input) => {
      input.disabled = !filmicEnabled;
    });
  });
  renderHighlightCompressionControls();
  els.controlRows.forEach((row) => {
    row.classList.toggle("modified", isPathModified(row.dataset.controlPath, defaults));
  });
  for (const [group, paths] of Object.entries(controlGroups)) {
    const count = paths.filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector(`[data-modified-count="${group}"]`);
    if (output) output.textContent = count ? `${count} Mod` : "";
    output?.closest(".control-group")?.classList.toggle("modified", count > 0);
  }
  const geometryReset = els.groupResets.find((button) => button.dataset.resetGroup === "geometry");
  if (geometryReset) {
    const hasDraft = Boolean(state.cropDraftGeometry || state.rotateDraftGeometry);
    geometryReset.disabled = !hasDraft && valuesEqual(state.adjustments.shared.geometry, defaults.shared.geometry);
    geometryReset.title = "Reset all crop and rotation geometry";
    geometryReset.setAttribute("aria-label", "Reset all crop and rotation geometry");
  }
  for (const lane of ["hdr", "sdr"]) {
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve") && !key.endsWith("_section_enabled") && key !== "highlight_compression_source_peak_nits");
    const modified = keys.some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]))
      || laneCurvesModified(lane, defaults);
    const button = els.viewButtons.find((item) => item.dataset.kind === lane);
    button?.classList.toggle("modified", modified);
  }
  const currentLaneDefaults = defaults[state.currentView];
  const modifiedCount = Object.keys(currentLaneDefaults)
    .filter((key) => !key.endsWith("_section_enabled") && key !== "highlight_compression_source_peak_nits")
    .filter((key) => !valuesEqual(state.adjustments[state.currentView]?.[key], currentLaneDefaults[key])).length;
  els.gradeModifiedSummary.textContent = modifiedCount ? `${modifiedCount} Mod` : "";
  const curvesModified = laneCurvesModified(state.currentView, defaults);
  els.curveGroupState.textContent = curvesModified ? "Mod" : "";
  els.curveReset.closest(".control-group")?.classList.toggle("modified", curvesModified);
  const filmModified = !valuesEqual(state.adjustments[state.currentView]?.film_look, currentLaneDefaults.film_look);
  if (els.filmLookState) els.filmLookState.textContent = filmModified ? "Mod" : "";
  els.filmLookReset?.closest(".control-group")?.classList.toggle("modified", filmModified);
  const gradingModified = !valuesEqual(state.adjustments[state.currentView]?.color_grading, currentLaneDefaults.color_grading);
  if (els.colorGradingState) els.colorGradingState.textContent = gradingModified ? "Mod" : "";
  els.colorGradingReset?.closest(".control-group")?.classList.toggle("modified", gradingModified);
  const vignetteModified = !valuesEqual(state.adjustments[state.currentView]?.vignette, currentLaneDefaults.vignette);
  if (els.vignetteState) els.vignetteState.textContent = vignetteModified ? "Mod" : "";
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
  const paths = controlGroups[group] || [];
  if (!paths.length) return;
  const defaults = defaultAdjustments();
  if (group === "geometry") {
    const current = state.cropDraftGeometry || state.adjustments.shared.geometry;
    if (valuesEqual(current, defaults.shared.geometry) && !state.rotateDraftGeometry) return;
    if (!window.confirm("Reset all crop and rotation geometry? This cannot be undone.")) return;
    if (state.cropMode) closeCropMode(false);
    if (state.rotateDraftGeometry) closeRotateMode(false);
  }
  paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
  const sectionPath = sectionPathForGroup[group];
  if (sectionPath) setValueByPath(state.adjustments, sectionPath, true);
  syncControlsFromState();
  if (group === "hdr-equalizer") drawToneEqualizerEditor();
  if (group === "geometry") {
    invalidatePreview("hdr"); invalidatePreview("sdr");
  } else invalidatePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
  renderControlState();
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

function resetSdrColorSliders() {
  setSdrColorSliders(defaultAdjustments().sdr);
}

function applyFilmLookPreset(referenceModel) {
  const preset = FILM_LOOK_PRESETS[referenceModel];
  if (!preset) return;
  Object.assign(state.adjustments[state.currentView].film_look, preset, { reference_model: referenceModel });
  syncControlsFromState();
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
  renderExportPreflight();
  els.exportStatus.textContent = "Choose a format and destination.";
}

function openExportSheet() {
  if (!state.session) return;
  activateWorkflowTab("export", { focus: true });
}

function renderCapabilities() {
  const keys = ["avif_gain_map_encoder", "ultrahdr_encoder", "jpegxl_encoder"];
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

  els.formatCards.forEach((card) => {
    const format = card.dataset.formatCard;
    const capability = state.capabilities[capabilityForFormat[format]];
    const availableForExport = capability?.status === "available";
    card.classList.toggle("unavailable", !availableForExport);
    const radio = card.querySelector("input");
    radio.disabled = !availableForExport;
    card.title = availableForExport ? "" : capability?.detail || "This export path is unavailable.";
    card.querySelector(".format-capability-detail")?.remove();
    if (!availableForExport) {
      const detail = document.createElement("span");
      detail.className = "format-capability-detail";
      detail.textContent = capability?.detail || "Required encoder is not installed.";
      card.append(detail);
    }
  });

  const selected = els.exportFormatChoices.find((choice) => choice.checked && !choice.disabled);
  if (!selected) {
    const fallback = els.exportFormatChoices.find((choice) => !choice.disabled);
    if (fallback) {
      fallback.checked = true;
      els.exportFormat.value = fallback.value;
    }
  }
  window.HDRProofing?.render();
}

function renderFormatCards() {
  els.formatCards.forEach((card) => {
    card.classList.toggle("selected", card.dataset.formatCard === els.exportFormat.value);
  });
  els.jpegAdvancedSettings.classList.toggle("hidden", els.exportFormat.value !== "jpeg_ultrahdr");
}

function renderExportPreflight() {
  const needsOverride = Boolean(state.session?.analysis?.needs_color_override);
  const sourceReady = Boolean(state.session) && (!needsOverride || state.interpretationGateDismissed);
  const encoderKey = capabilityForFormat[els.exportFormat.value];
  const encoderReady = state.capabilities[encoderKey]?.status === "available";
  setPreflight(
    "source",
    sourceReady,
    sourceReady ? "Source interpretation confirmed" : "Source interpretation needs confirmation",
  );
  setPreflight("hdr", cacheReady("hdr"), cacheReady("hdr") ? "HDR branch ready" : "HDR preview preparing");
  setPreflight("sdr", cacheReady("sdr"), cacheReady("sdr") ? "SDR fallback ready" : "SDR fallback preparing");
  setPreflight("encoder", encoderReady, encoderReady ? "Encoder available" : "Encoder unavailable");
  renderProofPreflight();
  els.exportConfirmButton.disabled = !state.session || !sourceReady || !encoderReady;
}

function renderProofPreflight() {
  const row = els.preflightItems.find((element) => element.dataset.preflight === "proof");
  if (!row || !els.exportProofStatus || !els.reviewChromeProof) return;
  row.classList.remove("pass", "warn");
  els.reviewChromeProof.classList.toggle("hidden", els.exportFormat.value === "sdr_png" || !state.session);
  if (els.exportFormat.value === "sdr_png") {
    els.exportProofStatus.textContent = "Chromium HDR proof not applicable to SDR PNG";
    return;
  }
  const formatName = state.proofArtifact?.format === "avif_gain_map" ? "AVIF" : "JPEG Ultra HDR";
  const targetName = state.proofReconstruction?.target_label || "selected target";
  if (!state.proofArtifact || !state.proofReconstruction) {
    els.exportProofStatus.textContent = "Chromium proof has not been reviewed";
    row.classList.add("warn");
  } else if (state.proofDirty) {
    els.exportProofStatus.textContent = `Chromium proof is stale · ${formatName} · ${targetName}`;
    row.classList.add("warn");
  } else if (state.proofArtifact.format !== els.exportFormat.value) {
    const exportName = els.exportFormat.value === "avif_gain_map" ? "AVIF" : "JPEG Ultra HDR";
    els.exportProofStatus.textContent = `Proofed ${formatName}, not selected ${exportName}`;
    row.classList.add("warn");
  } else {
    els.exportProofStatus.textContent = `Chromium proof reviewed · ${formatName} · ${targetName}`;
    row.classList.add("pass");
  }
}

function setPreflight(name, pass, label) {
  const item = els.preflightItems.find((element) => element.dataset.preflight === name);
  if (!item) return;
  item.textContent = label;
  item.classList.toggle("pass", pass);
  item.classList.toggle("warn", !pass);
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
    feather_mode: "outer_boundary",
    feather_nodes: [],
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

function newLocalAdjustment(type) {
  const number = (state.editDocument?.local_adjustments?.length || 0) + 1;
  return {
    id: crypto.randomUUID(),
    name: `Local Adjustment ${number}`,
    enabled: true,
    opacity: 1,
    mask: { operator: "leaf", leaf: newMaskLeaf(type), children: [], inverted: false },
    hdr_grade: defaultLocalGrade(),
    sdr_grade: defaultLocalGrade(),
  };
}

async function finishLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft || draft.finishing) return false;
  const local = localAdjustments().find((item) => item.id === draft.localId);
  const leaf = firstMaskLeaf(local?.mask, "path");
  if (!local || !leaf || leaf.nodes.length < 3) {
    cancelLocalPathDraft();
    return false;
  }
  draft.finishing = true;
  state.localPathCreatePendingId = local.id;
  state.localPathDraft = null;
  state.selectedPathNode = 0;
  renderLocalAdjustments();
  const created = await queueEditCommand("create_local", { local: JSON.parse(JSON.stringify(local)) });
  state.localPathCreatePendingId = null;
  if (!created) {
    const index = localAdjustments().findIndex((item) => item.id === local.id);
    if (index >= 0) localAdjustments().splice(index, 1);
    state.selectedLocalId = localAdjustments().at(-1)?.id || null;
    renderLocalAdjustments();
  }
  return created;
}

function cancelLocalPathDraft() {
  const draft = state.localPathDraft;
  if (!draft) return;
  const index = localAdjustments().findIndex((item) => item.id === draft.localId);
  if (index >= 0) localAdjustments().splice(index, 1);
  state.localPathDraft = null;
  state.localPointerGesture = null;
  state.selectedPathNode = null;
  state.selectedLocalId = localAdjustments().at(-1)?.id || null;
  renderLocalAdjustments();
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
    state.localTool = button.dataset.localTool;
    state.localErase = false;
    if (["brush", "linear_gradient", "luminance_range"].includes(state.localTool)) state.localShowMask = true;
    updateLocalToolState();
    if (!state.editDocument) await refreshEditState();
    if (!state.editDocument) {
      els.badge.textContent = "Local adjustment state is not ready. Please try the mask tool again.";
      els.badge.className = "badge warn";
      return;
    }
    const local = newLocalAdjustment(state.localTool);
    state.selectedLocalId = local.id;
    setGradeMode("local");
    if (state.localTool === "path") {
      state.editDocument.local_adjustments.push(local);
      state.localPathDraft = { localId: local.id, finishing: false };
      state.localPathEditMode = "path";
      state.selectedPathNode = null;
      state.localShowMask = true;
      renderLocalAdjustments();
      els.localMaskOverlay?.focus({ preventScroll: true });
      return;
    }
    const created = await queueEditCommand("create_local", { local });
    if (!created) {
      state.selectedLocalId = localAdjustments()[0]?.id || null;
      renderLocalAdjustments();
    }
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
    const menuAction = event.target.closest("button[data-local-menu-action]");
    if (menuAction) {
      state.selectedLocalId = menuAction.dataset.localId;
      state.localAdjustmentMenuId = null;
      renderLocalAdjustments();
      if (menuAction.dataset.localMenuAction === "add-sub-mask") await addSubMask();
      return;
    }
    const menuButton = event.target.closest("button[data-local-menu-id]");
    if (menuButton) {
      const localId = menuButton.dataset.localMenuId;
      state.selectedLocalId = localId;
      state.localTool = firstMaskLeaf(selectedLocal()?.mask)?.type || null;
      state.localAdjustmentMenuId = state.localAdjustmentMenuId === localId ? null : localId;
      renderLocalAdjustments();
      return;
    }
    const button = event.target.closest("button[data-local-id]");
    if (!button) return;
    state.selectedLocalId = button.dataset.localId;
    state.localTool = firstMaskLeaf(selectedLocal()?.mask)?.type || null;
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
    scheduleLocalPreview();
  });
  els.localOpacity?.addEventListener("change", () => commitSelectedLocal({ refreshPreview: false }));
  bindLocalPreviewInteraction(els.localOpacity);
  els.localGradeControls.forEach((control) => {
    control.addEventListener("input", () => {
      const local = selectedLocal();
      if (!local) return;
      local[`${state.currentView}_grade`][control.dataset.localGrade] = Number(control.value);
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
    copy.name = `${local.name} copy`;
    const index = localAdjustments().findIndex((item) => item.id === local.id) + 1;
    state.selectedLocalId = copy.id;
    await queueEditCommand("create_local", { local: copy, index });
  });
  els.localAddAdjustment?.addEventListener("click", async () => {
    if (!state.session) return;
    const type = state.localTool || firstMaskLeaf(selectedLocal()?.mask)?.type || "brush";
    const local = newLocalAdjustment(type);
    state.selectedLocalId = local.id;
    if (["brush", "linear_gradient", "luminance_range"].includes(type)) state.localShowMask = true;
    const created = await queueEditCommand("create_local", { local });
    if (!created) state.selectedLocalId = localAdjustments()[0]?.id || null;
    renderLocalAdjustments();
  });
  els.localInvert?.addEventListener("click", () => {
    const local = selectedLocal();
    if (!local) return;
    local.mask.inverted = !local.mask.inverted;
    if (gpuLumaMaskPreviewActive(local)) scheduleLocalPreview();
    commitSelectedLocal();
  });
  els.localDelete?.addEventListener("click", async () => {
    const local = selectedLocal();
    if (!local) return;
    await queueEditCommand("delete_local", {}, local.id);
    state.selectedLocalId = localAdjustments()[0]?.id || null;
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
  const brushSelected = Boolean(local && firstMaskLeaf(local.mask, "brush"));
  els.localToolButtons.forEach((button) => {
    const active = button.dataset.localTool === state.localTool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = false;
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

function renderLocalAdjustments() {
  if (!els.localAdjustmentList) return;
  const locals = localAdjustments();
  if (els.localAdjustmentCount) els.localAdjustmentCount.textContent = locals.length ? String(locals.length) : "0";
  if (!state.selectedLocalId && locals.length) state.selectedLocalId = locals[0].id;
  if (state.localAdjustmentMenuId && !locals.some((local) => local.id === state.localAdjustmentMenuId)) {
    state.localAdjustmentMenuId = null;
  }
  els.localAdjustmentList.innerHTML = "";
  locals.forEach((local, index) => {
    const item = document.createElement("li");
    item.className = "local-adjustment-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "local-adjustment-select";
    button.dataset.localId = local.id;
    button.classList.toggle("active", local.id === state.selectedLocalId);
    const maskType = firstMaskLeaf(local.mask)?.type || "mask";
    button.innerHTML = `<span class="local-adjustment-copy"><span>${escapeHtml(local.name)}</span><small>${escapeHtml(localMaskTypeLabel(maskType))}</small></span>`;
    const bypassButton = document.createElement("button");
    bypassButton.type = "button";
    bypassButton.className = "local-adjustment-bypass";
    bypassButton.classList.toggle("bypassed", !local.enabled);
    bypassButton.dataset.localBypassId = local.id;
    bypassButton.setAttribute("aria-label", `${local.enabled ? "Bypass" : "Show"} ${local.name}`);
    bypassButton.setAttribute("aria-pressed", String(!local.enabled));
    bypassButton.title = `${local.enabled ? "Bypass" : "Show"} ${local.name}`;
    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "local-adjustment-menu-button";
    menuButton.dataset.localMenuId = local.id;
    menuButton.setAttribute("aria-label", `More actions for ${local.name}`);
    menuButton.setAttribute("aria-haspopup", "menu");
    menuButton.setAttribute("aria-expanded", String(state.localAdjustmentMenuId === local.id));
    menuButton.title = `More actions for ${local.name}`;
    menuButton.textContent = "⋯";
    item.append(button, bypassButton, menuButton);
    if (state.localAdjustmentMenuId === local.id) {
      const menu = document.createElement("div");
      menu.className = "local-adjustment-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", `Actions for ${local.name}`);
      const addMask = document.createElement("button");
      addMask.type = "button";
      addMask.setAttribute("role", "menuitem");
      addMask.dataset.localMenuAction = "add-sub-mask";
      addMask.dataset.localId = local.id;
      addMask.textContent = "Add sub-mask";
      menu.append(addMask);
      item.append(menu);
    }
    els.localAdjustmentList.append(item);
  });
  const local = selectedLocal();
  els.localEmpty?.classList.toggle("hidden", locals.length > 0);
  if (!locals.length && els.localEmpty) {
    els.localEmpty.textContent = state.session
      ? "Choose a mask tool to create the first local adjustment."
      : "Load an image, then choose a mask tool to create the first local adjustment.";
  }
  els.localEditor?.classList.toggle("hidden", !local);
  const selectedIndex = local ? locals.findIndex((item) => item.id === local.id) : -1;
  if (els.localAddAdjustment) els.localAddAdjustment.disabled = !state.session;
  if (els.localRename) els.localRename.disabled = !local;
  if (els.localDuplicate) els.localDuplicate.disabled = !local;
  if (els.localDelete) els.localDelete.disabled = !local;
  if (els.localMoveUp) els.localMoveUp.disabled = !local || selectedIndex <= 0;
  if (els.localMoveDown) els.localMoveDown.disabled = !local || selectedIndex >= locals.length - 1;
  if (els.projectSave) {
    els.projectSave.disabled = !state.session;
    els.projectSave.textContent = state.documentDirty ? "Save project *" : "Save project";
  }
  syncDesktopDocumentState();
  if (local) {
    els.localOpacity.value = String(local.opacity);
    els.localOpacityValue.textContent = `${Math.round(local.opacity * 100)}%`;
    const brushLeaf = firstMaskLeaf(local.mask, "brush");
    els.localInvert.setAttribute("aria-pressed", String(Boolean(local.mask.inverted)));
    els.localInvert.textContent = local.mask.inverted ? "Restore mask" : "Invert mask";
    els.localInvert.disabled = Boolean(brushLeaf && !(brushLeaf.strokes || []).length);
    syncLocalMaskOverlayControl();
    els.localLaneButtons.forEach((button) => {
      const active = button.dataset.localLane === state.currentView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const grade = local[`${state.currentView}_grade`];
    els.localGradeControls.forEach((control) => {
      control.value = String(grade[control.dataset.localGrade]);
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

function localMaskTypeLabel(type) {
  return ({
    brush: "Brush",
    linear_gradient: "Linear gradient",
    luminance_range: "Luma range",
    path: "Path",
  })[type] || type.replaceAll("_", " ");
}

function updateLocalGradeOutput(name, value) {
  let output = els.localGradeOutputs.find((candidate) => candidate.dataset.localGradeOutput === name);
  if (!output) {
    const control = els.localGradeControls.find((candidate) => candidate.dataset.localGrade === name);
    const heading = control?.closest(".control-row")?.querySelector(".control-heading");
    if (!heading) return;
    output = document.createElement("output");
    output.dataset.localGradeOutput = name;
    heading.append(output);
    els.localGradeOutputs.push(output);
  }
  if (name === "exposure") output.textContent = `${value.toFixed(2)} EV`;
  else if (name === "white_balance_kelvin") output.textContent = `${Math.round(value)} K`;
  else output.textContent = Math.abs(value) < 0.005 ? "0" : value.toFixed(2);
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
  control.addEventListener("pointerdown", () => state.previewScheduler?.beginInteraction());
  ["pointerup", "pointercancel", "change"].forEach((eventName) => {
    control.addEventListener(eventName, () => state.previewScheduler?.endInteraction());
  });
  control.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
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
  scheduleAuthoritativeLocalMaskDraft(local);
  scheduleLocalPreview({ spatialMaskChanged: true });
}

function gpuLumaMaskOverlayOptions() {
  const local = selectedLocal();
  if (
    state.gradeMode !== "local"
    || !state.localShowMask
    || local?.enabled === false
    || !gpuLumaMaskPreviewActive(local)
  ) return null;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(state.localOverlayColor);
  const color = match
    ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
    : [1, 38 / 255, 61 / 255];
  return { localId: local.id, color };
}

function renderMaskTreeEditor(local) {
  const leaf = firstMaskLeaf(local.mask);
  els.localMaskFooterActions?.append(els.localInvert);
  els.localMaskTreeSummary.textContent = "";
  if (els.localGradientControls) {
    els.localGradientControls.textContent = "";
    els.localGradientControls.classList.add("hidden");
  }
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
    els.localInvert.textContent = local.mask.inverted ? "Restore Mask" : "Invert Mask";
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
  input.addEventListener("input", () => {
    const previous = Number(leaf.feather || 0);
    const next = Number(input.value) / 200;
    if (leaf.feather_nodes?.length) {
      const proposed = offsetBoundaryNodes(leaf.feather_nodes, next - previous);
      if (!validFeatherGeometry(leaf.nodes, proposed)) {
        input.value = String(previous * 200);
        state.pathInvalidGesture = true;
        queueLocalMaskOverlayRender();
        return;
      }
      leaf.feather_nodes = proposed;
    }
    leaf.feather = next;
    output.textContent = `${Math.round(Number(input.value))}%`;
    state.pathInvalidGesture = false;
    scheduleSpatialMaskPreview(local);
    queueLocalMaskOverlayRender();
  });
  input.addEventListener("change", () => commitSelectedLocal());
  bindLocalPreviewInteraction(input);
  label.append(heading, output, input);
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
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  const bands = falseColorBandsForPreset(preset);

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
  scale.innerHTML = "<span>0.1 nit</span><span>100 nit</span><span>10,000 nit</span>";

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
  const start = Number(clamp(startEv, referenceStart, referenceEnd - 0.01).toFixed(4));
  const end = Number(clamp(endEv, start + 0.01, referenceEnd).toFixed(4));
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

async function addSubMask() {
  const local = selectedLocal();
  if (!local) return;
  const type = window.prompt("Sub-mask type: brush, linear_gradient, luminance_range, or path", "brush")?.trim();
  if (!["brush", "linear_gradient", "luminance_range", "path"].includes(type)) return;
  const operator = window.prompt("Combine using union, intersect, or subtract", "union")?.trim();
  if (!["union", "intersect", "subtract"].includes(operator)) return;
  local.mask = {
    operator,
    leaf: null,
    children: [local.mask, { operator: "leaf", leaf: newMaskLeaf(type), children: [], inverted: false }],
    inverted: false,
  };
  state.localTool = type;
  await commitSelectedLocal();
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
  if (!local) return;
  state.localMaskCommitDepth += 1;
  state.localMaskCommitRefreshPending ||= refreshPreview;
  try {
    // Local strokes are optimistic and may overlap a previous commit. Hold the
    // adjusted preview until the last queued commit so it cannot render an
    // intermediate mask between strokes.
    const committed = await queueEditCommand("update_local", { local: JSON.parse(JSON.stringify(local)) }, local.id, { refreshPreview: false });
    if (committed) {
      window.cancelAnimationFrame(state.localMaskDraftTimer);
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
}

function queueEditCommand(commandType, payload = {}, targetId = null, { refreshPreview = true, globalEditGeneration = null } = {}) {
  if (commandType !== "set_global_adjustments" && state.globalEditDirty) {
    return syncGlobalEditState().then(() => queueEditCommand(commandType, payload, targetId, { refreshPreview, globalEditGeneration }));
  }
  state.editCommandQueue = (state.editCommandQueue || Promise.resolve()).then(async () => {
    if (!state.session) return false;
    const response = await fetch(`/api/session/${state.session.session_id}/edit-commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ expected_revision: state.editRevision, command_type: commandType, target_id: targetId, payload }] }),
    });
    const result = await safeJson(response);
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
    state.editRevision = result.revision;
    state.editDocument = result.document;
    if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
    if (optimisticAdjustments) state.editDocument.global_adjustments = optimisticAdjustments;
    state.documentDirty = preserveNewerGlobalEdit || Boolean(result.dirty);
    state.adjustments = optimisticAdjustments || result.document.global_adjustments;
    renderLocalAdjustments();
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
  if (!state.globalEditDirty) {
    const pending = state.globalEditSyncPending;
    if (!pending) return true;
    const applied = await pending;
    if (!applied) return false;
    return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
  }
  state.globalEditDirty = false;
  const generation = state.globalEditGeneration;
  const adjustments = JSON.parse(JSON.stringify(state.adjustments));
  const pending = queueEditCommand("set_global_adjustments", { adjustments }, null, { globalEditGeneration: generation });
  state.globalEditSyncPending = pending;
  const applied = await pending;
  if (state.globalEditSyncPending === pending) state.globalEditSyncPending = null;
  if (!applied) state.globalEditDirty = true;
  if (!applied) return false;
  return state.globalEditDirty || state.globalEditSyncPending ? syncGlobalEditState() : true;
}

async function refreshEditState({ preserveLocalDraft = false } = {}) {
  if (!state.session) return;
  const optimisticLocals = preserveLocalDraft
    ? state.editDocument?.local_adjustments
    : null;
  const response = await fetch(`/api/session/${state.session.session_id}/edit-state`);
  const result = await safeJson(response);
  if (!response.ok) return;
  state.editRevision = result.revision;
  state.editDocument = result.document;
  if (optimisticLocals) state.editDocument.local_adjustments = optimisticLocals;
  state.documentDirty = Boolean(result.dirty);
  state.adjustments = result.document.global_adjustments;
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
    const leaf = firstMaskLeaf(local.mask, state.localTool) || firstMaskLeaf(local.mask);
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
    const hoveredPathLeaf = firstMaskLeaf(selectedLocal()?.mask, "path");
    if (hoveredPathLeaf) state.localPathCursor = point;
    const activeLeaf = firstMaskLeaf(selectedLocal()?.mask, "brush");
    if (activeLeaf && state.localTool === "brush") {
      state.localBrushCursor = point;
      state.localBrushPreviewPinned = false;
    }
    if (!gesture) {
      if (activeLeaf && state.localTool === "brush") queueLocalMaskOverlayRender();
      const pathLeaf = firstMaskLeaf(selectedLocal()?.mask, "path");
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
    const leaf = firstMaskLeaf(local?.mask, "path");
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
  const fields = ["full_start_ev", "full_end_ev"];
  const defaults = [-8, 6];
  return fields.some((field, index) => Math.abs(Number(leaf[field]) - defaults[index]) > 0.001);
}

function appendLuminanceSamplePoint(gesture, point) {
  const previous = gesture.points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.006) return;
  if (gesture.points.length < 512) gesture.points.push(point);
}

async function finishLuminanceSampleGesture(gesture) {
  const local = selectedLocal();
  if (!state.session || !local || local.id !== gesture.localId || !gesture.points.length) return;
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
    if (!applyLuminanceSample(gesture.leaf, sample, gesture.remove)) return;
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
  leaf.reference_start_ev = fullStart;
  leaf.reference_end_ev = fullEnd;
  setLuminanceRefinedRange(leaf, fullStart, fullEnd);
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
  return simplePathPolygon(inner) && simplePathPolygon(outer) && inner.every((point) => pointInsidePathPolygon(point, outer));
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
  const pathLeaf = firstMaskLeaf(selectedLocal()?.mask, "path");
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
  const source = affinePoint(coordinateMap.outputToSource, point);
  const pathLeaf = firstMaskLeaf(selectedLocal()?.mask, "path");
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
  return affinePoint(coordinateMap.sourceToOutput, point);
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
  const leaf = firstMaskLeaf(local?.mask, "path");
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
  const movedSource = affinePoint(coordinateMap.outputToSource, {
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

function renderLocalMaskOverlay() {
  const canvas = els.localMaskOverlay;
  if (!canvas) return;
  const local = selectedLocal();
  const active = state.gradeMode === "local" && Boolean(local) && local.enabled !== false;
  canvas.classList.toggle("editing", active);
  const rect = els.previewPrimaryPane?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const deviceRatio = window.devicePixelRatio || 1;
  const bitmapLongEdge = Math.max(512, Math.min(1600, settledProxyLongEdge()));
  // The canvas element follows the zoomed image for pointer geometry, but its
  // bitmap does not need to grow to multi-thousand-pixel zoom dimensions. Keep
  // it at mask-proxy resolution and let CSS scale it with the preview.
  const ratio = Math.min(deviceRatio, bitmapLongEdge / Math.max(rect.width, rect.height));
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
  const maskSignature = JSON.stringify(local.mask);
  const spatialSignature = localMaskSpatialSignature(local.mask);
  const authoritative = local.mask?.operator === "leaf"
    ? localAuthoritativeMaskCache.get(local.id)
    : null;
  const needsAuthoritativeOverlay = ["linear_gradient", "luminance_range"].includes(local.mask?.leaf?.type);
  const drawOptions = {
    localId: local.id,
    maskSignature,
    spatialSignature,
    // Gradient and luminance masks have no client-side mask rasterizer. Keep
    // their most recent exact frame visible across both the draft and commit
    // handoffs, then replace it atomically when the current exact frame lands.
    // Brush masks can instead fall back to their current local stroke raster.
    authoritative: authoritative && (
      state.localMaskDraftDirty
      || needsAuthoritativeOverlay
      || authoritative.signature === (authoritative.spatialOnly ? spatialSignature : maskSignature)
    )
      ? authoritative
      : null,
    exactMaskPending: state.localMaskDraftDirty,
    gpuLumaOverlay: gpuLumaMaskPreviewActive(local),
  };
  drawMaskExpression(context, local.mask, x, y, { ...drawOptions, renderPhase: "mask" });
  const coordinateMap = currentGeometryCoordinateMap();
  if (coordinateMap) {
    context.save();
    applySourceGeometryCanvasTransform(context, imageRect, rect, coordinateMap.sourceToOutput);
    drawMaskExpression(context, local.mask, x, y, { ...drawOptions, renderPhase: "gizmo" });
    context.restore();
  } else {
    void ensureGeometryCoordinateMap();
  }
  if (!gpuLumaMaskPreviewActive(local)) void queueAuthoritativeLocalMask(local);
}

function applySourceGeometryCanvasTransform(context, imageRect, paneRect, matrix) {
  const width = Math.max(imageRect.width, 1);
  const height = Math.max(imageRect.height, 1);
  const offsetX = imageRect.left - paneRect.left;
  const offsetY = imageRect.top - paneRect.top;
  const a = matrix[0];
  const b = matrix[3] * height / width;
  const c = matrix[1] * width / height;
  const d = matrix[4];
  const e = offsetX - a * offsetX - c * offsetY + matrix[2] * width;
  const f = offsetY - b * offsetX - d * offsetY + matrix[5] * height;
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

function drawMaskExpression(context, expression, x, y, options = {}) {
  if (expression.operator !== "leaf") {
    (expression.children || []).forEach((child) => drawMaskExpression(context, child, x, y, options));
    return;
  }
  const leaf = expression.leaf;
  if (!leaf) return;
  const renderMask = options.renderPhase !== "gizmo";
  const renderGizmo = options.renderPhase !== "mask";
  context.save();
  context.strokeStyle = "rgba(238, 252, 255, .98)";
  context.fillStyle = overlayColorWithAlpha(0.22);
  context.lineWidth = 2;
  if (leaf.type === "linear_gradient") {
    if (renderMask && state.localShowMask && options.authoritative) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawLinearGradientGizmo(context, leaf, x, y);
  } else if (leaf.type === "brush") {
    const gesture = state.localPointerGesture;
    const activeStroke = gesture?.type === "brush" && gesture.leaf === leaf ? gesture.stroke : null;
    if (renderMask && state.localShowMask) drawBrushMaskOverlay(context, leaf, null, x, y, expression.inverted, options);
    if (renderGizmo && state.localShowMask && activeStroke) drawActiveBrushStrokeOverlay(context, activeStroke, x, y);
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
    if (renderMask && state.localShowMask && options.authoritative) {
      drawAuthoritativeMaskOverlay(context, options.authoritative.canvas, x, y, options.authoritative.spatialOnly ? leaf.mask_opacity : 1);
    }
    if (renderGizmo) drawPathMaskGizmo(context, leaf, x, y, { drawFill: !options.authoritative });
  }
  context.restore();
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
  maskCanvas = tintedBrushMaskCanvas(maskCanvas, !activeStroke);
  context.save();
  const influenceOpacity = options.authoritative?.spatialOnly === false
    ? 1
    : clamp(Number(leaf.mask_opacity ?? 1), 0, 1);
  context.globalAlpha = 0.52 * influenceOpacity;
  context.drawImage(maskCanvas, left, top, displayWidth, displayHeight);
  context.restore();
}

async function queueAuthoritativeLocalMask(local) {
  if (!state.session || !local || local.mask?.operator !== "leaf") return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  if (state.localMaskCommitDepth > 0) return;
  if (!["brush", "linear_gradient", "luminance_range", "path"].includes(local.mask.leaf?.type)) return;
  if (local.mask.leaf?.type === "brush" && !(local.mask.leaf.strokes || []).length) return;
  if (state.localMaskDraftDirty) return;
  const signature = localMaskSpatialSignature(local.mask);
  const longEdge = settledProxyLongEdge();
  const revision = state.editRevision;
  const requestedGeometrySignature = geometrySignature();
  const key = `${state.session.session_id}:${local.id}:${longEdge}:${requestedGeometrySignature}:${signature}`;
  const cached = localAuthoritativeMaskCache.get(local.id);
  if (cached?.key === key || localAuthoritativeMaskRequests.has(key)) return;
  const request = fetch(`/api/session/${state.session.session_id}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${revision}&spatial_only=true`)
    .then(async (response) => {
      if (!response.ok) return;
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
      localAuthoritativeMaskCache.set(local.id, { key, signature, canvas, spatialOnly: true });
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
  if (!state.session || !local || local.mask?.operator !== "leaf") return;
  if (state.localPathDraft?.localId === local.id) return;
  if (state.localPathCreatePendingId === local.id) return;
  if (!["brush", "linear_gradient", "luminance_range", "path"].includes(local.mask.leaf?.type)) return;
  if (local.mask.leaf?.type === "brush" && !(local.mask.leaf.strokes || []).length) return;
  const signature = JSON.stringify(local.mask);
  state.localMaskDraftPending = {
    localId: local.id,
    mask: JSON.parse(signature),
    signature,
    revision: state.editRevision,
    longEdge: settledProxyLongEdge(),
    adjustments: JSON.parse(JSON.stringify(state.adjustments)),
    geometrySignature: geometrySignature(),
    generation: ++state.localMaskDraftGeneration,
  };
  if (state.localMaskDraftController) {
    state.localMaskDraftController.abort();
    return;
  }
  if (state.localMaskDraftTimer) return;
  state.localMaskDraftTimer = window.requestAnimationFrame(flushAuthoritativeLocalMaskDraft);
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

function drawActiveBrushStrokeOverlay(context, stroke, x, y) {
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
    drawBrushMaskStroke(gesture.canvas.getContext("2d"), { ...stroke, points: pendingPoints }, width, height);
    gesture.renderedPointCount = stroke.points.length;
    const tintedContext = gesture.tinted.getContext("2d");
    tintedContext.clearRect(0, 0, width, height);
    tintedContext.drawImage(gesture.canvas, 0, 0);
    tintBrushMask(tintedContext, width, height);
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
    if (
      generation !== state.localMaskDraftGeneration
      || revision !== state.editRevision
      || requestedGeometrySignature !== geometrySignature()
      || localId !== state.selectedLocalId
      || signature !== JSON.stringify(selectedLocal()?.mask)
    ) {
      state.previewScheduler?.recordStaleResult();
      return;
    }
    const canvas = alphaMaskCanvas(alpha, width, height);
    localAuthoritativeMaskCache.set(localId, {
      key: `draft:${revision}:${longEdge}:${requestedGeometrySignature}:${signature}`,
      signature,
      canvas,
      spatialOnly: false,
    });
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
    if (error?.name !== "AbortError") console.warn("Authoritative local mask draft could not be loaded.", error);
  } finally {
    if (state.localMaskDraftController === controller) state.localMaskDraftController = null;
    if (state.localMaskDraftPending && state.localMaskDraftDirty && !state.localMaskDraftTimer) {
      state.localMaskDraftTimer = window.requestAnimationFrame(flushAuthoritativeLocalMaskDraft);
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

function tintedBrushMaskCanvas(maskCanvas, cacheable = false) {
  const color = state.localOverlayColor;
  const cached = cacheable ? localTintedMaskCanvasCache.get(maskCanvas) : null;
  if (cached?.color === color) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = maskCanvas.width;
  canvas.height = maskCanvas.height;
  const context = canvas.getContext("2d");
  context.drawImage(maskCanvas, 0, 0);
  tintBrushMask(context, canvas.width, canvas.height);
  if (cacheable) localTintedMaskCanvasCache.set(maskCanvas, { color, canvas });
  return canvas;
}

function tintBrushMask(context, width, height) {
  context.save();
  context.globalCompositeOperation = "source-in";
  context.fillStyle = state.localOverlayColor;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function overlayColorWithAlpha(alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(state.localOverlayColor);
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
  context.save();
  context.lineWidth = selected ? 2.5 : 2;
  context.strokeStyle = closeTarget ? uiToken("--ready") : selected ? uiToken("--curve-selected-ring") : uiToken("--accent");
  context.fillStyle = selected ? uiToken("--curve-selected") : uiToken("--raised");
  context.shadowColor = "rgba(0, 0, 0, .95)";
  context.shadowBlur = 3;
  context.beginPath();
  if (node.node_type === "sharp") context.rect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  else context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  if (hovered) {
    context.beginPath();
    context.arc(centerX, centerY, radius + 4, 0, Math.PI * 2);
    context.strokeStyle = uiToken("--text");
    context.lineWidth = 1;
    context.stroke();
  }
  context.restore();
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
    context.strokeStyle = "rgba(0, 0, 0, .9)";
    context.lineWidth = 5;
    context.stroke();
    context.strokeStyle = uiToken("--accent");
    context.lineWidth = 2;
    context.stroke();
    context.beginPath();
    context.arc(hx, hy, 6, 0, Math.PI * 2);
    context.fillStyle = uiToken("--raised");
    context.fill();
    context.strokeStyle = uiToken("--text");
    context.lineWidth = 2;
    context.stroke();
    if (state.hoveredPathTarget?.type === "handle" && state.hoveredPathTarget.index === nodeIndex && state.hoveredPathTarget.handle === handle) {
      context.beginPath();
      context.arc(hx, hy, 10, 0, Math.PI * 2);
      context.strokeStyle = uiToken("--curve-selected");
      context.lineWidth = 2;
      context.stroke();
    }
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
    context.fillStyle = overlayColorWithAlpha(0.22);
    context.fill();
  }
  if (inner.length) drawLocalGizmoStroke(context, innerPath, 2.5, state.pathInvalidGesture ? uiToken("--blocking") : uiToken("--accent"));
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
    context.strokeStyle = "rgba(0, 0, 0, .9)";
    context.lineWidth = 5;
    outerPath(); context.stroke();
    context.strokeStyle = state.pathInvalidGesture ? uiToken("--blocking") : uiToken("--text");
    context.lineWidth = 2;
    context.setLineDash([7, 6]);
    context.lineDashOffset = reducedPathMotion ? 0 : -performance.now() / 70;
    outerPath(); context.stroke();
    context.restore();
    if (!reducedPathMotion && !pathMarchingAntFrame) {
      pathMarchingAntFrame = window.requestAnimationFrame(() => {
        pathMarchingAntFrame = 0;
        if (firstMaskLeaf(selectedLocal()?.mask, "path")) queueLocalMaskOverlayRender();
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
  context.save();
  context.beginPath();
  context.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
  context.fillStyle = "rgba(0, 0, 0, .88)";
  context.fill();
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fillStyle = "#142226";
  context.fill();
  context.strokeStyle = "#74e5ee";
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, 2, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
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
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Reading source file...", 8);
  const response = await fetch("/api/desktop/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant: selection.grant }),
  });
  const payload = await safeJson(response);
  if (!response.ok || !payload?.session) {
    showUploadError(payload?.detail || "The source file could not be opened.");
    return;
  }
  await activateDesktopSession(payload.session, "");
}

async function activateDesktopSession(session, projectPath) {
  state.session = session;
  state.adjustments = session.adjustments;
  state.editDocument = session.edit_document;
  state.editRevision = session.edit_revision || 0;
  state.documentDirty = Boolean(session.dirty);
  state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null;
  state.projectPath = projectPath || "";
  state.currentView = "hdr";
  state.interpretationGateDismissed = false;
  clearPreviewCache();
  state.gpuPreview?.resetSession(session.session_id);
  invalidatePreview("hdr");
  invalidatePreview("sdr");
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
  hidePreviewMessage();
  prepareInactivePreview();
  syncDesktopDocumentState();
}

async function openProjectFromPath(desktopSelection = null) {
  if (desktop) {
    const selection = desktopSelection || await desktop.openProject();
    if (!selection) return;
    let response = await fetch("/api/desktop/project/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_grant: selection.grant }),
    });
    let payload = await safeJson(response);
    if (!response.ok) {
      const source = await desktop.relinkSource();
      if (!source) return;
      response = await fetch("/api/desktop/project/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_grant: selection.grant, source_grant: source.grant }),
      });
      payload = await safeJson(response);
    }
    if (!response.ok || !payload?.session) {
      window.alert(payload?.detail || "The project could not be opened.");
      return;
    }
    await activateDesktopSession(payload.session, selection.path);
    return;
  }
  const path = window.prompt("Path to a .hdrfinisher project", state.projectPath || "");
  if (!path) return;
  let sourcePath = null;
  let response = await fetch("/api/project/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    sourcePath = window.prompt("The saved source is unavailable or changed. Select the matching original source path.", "");
    if (!sourcePath) return;
    response = await fetch("/api/project/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, source_path: sourcePath }),
    });
  }
  const payload = await safeJson(response);
  if (!response.ok || !payload?.session) {
    window.alert(payload?.detail || "The project could not be opened.");
    return;
  }
  state.session = payload.session;
  state.adjustments = payload.session.adjustments;
  state.editDocument = payload.session.edit_document;
  state.editRevision = payload.session.edit_revision || 0;
  state.documentDirty = Boolean(payload.session.dirty);
  state.selectedLocalId = state.editDocument.local_adjustments[0]?.id || null;
  state.projectPath = path;
  state.currentView = "hdr";
  clearPreviewCache();
  state.gpuPreview?.resetSession(payload.session.session_id);
  activateWorkflowTab("grade", { focus: false });
  renderSession();
  renderLocalAdjustments();
  await refreshPreview();
  await refreshScopes(scopeLongEdge("settled"), { tier: "settled" });
}

async function saveProjectToPath({ saveAs = false } = {}) {
  if (!state.session) return;
  const pendingApplied = await (state.editCommandQueue || Promise.resolve(true));
  const globalsApplied = pendingApplied === false ? false : await syncGlobalEditState();
  if (globalsApplied === false) return;
  if (desktop) {
    const suggestedName = `${state.session.source.filename.replace(/\.[^.]+$/, "")}.hdrfinisher`;
    const selection = await desktop.saveProject({ saveAs, suggestedName });
    if (!selection) return;
    const response = await fetch(`/api/desktop/session/${state.session.session_id}/project/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_grant: selection.grant }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      window.alert(payload?.detail || "The project could not be saved.");
      return;
    }
    state.projectPath = payload.path;
    state.editDocument = payload.document;
    state.documentDirty = false;
    syncCopySourcePathButton();
    syncDesktopDocumentState();
    els.badge.textContent = `Project saved · revision ${payload.revision}`;
    els.badge.className = "badge good";
    return;
  }
  const path = window.prompt("Save project path", state.projectPath || `${state.session.source.filename}.hdrfinisher`);
  if (!path) return;
  let sourcePath = state.editDocument?.source?.durable_path || null;
  if (!sourcePath) {
    sourcePath = window.prompt("Path to the durable original source (the project stores no source pixels)", "");
    if (!sourcePath) return;
  }
  const response = await fetch(`/api/session/${state.session.session_id}/project/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, source_path: sourcePath }),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    window.alert(payload?.detail || "The project could not be saved.");
    return;
  }
  state.projectPath = payload.path;
  state.editDocument = payload.document;
  state.documentDirty = false;
  syncCopySourcePathButton();
  els.badge.textContent = `Project saved · revision ${payload.revision}`;
  els.badge.className = "badge good";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

renderSessionChrome();
renderCurveChannelTabs();
