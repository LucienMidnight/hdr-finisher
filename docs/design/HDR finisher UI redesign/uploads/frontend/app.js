const latitudePresets = {
  WIDE: {
    "hdr.exposure": [-4, 4, 0.05],
    "hdr.highlight_rolloff": [0, 2, 0.01],
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
    "hdr.highlight_rolloff": [0, 1.5, 0.01],
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
    "hdr.highlight_rolloff": [0, 1, 0.01],
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

const TONE_EQUALIZER_MIN_EV = -6;
const TONE_EQUALIZER_MAX_EV = 6;
const TONE_EQUALIZER_PQ_MAX_EV = Math.log2(10000 / 100);
const TONE_EQUALIZER_MAX_ADJUSTMENT_EV = 2;
const TONE_EQUALIZER_MIN_TARGET_STEP = 0.001;
const TONE_EQUALIZER_MIN_NODE_COUNT = 2;
const TONE_EQUALIZER_MAX_NODE_COUNT = 16;

const MIN_ZOOM_PERCENT = 1;
const MAX_ZOOM_PERCENT = 3200;
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 200, 300, 400, 500, 600, 800, 1200, 1600, 2400, 3200];
const LAYOUT_DEFAULTS = { railW: 268, gradeW: 320, dockH: 208, dockOpen: true, dockTab: "histogram" };
const LAYOUT_LIMITS = {
  railW: [200, 380],
  gradeW: [300, 420],
  dockH: [96, 340],
};
const LAYOUT_SETTLE_DELAY = 120;

const state = {
  session: null,
  capabilities: {},
  currentView: "hdr",
  activeWorkflow: "grade",
  scopeMode: "histogram",
  scopeChannelMode: "composite",
  sourceSettingsOpen: false,
  metadataOpen: false,
  interpretationGateDismissed: false,
  zoomMode: "fit",
  zoomPercent: 100,
  activeDockTab: "histogram",
  dockCollapsed: false,
  lastScope: null,
  scopeZoneOverlay: null,
  lastExportPath: "",
  defaultExportDirectory: "",
  compareHoldTimer: null,
  compareHeld: false,
  comparePeekActive: false,
  previewGeneration: { hdr: 0, sdr: 0 },
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
      tone_equalizer_section_enabled: true,
      color_section_enabled: true,
      primaries_section_enabled: true,
      curves_section_enabled: true,
      exposure: 0,
      highlight_rolloff: 0,
      highlight_rolloff_start_nits: 400,
      shadow_lift: 0,
      tone_equalizer_enabled: false,
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
      curves_enabled: false,
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
      match_hdr_color: true,
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
      curves_enabled: false,
      luma_curve: defaultCurvePoints(),
      red_curve: defaultCurvePoints(),
      green_curve: defaultCurvePoints(),
      blue_curve: defaultCurvePoints(),
    },
    shared: {
      active_focus: "hdr",
      curves_enabled: false,
      overlay_mode: "off",
      overlay_preset: "web_1000_100",
      overlay_opacity: 0.72,
      overlay_threshold: 1,
    },
  },
  selectedCurveChannel: "luma",
  activeCurvePoint: null,
  selectedCurvePoint: 2,
  activeToneEqualizerBand: null,
  selectedToneEqualizerBand: 2,
  previewAbortController: null,
  overlayAbortController: null,
  scopeAbortController: null,
  refreshTimer: null,
  settleTimer: null,
  gpuRenderSerial: 0,
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
  layoutBucket: null,
  layoutSettleTimer: null,
  proofEnabled: false,
  proofArtifact: null,
  proofReconstruction: null,
  proofDirty: true,
  proofFormat: "jpeg_ultrahdr",
  proofTarget: "auto",
  proofCustomNits: 1000,
  proofDisplayId: "",
  displayTelemetry: null,
};

let scopeResizeObserver = null;
let scopeResizeFrame = null;
let viewerResizeObserver = null;
let viewerResizeFrame = null;

const defaultAdjustments = () => ({
  hdr: {
    tone_section_enabled: true,
    tone_equalizer_section_enabled: true,
    color_section_enabled: true,
    primaries_section_enabled: true,
    curves_section_enabled: true,
    exposure: 0,
    highlight_rolloff: 0,
    highlight_rolloff_start_nits: 400,
    shadow_lift: 0,
    tone_equalizer_enabled: false,
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
    curves_enabled: false,
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
    match_hdr_color: true,
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
    curves_enabled: false,
    luma_curve: defaultCurvePoints(),
    red_curve: defaultCurvePoints(),
    green_curve: defaultCurvePoints(),
    blue_curve: defaultCurvePoints(),
  },
  shared: {
    active_focus: state.currentView,
    curves_enabled: false,
    overlay_mode: "off",
    overlay_preset: "web_1000_100",
    overlay_opacity: 0.72,
    overlay_threshold: 1,
  },
});

const els = {
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
  fileSummary: document.getElementById("file-summary"),
  sourceConfidence: document.getElementById("source-confidence"),
  sourceRailExpand: document.getElementById("source-rail-expand"),
  capabilitySummary: document.getElementById("capability-summary"),
  workflowTabs: [...document.querySelectorAll("[data-workflow-tab]")],
  overrideWarning: document.getElementById("override-warning"),
  overrideMessage: document.getElementById("override-message"),
  attentionFix: document.getElementById("attention-fix"),
  sourceSettingsToggle: document.getElementById("source-settings-toggle"),
  sourceSettingsPanel: document.getElementById("source-settings-panel"),
  interpretationSummary: document.getElementById("interpretation-summary"),
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
  curvesEnabled: document.getElementById("curves-enabled"),
  curveEditor: document.getElementById("curve-editor"),
  toneEqualizerEditor: document.getElementById("tone-equalizer-editor"),
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
  previewCanvas: document.getElementById("preview-canvas"),
  previewImage: document.getElementById("preview-image"),
  previewOverlay: document.getElementById("preview-overlay"),
  chromeProofImage: document.getElementById("chrome-proof-image"),
  chromeProofToggle: document.getElementById("chrome-proof-toggle"),
  chromeProofInlineStatus: document.getElementById("chrome-proof-inline-status"),
  chromeProofRefresh: document.getElementById("chrome-proof-refresh"),
  chromeProofFormat: document.getElementById("chrome-proof-format"),
  chromeProofTarget: document.getElementById("chrome-proof-target"),
  chromeProofCustomField: document.getElementById("chrome-proof-custom-field"),
  chromeProofCustomNits: document.getElementById("chrome-proof-custom-nits"),
  chromeProofDisplay: document.getElementById("chrome-proof-display"),
  chromeProofStatus: document.getElementById("chrome-proof-status"),
  emptyState: document.getElementById("empty-state"),
  previewStatus: document.getElementById("preview-status"),
  falseColorLegend: document.getElementById("false-color-legend"),
  viewerLaneLabel: document.getElementById("viewer-lane-label"),
  viewerBranchNote: document.getElementById("viewer-branch-note"),
  laneNote: document.getElementById("lane-note"),
  compareButton: document.getElementById("compare-button"),
  compareStatus: document.getElementById("compare-status"),
  zoomFit: document.getElementById("zoom-fit"),
  zoomActual: document.getElementById("zoom-actual"),
  zoomOut: document.getElementById("zoom-out"),
  zoomIn: document.getElementById("zoom-in"),
  zoomSlider: document.getElementById("zoom-slider"),
  zoomReadout: document.getElementById("zoom-readout"),
  overlayToggle: document.getElementById("overlay-toggle"),
  overlayClose: document.getElementById("overlay-close"),
  overlayPopover: document.getElementById("overlay-popover"),
  probeReadout: document.getElementById("probe-readout"),
  scopeTitle: document.getElementById("scope-title"),
  scopeNote: document.getElementById("scope-note"),
  scopeKindLabel: document.getElementById("scope-kind-label"),
  scopeMode: document.getElementById("scope-mode"),
  scopeChannelMode: document.getElementById("scope-channel-mode"),
  scopeStats: document.getElementById("scope-stats"),
  histogram: document.getElementById("histogram"),
  analysisDock: document.getElementById("analysis-dock"),
  dockCollapse: document.getElementById("dock-collapse"),
  dockSummary: document.getElementById("dock-summary"),
  dockTabs: [...document.querySelectorAll("[data-dock-tab]")],
  scopeView: document.getElementById("scope-view"),
  technicalView: document.getElementById("technical-view"),
  exportSheet: document.getElementById("export-sheet"),
  exportConfirmButton: document.getElementById("export-confirm-button"),
  exportStatus: document.getElementById("export-status"),
  exportFilename: document.getElementById("export-filename"),
  exportDirectory: document.getElementById("export-directory"),
  exportDirectoryBrowse: document.getElementById("export-directory-browse"),
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
  sectionBypasses: [...document.querySelectorAll("[data-section-path]")],
  controlRows: [...document.querySelectorAll("[data-control-path]")],
  modifiedCounts: [...document.querySelectorAll("[data-modified-count]")],
  gradeModifiedSummary: document.getElementById("grade-modified-summary"),
  curveGroupState: document.getElementById("curve-group-state"),
};

const overlayPresetNotes = {
  web_1000_100: "Built for web-HDR finishing with 100 nit diffuse white and a 1000 nit highlight ceiling. Best default for AVIF gain-map work and common consumer HDR displays.",
  bt2408_1000_203: "Uses the ITU-R BT.2408 style 203 nit HDR reference white with a 1000 nit peak target. Useful when you want false color to align with PQ/HLG reference-white practice.",
  bt2408_4000_203: "Keeps the 203 nit BT.2408 reference white but stretches warning bands toward a 4000 nit mastering ceiling. Good for checking very bright highlight intent.",
  sdr_100: "Treats 100 nits as both white and ceiling. Handy when judging the SDR fallback or when you want the overlay to behave like an SDR exposure aid.",
};

const controlGroups = {
  "hdr-tone": ["hdr.exposure", "hdr.highlight_rolloff", "hdr.highlight_rolloff_start_nits", "hdr.contrast", "hdr.contrast_pivot", "hdr.shadow_lift"],
  "hdr-equalizer": ["hdr.tone_equalizer_enabled", "hdr.tone_equalizer_nodes", "hdr.tone_equalizer_influence_radius", "hdr.tone_equalizer_smoothing"],
  "hdr-color": ["hdr.white_balance_kelvin", "hdr.tint", "hdr.saturation", "hdr.vibrance", "hdr.red_hue", "hdr.red_purity", "hdr.green_hue", "hdr.green_purity", "hdr.blue_hue", "hdr.blue_purity", "hdr.tint_hue", "hdr.tint_purity"],
  "hdr-zones": ["hdr.lift", "hdr.lift_range", "hdr.lift_pivot", "hdr.gamma", "hdr.gamma_range", "hdr.gamma_pivot", "hdr.gain", "hdr.gain_range", "hdr.gain_pivot"],
  "sdr-base": ["sdr.tone_mapper", "sdr.tone_contrast", "sdr.tone_skew"],
  "sdr-tone": ["sdr.exposure", "sdr.highlight_recovery", "sdr.contrast", "sdr.contrast_pivot", "sdr.shadow"],
  "sdr-color": ["sdr.match_hdr_color", "sdr.white_balance_kelvin", "sdr.tint", "sdr.saturation", "sdr.vibrance", "sdr.red_hue", "sdr.red_purity", "sdr.green_hue", "sdr.green_purity", "sdr.blue_hue", "sdr.blue_purity", "sdr.tint_hue", "sdr.tint_purity"],
  "sdr-zones": ["sdr.lift", "sdr.lift_range", "sdr.lift_pivot", "sdr.gamma", "sdr.gamma_range", "sdr.gamma_pivot", "sdr.gain", "sdr.gain_range", "sdr.gain_pivot"],
};

const sectionPathForGroup = {
  "hdr-tone": "hdr.tone_section_enabled",
  "hdr-equalizer": "hdr.tone_equalizer_section_enabled",
  "hdr-color": "hdr.color_section_enabled",
  "hdr-zones": "hdr.primaries_section_enabled",
  "sdr-base": "sdr.base_section_enabled",
  "sdr-tone": "sdr.tone_section_enabled",
  "sdr-color": "sdr.color_section_enabled",
  "sdr-zones": "sdr.primaries_section_enabled",
};

const branchCopy = {
  hdr: "Graded HDR rendition. Exported as the PQ HDR image.",
  sdr: "Independent fallback baked into the gain map. This is what viewers without HDR gain-map support will see.",
};

const capabilityForFormat = {
  avif_gain_map: "avif_gain_map_encoder",
  jpeg_ultrahdr: "ultrahdr_encoder",
  sdr_png: "pillow",
};

boot();

async function boot() {
  initializeInstrumentShell();
  activateWorkflowTab("grade", { focus: false });
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
  renderControlState();
  renderCapabilities();
  renderExportPreflight();
  window.addEventListener("resize", syncOverlayPlacement);
  observeScopeSize();
  observeViewerSize();
}

async function initializeGpuPreview() {
  if (!window.HDRWebGPUPreview) return;
  state.gpuPreview = new window.HDRWebGPUPreview(els.previewCanvas);
  await state.gpuPreview.initialize();
  state.displayInfo.gpu = state.gpuPreview.detail;
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
  restoreLayoutState();
  enhanceRangeControls();
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
  window.addEventListener("resize", debounceLayoutBucketRestore);
}

function viewportBucket() {
  if (window.innerWidth >= 2100) return "2100+";
  if (window.innerWidth >= 1600) return "1600";
  return "1280";
}

function layoutStorageKey(bucket = viewportBucket()) {
  return `hdr-finisher-layout:${bucket}`;
}

function safeStoredLayout(bucket = viewportBucket()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(layoutStorageKey(bucket)) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function restoreLayoutState() {
  const bucket = viewportBucket();
  state.layoutBucket = bucket;
  const stored = safeStoredLayout(bucket) || {};
  state.layout = {
    railW: clamp(Number(stored.railW) || LAYOUT_DEFAULTS.railW, ...LAYOUT_LIMITS.railW),
    gradeW: clamp(Number(stored.gradeW) || LAYOUT_DEFAULTS.gradeW, ...LAYOUT_LIMITS.gradeW),
    dockH: clamp(Number(stored.dockH) || LAYOUT_DEFAULTS.dockH, ...LAYOUT_LIMITS.dockH),
    dockOpen: stored.dockOpen !== false,
    dockTab: ["histogram", "waveform", "parade", "technical"].includes(stored.dockTab) ? stored.dockTab : LAYOUT_DEFAULTS.dockTab,
  };
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
    state.scopeMode = state.activeDockTab === "waveform" || state.activeDockTab === "parade" ? "waveform" : "histogram";
    state.scopeChannelMode = state.activeDockTab === "parade" ? "parade" : "composite";
    els.scopeMode.value = state.scopeMode;
    els.scopeChannelMode.value = state.scopeChannelMode;
  }
  updateSplitterAria();
}

function persistLayoutState() {
  state.layout.dockOpen = !state.dockCollapsed;
  state.layout.dockTab = state.activeDockTab;
  try {
    localStorage.setItem(layoutStorageKey(state.layoutBucket), JSON.stringify(state.layout));
  } catch {
    // Layout persistence is a convenience; private browsing can reject storage.
  }
}

function debounceLayoutBucketRestore() {
  window.clearTimeout(debounceLayoutBucketRestore.timer);
  debounceLayoutBucketRestore.timer = window.setTimeout(() => {
    const nextBucket = viewportBucket();
    if (nextBucket === state.layoutBucket) return;
    persistLayoutState();
    restoreLayoutState();
    dispatchLayoutSettled();
  }, LAYOUT_SETTLE_DELAY);
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
    persistLayoutState();
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
  document.querySelectorAll('input[type="range"]').forEach((control) => {
    if (control.closest(".range-shell")) return;
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
  });
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
  els.importButton.addEventListener("click", () => els.fileInput.click());
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
  els.emptyImportButton.addEventListener("click", () => els.fileInput.click());
  els.sourceRailExpand.addEventListener("click", () => {
    const rail = els.sourceRailExpand.closest(".source-rail");
    const expanded = rail.classList.toggle("pinned-open");
    els.sourceRailExpand.setAttribute("aria-expanded", String(expanded));
    els.sourceRailExpand.textContent = expanded ? "Close" : "Source";
    if (!expanded) els.sourceRailExpand.blur();
  });
  els.sourceSettingsToggle.addEventListener("click", () => {
    state.sourceSettingsOpen = !state.sourceSettingsOpen;
    renderSourceSettingsVisibility();
  });
  els.metadataToggle.addEventListener("click", () => {
    state.metadataOpen = !state.metadataOpen;
    renderMetadataVisibility();
  });
  els.attentionFix.addEventListener("click", openManualInterpretation);
  els.acceptInterpretation.addEventListener("click", () => {
    state.interpretationGateDismissed = true;
    els.overrideWarning.classList.add("hidden");
    els.sourceConfidence.textContent = "Assumption accepted";
    els.interpretationSummary.textContent = "Auto assumption";
    renderInterpretationGate();
    renderExportPreflight();
  });
  els.manualInterpretation.addEventListener("click", openManualInterpretation);
  els.interpretationMode.addEventListener("change", () => {
    renderSourceSettingsControls();
  });
  els.scopeMode.addEventListener("change", async () => {
    state.scopeMode = els.scopeMode.value;
    await refreshScopes();
  });
  els.scopeChannelMode.addEventListener("change", async () => {
    state.scopeChannelMode = els.scopeChannelMode.value;
    await refreshScopes();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("drag-active");
    });
  });
  ["dragleave", "dragend"].forEach((eventName) => {
    els.dropzone.addEventListener(eventName, () => {
      els.dropzone.classList.remove("drag-active");
    });
  });
  els.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("drag-active");
    const [file] = event.dataTransfer?.files || [];
    if (file) await uploadFile(file);
  });
  [els.previewImage, els.previewOverlay].forEach((image) => {
    image.addEventListener("dragstart", (event) => event.preventDefault());
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      await switchLane(button.dataset.kind);
    });
  });

  els.controls.forEach((control) => {
    control.addEventListener("input", () => {
      const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
      setValueByPath(state.adjustments, control.dataset.path, value);
      const path = control.dataset.path;
      if (path === "shared.overlay_preset") renderOverlayPresetNote();
      if (path.startsWith("hdr.tone_equalizer_")) drawToneEqualizerEditor();
      updateControlReadouts();
      renderControlState();
      if (path.startsWith("shared.overlay_")) {
        debounceOverlayAndScopes();
      } else {
        const lane = path.startsWith("sdr.") ? "sdr" : "hdr";
        invalidatePreview(lane);
        if (lane === "hdr" && state.adjustments.sdr?.match_hdr_color && controlGroups["hdr-color"].includes(path)) {
          invalidatePreview("sdr");
        }
        debouncePreview(lane);
      }
    });
  });
  bindRangeResetControls();

  els.curvesEnabled.addEventListener("input", () => {
    setValueByPath(state.adjustments, curveEnabledPath(), els.curvesEnabled.checked);
    drawCurveEditor();
    renderReadouts();
    invalidatePreview(state.currentView);
    renderControlState();
    debouncePreview(state.currentView);
  });

  els.curveChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCurveChannel = button.dataset.curveChannel;
      renderCurveChannelTabs();
      drawCurveEditor();
    });
  });
  els.curveReset.addEventListener("click", () => {
    setValueByPath(state.adjustments, `${currentCurveLane()}.curves_section_enabled`, true);
    setValueByPath(state.adjustments, curveEnabledPath(), false);
    ["luma", "red", "green", "blue"].forEach((channel) => {
      setCurveValues(channel, defaultCurvePoints());
    });
    state.selectedCurvePoint = 2;
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
  els.applyInterpretationButton.addEventListener("click", applyInterpretationOverride);
  els.resetInterpretationButton.addEventListener("click", resetInterpretationToAuto);
  els.ejectButton.addEventListener("click", ejectCurrentSession);
  els.copyExportPath.addEventListener("click", copyLastExportPath);

  els.groupToggles.forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest(".control-group");
      const collapsed = group.classList.toggle("collapsed");
      button.setAttribute("aria-expanded", String(!collapsed));
    });
  });
  els.groupResets.forEach((button) => {
    button.addEventListener("click", () => resetControlGroup(button.dataset.resetGroup));
  });
  els.sectionBypasses.forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.sectionPath === "current.curves_section_enabled"
        ? `${state.currentView}.curves_section_enabled`
        : button.dataset.sectionPath;
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

  bindCompareControl();
  bindKeyboardShortcuts();
  els.dropzone.addEventListener("mousemove", updateProbeReadout);
  els.dropzone.addEventListener("mouseleave", () => {
    els.probeReadout.textContent = "Move over the image for pixel coordinates";
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
  document.querySelectorAll('input[type="range"]:not([data-no-double-reset])').forEach((control) => {
    control.addEventListener("dblclick", (event) => {
      event.preventDefault();
      control.value = control.defaultValue;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  els.badge.textContent = "Loading image and building session...";
  setPreviewMessage("Preparing session...");
  try {
    const response = await fetch("/api/session", { method: "POST", body: formData });
    const payload = await safeJson(response);
    if (!response.ok || !payload?.session) {
      const detail = payload?.detail || `Upload failed with HTTP ${response.status}.`;
      showUploadError(detail);
      return;
    }
    state.session = payload.session;
    state.adjustments = payload.session.adjustments;
    state.currentView = "hdr";
    activateWorkflowTab("grade", { focus: false });
    state.adjustments.shared.active_focus = "hdr";
    state.interpretationGateDismissed = false;
    clearPreviewCache();
    state.gpuPreview?.resetSession(payload.session.session_id);
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    renderSession();
    seedExportFieldsFromSession();
    await renderGpuDraft("hdr");
    await Promise.all([refreshPreview(), refreshOverlay(), refreshScopes(state.session.preview?.long_edge || 1600)]);
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
  state.currentView = "hdr";
  activateWorkflowTab("grade", { focus: false });
  state.adjustments.shared.active_focus = "hdr";
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
  els.sessionName.textContent = "No active image";
  els.fileSummary.textContent = "Import one HDR-capable source to begin";
  els.sourceConfidence.textContent = "Waiting";
  els.metadataList.innerHTML = "";
  els.overrideWarning.classList.add("hidden");
  els.sourceSettingsPanel.classList.add("hidden");
  els.interpretationMode.value = "auto";
  els.interpretationColorSpace.value = "auto";
  els.interpretationTransfer.value = "auto";
  state.sourceSettingsOpen = false;
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
  state.selectedCurvePoint = 2;
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
  els.sessionName.textContent = session.source.filename;
  clearPreviewOverlay();
  setPreviewMessage(`Rendering ${state.currentView.toUpperCase()} preview...`);
  els.badge.textContent = session.analysis.badge_message;
  els.badge.className = badgeClass(session.analysis.classification);
  els.overrideWarning.classList.toggle("hidden", !session.analysis.needs_color_override);
  els.overrideMessage.textContent = overrideMessage(session);
  els.interpretationSummary.textContent = interpretationSummary(session);
  els.sourceConfidence.textContent = session.source.color_space_confident ? "Confirmed" : "Review";
  els.fileSummary.textContent = `${session.source.suffix.toUpperCase()} · ${session.source.width} × ${session.source.height} · ${session.source.working_space}`;
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
  const enabled = getValueByPath(state.adjustments, curveEnabledPath()) ? "enabled" : "disabled";
  els.curveStatus.textContent = `${lane} curves are ${enabled}. Curve edits affect only the ${lane} preview/export branch.`;
}

function renderOverlayPresetNote() {
  const preset = state.adjustments.shared.overlay_preset || "web_1000_100";
  els.overlayPresetNote.textContent = overlayPresetNotes[preset] || overlayPresetNotes.web_1000_100;
  const mode = state.adjustments.shared.overlay_mode || "off";
  const label = mode === "false_color" ? "False color" : mode === "zebra" ? "Zebra" : "Off";
  els.overlayToggle.textContent = `Overlays: ${label}`;
  els.falseColorLegend.classList.toggle("hidden", mode !== "false_color" || !state.session);
}

function previewOutputEntries() {
  return [
    ["View", state.currentView.toUpperCase()],
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
      ["Stage", "Chrome Proof"],
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
    }
  });
}

function debouncePreview(lane = state.currentView) {
  if (lane === state.currentView) queueGpuDraft(lane);
  window.clearTimeout(state.refreshTimer);
  window.clearTimeout(state.settleTimer);
  const gpuDraftActive = Boolean(state.gpuPreview?.available && lane === state.currentView);
  state.refreshTimer = window.setTimeout(async () => {
    if (lane === state.currentView) {
      if (gpuDraftActive) await refreshScopes(960);
      else await Promise.all([renderPreviewForLane(lane, true, 960), refreshScopes(960)]);
    } else {
      await renderPreviewForLane(lane, false, 960);
    }
  }, 90);
  state.settleTimer = window.setTimeout(() => settlePreview(lane), gpuDraftActive ? 240 : 320);
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

async function settlePreview(lane = state.currentView) {
  if (!state.session) return;
  const display = lane === state.currentView;
  const longEdge = state.session.preview?.long_edge || 1600;
  if (display) {
    await Promise.all([
      renderPreviewForLane(lane, true, longEdge),
      refreshOverlay(longEdge),
      refreshScopes(longEdge),
    ]);
    prepareInactivePreview();
  } else {
    await renderPreviewForLane(lane, false, longEdge);
  }
  window.HDRProofing?.settled(lane);
}

function debounceOverlayAndScopes() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(async () => {
    renderOverlayPresetNote();
    await refreshOverlay();
    await refreshScopes();
  }, 120);
}

async function refreshPreview() {
  return renderPreviewForLane(state.currentView, true, state.session?.preview?.long_edge || 1600);
}

async function renderPreviewForLane(lane, displayWhenReady, longEdge = 1600) {
  if (!state.session) return false;
  const cached = state.previewCache[lane];
  const generation = state.previewGeneration[lane];
  if (cached?.generation === generation && (cached.longEdge || 0) >= longEdge) {
    if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) showCachedPreview(lane);
    renderCompareStatus();
    return true;
  }

  state.previewControllers[lane]?.abort();
  const controller = new AbortController();
  state.previewControllers[lane] = controller;
  if (displayWhenReady) setPreviewMessage(`Rendering ${lane.toUpperCase()} preview...`);

  const response = await fetch(`/api/session/${state.session.session_id}/preview/${lane}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adjustments: state.adjustments,
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
    if (displayWhenReady) setPreviewMessage("A newer adjustment replaced this render.");
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

  const previewInfo = previewInfoFromResponse(response, lane);
  const blob = await response.blob();
  if (generation !== state.previewGeneration[lane]) return false;
  const url = URL.createObjectURL(blob);
  const previous = state.previewCache[lane];
  if (previous?.url) URL.revokeObjectURL(previous.url);
  state.previewCache[lane] = { url, generation, longEdge };
  if (displayWhenReady && state.currentView === lane && !state.comparePeekActive) {
    const keptGpuSurface = shouldKeepHdrGpuSurface(lane)
      && await renderGpuDraft(lane)
      && state.gpuSurfaceHdr;
    if (!keptGpuSurface) {
      state.previewInfoByLane[lane] = previewInfo;
      await applyPreviewUrl(url);
      state.previewInfo = previewInfo;
      els.scopeKindLabel.textContent = lane.toUpperCase();
      renderReadouts();
    }
  } else {
    state.previewInfoByLane[lane] = previewInfo;
  }
  renderCompareStatus();
  return true;
}

async function refreshOverlay(longEdge = state.session?.preview?.long_edge || 1600) {
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
    body: JSON.stringify({ adjustments: state.adjustments, long_edge: longEdge }),
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

async function refreshScopes(longEdge = 960) {
  if (!state.session) return;
  if (state.scopeAbortController) state.scopeAbortController.abort();
  const controller = new AbortController();
  state.scopeAbortController = controller;
  const lane = state.currentView;
  const mode = state.scopeMode;
  const resolution = mode === "waveform" ? waveformRequestResolution() : null;
  const resolutionQuery = resolution ? `&bins=${resolution.bins}&columns=${resolution.columns}` : "";
  const response = await fetch(`/api/session/${state.session.session_id}/scopes?kind=${lane}&mode=${mode}&long_edge=${longEdge}${resolutionQuery}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustments: state.adjustments, long_edge: longEdge }),
    signal: controller.signal,
  }).catch((error) => {
    if (error.name === "AbortError") return null;
    console.error(error);
    return null;
  });
  if (!response || controller !== state.scopeAbortController) return;
  if (!response.ok) return;
  const payload = await response.json();
  if (controller !== state.scopeAbortController || lane !== state.currentView || mode !== state.scopeMode) return;
  state.lastScope = payload;
  drawHistogram(payload);
  renderDockSummary();
  renderExportPreflight();
}

function waveformRequestResolution() {
  const width = Math.max(1, els.histogram.clientWidth);
  const height = Math.max(1, els.histogram.clientHeight);
  return {
    columns: Math.round(clamp(width / 2, 256, 768)),
    bins: Math.round(clamp(height * 1.5, 128, 384)),
  };
}

function drawHistogram(scope) {
  const canvas = els.histogram;
  const surface = resizeScopeCanvas(canvas);
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
  els.scopeNote.textContent = scope.preview_kind === "hdr"
    ? scope.scope_type.includes("waveform")
      ? "HDR waveform plots horizontal image position against reference nits. Reference nits use the app's internal model: 0.18 scene-linear equals 100 nits."
      : "HDR histogram plots reference luminance from left to right on a logarithmic nit scale. Density is log-scaled to retain fine tonal detail."
    : scope.scope_type.includes("waveform")
      ? "SDR waveform plots horizontal image position against normalized tone-mapped output."
      : "SDR histogram plots display-safe values from black to white. Density is log-scaled so small tonal populations remain visible.";
  renderKeyValueList(els.scopeStats, (scope.stats || []).map((item) => [item.label, item.value]));

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

function resizeScopeCanvas(canvas) {
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
  if (scope.preview_kind === "hdr") return new Set([1, 10, 100, 203, 1000, 4000]);
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
  };
  return labels[Number(guide.value)] || guide.label;
}

function guidePosition(scope, value) {
  if (scope.preview_kind === "hdr") {
    const min = Math.log10(1);
    const max = Math.log10(4000);
    return (Math.log10(Math.max(value, 1)) - min) / (max - min);
  }
  return Math.min(1, Math.max(0, value));
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
  const surface = document.createElement("canvas");
  surface.width = columnCount;
  surface.height = rowCount;
  const surfaceContext = surface.getContext("2d");
  const pixels = surfaceContext.createImageData(columnCount, rowCount);
  grid.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
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
  return surface;
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
  if (!previewIsVisible() || els.previewOverlay.style.display === "none") return;
  const stageRect = els.previewStage.getBoundingClientRect();
  const imageRect = preview.getBoundingClientRect();
  if (!imageRect.width || !imageRect.height) return;
  els.previewOverlay.style.left = `${imageRect.left - stageRect.left + imageRect.width / 2}px`;
  els.previewOverlay.style.top = `${imageRect.top - stageRect.top + imageRect.height / 2}px`;
  els.previewOverlay.style.width = `${imageRect.width}px`;
  els.previewOverlay.style.height = `${imageRect.height}px`;
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
  const outputPath = buildExportOutputPath();
  els.exportConfirmButton.disabled = true;
  els.exportStatus.textContent = "Encoding and validating the finished file…";
  els.exportResult.classList.add("hidden");
  try {
    let response = await requestSessionExport(outputPath, false);
    let payload = await safeJson(response);
    if (response.status === 409 && payload?.detail?.code === "overwrite_required") {
      const detail = payload.detail;
      const approved = window.confirm(`${detail.message}\n\n${detail.output_path}\n\nThis cannot be undone.`);
      if (!approved) {
        els.exportStatus.textContent = "Export cancelled; the existing file was left unchanged.";
        return;
      }
      els.exportStatus.textContent = "Replacing the existing file and validating the result...";
      response = await requestSessionExport(outputPath, true);
      payload = await safeJson(response);
    }
    if (!response.ok) {
      els.exportStatus.textContent = typeof payload?.detail === "string" ? payload.detail : payload?.message || "Export failed.";
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
    els.exportConfirmButton.disabled = false;
  }
}

async function chooseExportDirectory() {
  els.exportDirectoryBrowse.disabled = true;
  els.exportStatus.textContent = "Opening folder picker...";
  try {
    const response = await fetch("/api/export-directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initial_directory: els.exportDirectory.value || null }),
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      els.exportStatus.textContent = payload?.detail || "Folder picker failed.";
      return;
    }
    if (payload?.directory) {
      els.exportDirectory.value = payload.directory;
      els.exportStatus.textContent = `Save folder set to ${payload.directory}`;
      return;
    }
    els.exportStatus.textContent = "Folder selection cancelled.";
  } catch (error) {
    console.error(error);
    els.exportStatus.textContent = "Folder picker could not reach the local HDR Finisher server.";
  } finally {
    els.exportDirectoryBrowse.disabled = false;
  }
}

async function applyInterpretationOverride() {
  if (!state.session) return;
  const override = interpretationPayload();
  els.badge.textContent = "Re-interpreting source file...";
  setPreviewMessage("Rebuilding preview with the new interpretation...");
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
    state.adjustments = payload.session.adjustments;
    state.interpretationGateDismissed = false;
    invalidatePreview("hdr");
    invalidatePreview("sdr");
    state.gpuPreview?.resetSession(payload.session.session_id);
    renderSession();
    await renderGpuDraft(state.currentView);
    await Promise.all([refreshPreview(), refreshOverlay(), refreshScopes(state.session.preview?.long_edge || 1600)]);
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
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}

function getValueByPath(target, path) {
  return path.split(".").reduce((cursor, key) => cursor?.[key], target);
}

function syncControlsFromState() {
  els.controls.forEach((control) => {
    const value = getValueByPath(state.adjustments, control.dataset.path);
    if (value === undefined) return;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else {
      control.value = String(value);
      if (control.type === "range") updateRangeVisual(control);
    }
  });
  updateControlReadouts();
  syncToneEqualizerControls();
}

function syncCurveControlsFromState() {
  els.curvesEnabled.checked = Boolean(getValueByPath(state.adjustments, curveEnabledPath()));
  els.curveRemove.disabled = currentCurveValues().length <= 2 || isLockedCurveEndpoint(state.selectedCurvePoint);
}

function renderSessionChrome() {
  const hasSession = Boolean(state.session);
  els.ejectButton.disabled = !hasSession;
  els.workflowTabs.forEach((button) => {
    button.disabled = button.dataset.workflowTab !== "grade" && !hasSession;
  });
  els.emptyImportButton.disabled = hasSession;
  document.querySelectorAll(".grade-rail input, .grade-rail select, .grade-rail button").forEach((control) => {
    control.disabled = !hasSession;
  });
  els.viewButtons.forEach((button) => {
    button.disabled = !hasSession;
  });
  els.toneEqualizerEditor.setAttribute("aria-disabled", String(!hasSession));
  els.toneEqualizerEditor.tabIndex = hasSession ? 0 : -1;
  [els.zoomOut, els.zoomIn, els.zoomSlider, els.zoomReadout, els.zoomFit, els.zoomActual].forEach((control) => {
    control.disabled = !hasSession;
  });
  window.HDRProofing?.render();
}

function renderCurveChannelTabs() {
  els.curveChannelButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.curveChannel === state.selectedCurveChannel);
  });
}

function bindToneEqualizerEditor() {
  const canvas = els.toneEqualizerEditor;
  const beginDrag = (clientX, clientY) => {
    if (!state.session) return;
    const rect = canvas.getBoundingClientRect();
    state.activeToneEqualizerBand = nearestToneEqualizerBandIndex(clientX, rect);
    state.selectedToneEqualizerBand = state.activeToneEqualizerBand;
    const startingNodes = currentToneEqualizerNodes();
    updateToneEqualizerFromPointer(clientX, clientY, rect, startingNodes);
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
      debouncePreview("hdr");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    beginDrag(event.clientX, event.clientY);
  });
  canvas.addEventListener("dblclick", (event) => {
    event.preventDefault();
    addToneEqualizerNode(toneEqualizerEvFromPointer(event.clientX, canvas.getBoundingClientRect()));
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
    debouncePreview("hdr");
  });

  els.toneEqualizerBandValue.addEventListener("input", () => {
    if (!state.session) return;
    setToneEqualizerBand(state.selectedToneEqualizerBand, Number(els.toneEqualizerBandValue.value));
  });
  els.toneEqualizerBandValue.addEventListener("change", () => {
    renderControlState();
    debouncePreview("hdr");
  });
  els.toneEqualizerAdd.addEventListener("click", () => addToneEqualizerNode());
  els.toneEqualizerRemove.addEventListener("click", removeToneEqualizerNode);
  els.toneEqualizerRadiusDown.addEventListener("click", () => changeToneEqualizerRadius(-0.25));
  els.toneEqualizerRadiusUp.addEventListener("click", () => changeToneEqualizerRadius(0.25));
}

function updateToneEqualizerFromPointer(clientX, clientY, rect, startingNodes) {
  const paddingTop = 16 / els.toneEqualizerEditor.height;
  const paddingBottom = 28 / els.toneEqualizerEditor.height;
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
  state.adjustments.hdr.tone_equalizer_enabled = true;
  syncControlsFromState();
  drawToneEqualizerEditor();
  invalidatePreview("hdr");
  queueGpuDraft("hdr");
}

function nearestToneEqualizerBandIndex(clientX, rect) {
  const inputEv = toneEqualizerEvFromPointer(clientX, rect);
  const nodes = currentToneEqualizerNodes();
  return nodes.reduce((best, node, index) => (
    Math.abs(node.input_ev - inputEv) < Math.abs(nodes[best].input_ev - inputEv) ? index : best
  ), 0);
}

function setToneEqualizerBand(index, requestedValue) {
  const nodes = currentToneEqualizerNodes();
  const [minimum, maximum] = toneEqualizerBandLimits(index, nodes);
  const rounded = Math.round(clamp(Number(requestedValue) || 0, minimum, maximum) * 100) / 100;
  nodes[index].adjustment_ev = clamp(rounded, Math.ceil(minimum * 100) / 100, Math.floor(maximum * 100) / 100);
  state.adjustments.hdr.tone_equalizer_nodes = normalizeToneEqualizerNodes(nodes);
  state.adjustments.hdr.tone_equalizer_enabled = true;
  state.selectedToneEqualizerBand = index;
  syncControlsFromState();
  drawToneEqualizerEditor();
  invalidatePreview("hdr");
  queueGpuDraft("hdr");
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
  els.toneEqualizerBandLabel.textContent = `${formatSignedEv(inputEv, 0)} · ${formatToneBandNits(100 * (2 ** inputEv))}`;
  els.toneEqualizerBandOutput.textContent = formatSignedEv(value, 2);
  els.toneEqualizerRadius.textContent = `Influence ${Number(state.adjustments.hdr.tone_equalizer_influence_radius || 1.5).toFixed(2)} EV`;
  els.toneEqualizerRemove.disabled = nodes.length <= TONE_EQUALIZER_MIN_NODE_COUNT || index === 0 || index === nodes.length - 1;
  els.toneEqualizerAdd.disabled = nodes.length >= TONE_EQUALIZER_MAX_NODE_COUNT;
}

function drawToneEqualizerEditor() {
  const canvas = els.toneEqualizerEditor;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const left = 26;
  const right = 14;
  const top = 16;
  const bottom = 28;
  const graphWidth = width - left - right;
  const graphHeight = height - top - bottom;
  const nodes = currentToneEqualizerNodes();
  const smoothing = clamp(Number(state.adjustments.hdr?.tone_equalizer_smoothing ?? 0.5), 0, 1);
  const enabled = Boolean(state.adjustments.hdr?.tone_equalizer_enabled);
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
    ctx.strokeStyle = adjustment === 0 ? "rgba(236,233,223,0.26)" : "rgba(255,255,255,0.08)";
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
    ctx.strokeStyle = inputEv === 0 ? "rgba(110,159,181,0.32)" : "rgba(255,255,255,0.06)";
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
  ctx.strokeStyle = "rgba(217,182,114,0.65)";
  ctx.beginPath();
  ctx.moveTo(pqX, top);
  ctx.lineTo(pqX, height - bottom);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = uiToken("--attention");
  ctx.textAlign = "right";
  ctx.fillText("10K", pqX, 3);

  ctx.strokeStyle = enabled ? uiToken("--text") : uiToken("--quiet");
  ctx.lineWidth = 2.25;
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
    ctx.fillStyle = "rgba(239,187,85,0.09)";
    ctx.fillRect(start, top, end - start, graphHeight);
  }
  nodes.forEach((node, index) => {
    const inputEv = node.input_ev;
    const selected = index === state.selectedToneEqualizerBand;
    ctx.fillStyle = selected ? uiToken("--equalizer-selected") : enabled ? uiToken("--curve-neutral") : uiToken("--quiet");
    ctx.beginPath();
    ctx.arc(xForEv(inputEv), yForAdjustment(node.adjustment_ev), selected ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fill();
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
  const paddingLeft = 26 / els.toneEqualizerEditor.width;
  const paddingRight = 14 / els.toneEqualizerEditor.width;
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
  state.adjustments.hdr.tone_equalizer_enabled = true;
  drawToneEqualizerEditor();
  renderControlState();
  invalidatePreview("hdr");
  debouncePreview("hdr");
}

function removeToneEqualizerNode() {
  const nodes = currentToneEqualizerNodes();
  const index = state.selectedToneEqualizerBand;
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
  const beginDrag = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    state.activeCurvePoint = nearestCurvePointIndex(clientX, clientY, rect);
    state.selectedCurvePoint = state.activeCurvePoint;
    updateCurveFromPointer(clientX, clientY);
    const move = (event) => {
      event.preventDefault();
      updateCurveFromPointer(event.clientX, event.clientY);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      state.activeCurvePoint = null;
      syncCurveControlsFromState();
      invalidatePreview(state.currentView);
      renderControlState();
      debouncePreview(state.currentView);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  canvas.addEventListener("pointerdown", (event) => {
    beginDrag(event.clientX, event.clientY);
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
      if (event.key === "ArrowLeft" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] - step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowRight" && !isLockedCurveEndpoint(index)) {
        point[0] = clamp(point[0] + step, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
      }
      if (event.key === "ArrowUp") point[1] = clamp(point[1] + step, 0, 1);
      if (event.key === "ArrowDown") point[1] = clamp(point[1] - step, 0, 1);
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

function updateCurveFromPointer(clientX, clientY) {
  const rect = els.curveEditor.getBoundingClientRect();
  const index = state.activeCurvePoint ?? nearestCurvePointIndex(clientX, clientY, rect);
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  const point = [...curve[index]];
  if (index === 0) point[0] = 0;
  else if (index === curve.length - 1) point[0] = 1;
  else point[0] = clamp(normalizedX, curve[index - 1][0] + 0.02, curve[index + 1][0] - 0.02);
  point[1] = clamp(normalizedY, 0, 1);
  curve[index] = point;
  state.selectedCurvePoint = index;
  setCurveValues(state.selectedCurveChannel, curve);
  drawCurveEditor();
  invalidatePreview(state.currentView);
  queueGpuDraft(state.currentView);
}

function drawCurveEditor() {
  const canvas = els.curveEditor;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 18;
  const curve = currentCurveValues();
  const curveSamples = sampleCurvePoints(curve, 96);
  const channelColor = curveColor(state.selectedCurveChannel);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = uiToken("--app");
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const x = padding + ((width - padding * 2) * step) / 4;
    const y = padding + ((height - padding * 2) * step) / 4;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  if (currentCurveLane() === "hdr") {
    const guides = [
      [100, 0.5, "100"],
      ...[200, 400, 800, 1600, 3200, 6400].map((nits) => [nits, 0.5 + 0.5 * Math.log10(nits / 100) / 2, `${nits}`]),
      [10000, 1, "10K"],
    ];
    ctx.save();
    ctx.font = '9px "IBM Plex Mono", "Cascadia Mono", Consolas';
    ctx.textBaseline = "bottom";
    guides.forEach(([nits, normalized, label]) => {
      const x = padding + normalized * (width - padding * 2);
      ctx.strokeStyle = nits === 100 ? "rgba(151,224,236,0.36)" : "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(x, padding);
      ctx.lineTo(x, height - padding);
      ctx.stroke();
      if (nits === 100 || nits === 400 || nits === 1600 || nits === 6400 || nits === 10000) {
        ctx.fillStyle = "rgba(224,232,235,0.58)";
        ctx.textAlign = normalized >= 0.98 ? "right" : "center";
        ctx.fillText(label, x, height - 2);
      }
    });
    ctx.restore();
  }

  ctx.strokeStyle = "rgba(236,233,223,0.18)";
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, padding);
  ctx.stroke();

  ctx.strokeStyle = channelColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  curveSamples.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  curve.forEach(([xValue, yValue], index) => {
    const x = padding + xValue * (width - padding * 2);
    const y = height - padding - yValue * (height - padding * 2);
    ctx.fillStyle = index === state.selectedCurvePoint
      ? uiToken("--curve-selected")
      : index === 0 || index === curve.length - 1
        ? uiToken("--curve-endpoint")
        : uiToken("--curve-neutral");
    ctx.beginPath();
    ctx.arc(x, y, index === state.selectedCurvePoint ? 6 : index === 0 || index === curve.length - 1 ? 4 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
  syncCurveControlsFromState();
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

function curveEnabledPath() {
  return `${currentCurveLane()}.curves_enabled`;
}

function currentCurveLane() {
  return state.currentView === "sdr" ? "sdr" : "hdr";
}

function nearestCurvePointIndex(clientX, clientY, rect) {
  const normalizedX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const normalizedY = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
  const curve = currentCurveValues();
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  curve.forEach(([x, y], index) => {
    const distance = ((x - normalizedX) ** 2) + ((y - normalizedY) ** 2);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function addCurvePoint() {
  const curve = currentCurveValues();
  if (curve.length >= 16) return;
  let insertIndex = 1;
  let widestGap = -1;
  for (let index = 0; index < curve.length - 1; index += 1) {
    const gap = curve[index + 1][0] - curve[index][0];
    if (gap > widestGap) {
      widestGap = gap;
      insertIndex = index + 1;
    }
  }
  const x = curve[insertIndex - 1][0] + widestGap / 2;
  const [[, y]] = sampleCurvePoints(curve, 1, x);
  curve.splice(insertIndex, 0, [x, y]);
  state.selectedCurvePoint = insertIndex;
  setCurveValues(state.selectedCurveChannel, curve);
}

function removeCurvePoint() {
  const curve = currentCurveValues();
  const index = state.selectedCurvePoint ?? Math.floor(curve.length / 2);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function defaultCurvePoints() {
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

  els.previewCanvas.style.display = "none";
  els.previewImage.style.display = "block";
  els.emptyState.style.display = "none";
  setZoomMode(state.zoomMode);
  syncOverlayPlacement();
  updateZoomReadout();
  hidePreviewMessage();
}

async function renderGpuDraft(lane = state.currentView) {
  if (!state.session || lane !== state.currentView || !state.gpuPreview?.available) return false;
  if (state.adjustments.shared.overlay_mode !== "off" || state.comparePeekActive) return false;
  const serial = ++state.gpuRenderSerial;
  try {
    const result = await state.gpuPreview.render(
      state.session.session_id,
      lane,
      state.adjustments,
      sampleCurvePoints,
      state.session.preview?.long_edge || 1600,
    );
    if (!result || serial !== state.gpuRenderSerial || lane !== state.currentView) return false;
    state.gpuSurfaceHdr = Boolean(result.hdr);
    els.previewImage.style.display = "none";
    els.previewCanvas.style.display = "block";
    els.emptyState.style.display = "none";
    state.previewInfo = {
      mediaType: "WebGPU canvas",
      transport: "GPU texture",
      colorSpace: result.hdr ? "Display P3 extended" : "sRGB",
      transfer: "linear canvas",
      bitDepth: result.hdr ? "16-bit float" : "display native",
      notes: "Interactive GPU draft; settled preview remains export-authoritative",
    };
    state.previewInfoByLane[lane] = state.previewInfo;
    setZoomMode(state.zoomMode);
    renderReadouts();
    hidePreviewMessage();
    return true;
  } catch (error) {
    console.warn("WebGPU draft render failed; using backend preview.", error);
    state.gpuPreview.available = false;
    state.gpuSurfaceHdr = false;
    state.gpuPreview.detail = error?.message || "WebGPU draft failed";
    state.displayInfo.gpu = state.gpuPreview.detail;
    renderReadouts();
    return false;
  }
}

function requestSessionExport(outputPath, overwrite) {
  return fetch(`/api/session/${state.session.session_id}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: els.exportFormat.value,
      quality: Number(els.exportQuality.value),
      jpeg_gain_map_quality: Number(els.jpegGainMapQuality.value),
      jpeg_gain_map_scale: els.jpegGainMapScale.value,
      output_path: outputPath,
      overwrite,
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

function setPreviewMessage(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden", "error");
}

function setPreviewError(message) {
  els.previewStatus.textContent = message;
  els.previewStatus.classList.remove("hidden");
  els.previewStatus.classList.add("error");
}

function hidePreviewMessage() {
  els.previewStatus.textContent = "";
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
  els.sourceSettingsNote.textContent = session.analysis.needs_color_override
    ? "Auto detection found an ambiguous source interpretation. Manual override is recommended before trusting export decisions."
    : "Color Primaries controls gamut. Transfer Function controls encoding. Use Manual only when the file metadata is missing, wrong, or you know the render pipeline better than the file does.";
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
  if (state.currentView === lane && cacheReady(lane)) {
    renderLaneChrome();
    return;
  }
  state.currentView = lane;
  state.adjustments.shared.active_focus = lane;
  state.selectedCurvePoint = Math.min(state.selectedCurvePoint ?? 0, currentCurveValues().length - 1);
  renderLaneChrome();
  syncCurveControlsFromState();
  renderCurveChannelTabs();
  drawCurveEditor();
  renderReadouts();
  const previewTask = cacheReady(lane) ? showCachedPreview(lane) : refreshPreview();
  await Promise.all([previewTask, refreshOverlay(), refreshScopes(state.session.preview?.long_edge || 1600)]);
  prepareInactivePreview();
}

function renderLaneChrome() {
  const lane = state.currentView;
  const label = lane === "hdr" ? "HDR Grade" : "SDR Fallback";
  document.body.dataset.activeLane = lane;
  els.viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.kind === lane));
  els.lanePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.lanePanel !== lane));
  els.viewerLaneLabel.textContent = label;
  els.viewerBranchNote.textContent = branchCopy[lane];
  els.laneNote.textContent = branchCopy[lane];
  els.scopeKindLabel.textContent = lane.toUpperCase();
  state.previewInfo = state.previewInfoByLane[lane];
  window.HDRProofing?.syncLane();
  renderCompareStatus();
  updateControlReadouts();
  renderControlState();
}

function invalidatePreview(lane) {
  state.previewGeneration[lane] += 1;
  window.HDRProofing?.invalidate(lane);
  renderCompareStatus();
  renderExportPreflight();
}

function clearPreviewCache() {
  for (const lane of ["hdr", "sdr"]) {
    state.previewControllers[lane]?.abort();
    state.previewControllers[lane] = null;
    const cached = state.previewCache[lane];
    if (cached?.url) URL.revokeObjectURL(cached.url);
    state.previewCache[lane] = null;
    state.previewGeneration[lane] = 0;
  }
  state.comparePeekActive = false;
  state.gpuSurfaceHdr = false;
  clearPreviewImage();
  window.HDRProofing?.reset();
}

function cacheReady(lane) {
  const cached = state.previewCache[lane];
  return Boolean(cached?.url && cached.generation === state.previewGeneration[lane]);
}

async function showCachedPreview(lane) {
  const cached = state.previewCache[lane];
  if (!cached?.url) return;
  if (shouldKeepHdrGpuSurface(lane) && await renderGpuDraft(lane) && state.gpuSurfaceHdr) return;
  await applyPreviewUrl(cached.url);
  state.previewInfo = state.previewInfoByLane[lane];
  renderReadouts();
}

function prepareInactivePreview() {
  if (!state.session) return;
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (cacheReady(other)) {
    renderCompareStatus();
    return;
  }
  window.setTimeout(() => {
    renderPreviewForLane(other, false).catch(() => null);
  }, 80);
}

function renderCompareStatus() {
  if (!state.session) {
    els.compareStatus.textContent = "No comparison";
    els.compareButton.disabled = true;
    return;
  }
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  const ready = cacheReady(other);
  els.compareButton.disabled = !ready;
  els.compareStatus.textContent = ready ? `${other.toUpperCase()} ready` : `Preparing ${other.toUpperCase()}…`;
}

function bindCompareControl() {
  els.compareButton.addEventListener("click", async () => {
    const other = state.currentView === "hdr" ? "sdr" : "hdr";
    if (cacheReady(other)) await switchLane(other);
  });
}

function beginCompareHold() {
  if (!state.session || state.compareHoldTimer || state.comparePeekActive) return;
  state.compareHeld = true;
  state.compareHoldTimer = window.setTimeout(async () => {
    state.compareHoldTimer = null;
    if (!state.compareHeld) return;
    await peekOtherLane();
  }, 180);
}

async function endCompareHold() {
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
  const other = state.currentView === "hdr" ? "sdr" : "hdr";
  if (!cacheReady(other)) {
    els.compareStatus.textContent = `Preparing ${other.toUpperCase()}…`;
    return;
  }
  state.comparePeekActive = true;
  window.HDRProofing?.syncLane();
  clearPreviewOverlay();
  await showCachedPreview(other);
  els.viewerLaneLabel.textContent = `${other.toUpperCase()} peek · release V`;
}

async function restoreActiveLane() {
  state.comparePeekActive = false;
  window.HDRProofing?.syncLane();
  await showCachedPreview(state.currentView);
  renderLaneChrome();
  await refreshOverlay();
}

function bindKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "v") {
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
    } else if (key === "d") {
      event.preventDefault();
      els.fileInput.click();
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
  return lane === "hdr"
    && lane === state.currentView
    && Boolean(state.gpuPreview?.available)
    && mediaQueryMatch("(dynamic-range: high)")
    && state.adjustments.shared.overlay_mode === "off"
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

  const sourceWidth = Math.max(1, state.session.source.width || preview.naturalWidth || preview.width);
  const sourceHeight = Math.max(1, state.session.source.height || preview.naturalHeight || preview.height);
  const frameWidth = Math.max(1, els.dropzone.clientWidth);
  const frameHeight = Math.max(1, els.dropzone.clientHeight);
  const fitPercent = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight) * 100;
  const percent = state.zoomMode === "fit" ? fitPercent : state.zoomPercent;
  const displayWidth = Math.max(1, sourceWidth * percent / 100);
  const displayHeight = Math.max(1, sourceHeight * percent / 100);

  els.previewStage.style.width = `${Math.max(frameWidth, displayWidth)}px`;
  els.previewStage.style.height = `${Math.max(frameHeight, displayHeight)}px`;
  els.previewImage.style.width = `${displayWidth}px`;
  els.previewImage.style.height = `${displayHeight}px`;
  els.previewCanvas.style.width = `${displayWidth}px`;
  els.previewCanvas.style.height = `${displayHeight}px`;
  if (els.chromeProofImage) {
    els.chromeProofImage.style.width = `${displayWidth}px`;
    els.chromeProofImage.style.height = `${displayHeight}px`;
  }
  state.zoomPercent = percent;
  updateZoomReadout();
  syncOverlayPlacement();
}

function updateZoomReadout() {
  const percent = Math.max(0.01, state.zoomPercent || 100);
  if (document.activeElement !== els.zoomReadout) {
    els.zoomReadout.value = state.zoomMode === "fit" ? `Fit ${formatZoomPercent(percent)}` : formatZoomPercent(percent);
  }
  els.zoomSlider.value = String(zoomPercentToSlider(clamp(percent, MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT)));
  els.zoomSlider.setAttribute("aria-valuetext", state.zoomMode === "fit" ? `Fit, ${formatZoomPercent(percent)}` : formatZoomPercent(percent));
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

function closeOverlayPopover() {
  els.overlayPopover.classList.add("hidden");
  els.overlayToggle.setAttribute("aria-expanded", "false");
  els.overlayToggle.focus();
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
  persistLayoutState();
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
  persistLayoutState();
  scheduleLayoutSettled();
  if (technical) return;
  state.scopeMode = tab === "waveform" || tab === "parade" ? "waveform" : "histogram";
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
    const path = output.dataset.valuePath;
    const value = getValueByPath(state.adjustments, path);
    if (value === undefined) return;
    const text = formatControlValue(path, value);
    output.textContent = text;
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) control.setAttribute("aria-valuetext", text);
  });
}

function formatControlValue(path, value) {
  const numeric = Number(value);
  if (path.endsWith("white_balance_kelvin")) return `${Math.round(numeric)} K`;
  if (path.endsWith("_hue")) return `${numeric > 0 ? "+" : ""}${numeric.toFixed(1)}°`;
  if (path.endsWith("_purity") || path.endsWith(".saturation") || path.endsWith(".vibrance")) return `${numeric > 0 ? "+" : ""}${Math.round(path.endsWith("_purity") ? numeric : numeric * 100)}%`;
  if (path.endsWith(".exposure")) return `${numeric.toFixed(2)} EV`;
  if (path.endsWith("_nits")) return `${Math.round(numeric)} nit`;
  if (path.endsWith("_range") || (path.endsWith("_pivot") && !path.endsWith("contrast_pivot"))) return `${numeric.toFixed(2)} EV`;
  if (path === "shared.overlay_opacity") return `${Math.round(numeric * 100)}%`;
  if (path === "shared.overlay_threshold") return `${Math.round(numeric * 100)} nit`;
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
  const followsHdrColor = state.adjustments.sdr?.match_hdr_color !== false;
  document.querySelectorAll("[data-sdr-manual-color]").forEach((container) => {
    container.classList.toggle("linked-controls", followsHdrColor);
    container.querySelectorAll("input").forEach((input) => {
      input.disabled = followsHdrColor || !state.session;
    });
  });
  els.controlRows.forEach((row) => {
    row.classList.toggle("modified", isPathModified(row.dataset.controlPath, defaults));
  });
  for (const [group, paths] of Object.entries(controlGroups)) {
    const count = paths.filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector(`[data-modified-count="${group}"]`);
    if (output) output.textContent = count ? `${count} modified` : "Default";
    output?.closest(".control-group")?.classList.toggle("modified", count > 0);
  }
  if (followsHdrColor) {
    const linkedCount = controlGroups["hdr-color"].filter((path) => isPathModified(path, defaults)).length;
    const output = document.querySelector('[data-modified-count="sdr-color"]');
    if (output) output.textContent = linkedCount ? `Following HDR / ${linkedCount} linked` : "Following HDR";
    output?.closest(".control-group")?.classList.toggle("modified", linkedCount > 0);
  }
  for (const lane of ["hdr", "sdr"]) {
    const keys = Object.keys(defaults[lane]).filter((key) => !key.endsWith("_curve") && !key.endsWith("_section_enabled"));
    const modified = keys.some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]))
      || laneCurvesModified(lane, defaults);
    const button = els.viewButtons.find((item) => item.dataset.kind === lane);
    button?.classList.toggle("modified", modified);
  }
  const currentLaneDefaults = defaults[state.currentView];
  const modifiedCount = Object.keys(currentLaneDefaults)
    .filter((key) => !key.endsWith("_section_enabled"))
    .filter((key) => !valuesEqual(state.adjustments[state.currentView]?.[key], currentLaneDefaults[key])).length;
  els.gradeModifiedSummary.textContent = modifiedCount ? `${modifiedCount} modified` : "Default";
  els.curveGroupState.textContent = laneCurvesModified(state.currentView, defaults) ? "Modified" : "Default";
  els.sectionBypasses.forEach((button) => {
    const path = button.dataset.sectionPath === "current.curves_section_enabled"
      ? `${state.currentView}.curves_section_enabled`
      : button.dataset.sectionPath;
    const enabled = getValueByPath(state.adjustments, path) !== false;
    button.classList.toggle("bypassed", !enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.textContent = enabled ? "◉" : "○";
    button.closest(".control-group")?.classList.toggle("bypassed", !enabled);
  });
}

function isPathModified(path, defaults = defaultAdjustments()) {
  return !valuesEqual(getValueByPath(state.adjustments, path), getValueByPath(defaults, path));
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right);
  return left === right;
}

function laneCurvesModified(lane, defaults = defaultAdjustments()) {
  return ["curves_enabled", "luma_curve", "red_curve", "green_curve", "blue_curve"]
    .some((key) => !valuesEqual(state.adjustments[lane]?.[key], defaults[lane][key]));
}

function resetControlGroup(group) {
  const paths = controlGroups[group] || [];
  if (!paths.length) return;
  const defaults = defaultAdjustments();
  paths.forEach((path) => setValueByPath(state.adjustments, path, getValueByPath(defaults, path)));
  const sectionPath = sectionPathForGroup[group];
  if (sectionPath) setValueByPath(state.adjustments, sectionPath, true);
  syncControlsFromState();
  if (group === "hdr-equalizer") drawToneEqualizerEditor();
  invalidatePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
  renderControlState();
  debouncePreview(group.startsWith("sdr-") ? "sdr" : "hdr");
}

function activateWorkflowTab(workflow, { focus = false } = {}) {
  const next = ["grade", "proof", "export"].includes(workflow) ? workflow : "grade";
  if (next !== "grade" && !state.session) return;
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
    els.exportProofStatus.textContent = "Chrome HDR proof not applicable to SDR PNG";
    return;
  }
  const formatName = state.proofArtifact?.format === "avif_gain_map" ? "AVIF" : "JPEG Ultra HDR";
  const targetName = state.proofReconstruction?.target_label || "selected target";
  if (!state.proofArtifact || !state.proofReconstruction) {
    els.exportProofStatus.textContent = "Chrome proof has not been reviewed";
    row.classList.add("warn");
  } else if (state.proofDirty) {
    els.exportProofStatus.textContent = `Chrome proof is stale · ${formatName} · ${targetName}`;
    row.classList.add("warn");
  } else if (state.proofArtifact.format !== els.exportFormat.value) {
    const exportName = els.exportFormat.value === "avif_gain_map" ? "AVIF" : "JPEG Ultra HDR";
    els.exportProofStatus.textContent = `Proofed ${formatName}, not selected ${exportName}`;
    row.classList.add("warn");
  } else {
    els.exportProofStatus.textContent = `Chrome proof reviewed · ${formatName} · ${targetName}`;
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
    await navigator.clipboard.writeText(state.lastExportPath);
    els.copyExportPath.textContent = "Copied";
  } catch {
    els.copyExportPath.textContent = "Copy failed";
  }
}

function updateProbeReadout(event) {
  if (!previewIsVisible()) return;
  const rect = activePreviewElement().getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
    els.probeReadout.textContent = "Move over the image for pixel coordinates";
    return;
  }
  const normalizedX = (event.clientX - rect.left) / Math.max(1, rect.width);
  const normalizedY = (event.clientY - rect.top) / Math.max(1, rect.height);
  const x = Math.min(state.session.source.width - 1, Math.max(0, Math.floor(normalizedX * state.session.source.width)));
  const y = Math.min(state.session.source.height - 1, Math.max(0, Math.floor(normalizedY * state.session.source.height)));
  els.probeReadout.textContent = `x ${x} · y ${y} · ${state.currentView.toUpperCase()} preview`;
}

renderSessionChrome();
renderCurveChannelTabs();
