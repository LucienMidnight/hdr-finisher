(function () {
  const PARAM_COUNT = 144;
  const CURVE_SAMPLES = 1024;
  const DENOISE_ALGORITHM_VERSION = "compact-haar-residual-v1";
  // Preserve progressively more structure at medium/coarse Haar scales. Full
  // strength at all levels makes a three-level resolve visibly tile into 8x8
  // blocks when Amount and Luminance approach 100%.
  const DENOISE_LEVEL_WEIGHTS = Object.freeze([1.0, 0.55, 0.25, 0.1]);
  const DENOISE_SHADER_SOURCE = `
struct AnalysisParams { sigmaThreshold: vec4f, };
@group(0) @binding(0) var analysisSource: texture_2d<f32>;
@group(0) @binding(1) var analysisLow: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var analysisH: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var analysisV: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var analysisD: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> analysisParams: AnalysisParams;

fn loadClamped(source: texture_2d<f32>, p: vec2i) -> vec3f {
  let size = vec2i(textureDimensions(source));
  return textureLoad(source, clamp(p, vec2i(0), size - vec2i(1)), 0).rgb;
}
fn components(rgb: vec3f) -> vec3f {
  let y = dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895));
  return vec3f(y, rgb.r - y, rgb.b - y);
}
fn magnitude(c: vec3f, sigma: vec3f) -> f32 {
  let scaled = c / sigma;
  return sqrt(scaled.x * scaled.x + dot(scaled.yz, scaled.yz));
}
fn evidence(c: vec3f, mag: f32, total: f32) -> vec4f {
  let ratio = mag / analysisParams.sigmaThreshold.w;
  let confidence = 1.0 / (1.0 + ratio * ratio * ratio * ratio);
  let directional = clamp((mag / max(total, 1e-6) - 0.5) / 0.4, 0.0, 1.0);
  let threshold = clamp(4.0 * confidence * (1.0 - confidence), 0.0, 1.0);
  return vec4f(c * confidence, max(directional, threshold));
}
@compute @workgroup_size(8, 8)
fn analyzeMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = textureDimensions(analysisLow);
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy) * 2;
  let a = loadClamped(analysisSource, p);
  let b = loadClamped(analysisSource, p + vec2i(1, 0));
  let c = loadClamped(analysisSource, p + vec2i(0, 1));
  let d = loadClamped(analysisSource, p + vec2i(1, 1));
  let h = components((a - b + c - d) * 0.25);
  let v = components((a + b - c - d) * 0.25);
  let diagonal = components((a - b - c + d) * 0.25);
  let sigma = analysisParams.sigmaThreshold.xyz;
  let mh = magnitude(h, sigma);
  let mv = magnitude(v, sigma);
  let md = magnitude(diagonal, sigma);
  let total = mh + mv + md;
  textureStore(analysisLow, vec2i(id.xy), vec4f((a + b + c + d) * 0.25, 1.0));
  textureStore(analysisH, vec2i(id.xy), evidence(h, mh, total));
  textureStore(analysisV, vec2i(id.xy), evidence(v, mv, total));
  textureStore(analysisD, vec2i(id.xy), evidence(diagonal, md, total));
}

struct ResolveParams { weights: vec4f, flags: vec4f, };
@group(1) @binding(0) var resolveLow: texture_2d<f32>;
@group(1) @binding(1) var resolveH: texture_2d<f32>;
@group(1) @binding(2) var resolveV: texture_2d<f32>;
@group(1) @binding(3) var resolveD: texture_2d<f32>;
@group(1) @binding(4) var resolveOriginal: texture_2d<f32>;
@group(1) @binding(5) var resolveOutput: texture_storage_2d<rgba16float, write>;
@group(1) @binding(6) var<uniform> resolveParams: ResolveParams;

fn componentRgb(value: vec3f) -> vec3f {
  let red = value.x + value.y;
  let blue = value.x + value.z;
  let green = (value.x - 0.2722287 * red - 0.0536895 * blue) / 0.6740818;
  return vec3f(red, green, blue);
}
fn weightedDetailWith(packed: vec4f, weights: vec4f) -> vec3f {
  let recovery = 1.0 - weights.w * packed.w;
  let c = packed.xyz * vec3f(weights.y, weights.z, weights.z) * recovery;
  return componentRgb(c) * weights.x;
}
fn weightedDetail(packed: vec4f) -> vec3f {
  return weightedDetailWith(packed, resolveParams.weights);
}
@compute @workgroup_size(8, 8)
fn resolveMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = textureDimensions(resolveOutput);
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy);
  let q = p / 2;
  let sx = select(1.0, -1.0, (p.x & 1) == 1);
  let sy = select(1.0, -1.0, (p.y & 1) == 1);
  var residual = vec3f(0.0);
  if (resolveParams.flags.x > 0.5) { residual = textureLoad(resolveLow, q, 0).rgb; }
  residual += sx * weightedDetail(textureLoad(resolveH, q, 0));
  residual += sy * weightedDetail(textureLoad(resolveV, q, 0));
  residual += sx * sy * weightedDetail(textureLoad(resolveD, q, 0));
  var rgb = residual;
  if (resolveParams.flags.y > 0.5) { rgb = textureLoad(resolveOriginal, p, 0).rgb - residual; }
  textureStore(resolveOutput, p, vec4f(rgb, 1.0));
}

@group(2) @binding(0) var directH0: texture_2d<f32>;
@group(2) @binding(1) var directV0: texture_2d<f32>;
@group(2) @binding(2) var directD0: texture_2d<f32>;
@group(2) @binding(3) var directH1: texture_2d<f32>;
@group(2) @binding(4) var directV1: texture_2d<f32>;
@group(2) @binding(5) var directD1: texture_2d<f32>;
@group(2) @binding(6) var directOriginal: texture_2d<f32>;
@group(2) @binding(7) var directOutput: texture_storage_2d<rgba16float, write>;
@group(2) @binding(8) var<uniform> directParams: ResolveParams;

@compute @workgroup_size(8, 8)
fn resolveTwoLevelMain(@builtin(global_invocation_id) id: vec3u) {
  let outSize = textureDimensions(directOutput);
  if (id.x >= outSize.x || id.y >= outSize.y) { return; }
  let p = vec2i(id.xy);
  let q0 = p / 2;
  let q1 = q0 / 2;
  let sx0 = select(1.0, -1.0, (p.x & 1) == 1);
  let sy0 = select(1.0, -1.0, (p.y & 1) == 1);
  let sx1 = select(1.0, -1.0, (q0.x & 1) == 1);
  let sy1 = select(1.0, -1.0, (q0.y & 1) == 1);
  let weights = directParams.weights;
  var residual = ${DENOISE_LEVEL_WEIGHTS[1]} * sx1 * weightedDetailWith(textureLoad(directH1, q1, 0), weights);
  residual += ${DENOISE_LEVEL_WEIGHTS[1]} * sy1 * weightedDetailWith(textureLoad(directV1, q1, 0), weights);
  residual += ${DENOISE_LEVEL_WEIGHTS[1]} * sx1 * sy1 * weightedDetailWith(textureLoad(directD1, q1, 0), weights);
  residual += sx0 * weightedDetailWith(textureLoad(directH0, q0, 0), weights);
  residual += sy0 * weightedDetailWith(textureLoad(directV0, q0, 0), weights);
  residual += sx0 * sy0 * weightedDetailWith(textureLoad(directD0, q0, 0), weights);
  let rgb = textureLoad(directOriginal, p, 0).rgb - residual;
  textureStore(directOutput, p, vec4f(rgb, 1.0));
}`;

  class HDRWebGPUPreview {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = null;
      this.adapter = null;
      this.device = null;
      this.module = null;
      this.maskModule = null;
      this.pipelines = new Map();
      this.proxies = new Map();
      this.proxyInflight = new Map();
      this.sceneLuminance = new Map();
      this.sceneLuminanceInflight = new Map();
      this.sessionId = null;
      this.available = false;
      this.detail = "WebGPU has not been initialized";
      this.renderSerials = new WeakMap();
      this.paramBuffer = null;
      this.curveBuffer = null;
      this.curveSampleCache = new Map();
      this.lastCurveSamples = null;
      this.surfaceKeys = new WeakMap();
      this.intermediates = new Map();
      this.localMasks = new Map();
      this.localParamBuffers = new Map();
      this.localParamValues = new Map();
      this.scopeSources = new WeakMap();
      this.scopeResources = new Map();
      this.bindGroupLayout = null;
      this.pipelineLayout = null;
      this.maskBindGroupLayout = null;
      this.maskPipelineLayout = null;
      this.maskPipelines = null;
      this.instrumentationEnabled = false;
      this.performanceMetrics = { renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [] };
      // Phase 0 denoise seam. This remains null until the explicit selector
      // benchmark asks for it, so the established never-used path owns no
      // denoise resources and performs no denoise dispatches.
      this.denoiseSourceSelector = null;
      this.denoiseSelectorGeneration = 0;
      this.denoiseCounters = this.emptyDenoiseCounters();
      this.denoisePipelines = null;
      this.adapterInfo = null;
    }

    async initialize() {
      if (!navigator.gpu) {
        this.detail = "WebGPU is unavailable in this browser";
        return false;
      }
      try {
        this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!this.adapter) throw new Error("No WebGPU adapter was returned");
        const timestampQueries = this.adapter.features.has("timestamp-query");
        this.device = await this.adapter.requestDevice({
          requiredFeatures: timestampQueries ? ["timestamp-query"] : [],
        });
        const info = this.adapter.info || {};
        this.adapterInfo = {
          vendor: info.vendor || "unknown",
          architecture: info.architecture || "unknown",
          device: info.device || "unknown",
          description: info.description || "unknown",
          timestampQueries,
        };
        this.context = this.canvas.getContext("webgpu");
        if (!this.context) throw new Error("The WebGPU canvas context is unavailable");
        this.module = this.device.createShaderModule({ code: SHADER_SOURCE });
        this.maskModule = this.device.createShaderModule({ code: LUMA_MASK_SHADER_SOURCE });
        const [compilation, maskCompilation] = await Promise.all([
          this.module.getCompilationInfo(),
          this.maskModule.getCompilationInfo(),
        ]);
        const errors = [...compilation.messages, ...maskCompilation.messages].filter((message) => message.type === "error");
        if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
        this.bindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
            { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          ],
        });
        this.spatialSampler = this.device.createSampler({
          magFilter: "linear",
          minFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge",
        });
        this.pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] });
        this.scopePipeline = this.device.createRenderPipeline({
          layout: this.pipelineLayout,
          vertex: { module: this.module, entryPoint: "vertexMain" },
          fragment: { module: this.module, entryPoint: "scopeFragmentMain", targets: [{ format: "rgba16float" }] },
          primitive: { topology: "triangle-list" },
        });
        this.maskBindGroupLayout = this.device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
          ],
        });
        this.maskPipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [this.maskBindGroupLayout] });
        this.maskPipelines = {
          sceneLuminance: this.createMaskPipeline("sceneLuminanceFragmentMain"),
          qualify: this.createMaskPipeline("lumaQualificationFragmentMain"),
          refine: this.createMaskPipeline("maskRefinementFragmentMain"),
          combine: this.createMaskPipeline("maskCombineFragmentMain"),
        };
        this.device.lost.then((info) => {
          this.available = false;
          this.detail = `WebGPU device lost: ${info.message || info.reason}`;
          window.dispatchEvent(new CustomEvent("hdrfinisher:webgpulost", { detail: { message: this.detail } }));
        });
        this.available = true;
        this.detail = "WebGPU settled authoring renderer ready";
        return true;
      } catch (error) {
        this.available = false;
        this.detail = error?.message || "WebGPU initialization failed";
        return false;
      }
    }

    resetSession(sessionId = null) {
      this.disposeDenoiseSelectorSeam();
      this.sessionId = sessionId;
      this.renderSerials = new WeakMap();
      for (const proxy of this.proxies.values()) proxy.texture?.destroy();
      this.proxies.clear();
      this.proxyInflight.clear();
      for (const scene of this.sceneLuminance.values()) scene.texture?.destroy();
      this.sceneLuminance.clear();
      this.sceneLuminanceInflight.clear();
      for (const intermediate of this.intermediates.values()) {
        intermediate.baseTexture?.destroy();
        intermediate.filmTexture?.destroy();
        intermediate.spatialATexture?.destroy();
        intermediate.spatialBTexture?.destroy();
        intermediate.localTexture?.destroy();
      }
      this.intermediates.clear();
      for (const mask of this.localMasks.values()) this.destroyLocalMaskEntry(mask);
      this.localMasks.clear();
      for (const buffer of this.localParamBuffers.values()) buffer.destroy();
      this.localParamBuffers.clear();
      this.localParamValues.clear();
      this.curveSampleCache.clear();
      this.lastCurveSamples = null;
      this.scopeSources = new WeakMap();
      for (const pool of this.scopeResources.values()) {
        for (const resource of pool) {
          resource.texture.destroy();
          resource.readBuffer.destroy();
          resource.paramBuffer.destroy();
        }
      }
      this.scopeResources.clear();
    }

    async render(sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203) {
      return this.renderTo(this.canvas, sessionId, lane, adjustments, curveSampler, longEdge, localAdjustments, editRevision, maskOverlay, referenceWhiteNits);
    }

    setInstrumentationEnabled(enabled = true) {
      this.instrumentationEnabled = Boolean(enabled);
      if (enabled) {
        this.performanceMetrics = {
          renders: [], scopes: [], maskEvents: [], stages: [], allocations: [], presentations: [],
        };
      }
    }

    emptyDenoiseCounters() {
      return {
        analysisCalls: 0,
        resolveCalls: 0,
        allocations: 0,
        allocatedBytes: 0,
        atomicSwaps: 0,
        toggles: 0,
      };
    }

    recordStage(stage, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.stages;
      entries.push({ stage, at: performance.now(), ...detail });
      if (entries.length > 720) entries.shift();
    }

    recordAllocation(kind, bytes, detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.allocations;
      entries.push({ kind, bytes, at: performance.now(), ...detail });
      if (entries.length > 480) entries.shift();
    }

    recordPresentation(detail = {}) {
      if (!this.instrumentationEnabled) return;
      const entries = this.performanceMetrics.presentations;
      entries.push({ at: performance.now(), ...detail });
      if (entries.length > 240) entries.shift();
      this.recordStage("presentation", detail);
    }

    diagnosticsSnapshot() {
      return {
        adapter: this.adapterInfo,
        available: this.available,
        detail: this.detail,
        renders: this.performanceMetrics.renders.map((entry) => ({ ...entry })),
        scopes: (this.performanceMetrics.scopes || []).map((entry) => ({ ...entry })),
        maskEvents: (this.performanceMetrics.maskEvents || []).map((entry) => ({ ...entry })),
        stages: (this.performanceMetrics.stages || []).map((entry) => ({ ...entry })),
        allocations: (this.performanceMetrics.allocations || []).map((entry) => ({ ...entry })),
        presentations: (this.performanceMetrics.presentations || []).map((entry) => ({ ...entry })),
        denoise: {
          ...this.denoiseCounters,
          selectorCreated: Boolean(this.denoiseSourceSelector),
          selectedSource: this.denoiseSourceSelector?.selected || "original",
          identity: this.denoiseSourceSelector?.identity || null,
          resolvedResident: Boolean(this.denoiseSourceSelector?.resolved),
          cacheReady: Boolean(this.denoiseSourceSelector?.cache),
          algorithmVersion: this.denoiseSourceSelector?.cache?.algorithmVersion || null,
        },
        resources: {
          proxies: this.proxies.size,
          proxyBytes: [...this.proxies.values()].reduce((sum, entry) => sum + (entry.byteSize || 0), 0),
          sceneLuminanceTextures: this.sceneLuminance.size,
          localMasks: this.localMasks.size,
          localMaskBytes: [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0),
          maskGraphs: [...this.localMasks.values()].filter((entry) => entry.kind === "gpu-mask-graph").length,
          scopePools: this.scopeResources.size,
          scopeBuffers: [...this.scopeResources.values()].reduce((sum, pool) => sum + pool.length, 0),
          scopeBytes: [...this.scopeResources.values()].reduce(
            (sum, pool) => sum + pool.reduce((poolSum, resource) => poolSum + (resource.byteSize || 0), 0),
            0,
          ),
          gradingIntermediateBytes: [...this.intermediates.values()].reduce((sum, entry) => {
            const spatialWidth = Math.max(1, Math.ceil(entry.width / 4));
            const spatialHeight = Math.max(1, Math.ceil(entry.height / 4));
            const spatialBytes = entry.spatialATexture && entry.spatialBTexture
              ? spatialWidth * spatialHeight * 8 * 2
              : 0;
            return sum + entry.width * entry.height * 8 * 3 + spatialBytes;
          }, 0),
          denoiseTextures: (this.denoiseSourceSelector?.resolved ? 1 : 0)
            + (this.denoiseSourceSelector?.cache?.textureCount || 0),
          denoiseBytes: (this.denoiseSourceSelector?.resolved?.byteSize || 0)
            + (this.denoiseSourceSelector?.cache?.byteSize || 0),
        },
      };
    }

    async renderTo(canvas, sessionId, lane, adjustments, curveSampler, longEdge = 1600, localAdjustments = [], editRevision = 0, maskOverlay = null, referenceWhiteNits = 203) {
      if (!this.available || !sessionId) return false;
      const renderStartedAt = performance.now();
      if (this.sessionId !== sessionId) this.resetSession(sessionId);
      const serial = (this.renderSerials.get(canvas) || 0) + 1;
      this.renderSerials.set(canvas, serial);
      const geometrySignature = JSON.stringify(adjustments.shared?.geometry || {});
      const retainedOriginal = this.denoiseSourceSelector?.original;
      if (retainedOriginal
        && retainedOriginal.sessionId === sessionId
        && retainedOriginal.lane === lane
        && retainedOriginal.geometrySignature === geometrySignature) {
        longEdge = retainedOriginal.longEdge;
      }
      const proxy = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision);
      const proxyReadyAt = performance.now();
      if (serial !== this.renderSerials.get(canvas) || !proxy) return false;
      const sourceProxy = this.selectedDenoiseSource(proxy);
      const activeLocals = localAdjustments.filter((local) => local.enabled !== false && local.opacity > 0 && local[`${lane}_grade`]?.enabled !== false);
      if (!activeLocals.every((local) => gpuLocalSupported(local[`${lane}_grade`]))) return false;
      const masks = await Promise.all(activeLocals.map((local) => this.loadLocalMask(
        sessionId,
        local,
        longEdge,
        editRevision,
        geometrySignature,
        () => serial === this.renderSerials.get(canvas),
      )));
      const masksReadyAt = performance.now();
      if (serial !== this.renderSerials.get(canvas) || masks.some((mask) => !mask)) return false;

      if (canvas.width !== proxy.width) canvas.width = proxy.width;
      if (canvas.height !== proxy.height) canvas.height = proxy.height;
      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The comparison WebGPU canvas context is unavailable");
      const surface = this.configureSurface(canvas, context, lane === "hdr");
      const pipelines = this.pipelineFor(surface.format);
      const params = buildParams(lane, adjustments, proxy.workingSpace, surface.hdr, referenceWhiteNits);
      const overlayIndex = maskOverlay?.localId
        ? activeLocals.findIndex((local) => local.id === maskOverlay.localId)
        : -1;
      const overlayMask = overlayIndex >= 0 ? masks[overlayIndex] : null;
      const overlayLocal = overlayIndex >= 0 ? activeLocals[overlayIndex] : null;
      const overlayColor = Array.isArray(maskOverlay?.color) ? maskOverlay.color : [0.12, 0.72, 0.86];
      params[131] = overlayMask ? 1 : 0;
      params[132] = overlayLocal ? gpuMaskInfluenceOpacity(overlayLocal.mask) : 0;
      params[133] = Number(overlayColor[0]) || 0;
      params[134] = Number(overlayColor[1]) || 0;
      params[135] = Number(overlayColor[2]) || 0;
      const curves = buildCurves(lane, adjustments, curveSampler, this.curveSampleCache);
      this.ensureStorageBuffers(params.byteLength, curves.byteLength);
      this.device.queue.writeBuffer(this.paramBuffer, 0, params);
      if (curves !== this.lastCurveSamples) {
        this.device.queue.writeBuffer(this.curveBuffer, 0, curves);
        this.lastCurveSamples = curves;
      }
      const spatialActive = params[78] > 0.5 && params[79] > 0
        && (params[85] > 0.5 || (params[92] > 0.5 && params[93] > 0));
      const intermediate = this.ensureIntermediate(canvas, proxy.width, proxy.height, spatialActive);
      const makeBindGroup = (sourceView, spatialView, parameterBuffer = this.paramBuffer, overlayView = spatialView) => this.device.createBindGroup({
          layout: this.bindGroupLayout,
          entries: [
            { binding: 0, resource: sourceView },
            { binding: 1, resource: { buffer: parameterBuffer } },
            { binding: 2, resource: { buffer: this.curveBuffer } },
            { binding: 3, resource: spatialView },
            { binding: 4, resource: this.spatialSampler },
            { binding: 5, resource: overlayView },
          ],
      });
      // When spatial effects are inactive, use the immutable proxy as the
      // required placeholder binding. Binding filmTexture here would make the
      // response pass sample from the same texture it renders into, which is
      // invalid in WebGPU even when the inactive shader branch never samples it.
      const fallbackSpatialView = sourceProxy.texture.createView();
      const spatialAView = intermediate.spatialATexture?.createView() || fallbackSpatialView;
      const baseBindGroup = makeBindGroup(sourceProxy.texture.createView(), spatialAView);
      const extractBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const horizontalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialATexture.createView())
        : null;
      const verticalBindGroup = spatialActive
        ? makeBindGroup(intermediate.filmTexture.createView(), intermediate.spatialBTexture.createView())
        : null;
      const compositeBindGroup = makeBindGroup(
        intermediate.filmTexture.createView(),
        spatialAView,
        this.paramBuffer,
        overlayMask?.texture?.createView() || spatialAView,
      );
      const encoder = this.device.createCommandEncoder();
      const gpuTiming = this.instrumentationEnabled && this.device.features.has("timestamp-query")
        ? this.createGpuTimingResources()
        : null;
      const basePass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, beginningOfPassWriteIndex: 0 } } : {}),
        colorAttachments: [{
          view: intermediate.baseTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      basePass.setPipeline(pipelines.base);
      basePass.setBindGroup(0, baseBindGroup);
      basePass.draw(3);
      basePass.end();
      let localSource = intermediate.baseTexture;
      for (let index = 0; index < activeLocals.length; index += 1) {
        const local = activeLocals[index];
        const target = index % 2 === 0 ? intermediate.localTexture : intermediate.baseTexture;
        const localBuffer = this.localParamBuffer(local, lane);
        const localBindGroup = makeBindGroup(localSource.createView(), masks[index].texture.createView(), localBuffer);
        const localPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: target.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        localPass.setPipeline(pipelines.local);
        localPass.setBindGroup(0, localBindGroup);
        localPass.draw(3);
        localPass.end();
        localSource = target;
      }
      const responseBindGroup = makeBindGroup(localSource.createView(), spatialAView);
      const responsePass = encoder.beginRenderPass({
        colorAttachments: [{
          view: intermediate.filmTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      responsePass.setPipeline(pipelines.response);
      responsePass.setBindGroup(0, responseBindGroup);
      responsePass.draw(3);
      responsePass.end();
      if (spatialActive) {
        const extractPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        extractPass.setPipeline(pipelines.extract);
        extractPass.setBindGroup(0, extractBindGroup);
        extractPass.draw(3);
        extractPass.end();
        const horizontalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialBTexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        horizontalPass.setPipeline(pipelines.blurHorizontal);
        horizontalPass.setBindGroup(0, horizontalBindGroup);
        horizontalPass.draw(3);
        horizontalPass.end();
        const verticalPass = encoder.beginRenderPass({
          colorAttachments: [{
            view: intermediate.spatialATexture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          }],
        });
        verticalPass.setPipeline(pipelines.blurVertical);
        verticalPass.setBindGroup(0, verticalBindGroup);
        verticalPass.draw(3);
        verticalPass.end();
      }
      const pass = encoder.beginRenderPass({
        ...(gpuTiming ? { timestampWrites: { querySet: gpuTiming.querySet, endingOfPassWriteIndex: 1 } } : {}),
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipelines.composite);
      pass.setBindGroup(0, compositeBindGroup);
      pass.draw(3);
      pass.end();
      if (gpuTiming) {
        encoder.resolveQuerySet(gpuTiming.querySet, 0, 2, gpuTiming.resolveBuffer, 0);
        encoder.copyBufferToBuffer(gpuTiming.resolveBuffer, 0, gpuTiming.readBuffer, 0, 16);
      }
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      this.recordStage("grading", {
        serial,
        lane,
        longEdge,
        source: sourceProxy === proxy ? "original" : "resolved",
        durationMs: submittedAt - masksReadyAt,
      });
      this.scopeSources.set(canvas, {
        serial,
        lane,
        width: proxy.width,
        height: proxy.height,
        filmTexture: intermediate.filmTexture,
        spatialTexture: intermediate.spatialATexture || intermediate.filmTexture,
        params: new Float32Array(params),
      });
      if (this.instrumentationEnabled) {
        const metric = {
          serial,
          lane,
          longEdge,
          width: proxy.width,
          height: proxy.height,
          localCount: activeLocals.length,
          proxyAwaitMs: proxyReadyAt - renderStartedAt,
          maskAwaitMs: masksReadyAt - proxyReadyAt,
          encodeSubmitMs: submittedAt - masksReadyAt,
          submissionMs: submittedAt - renderStartedAt,
          queueCompleteMs: null,
          gpuMs: null,
        };
        this.performanceMetrics.renders.push(metric);
        if (this.performanceMetrics.renders.length > 240) this.performanceMetrics.renders.shift();
        void this.device.queue.onSubmittedWorkDone().then(() => {
          metric.queueCompleteMs = performance.now() - submittedAt;
        }).catch(() => null);
        if (gpuTiming) this.collectGpuTiming(gpuTiming, metric);
      } else {
        gpuTiming?.querySet.destroy();
        gpuTiming?.resolveBuffer.destroy();
        gpuTiming?.readBuffer.destroy();
      }
      return { width: proxy.width, height: proxy.height, hdr: surface.hdr, proxyFormat: proxy.pixelFormat };
    }

    selectedDenoiseSource(originalProxy) {
      const selector = this.denoiseSourceSelector;
      if (!selector || selector.identity !== originalProxy.identity) {
        return originalProxy;
      }
      if (selector.selected === "resolved" && selector.resolved) return selector.resolved;
      return selector.original;
    }

    async ensureDenoisePipelines() {
      if (this.denoisePipelines) return this.denoisePipelines;
      const module = this.device.createShaderModule({ code: DENOISE_SHADER_SOURCE });
      const compilation = await module.getCompilationInfo();
      const errors = compilation.messages.filter((message) => message.type === "error");
      if (errors.length) throw new Error(errors.map((message) => message.message).join("; "));
      const [analysis, resolve, resolveTwoLevel] = await Promise.all([
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "analyzeMain" } }),
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "resolveMain" } }),
        this.device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "resolveTwoLevelMain" } }),
      ]);
      this.denoisePipelines = { analysis, resolve, resolveTwoLevel };
      return this.denoisePipelines;
    }

    createDenoiseTexture(width, height, label) {
      const texture = this.device.createTexture({
        label,
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      return { texture, width, height, byteSize: width * height * 8 };
    }

    async analyzeDenoiseProxy(sessionId, lane, adjustments, longEdge, editRevision = 0, preset = {}) {
      if (!this.available || !sessionId) return false;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const original = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision);
      if (!original) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const pipelines = await this.ensureDenoisePipelines();
      const settings = {
        name: "Photo / Fine",
        levels: 2,
        noiseThreshold: 3.0,
        lumaSigma: 0.035,
        chromaSigma: 0.035,
        lumaStrength: 1.0,
        chromaStrength: 1.25,
        ...preset,
      };
      if (!Number.isInteger(settings.levels) || settings.levels < 1 || settings.levels > 4) {
        throw new Error("Wavelet analysis supports one through four decimated scales.");
      }
      const startedAt = performance.now();
      this.denoiseCounters.analysisCalls += 1;
      this.recordStage("denoise-analysis", { state: "started", generation, longEdge });
      const levels = [];
      const transient = [];
      const evidenceAllocated = [];
      const paramBuffers = [];
      const resolveScratch = [];
      const resolveParamBuffers = [];
      let cacheInstalled = false;
      let input = original;
      try {
        const encoder = this.device.createCommandEncoder();
        for (let index = 0; index < settings.levels; index += 1) {
          const width = Math.ceil(input.width / 2);
          const height = Math.ceil(input.height / 2);
          const low = this.createDenoiseTexture(width, height, `denoise-low-${index}`);
          const evidence = ["h", "v", "d"].map((axis) => this.createDenoiseTexture(width, height, `denoise-${axis}-${index}`));
          transient.push(low);
          evidenceAllocated.push(...evidence);
          const params = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          paramBuffers.push(params);
          const scale = 0.5 ** (index + 1);
          this.device.queue.writeBuffer(params, 0, new Float32Array([
            settings.lumaSigma * scale * settings.lumaStrength,
            settings.chromaSigma * scale * settings.chromaStrength,
            settings.chromaSigma * scale * settings.chromaStrength,
            settings.noiseThreshold,
          ]));
          const bindGroup = this.device.createBindGroup({
            layout: pipelines.analysis.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: input.texture.createView() },
              { binding: 1, resource: low.texture.createView() },
              { binding: 2, resource: evidence[0].texture.createView() },
              { binding: 3, resource: evidence[1].texture.createView() },
              { binding: 4, resource: evidence[2].texture.createView() },
              { binding: 5, resource: { buffer: params } },
            ],
          });
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipelines.analysis);
          pass.setBindGroup(0, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
          pass.end();
          levels.push({ sourceWidth: input.width, sourceHeight: input.height, low, evidence, params });
          input = low;
        }
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
          this.recordStage("denoise-analysis", { state: "stale", generation });
          return false;
        }
        for (let index = 1; index < levels.length; index += 1) {
          resolveScratch.push(this.createDenoiseTexture(
            levels[index].sourceWidth,
            levels[index].sourceHeight,
            `denoise-resolve-scratch-${index}`,
          ));
        }
        for (let index = 0; index < Math.max(1, levels.length); index += 1) {
          resolveParamBuffers.push(this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        }
        const previous = this.denoiseSourceSelector;
        const evidenceByteSize = levels.reduce((sum, level) => sum + level.evidence.reduce((value, item) => value + item.byteSize, 0), 0);
        const scratchByteSize = resolveScratch.reduce((sum, item) => sum + item.byteSize, 0);
        const byteSize = evidenceByteSize + scratchByteSize;
        const cache = {
          algorithmVersion: DENOISE_ALGORITHM_VERSION,
          settings,
          levels: levels.map((level) => ({
            sourceWidth: level.sourceWidth,
            sourceHeight: level.sourceHeight,
            evidence: level.evidence,
          })),
          resolveScratch,
          resolveParamBuffers,
          byteSize,
          textureCount: levels.length * 3 + resolveScratch.length,
        };
        this.denoiseSourceSelector = {
          identity: original.identity,
          original,
          resolved: null,
          selected: previous?.identity === original.identity ? previous.selected : "original",
          cache,
          generation,
        };
        cacheInstalled = true;
        this.destroyDenoiseSelector(previous);
        this.denoiseCounters.allocations += cache.textureCount;
        this.denoiseCounters.allocatedBytes += byteSize;
        this.recordAllocation("denoise-wavelet-cache", byteSize, { textures: cache.textureCount, longEdge });
        this.recordStage("denoise-analysis", { state: "ready", generation, durationMs: performance.now() - startedAt });
      } catch (error) {
        this.recordStage("denoise-analysis", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      } finally {
        for (const item of transient) item.texture.destroy();
        for (const buffer of paramBuffers) buffer.destroy();
        if (!cacheInstalled) {
          for (const item of evidenceAllocated) item.texture.destroy();
          for (const item of resolveScratch) item.texture.destroy();
          for (const buffer of resolveParamBuffers) buffer.destroy();
        }
      }
      return this.resolveDenoiseProxy({ amount: 0.5, luminance: 0.5, colorNoise: 0.5, detailRecovery: 0.5 });
    }

    async resolveDenoiseProxy(controls = {}) {
      const selector = this.denoiseSourceSelector;
      if (!selector?.cache || !selector.original) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const startedAt = performance.now();
      this.denoiseCounters.resolveCalls += 1;
      const weights = ["amount", "luminance", "colorNoise", "detailRecovery"].map((name) => {
        const value = Number(controls[name] ?? 0.5);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1`);
        return value;
      });
      const pipelines = await this.ensureDenoisePipelines();
      const levels = selector.cache.levels;
      const candidateIsNew = !selector.resolved;
      const candidate = selector.resolved || this.createDenoiseTexture(selector.original.width, selector.original.height, "denoise-resolved");
      try {
        const encoder = this.device.createCommandEncoder();
        if (levels.length === 2) {
          const params = selector.cache.resolveParamBuffers[0];
          this.device.queue.writeBuffer(params, 0, new Float32Array([...weights, 0, 1, 0, 0]));
          const fine = levels[0].evidence;
          const medium = levels[1].evidence;
          const bindGroup = this.device.createBindGroup({
            layout: pipelines.resolveTwoLevel.getBindGroupLayout(2),
            entries: [
              { binding: 0, resource: fine[0].texture.createView() },
              { binding: 1, resource: fine[1].texture.createView() },
              { binding: 2, resource: fine[2].texture.createView() },
              { binding: 3, resource: medium[0].texture.createView() },
              { binding: 4, resource: medium[1].texture.createView() },
              { binding: 5, resource: medium[2].texture.createView() },
              { binding: 6, resource: selector.original.texture.createView() },
              { binding: 7, resource: candidate.texture.createView() },
              { binding: 8, resource: { buffer: params } },
            ],
          });
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipelines.resolveTwoLevel);
          pass.setBindGroup(2, bindGroup);
          pass.dispatchWorkgroups(Math.ceil(candidate.width / 8), Math.ceil(candidate.height / 8));
          pass.end();
        } else {
          let reconstructedLow = null;
          for (let index = levels.length - 1; index >= 0; index -= 1) {
            const level = levels[index];
            const finalPass = index === 0;
            const output = finalPass ? candidate : selector.cache.resolveScratch[index - 1];
            const params = selector.cache.resolveParamBuffers[index];
            const levelWeight = DENOISE_LEVEL_WEIGHTS[Math.min(index, DENOISE_LEVEL_WEIGHTS.length - 1)];
            this.device.queue.writeBuffer(params, 0, new Float32Array([
              weights[0] * levelWeight,
              weights[1],
              weights[2],
              weights[3],
              reconstructedLow ? 1 : 0,
              finalPass ? 1 : 0,
              0,
              0,
            ]));
            const dummyLow = reconstructedLow || level.evidence[0];
            const bindGroup = this.device.createBindGroup({
              layout: pipelines.resolve.getBindGroupLayout(1),
              entries: [
                { binding: 0, resource: dummyLow.texture.createView() },
                { binding: 1, resource: level.evidence[0].texture.createView() },
                { binding: 2, resource: level.evidence[1].texture.createView() },
                { binding: 3, resource: level.evidence[2].texture.createView() },
                { binding: 4, resource: selector.original.texture.createView() },
                { binding: 5, resource: output.texture.createView() },
                { binding: 6, resource: { buffer: params } },
              ],
            });
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipelines.resolve);
            pass.setBindGroup(1, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(output.width / 8), Math.ceil(output.height / 8));
            pass.end();
            reconstructedLow = output;
          }
        }
        this.device.queue.submit([encoder.finish()]);
        await this.device.queue.onSubmittedWorkDone();
        if (generation !== this.denoiseSelectorGeneration || selector !== this.denoiseSourceSelector) {
          if (candidateIsNew) candidate.texture.destroy();
          this.recordStage("denoise-resolve", { state: "stale", generation });
          return false;
        }
        if (candidateIsNew) {
          selector.resolved = {
            ...candidate,
            workingSpace: selector.original.workingSpace,
            pixelFormat: "rgba16float",
            geometrySignature: selector.original.geometrySignature,
            identity: selector.original.identity,
          };
        }
        selector.selected = "resolved";
        this.denoiseCounters.atomicSwaps += 1;
        if (candidateIsNew) {
          this.denoiseCounters.allocations += 1;
          this.denoiseCounters.allocatedBytes += candidate.byteSize;
          this.recordAllocation("denoise-resolved", candidate.byteSize, { generation });
        }
        this.recordStage("denoise-resolve", { state: "ready", generation, durationMs: performance.now() - startedAt });
        return true;
      } catch (error) {
        if (candidateIsNew) candidate.texture.destroy();
        this.recordStage("denoise-resolve", { state: "error", generation, durationMs: performance.now() - startedAt });
        throw error;
      }
    }

    async prepareDenoiseSelectorSeam(sessionId, lane, adjustments, longEdge, editRevision = 0, variant = "resolved-a") {
      if (!this.available || !sessionId) return false;
      const geometrySignature = JSON.stringify(adjustments?.shared?.geometry || {});
      const original = await this.loadProxy(sessionId, lane, longEdge, geometrySignature, editRevision);
      if (!original) return false;
      const generation = ++this.denoiseSelectorGeneration;
      const startedAt = performance.now();
      const texture = this.device.createTexture({
        size: { width: original.width, height: original.height },
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      const byteSize = original.width * original.height * 8;
      this.denoiseCounters.allocations += 1;
      this.denoiseCounters.allocatedBytes += byteSize;
      this.recordAllocation("denoise-selector-fixture", byteSize, { width: original.width, height: original.height, variant });
      const colors = {
        "resolved-a": { r: 0, g: 0, b: 0, a: 1 },
        "resolved-b": { r: 4, g: 4, b: 4, a: 1 },
      };
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          clearValue: colors[variant] || colors["resolved-a"],
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      if (generation !== this.denoiseSelectorGeneration || this.sessionId !== sessionId) {
        texture.destroy();
        this.recordStage("selector-stale-candidate", { generation, variant });
        return false;
      }
      const previous = this.denoiseSourceSelector;
      this.denoiseSourceSelector = {
        identity: original.identity,
        original,
        resolved: {
          texture,
          width: original.width,
          height: original.height,
          workingSpace: original.workingSpace,
          pixelFormat: "rgba16float",
          geometrySignature: original.geometrySignature,
          identity: original.identity,
          byteSize,
        },
        selected: previous?.identity === original.identity ? previous.selected : "original",
        variant,
        generation,
      };
      this.destroyDenoiseSelector(previous);
      this.denoiseCounters.atomicSwaps += 1;
      this.recordStage("selector-atomic-swap", { generation, variant, durationMs: performance.now() - startedAt });
      return true;
    }

    selectDenoiseSelectorSource(enabled) {
      if (!this.denoiseSourceSelector) return false;
      this.denoiseSourceSelector.selected = enabled ? "resolved" : "original";
      this.denoiseCounters.toggles += 1;
      this.recordStage("selector-toggle", { source: this.denoiseSourceSelector.selected });
      return true;
    }

    async readDenoiseSelectorPixel() {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const buffer = this.device.createBuffer({
        size: 256,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture },
        { buffer, bytesPerRow: 256, rowsPerImage: 1 },
        { width: 1, height: 1 },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const values = new Uint16Array(buffer.getMappedRange());
        return [halfToFloat(values[0]), halfToFloat(values[1]), halfToFloat(values[2]), halfToFloat(values[3])];
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    async readDenoiseResolvedRegion(width = 16, height = 16) {
      const resolved = this.denoiseSourceSelector?.resolved;
      if (!resolved) return null;
      const copyWidth = Math.min(Math.max(1, Number(width) || 1), resolved.width);
      const copyHeight = Math.min(Math.max(1, Number(height) || 1), resolved.height);
      const bytesPerRow = Math.ceil((copyWidth * 8) / 256) * 256;
      const buffer = this.device.createBuffer({
        size: bytesPerRow * copyHeight,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: resolved.texture },
        { buffer, bytesPerRow, rowsPerImage: copyHeight },
        { width: copyWidth, height: copyHeight },
      );
      this.device.queue.submit([encoder.finish()]);
      try {
        await buffer.mapAsync(GPUMapMode.READ);
        const source = new Uint16Array(buffer.getMappedRange());
        const stride = bytesPerRow / 2;
        const values = [];
        for (let y = 0; y < copyHeight; y += 1) {
          for (let x = 0; x < copyWidth * 4; x += 1) values.push(halfToFloat(source[y * stride + x]));
        }
        return { width: copyWidth, height: copyHeight, values };
      } finally {
        if (buffer.mapState === "mapped") buffer.unmap();
        buffer.destroy();
      }
    }

    disposeDenoiseSelectorSeam() {
      this.denoiseSelectorGeneration += 1;
      this.destroyDenoiseSelector(this.denoiseSourceSelector);
      this.denoiseSourceSelector = null;
      this.denoiseCounters = this.emptyDenoiseCounters();
    }

    evictDenoiseCache() {
      this.denoiseSelectorGeneration += 1;
      this.destroyDenoiseSelector(this.denoiseSourceSelector);
      this.denoiseSourceSelector = null;
      this.recordStage("denoise-cache-evicted", {});
    }

    destroyDenoiseSelector(selector) {
      if (!selector) return;
      selector.resolved?.texture?.destroy();
      for (const level of selector.cache?.levels || []) {
        for (const item of level.evidence || []) item.texture?.destroy();
      }
      for (const item of selector.cache?.resolveScratch || []) item.texture?.destroy();
      for (const buffer of selector.cache?.resolveParamBuffers || []) buffer.destroy();
    }

    async analyzeScope(canvas, { width = 256, height = 128, generation = 0, tier = "interactive" } = {}) {
      if (!this.available) return null;
      const source = this.scopeSources.get(canvas);
      if (!source) return null;
      const resource = this.acquireScopeResource(width, height);
      if (!resource) return null;
      const startedAt = performance.now();
      resource.busy = true;
      const params = new Float32Array(source.params);
      params[136] = width;
      params[137] = height;
      this.device.queue.writeBuffer(resource.paramBuffer, 0, params);
      const bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: source.filmTexture.createView() },
          { binding: 1, resource: { buffer: resource.paramBuffer } },
          { binding: 2, resource: { buffer: this.curveBuffer } },
          { binding: 3, resource: source.spatialTexture.createView() },
          { binding: 4, resource: this.spatialSampler },
          { binding: 5, resource: source.spatialTexture.createView() },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: resource.texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(this.scopePipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: resource.texture },
        { buffer: resource.readBuffer, bytesPerRow: resource.bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const encodedAt = performance.now();
      this.device.queue.submit([encoder.finish()]);
      const submittedAt = performance.now();
      try {
        await resource.readBuffer.mapAsync(GPUMapMode.READ);
        const mappedAt = performance.now();
        const sourceBytes = new Uint16Array(resource.readBuffer.getMappedRange());
        const rowStride = resource.bytesPerRow / 2;
        const pixels = new Float32Array(width * height * 3);
        let targetIndex = 0;
        for (let row = 0; row < height; row += 1) {
          let sourceIndex = row * rowStride;
          for (let column = 0; column < width; column += 1) {
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex]);
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 1]);
            pixels[targetIndex++] = halfToFloat(sourceBytes[sourceIndex + 2]);
            sourceIndex += 4;
          }
        }
        const completedAt = performance.now();
        const metric = {
          generation,
          tier,
          lane: source.lane,
          sourceSerial: source.serial,
          width,
          height,
          encodeMs: encodedAt - startedAt,
          submitMs: submittedAt - encodedAt,
          mapReadbackMs: mappedAt - submittedAt,
          unpackMs: completedAt - mappedAt,
          totalMs: completedAt - startedAt,
          byteLength: resource.bytesPerRow * height,
        };
        if (this.instrumentationEnabled) {
          this.performanceMetrics.scopes.push(metric);
          if (this.performanceMetrics.scopes.length > 240) this.performanceMetrics.scopes.shift();
          this.recordStage("scopes", { ...metric });
        }
        return { pixels, width, height, lane: source.lane, sourceSerial: source.serial, metric };
      } catch {
        return null;
      } finally {
        if (resource.readBuffer.mapState === "mapped") resource.readBuffer.unmap();
        resource.busy = false;
      }
    }

    acquireScopeResource(width, height) {
      const bytesPerRow = Math.ceil((width * 8) / 256) * 256;
      const key = `${width}x${height}`;
      let pool = this.scopeResources.get(key);
      if (!pool) {
        pool = [];
        this.scopeResources.set(key, pool);
      }
      const available = pool.find((resource) => !resource.busy && resource.readBuffer.mapState === "unmapped");
      if (available) return available;
      if (pool.length >= 2) return null;
      const resource = {
        busy: false,
        bytesPerRow,
        byteSize: width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4,
        texture: this.device.createTexture({
          size: { width, height },
          format: "rgba16float",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        }),
        readBuffer: this.device.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        }),
        paramBuffer: this.device.createBuffer({
          size: PARAM_COUNT * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
      };
      pool.push(resource);
      this.recordAllocation("scope", width * height * 8 + bytesPerRow * height + PARAM_COUNT * 4, { width, height });
      return resource;
    }

    createGpuTimingResources() {
      const querySet = this.device.createQuerySet({ type: "timestamp", count: 2 });
      const resolveBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      const readBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      return { querySet, resolveBuffer, readBuffer };
    }

    collectGpuTiming(resources, metric) {
      void resources.readBuffer.mapAsync(GPUMapMode.READ).then(() => {
        const timestamps = new BigUint64Array(resources.readBuffer.getMappedRange());
        metric.gpuMs = Number(timestamps[1] - timestamps[0]) / 1e6;
        resources.readBuffer.unmap();
      }).catch(() => null).finally(() => {
        resources.querySet.destroy();
        resources.resolveBuffer.destroy();
        resources.readBuffer.destroy();
      });
    }

    configureSurface(canvas, context, wantsHdr) {
      const hdrDisplay = Boolean(window.matchMedia?.("(dynamic-range: high)").matches);
      if (wantsHdr && hdrDisplay) {
        try {
          const format = "rgba16float";
          const key = `${format}:display-p3:extended:${canvas.width}x${canvas.height}`;
          if (this.surfaceKeys.get(canvas) !== key) {
            context.configure({
              device: this.device,
              format,
              colorSpace: "display-p3",
              toneMapping: { mode: "extended" },
              alphaMode: "opaque",
            });
            this.surfaceKeys.set(canvas, key);
          }
          return { format, hdr: true };
        } catch {
          // Older WebGPU implementations still provide a fast SDR draft.
        }
      }
      const format = navigator.gpu.getPreferredCanvasFormat();
      const key = `${format}:srgb:standard:${canvas.width}x${canvas.height}`;
      if (this.surfaceKeys.get(canvas) !== key) {
        context.configure({ device: this.device, format, colorSpace: "srgb", alphaMode: "opaque" });
        this.surfaceKeys.set(canvas, key);
      }
      return { format, hdr: false };
    }

    createMaskPipeline(entryPoint) {
      return this.device.createRenderPipeline({
        layout: this.maskPipelineLayout,
        vertex: { module: this.maskModule, entryPoint: "vertexMain" },
        fragment: { module: this.maskModule, entryPoint, targets: [{ format: "r16float" }] },
        primitive: { topology: "triangle-list" },
      });
    }

    pipelineFor(format) {
      if (this.pipelines.has(format)) return this.pipelines.get(format);
      const base = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "baseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const response = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "filmResponseFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const local = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "localAdjustmentFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const extract = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialExtractFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurHorizontal = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurHorizontalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const blurVertical = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "spatialBlurVerticalFragmentMain", targets: [{ format: "rgba16float" }] },
        primitive: { topology: "triangle-list" },
      });
      const composite = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module: this.module, entryPoint: "vertexMain" },
        fragment: { module: this.module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      const pipelines = { base, local, response, extract, blurHorizontal, blurVertical, composite };
      this.pipelines.set(format, pipelines);
      return pipelines;
    }

    ensureIntermediate(canvas, width, height, spatialActive = false) {
      const current = this.intermediates.get(canvas);
      const spatialWidth = Math.max(1, Math.ceil(width / 4));
      const spatialHeight = Math.max(1, Math.ceil(height / 4));
      const createSpatialTexture = () => this.device.createTexture({
        size: { width: spatialWidth, height: spatialHeight },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      if (current?.width === width && current?.height === height) {
        if (spatialActive && (!current.spatialATexture || !current.spatialBTexture)) {
          current.spatialATexture = createSpatialTexture();
          current.spatialBTexture = createSpatialTexture();
          this.recordAllocation(
            "grading-spatial-intermediates",
            spatialWidth * spatialHeight * 8 * 2,
            { width, height, spatialWidth, spatialHeight },
          );
        }
        // Retain spatial textures after first use. Bypass toggles and non-spatial
        // slider edits can then reuse every 4K intermediate instead of destroying
        // and reallocating the full render set.
        current.spatialActive = spatialActive;
        return current;
      }
      current?.baseTexture?.destroy();
      current?.filmTexture?.destroy();
      current?.spatialATexture?.destroy();
      current?.spatialBTexture?.destroy();
      current?.localTexture?.destroy();
      const createTexture = () => this.device.createTexture({
        size: { width, height },
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const intermediate = {
        baseTexture: createTexture(),
        filmTexture: createTexture(),
        localTexture: createTexture(),
        spatialATexture: spatialActive ? createSpatialTexture() : null,
        spatialBTexture: spatialActive ? createSpatialTexture() : null,
        spatialActive,
        width,
        height,
      };
      this.intermediates.set(canvas, intermediate);
      this.recordAllocation(
        "grading-intermediates",
        width * height * 8 * 3 + (spatialActive ? spatialWidth * spatialHeight * 8 * 2 : 0),
        { width, height, spatialWidth: spatialActive ? spatialWidth : 0, spatialHeight: spatialActive ? spatialHeight : 0 },
      );
      return intermediate;
    }

    ensureStorageBuffers(paramBytes, curveBytes) {
      if (!this.paramBuffer) {
        this.paramBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(paramBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      if (!this.curveBuffer) {
        this.curveBuffer = this.device.createBuffer({
          size: Math.max(16, Math.ceil(curveBytes / 4) * 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
    }

    trimProxyLevels(sessionId, lane) {
      const prefix = `${sessionId}:${lane}:`;
      const keys = [...this.proxies.keys()].filter((key) => key.startsWith(prefix));
      while (keys.length > 2) {
        const key = keys.shift();
        this.proxies.get(key)?.texture?.destroy();
        this.proxies.delete(key);
      }
    }

    createStorageBuffer(values) {
      const size = Math.max(16, Math.ceil(values.byteLength / 4) * 4);
      return this.device.createBuffer({
        size,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    async loadProxy(sessionId, lane, longEdge, geometrySignature = "{}", editRevision = 0) {
      const key = `${sessionId}:${lane}:${longEdge}:${geometrySignature}`;
      if (this.proxies.has(key)) {
        this.recordStage("proxy-request", { lane, longEdge, cacheHit: true });
        return this.proxies.get(key);
      }
      if (this.proxyInflight.has(key)) return this.proxyInflight.get(key);
      const pending = (async () => {
        const startedAt = performance.now();
        const response = await fetch(`/api/session/${sessionId}/proxy/${lane}?long_edge=${longEdge}&format=rgba16f&edit_revision=${editRevision}&geometry_signature=${encodeURIComponent(geometrySignature)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(payload?.detail || (response.status === 409
            ? "WebGPU geometry proxy is waiting for the committed edit"
            : "WebGPU proxy could not be loaded"));
          error.recoverable = response.status === 409 || response.status === 507;
          error.previewCapacity = response.status === 507;
          error.status = response.status;
          throw error;
        }
        const width = Number(response.headers.get("X-Image-Width"));
        const height = Number(response.headers.get("X-Image-Height"));
        const bytesPerRow = Number(response.headers.get("X-Bytes-Per-Row"));
        const workingSpace = response.headers.get("X-Working-Space") || "acescg";
        const pixelFormat = response.headers.get("X-Pixel-Format") || "rgba32float";
        const acceptedGeometry = response.headers.get("X-Geometry-Signature") || "{}";
        const data = await response.arrayBuffer();
        if (acceptedGeometry !== geometrySignature) {
          const error = new Error("Stale WebGPU geometry proxy rejected");
          error.recoverable = true;
          throw error;
        }
        const texture = this.device.createTexture({
          size: { width, height },
          format: pixelFormat,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        this.device.queue.writeTexture(
          { texture },
          data,
          { offset: 0, bytesPerRow, rowsPerImage: height },
          { width, height },
        );
        const byteSize = width * height * (pixelFormat === "rgba16float" ? 8 : 16);
        const proxy = {
          texture,
          width,
          height,
          sessionId,
          lane,
          longEdge,
          workingSpace,
          pixelFormat,
          geometrySignature,
          identity: key,
          byteSize,
          bindGroups: new Map(),
        };
        this.proxies.set(key, proxy);
        this.recordAllocation("source-proxy", byteSize, { width, height, lane, longEdge, pixelFormat });
        this.recordStage("proxy-request", {
          lane,
          longEdge,
          cacheHit: false,
          durationMs: performance.now() - startedAt,
          bytes: data.byteLength,
        });
        this.trimProxyLevels(sessionId, lane);
        return proxy;
      })();
      this.proxyInflight.set(key, pending);
      try {
        return await pending;
      } finally {
        this.proxyInflight.delete(key);
      }
    }

    async loadLocalMask(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      if (local.mask?.operator !== "leaf") {
        return this.loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent);
      }
      return this.loadMaskLeaf(sessionId, local, local.mask, "", longEdge, editRevision, geometrySignature, isCurrent);
    }

    async loadMaskLeaf(sessionId, local, expression, maskPath, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const leafLocal = { ...local, id: maskPath ? `${local.id}:${maskPath}` : local.id, mask: expression };
      if (isGpuLumaMask(expression)) return this.loadGpuLumaMask(sessionId, leafLocal, longEdge, editRevision, geometrySignature, isCurrent);
      const maskSignature = gpuMaskIdentity(expression);
      const key = `${sessionId}:${longEdge}:${geometrySignature}:cpu-spatial-leaf:${maskSignature}`;
      const cached = this.localMasks.get(key);
      if (cached) {
        this.localMasks.delete(key);
        this.localMasks.set(key, cached);
        return cached;
      }
      const pathQuery = maskPath ? `&mask_path=${encodeURIComponent(maskPath)}` : "";
      const startedAt = performance.now();
      const response = await fetch(`/api/session/${sessionId}/local-mask/${encodeURIComponent(local.id)}?long_edge=${longEdge}&edit_revision=${editRevision}&spatial_only=true${pathQuery}`);
      if (!response.ok) return null;
      const width = Number(response.headers.get("X-Image-Width"));
      const height = Number(response.headers.get("X-Image-Height"));
      const source = new Uint8Array(await response.arrayBuffer());
      if (!isCurrent()) return null;
      const bytesPerRow = Math.ceil(width / 256) * 256;
      const padded = bytesPerRow === width ? source : new Uint8Array(bytesPerRow * height);
      if (padded !== source) {
        for (let row = 0; row < height; row += 1) padded.set(source.subarray(row * width, (row + 1) * width), row * bytesPerRow);
      }
      const texture = this.device.createTexture({
        size: { width, height },
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.device.queue.writeTexture(
        { texture },
        padded,
        { bytesPerRow, rowsPerImage: height },
        { width, height },
      );
      const entry = { kind: "cpu-spatial-leaf", texture, width, height, byteSize: width * height };
      this.localMasks.set(key, entry);
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({
          kind: "cpu-spatial-leaf",
          maskPath: maskPath || "root",
          longEdge,
          width,
          height,
          cpuMaskMs: Number(response.headers.get("X-CPU-Mask-Ms")) || null,
          requestMs: performance.now() - startedAt,
          cpuMaskRequest: true,
        });
      }
      return entry;
    }

    async loadGpuMaskGraph(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const startedAt = performance.now();
      const layoutIdentity = gpuMaskGraphLayoutIdentity(local.mask);
      const key = `${sessionId}:${local.id}:${longEdge}:${geometrySignature}:gpu-mask-graph:${layoutIdentity}`;
      let entry = this.localMasks.get(key);
      const influenceIdentity = JSON.stringify(local.mask);
      if (entry?.influenceIdentity === influenceIdentity) {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
        return entry;
      }

      const resolveNode = async (expression, path) => {
        if (expression.operator === "leaf") {
          const leafEntry = await this.loadMaskLeaf(sessionId, local, expression, path, longEdge, editRevision, geometrySignature, isCurrent);
          return leafEntry ? { expression, leafEntry, children: [] } : null;
        }
        const children = await Promise.all(expression.children.map((child, index) =>
          resolveNode(child, path ? `${path}.${index}` : String(index))));
        return children.some((child) => !child) ? null : { expression, children };
      };
      const resolved = await resolveNode(local.mask, "");
      if (!resolved || !isCurrent()) return null;

      const firstLeaf = firstResolvedMaskLeaf(resolved);
      const passCount = gpuMaskGraphPassCount(local.mask);
      if (!entry || entry.width !== firstLeaf.width || entry.height !== firstLeaf.height || entry.nodeTextures.length !== passCount) {
        if (entry) this.destroyLocalMaskEntry(entry);
        const nodeTextures = Array.from({ length: passCount }, () => this.createMaskTexture(firstLeaf.width, firstLeaf.height));
        entry = {
          kind: "gpu-mask-graph",
          texture: nodeTextures.at(-1),
          nodeTextures,
          width: firstLeaf.width,
          height: firstLeaf.height,
          byteSize: firstLeaf.width * firstLeaf.height * 2 * passCount,
          influenceIdentity: null,
        };
      }

      const encoder = this.device.createCommandEncoder();
      const parameterBuffers = [];
      let textureIndex = 0;
      const encodeNode = (node) => {
        if (node.expression.operator === "leaf") {
          return {
            texture: node.leafEntry.texture,
            opacity: Math.min(1, Math.max(0, Number(node.expression.leaf?.mask_opacity ?? 1))),
          };
        }
        let result = encodeNode(node.children[0]);
        for (let childIndex = 1; childIndex < node.children.length; childIndex += 1) {
          const right = encodeNode(node.children[childIndex]);
          const target = entry.nodeTextures[textureIndex++];
          const finalChild = childIndex === node.children.length - 1;
          const values = new Float32Array([
            gpuMaskOperatorCode(node.expression.operator),
            result.opacity,
            right.opacity,
            finalChild && node.expression.inverted ? 1 : 0,
          ]);
          const parameterBuffer = this.createStorageBuffer(values);
          parameterBuffers.push(parameterBuffer);
          this.device.queue.writeBuffer(parameterBuffer, 0, values);
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.combine,
            this.createMaskBindGroup(result.texture, parameterBuffer, right.texture),
            target,
          );
          result = { texture: target, opacity: 1 };
        }
        return result;
      };
      const result = encodeNode(resolved);
      entry.texture = result.texture;
      entry.influenceIdentity = influenceIdentity;
      this.device.queue.submit([encoder.finish()]);
      parameterBuffers.forEach((buffer) => buffer.destroy());
      this.localMasks.set(key, entry);
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push({
          kind: "gpu-mask-graph",
          longEdge,
          width: entry.width,
          height: entry.height,
          passCount,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        });
      }
      return entry;
    }

    async loadSceneLuminance(sessionId, longEdge, editRevision, geometrySignature) {
      const key = `${sessionId}:${longEdge}:${geometrySignature}`;
      const cached = this.sceneLuminance.get(key);
      if (cached) return { ...cached, created: false };
      if (this.sceneLuminanceInflight.has(key)) return this.sceneLuminanceInflight.get(key);
      const pending = (async () => {
        const source = await this.loadProxy(sessionId, "hdr", longEdge, geometrySignature, editRevision);
        const texture = this.createMaskTexture(source.width, source.height);
        const params = this.createStorageBuffer(new Float32Array(4));
        this.device.queue.writeBuffer(params, 0, new Float32Array(4));
        const bindGroup = this.createMaskBindGroup(source.texture, params);
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(encoder, this.maskPipelines.sceneLuminance, bindGroup, texture);
        this.device.queue.submit([encoder.finish()]);
        params.destroy();
        const entry = {
          texture,
          width: source.width,
          height: source.height,
          byteSize: source.width * source.height * 2,
        };
        this.sceneLuminance.set(key, entry);
        const prefix = `${sessionId}:`;
        const keys = [...this.sceneLuminance.keys()].filter((candidate) => candidate.startsWith(prefix));
        while (keys.length > 2) {
          const staleKey = keys.shift();
          this.sceneLuminance.get(staleKey)?.texture?.destroy();
          this.sceneLuminance.delete(staleKey);
        }
        return { ...entry, created: true };
      })();
      this.sceneLuminanceInflight.set(key, pending);
      try {
        return await pending;
      } finally {
        this.sceneLuminanceInflight.delete(key);
      }
    }

    async loadGpuLumaMask(sessionId, local, longEdge, editRevision, geometrySignature, isCurrent = () => true) {
      const startedAt = performance.now();
      const scene = await this.loadSceneLuminance(sessionId, longEdge, editRevision, geometrySignature);
      if (!isCurrent()) return null;
      const baseSignature = gpuLumaBaseIdentity(local.mask);
      const key = `${sessionId}:${longEdge}:${geometrySignature}:gpu-luma:${baseSignature}`;
      let entry = this.localMasks.get(key);
      let baseRegenerated = false;
      if (!entry) {
        const baseTexture = this.createMaskTexture(scene.width, scene.height);
        const qualifyValues = buildGpuLumaQualificationParams(local.mask);
        const qualifyBuffer = this.createStorageBuffer(qualifyValues);
        this.device.queue.writeBuffer(qualifyBuffer, 0, qualifyValues);
        entry = {
          kind: "gpu-luma",
          texture: baseTexture,
          baseTexture,
          horizontalTexture: null,
          refinedTexture: null,
          qualifyBuffer,
          horizontalBuffer: null,
          verticalBuffer: null,
          width: scene.width,
          height: scene.height,
          byteSize: scene.width * scene.height * 2 + 16,
          refinementIdentity: null,
        };
        const encoder = this.device.createCommandEncoder();
        this.encodeMaskPass(
          encoder,
          this.maskPipelines.qualify,
          this.createMaskBindGroup(scene.texture, qualifyBuffer),
          baseTexture,
        );
        this.device.queue.submit([encoder.finish()]);
        this.localMasks.set(key, entry);
        baseRegenerated = true;
      } else {
        this.localMasks.delete(key);
        this.localMasks.set(key, entry);
      }

      const leaf = local.mask.leaf;
      const feather = Math.min(0.05, Math.max(0, Number(leaf.mask_feather) || 0));
      const inverted = Boolean(local.mask.inverted);
      const refinementIdentity = `${feather}:${inverted}`;
      let refinementRan = false;
      if (entry.refinementIdentity !== refinementIdentity) {
        const amount = feather / 0.05;
        const sigmaX = 0.09 * amount * entry.width;
        const sigmaY = 0.09 * amount * entry.height;
        if (Math.max(sigmaX, sigmaY) < 0.25 && !inverted) {
          entry.texture = entry.baseTexture;
        } else {
          if (!entry.horizontalTexture) {
            entry.horizontalTexture = this.createMaskTexture(entry.width, entry.height);
            entry.refinedTexture = this.createMaskTexture(entry.width, entry.height);
            entry.horizontalBuffer = this.createStorageBuffer(new Float32Array(4));
            entry.verticalBuffer = this.createStorageBuffer(new Float32Array(4));
            entry.byteSize += entry.width * entry.height * 2 * 2 + 32;
          }
          const horizontalValues = new Float32Array([sigmaX, sigmaY, 0, 0]);
          const verticalValues = new Float32Array([sigmaX, sigmaY, 1, inverted ? 1 : 0]);
          this.device.queue.writeBuffer(entry.horizontalBuffer, 0, horizontalValues);
          this.device.queue.writeBuffer(entry.verticalBuffer, 0, verticalValues);
          const encoder = this.device.createCommandEncoder();
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.refine,
            this.createMaskBindGroup(entry.baseTexture, entry.horizontalBuffer),
            entry.horizontalTexture,
          );
          this.encodeMaskPass(
            encoder,
            this.maskPipelines.refine,
            this.createMaskBindGroup(entry.horizontalTexture, entry.verticalBuffer),
            entry.refinedTexture,
          );
          this.device.queue.submit([encoder.finish()]);
          entry.texture = entry.refinedTexture;
          refinementRan = true;
        }
        entry.refinementIdentity = refinementIdentity;
      }
      this.trimLocalMaskCache(longEdge > 1600 ? 160 * 1024 * 1024 : 96 * 1024 * 1024);
      if (this.instrumentationEnabled) {
        const event = {
          kind: "gpu-luma",
          longEdge,
          width: entry.width,
          height: entry.height,
          sceneLuminanceCreated: scene.created,
          baseRegenerated,
          refinementRan,
          feather,
          encodeSubmitMs: performance.now() - startedAt,
          cpuMaskRequest: false,
        };
        this.performanceMetrics.maskEvents ||= [];
        this.performanceMetrics.maskEvents.push(event);
        if (this.performanceMetrics.maskEvents.length > 480) this.performanceMetrics.maskEvents.shift();
      }
      return entry;
    }

    createMaskTexture(width, height) {
      return this.device.createTexture({
        size: { width, height },
        format: "r16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    createMaskBindGroup(texture, parameterBuffer, operandTexture = texture) {
      return this.device.createBindGroup({
        layout: this.maskBindGroupLayout,
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: { buffer: parameterBuffer } },
          { binding: 2, resource: operandTexture.createView() },
        ],
      });
    }

    encodeMaskPass(encoder, pipeline, bindGroup, targetTexture) {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: targetTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
    }

    trimLocalMaskCache(budget) {
      let total = [...this.localMasks.values()].reduce((sum, entry) => sum + entry.byteSize, 0);
      while (this.localMasks.size && total > budget) {
        const [key, entry] = this.localMasks.entries().next().value;
        this.destroyLocalMaskEntry(entry);
        this.localMasks.delete(key);
        total -= entry.byteSize;
      }
    }

    destroyLocalMaskEntry(entry) {
      const textures = new Set([
        entry.texture,
        entry.baseTexture,
        entry.horizontalTexture,
        entry.refinedTexture,
        ...(entry.nodeTextures || []),
      ].filter(Boolean));
      textures.forEach((texture) => texture.destroy());
      entry.qualifyBuffer?.destroy();
      entry.horizontalBuffer?.destroy();
      entry.verticalBuffer?.destroy();
    }

    localParamBuffer(local, lane) {
      const key = `${local.id}:${lane}`;
      let buffer = this.localParamBuffers.get(key);
      const values = buildLocalParams(local, lane);
      if (!buffer) {
        buffer = this.createStorageBuffer(values);
        this.localParamBuffers.set(key, buffer);
      }
      const previous = this.localParamValues.get(key);
      if (!previous || !floatArraysEqual(previous, values)) {
        this.device.queue.writeBuffer(buffer, 0, values);
        this.localParamValues.set(key, values);
      }
      return buffer;
    }
  }

  function halfToFloat(value) {
    const sign = (value & 0x8000) ? -1 : 1;
    const exponent = (value >> 10) & 0x1f;
    const fraction = value & 0x03ff;
    if (exponent === 0) return sign * fraction * 5.960464477539063e-8;
    if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
    return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
  }

  function floatArraysEqual(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  const IDENTITY_3X3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ACESCG_PRIMARIES = [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]];
  const ACESCG_WHITE = [0.32168, 0.33767];

  function multiply3x3(left, right) {
    const output = new Array(9).fill(0);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        for (let inner = 0; inner < 3; inner += 1) output[row * 3 + column] += left[row * 3 + inner] * right[inner * 3 + column];
      }
    }
    return output;
  }

  function invert3x3(matrix) {
    const [a, b, c, d, e, f, g, h, i] = matrix;
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) return null;
    return [
      e * i - f * h, c * h - b * i, b * f - c * e,
      f * g - d * i, a * i - c * g, c * d - a * f,
      d * h - e * g, b * g - a * h, a * e - b * d,
    ].map((value) => value / determinant);
  }

  function rgbToXyzMatrix(primaries, white) {
    const unscaled = [
      primaries[0][0] / primaries[0][1], primaries[1][0] / primaries[1][1], primaries[2][0] / primaries[2][1],
      1, 1, 1,
      (1 - primaries[0][0] - primaries[0][1]) / primaries[0][1],
      (1 - primaries[1][0] - primaries[1][1]) / primaries[1][1],
      (1 - primaries[2][0] - primaries[2][1]) / primaries[2][1],
    ];
    const inverse = invert3x3(unscaled);
    if (!inverse) return null;
    const whiteXyz = [white[0] / white[1], 1, (1 - white[0] - white[1]) / white[1]];
    const scales = [0, 1, 2].map((row) => inverse[row * 3] * whiteXyz[0] + inverse[row * 3 + 1] * whiteXyz[1] + inverse[row * 3 + 2] * whiteXyz[2]);
    return unscaled.map((value, index) => value * scales[index % 3]);
  }

  function rayTriangleDistance(origin, direction, triangle) {
    let nearest = Infinity;
    for (let index = 0; index < 3; index += 1) {
      const start = triangle[index];
      const end = triangle[(index + 1) % 3];
      const edge = [end[0] - start[0], end[1] - start[1]];
      const determinant = direction[1] * edge[0] - direction[0] * edge[1];
      if (Math.abs(determinant) < 1e-12) continue;
      const delta = [start[0] - origin[0], start[1] - origin[1]];
      const distance = (edge[0] * delta[1] - edge[1] * delta[0]) / determinant;
      const edgePosition = (direction[0] * delta[1] - direction[1] * delta[0]) / determinant;
      if (distance >= -1e-9 && edgePosition >= -1e-9 && edgePosition <= 1 + 1e-9) nearest = Math.min(nearest, Math.max(0, distance));
    }
    return Number.isFinite(nearest) ? nearest : Math.hypot(triangle[0][0] - origin[0], triangle[0][1] - origin[1]);
  }

  function rotateScalePrimary(reference, hueDegrees, purityScale) {
    const baseAngle = Math.atan2(reference[1] - ACESCG_WHITE[1], reference[0] - ACESCG_WHITE[0]);
    const angle = baseAngle + hueDegrees * Math.PI / 180;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const distance = rayTriangleDistance(ACESCG_WHITE, direction, ACESCG_PRIMARIES);
    return [ACESCG_WHITE[0] + direction[0] * distance * purityScale, ACESCG_WHITE[1] + direction[1] * distance * purityScale];
  }

  function rgbPrimariesAdjustmentMatrix(branch) {
    const customPrimaries = ACESCG_PRIMARIES.map((primary, index) => {
      const channel = ["red", "green", "blue"][index];
      const hue = Number(branch?.[`${channel}_hue`]) || 0;
      const purity = Math.max(0.01, 1 + (Number(branch?.[`${channel}_purity`]) || 0) / 100);
      return rotateScalePrimary(primary, hue, purity);
    });
    const tintHue = Number(branch?.tint_hue) || 0;
    const tintPurity = Math.min(0.99, Math.max(0, (Number(branch?.tint_purity) || 0) / 100));
    const customWhite = rotateScalePrimary(ACESCG_PRIMARIES[0], tintHue, tintPurity);
    const base = rgbToXyzMatrix(ACESCG_PRIMARIES, ACESCG_WHITE);
    const custom = rgbToXyzMatrix(customPrimaries, customWhite);
    const inverseBase = base && invert3x3(base);
    if (!custom || !inverseBase) return IDENTITY_3X3;
    const adjustment = multiply3x3(inverseBase, custom);
    return adjustment.every((value) => Number.isFinite(value) && Math.abs(value) <= 64) ? adjustment : IDENTITY_3X3;
  }

  function colorSettingsNeutral(branch) {
    if ((Number(branch?.white_balance_kelvin) || 6500) !== 6500) return false;
    return [
      "tint", "saturation", "vibrance",
      "red_hue", "red_purity", "green_hue", "green_purity",
      "blue_hue", "blue_purity", "tint_hue", "tint_purity",
    ].every((name) => Math.abs(Number(branch?.[name]) || 0) < 0.000001);
  }

  function curveSetNeutral(branch) {
    return ["luma_curve", "red_curve", "green_curve", "blue_curve"].every((name) => {
      const points = branch?.[name];
      return Array.isArray(points) && points.length >= 2
        && points.every((point) => Array.isArray(point) && Math.abs(Number(point[0]) - Number(point[1])) < 0.000001);
    });
  }

  function toneEqualizerNeutral(branch) {
    const nodes = branch?.tone_equalizer_nodes;
    return !Array.isArray(nodes) || nodes.every((node) => Math.abs(Number(node?.adjustment_ev) || 0) < 0.000001);
  }

  function toneAdjustedHighlightPeakLinear(branch, toneEnabled, referenceWhiteNits) {
    let peak = Math.max(1, Number(branch.highlight_compression_source_peak_nits) || 1000) * 0.18 / referenceWhiteNits;
    if (!toneEnabled) return peak;
    peak *= Math.pow(2, Number(branch.exposure) || 0);
    const shadowLift = Number(branch.shadow_lift) || 0;
    if (shadowLift !== 0) {
      const liftFactor = Math.min(1, shadowLift * (1 - Math.min(1, Math.max(0, peak))));
      peak *= 1 + liftFactor;
    }
    const contrast = Number(branch.contrast) || 0;
    if (contrast !== 0 && peak > 0.00000001) {
      const pivot = Math.max(Number(branch.contrast_pivot) || 0.1845, 0.000001);
      const stops = Math.log2(Math.max(peak, 0.00000001) / pivot);
      peak = pivot * Math.pow(2, Math.min(32, Math.max(-32, stops * Math.pow(2, contrast))));
    }
    return Math.max(0.0018, peak);
  }

  function buildParams(lane, adjustments, workingSpace, hdrSurface, referenceWhiteNits = 203) {
    const params = new Float32Array(PARAM_COUNT);
    const projectReferenceWhite = Number(referenceWhiteNits) === 100 ? 100 : 203;
    const branch = adjustments[lane];
    const colorSource = branch;
    params[0] = lane === "hdr" ? 1 : 0;
    params[1] = workingSpace === "linear-srgb" ? 1 : 0;
    const toneEnabled = branch.tone_section_enabled !== false;
    const highlightEnabled = lane === "hdr" && branch.highlight_section_enabled !== false;
    const primariesEnabled = branch.primaries_section_enabled !== false;
    const colorEnabled = branch.color_section_enabled !== false;
    const colorActive = colorEnabled && !colorSettingsNeutral(colorSource);
    const baseEnabled = lane !== "sdr" || branch.base_section_enabled !== false;
    params[2] = toneEnabled ? branch.exposure || 0 : 0;
    params[3] = lane === "hdr"
      ? (highlightEnabled ? branch.highlight_compression_softness || 0 : 0)
      : (toneEnabled ? branch.highlight_recovery || 0 : 0);
    params[4] = toneEnabled ? (lane === "hdr" ? branch.shadow_lift || 0 : branch.shadow || 0) : 0;
    params[5] = primariesEnabled ? branch.lift || 0 : 0;
    params[6] = primariesEnabled ? branch.gamma || 0 : 0;
    params[7] = primariesEnabled ? branch.gain || 0 : 0;
    params[8] = toneEnabled ? branch.contrast || 0 : 0;
    params[9] = branch.contrast_pivot || (lane === "hdr" ? 0.1845 : 0.5);
    params[10] = colorActive ? colorSource.white_balance_kelvin || 6500 : 6500;
    params[11] = colorActive ? colorSource.tint || 0 : 0;
    params[12] = baseEnabled ? (branch.tone_mapper === "aces" ? 1 : branch.tone_mapper === "reinhard" ? 2 : 0) : 0;
    params[13] = baseEnabled ? branch.tone_contrast ?? 1 : 1;
    params[14] = baseEnabled ? branch.tone_skew || 0 : 0;
    params[15] = branch.curves_section_enabled !== false && !curveSetNeutral(branch) ? 1 : 0;
    params[16] = hdrSurface ? 1 : 0;
    // The transport limit is absolute; scene-linear scale follows the project.
    params[17] = 10000 * 0.18 / projectReferenceWhite;
    params[18] = branch.tone_equalizer_section_enabled !== false && !toneEqualizerNeutral(branch) ? 1 : 0;
    params[19] = Math.min(1, Math.max(0, branch.tone_equalizer_smoothing ?? 0.5));
    const toneNodes = normalizedToneEqualizerNodes(branch.tone_equalizer_nodes);
    params[20] = toneNodes.length;
    toneNodes.forEach((node, index) => {
      params[21 + index] = node.input_ev;
      params[37 + index] = node.adjustment_ev;
    });
    params[53] = lane === "hdr" ? ((branch.highlight_compression_start_nits ?? 400) * 0.18 / projectReferenceWhite) : 0;
    params[54] = branch.lift_pivot ?? -2;
    params[55] = branch.lift_range ?? 4;
    params[56] = branch.gamma_pivot ?? 0;
    params[57] = branch.gamma_range ?? 4.25;
    params[58] = branch.gain_pivot ?? 2;
    params[59] = branch.gain_range ?? 4;
    params[60] = baseEnabled ? 1 : 0;
    const colorMatrix = colorActive ? rgbPrimariesAdjustmentMatrix(colorSource) : IDENTITY_3X3;
    colorMatrix.forEach((value, index) => { params[61 + index] = value; });
    params[70] = colorActive ? colorSource.saturation || 0 : 0;
    params[71] = colorActive ? colorSource.vibrance || 0 : 0;
    params[72] = colorActive ? 1 : 0;
    params[73] = lane === "hdr" ? ((branch.highlight_compression_target_nits ?? 1000) * 0.18 / projectReferenceWhite) : 0;
    params[74] = highlightEnabled ? (branch.highlight_compression_mode === "peak_fit" ? 1 : branch.highlight_compression_mode === "soft_ceiling" ? 2 : 0) : 0;
    params[75] = lane === "hdr" ? toneAdjustedHighlightPeakLinear(branch, toneEnabled, projectReferenceWhite) : 0;
    params[138] = projectReferenceWhite;
    params[139] = 203;
    params[76] = lane === "hdr" ? Math.min(1, Math.max(0, (branch.highlight_compression_peak_detail ?? 35) / 100)) : 0;
    params[77] = lane === "hdr" ? Math.min(1, Math.max(-1, (branch.highlight_compression_bias ?? 0) / 100)) * 0.6 : 0;
    const film = branch.film_look || {};
    const filmEnabled = branch.film_look_section_enabled !== false;
    params[78] = filmEnabled ? 1 : 0;
    params[79] = filmEnabled ? (film.look_strength ?? 100) / 100 : 0;
    params[80] = (film.print_strength || 0) / 100;
    params[81] = (film.print_contrast || 0) / 100;
    params[82] = (film.print_toe || 0) / 100;
    params[83] = (film.print_shoulder || 0) / 100;
    params[84] = (film.color_density || 0) / 100;
    params[85] = film.halation_enabled !== false && ((film.halation_amount || 0) > 0 || film.halation_view_map) ? 1 : 0;
    params[86] = (film.halation_amount || 0) / 100;
    params[87] = (film.halation_sensitivity ?? 75) / 100;
    params[88] = film.halation_radius ?? 0.2;
    params[89] = (film.halation_hue_offset || 0) / 100;
    params[90] = (film.halation_saturation ?? 75) / 100;
    params[91] = film.halation_view_map ? 1 : 0;
    params[92] = film.bloom_enabled !== false ? 1 : 0;
    params[93] = (film.bloom_amount || 0) / 100;
    params[94] = (film.bloom_sensitivity ?? 80) / 100;
    params[95] = film.bloom_radius ?? 0.5;
    params[96] = (film.bloom_highlight_detail ?? 75) / 100;
    params[97] = film.image_structure_enabled !== false ? 1 : 0;
    params[98] = (film.image_softness || 0) / 100;
    params[99] = (film.microcontrast || 0) / 100;
    params[100] = film.grain_enabled !== false ? 1 : 0;
    params[101] = (film.grain_amount || 0) / 100;
    params[102] = (film.grain_size ?? 50) / 100;
    params[103] = (film.grain_softness ?? 25) / 100;
    params[104] = (film.grain_chroma || 0) / 100;
    params[105] = (film.grain_shadow_response ?? 100) / 100;
    params[106] = (film.grain_midtone_response ?? 100) / 100;
    params[107] = (film.grain_highlight_response ?? 100) / 100;
    params[108] = (film.film_resolution ?? 100) / 100;
    params[109] = adjustments.shared?.film_grain_seed ?? 271828;
    const grainGates = {
      "65mm": [52.63, 23.01],
      "35mm": [36, 24],
      super35: [24.89, 18.66],
      super16: [12.52, 7.41],
      "16mm": [10.26, 7.49],
      super8: [5.79, 4.01],
    };
    const gate = film.grain_film_format === "custom"
      ? [Math.min(500, Math.max(1, Number(film.grain_custom_width_mm) || 36)), Math.min(500, Math.max(1, Number(film.grain_custom_height_mm) || 24))]
      : (grainGates[film.grain_film_format] || grainGates["35mm"]);
    params[140] = gate[0];
    params[141] = gate[1];
    params[142] = film.grain_capture_geometry === "horizontal_strip" ? 1
      : film.grain_capture_geometry === "vertical_strip" ? 2 : 0;
    params[110] = lane === "hdr" && branch.highlight_compression_color_handling === "path_to_white" ? 1 : 0;
    const grading = branch.color_grading || {};
    params[111] = branch.color_grading_section_enabled !== false ? 1 : 0;
    params[112] = 0.55 + 3.45 * (grading.blending ?? 50) / 100;
    params[113] = (grading.balance || 0) / 50;
    [grading.shadows || {}, grading.midtones || {}, grading.highlights || {}].forEach((wheel, index) => {
      params[114 + index * 3] = wheel.hue || 0;
      params[115 + index * 3] = (wheel.saturation || 0) / 400;
      params[116 + index * 3] = wheel.luminance_ev || 0;
    });
    const vignette = branch.vignette || {};
    params[123] = branch.vignette_section_enabled !== false ? 1 : 0;
    params[124] = 2 * (vignette.amount || 0) / 100;
    params[125] = 0.15 + 0.70 * (vignette.midpoint ?? 50) / 100;
    const roundness = (vignette.roundness || 0) / 100;
    params[126] = roundness >= 0 ? 2 + 6 * roundness : 2 + roundness;
    params[127] = 0.02 + 0.98 * (vignette.feather ?? 75) / 100;
    params[128] = (vignette.highlight_protection || 0) / 100;
    params[129] = vignette.center_x ?? 0.5;
    params[130] = vignette.center_y ?? 0.5;
    return params;
  }

  function normalizedToneEqualizerNodes(values) {
    const source = Array.isArray(values) && values.length >= 2
      ? values.slice(0, 16)
      : [-6, -3, 0, 3, 6].map((inputEv) => ({ input_ev: inputEv, adjustment_ev: 0 }));
    const nodes = source.map((node) => ({
      input_ev: Math.min(6, Math.max(-6, Number(node?.input_ev) || 0)),
      adjustment_ev: Math.min(2, Math.max(-2, Number(node?.adjustment_ev) || 0)),
    })).sort((left, right) => left.input_ev - right.input_ev);
    nodes[0].input_ev = -6;
    nodes[nodes.length - 1].input_ev = 6;
    const targets = nodes.map((node) => node.input_ev + node.adjustment_ev);
    for (let index = 1; index < targets.length; index += 1) {
      targets[index] = Math.max(targets[index], targets[index - 1] + 0.001);
    }
    nodes.forEach((node, index) => { node.adjustment_ev = Math.min(2, Math.max(-2, targets[index] - node.input_ev)); });
    return nodes;
  }

  function buildCurves(lane, adjustments, curveSampler, sampleCache) {
    const branch = adjustments[lane];
    const names = ["luma_curve", "red_curve", "green_curve", "blue_curve"];
    const signatures = names.map((name) => JSON.stringify(branch[name]));
    const packedKey = `${lane}:packed`;
    const packedSignature = signatures.join("|");
    const packedCached = sampleCache.get(packedKey);
    if (packedCached?.signature === packedSignature) return packedCached.samples;
    const packed = new Float32Array(CURVE_SAMPLES * 4);
    names.forEach((name, channel) => {
      const signature = signatures[channel];
      const cacheKey = `${lane}:${name}`;
      let cached = sampleCache.get(cacheKey);
      if (!cached || cached.signature !== signature) {
        cached = { signature, samples: curveSampler(branch[name], CURVE_SAMPLES) };
        sampleCache.set(cacheKey, cached);
      }
      const samples = cached.samples;
      for (let index = 0; index < CURVE_SAMPLES; index += 1) {
        const sample = samples[index];
        packed[channel * CURVE_SAMPLES + index] = Array.isArray(sample) ? sample[1] : sample;
      }
    });
    sampleCache.set(packedKey, { signature: packedSignature, samples: packed });
    return packed;
  }

  function gpuLocalSupported(grade) {
    if (!grade || !curveSetNeutral(grade)) return false;
    const grading = grade.color_grading || {};
    if (Math.abs(Number(grading.balance) || 0) > 0.000001 || Math.abs((Number(grading.blending) || 50) - 50) > 0.000001) return false;
    return [grading.shadows, grading.midtones, grading.highlights].every((wheel) =>
      !wheel || [wheel.hue, wheel.saturation, wheel.luminance_ev].every((value) => Math.abs(Number(value) || 0) < 0.000001));
  }

  function buildLocalParams(local, lane) {
    const grade = local[`${lane}_grade`];
    const values = new Float32Array(16);
    values[0] = lane === "hdr" ? 1 : 0;
    values[1] = Number(local.opacity) || 0;
    values[2] = Number(grade.exposure) || 0;
    values[3] = Number(grade.highlights) || 0;
    values[4] = Number(grade.midtones) || 0;
    values[5] = Number(grade.shadows) || 0;
    values[6] = Number(grade.blacks) || 0;
    values[7] = Number(grade.contrast) || 0;
    values[8] = Math.max(0.001, Number(grade.contrast_pivot) || 0.18);
    values[9] = Number(grade.white_balance_kelvin) || 6500;
    values[10] = Number(grade.tint) || 0;
    values[11] = Number(grade.saturation) || 0;
    values[12] = Number(grade.vibrance) || 0;
    values[13] = gpuMaskInfluenceOpacity(local.mask);
    return values;
  }

  function gpuMaskInfluenceOpacity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return 1;
    return Math.min(1, Math.max(0, Number(expression.leaf.mask_opacity ?? 1)));
  }

  function gpuMaskIdentity(expression) {
    if (expression?.operator !== "leaf" || !expression.leaf) return JSON.stringify(expression);
    return JSON.stringify({
      ...expression,
      leaf: { ...expression.leaf, mask_opacity: 1 },
    });
  }

  function isGpuLumaMask(expression) {
    return expression?.operator === "leaf"
      && expression.leaf?.type === "luminance_range"
      && (!expression.children || expression.children.length === 0);
  }

  function gpuLumaBaseIdentity(expression) {
    if (!isGpuLumaMask(expression)) return JSON.stringify(expression);
    return JSON.stringify({
      ...expression,
      inverted: false,
      leaf: {
        ...expression.leaf,
        mask_feather: 0,
        mask_opacity: 1,
      },
    });
  }

  function buildGpuLumaQualificationParams(expression) {
    const leaf = expression.leaf;
    return new Float32Array([
      Number(leaf.fade_in_start_ev),
      Number(leaf.full_start_ev),
      Number(leaf.full_end_ev),
      Number(leaf.fade_out_end_ev),
    ]);
  }

  function gpuMaskGraphLayoutIdentity(expression) {
    if (expression?.operator === "leaf") return `leaf:${expression.leaf?.type || "unknown"}`;
    return `node(${(expression?.children || []).map(gpuMaskGraphLayoutIdentity).join(",")})`;
  }

  function gpuMaskGraphPassCount(expression) {
    if (expression?.operator === "leaf") return 0;
    return Math.max(0, (expression?.children || []).length - 1)
      + (expression?.children || []).reduce((total, child) => total + gpuMaskGraphPassCount(child), 0);
  }

  function firstResolvedMaskLeaf(node) {
    if (node.leafEntry) return node.leafEntry;
    for (const child of node.children || []) {
      const leaf = firstResolvedMaskLeaf(child);
      if (leaf) return leaf;
    }
    return null;
  }

  function gpuMaskOperatorCode(operator) {
    if (operator === "intersect") return 1;
    if (operator === "subtract") return 2;
    return 0;
  }

  window.HDRWebGPUPreview = HDRWebGPUPreview;

  const SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var<storage, read> curveLuts: array<f32>;
    @group(0) @binding(3) var spatialTexture: texture_2d<f32>;
    @group(0) @binding(4) var spatialSampler: sampler;
    @group(0) @binding(5) var overlayMaskTexture: texture_2d<f32>;

    struct VertexOut { @builtin(position) position: vec4f }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      return output;
    }

    fn lumaAces(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2722287, 0.6740818, 0.0536895)); }
    fn lumaSrgb(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
    fn smoothRange(a: f32, b: f32, v: f32) -> f32 {
      let t = clamp((v - a) / max(b - a, 0.000001), 0.0, 1.0);
      return t * t * (3.0 - 2.0 * t);
    }
    fn curveValue(channel: u32, value: f32) -> f32 {
      let base = channel * 1024u;
      if (value < 0.0) {
        let slope = (curveLuts[base + 1u] - curveLuts[base]) * 1023.0;
        return curveLuts[base] + value * slope;
      }
      if (value > 1.0) {
        let slope = (curveLuts[base + 1023u] - curveLuts[base + 1022u]) * 1023.0;
        return curveLuts[base + 1023u] + (value - 1.0) * slope;
      }
      let location = clamp(value, 0.0, 1.0) * 1023.0;
      let lower = u32(floor(location));
      let upper = min(lower + 1u, 1023u);
      let amount = fract(location);
      return mix(curveLuts[base + lower], curveLuts[base + upper], amount);
    }
    fn curveEncodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value / 0.36; }
      if (value <= 0.18) { return 0.5 * pow(value / 0.18, 1.0 / log(100.0)); }
      return 0.5 + 0.5 * log2(value / 0.18) / log2(100.0);
    }
    fn curveDecodeChannel(value: f32) -> f32 {
      if (value < 0.0) { return value * 0.36; }
      if (value <= 0.5) { return 0.18 * pow(2.0 * value, log(100.0)); }
      return 0.18 * exp2((value - 0.5) * 2.0 * log2(100.0));
    }
    fn curveEncode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveEncodeChannel(rgb.r), curveEncodeChannel(rgb.g), curveEncodeChannel(rgb.b));
    }
    fn curveDecode(rgb: vec3f, hdr: bool) -> vec3f {
      if (!hdr) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
      return vec3f(curveDecodeChannel(rgb.r), curveDecodeChannel(rgb.g), curveDecodeChannel(rgb.b));
    }
    fn applyCurves(input: vec3f, hdr: bool) -> vec3f {
      if (p[15] < 0.5) { return input; }
      var rgb = select(clamp(input, vec3f(0.0), vec3f(1.0)), input, hdr);
      let sourceLuma = select(lumaSrgb(rgb), lumaAces(rgb), hdr);
      let curveLuma = select(clamp(sourceLuma, 0.0, 1.0), curveEncodeChannel(sourceLuma), hdr);
      let mappedCurveLuma = curveValue(0u, curveLuma);
      let mappedLuma = select(mappedCurveLuma, curveDecodeChannel(mappedCurveLuma), hdr);
      if (abs(sourceLuma) > 0.00001) { rgb *= mappedLuma / sourceLuma; }
      rgb = curveEncode(rgb, hdr);
      for (var channel = 0u; channel < 3u; channel++) {
        let value = rgb[channel];
        rgb[channel] = curveValue(channel + 1u, value);
      }
      return curveDecode(rgb, hdr);
    }
    fn acescgToSrgb(rgb: vec3f) -> vec3f {
      return vec3f(
        1.7048873310 * rgb.r - 0.6241572745 * rgb.g - 0.0808867739 * rgb.b,
       -0.1295209353 * rgb.r + 1.1383993260 * rgb.g - 0.0087792418 * rgb.b,
       -0.0241270599 * rgb.r - 0.1246206123 * rgb.g + 1.1488221099 * rgb.b
      );
    }
    fn srgbToAcescg(rgb: vec3f) -> vec3f {
      return vec3f(
        0.6130974024 * rgb.r + 0.3395231366 * rgb.g + 0.0473794610 * rgb.b,
        0.0701937225 * rgb.r + 0.9163538791 * rgb.g + 0.0134523985 * rgb.b,
        0.0206155922 * rgb.r + 0.1095697729 * rgb.g + 0.8698146349 * rgb.b
      );
    }
    fn acescgToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3793363837 * rgb.r - 0.3112868172 * rgb.g - 0.0680495665 * rgb.b,
       -0.0687964722 * rgb.r + 1.0799570656 * rgb.g - 0.0111605934 * rgb.b,
       -0.0022666792 * rgb.r - 0.0417050150 * rgb.g + 1.0439716942 * rgb.b
      );
    }
    fn acescgToBt2020(rgb: vec3f) -> vec3f {
      return vec3f(
        1.0260187082 * rgb.r - 0.0221655448 * rgb.g - 0.0038531634 * rgb.b,
       -0.0017230808 * rgb.r + 1.0023190716 * rgb.g - 0.0005959908 * rgb.b,
       -0.0051099278 * rgb.r - 0.0216355504 * rgb.g + 1.0267454781 * rgb.b
      );
    }
    fn bt2020ToP3(rgb: vec3f) -> vec3f {
      return vec3f(
        1.3435782526 * rgb.r - 0.2821796705 * rgb.g - 0.0613985821 * rgb.b,
       -0.0652974528 * rgb.r + 1.0757879158 * rgb.g - 0.0104904631 * rgb.b,
        0.0028217873 * rgb.r - 0.0195984945 * rgb.g + 1.0167767073 * rgb.b
      );
    }
    fn compressSrgbGamut(input: vec3f) -> vec3f {
      let y = clamp(lumaSrgb(input), 0.0, 1.0);
      let minimum = min(input.r, min(input.g, input.b));
      let maximum = max(input.r, max(input.g, input.b));
      var scale = 1.0;
      if (minimum < 0.0) { scale = min(scale, y / max(y - minimum, 0.00000001)); }
      if (maximum > 1.0) { scale = min(scale, (1.0 - y) / max(maximum - y, 0.00000001)); }
      return clamp(vec3f(y) + (input - vec3f(y)) * clamp(scale, 0.0, 1.0), vec3f(0.0), vec3f(1.0));
    }
    fn whiteBalance(input: vec3f) -> vec3f {
      let offset = (p[10] - 6500.0) / 6500.0;
      return input * vec3f(1.0 + offset * 0.15, 1.0 + p[11] * 0.08, 1.0 - offset * 0.15);
    }
    fn hdrColor(input: vec3f) -> vec3f {
      let rgb = vec3f(
        p[61] * input.r + p[62] * input.g + p[63] * input.b,
        p[64] * input.r + p[65] * input.g + p[66] * input.b,
        p[67] * input.r + p[68] * input.g + p[69] * input.b
      );
      let y = lumaAces(rgb);
      let neutral = vec3f(y);
      let chroma = rgb - neutral;
      let maximum = max(rgb.r, max(rgb.g, rgb.b));
      let minimum = min(rgb.r, min(rgb.g, rgb.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      let vibranceFactor = max(0.0, 1.0 + p[71] * vibranceWeight);
      let saturationFactor = max(0.0, 1.0 + p[70]);
      return neutral + chroma * vibranceFactor * saturationFactor;
    }
    fn hdrBase(input: vec3f) -> vec3f {
      var rgb = input * exp2(p[2]);
      if (p[4] != 0.0) {
        let lift = min(p[4] * (1.0 - clamp(lumaAces(rgb), 0.0, 1.0)), 1.0);
        rgb *= 1.0 + lift;
      }
      return rgb;
    }
    fn hdrContrast(input: vec3f) -> vec3f {
      if (p[8] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      let targetStops = stops * exp2(p[8]);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn gradingVector(hue: f32, hdr: bool) -> vec3f {
      let angle = radians(hue);
      var tint = vec3f(cos(angle), cos(angle - 2.0943951), cos(angle + 2.0943951));
      let neutral = select(lumaSrgb(tint), lumaAces(tint), hdr);
      tint -= vec3f(neutral);
      return tint / max(max(abs(tint.r), abs(tint.g)), max(abs(tint.b), 0.000001));
    }
    fn applyColorGrading(input: vec3f, hdr: bool) -> vec3f {
      if (p[111] < 0.5) { return input; }
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.0);
      let signal = select(log2(max(srgbEncode(sourceY), 0.0000001) / 0.5), log2(max(sourceY, 0.0000001) / 0.18), hdr);
      let shadow = 1.0 - smoothRange(-1.0 + p[113] - p[112] * 0.5, -1.0 + p[113] + p[112] * 0.5, signal);
      let highlight = smoothRange(1.0 + p[113] - p[112] * 0.5, 1.0 + p[113] + p[112] * 0.5, signal);
      let midtone = max(0.0, 1.0 - shadow - highlight);
      let total = max(shadow + midtone + highlight, 0.000001);
      let masks = vec3f(shadow, midtone, highlight) / total;
      var tint = vec3f(0.0);
      var luminanceEv = 0.0;
      for (var index: u32 = 0u; index < 3u; index = index + 1u) {
        let offset = 114 + index * 3;
        tint += gradingVector(p[offset], hdr) * p[offset + 1] * masks[index];
        luminanceEv += p[offset + 2] * masks[index];
      }
      var result = input + tint * sourceY;
      let tintedY = max(select(lumaSrgb(result), lumaAces(result), hdr), 0.0000001);
      result *= sourceY / tintedY;
      return max(result * exp2(luminanceEv), vec3f(0.0));
    }
    fn hdrSoftCeiling(input: vec3f) -> vec3f {
      if (p[74] != 2.0 || p[3] <= 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let start = max(p[53], 0.000001);
      if (y <= start) { return input; }
      let targetLevel = max(p[73], start + 0.0018);
      let span = targetLevel - start;
      let normalized = (y - start) / span;
      let softness = clamp(p[3] / 100.0, 0.0, 1.0);
      let exponent = exp2(5.0 * (1.0 - softness));
      var compressed: f32;
      if (normalized <= 1.0) {
        compressed = normalized / pow(1.0 + pow(normalized, exponent), 1.0 / exponent);
      } else {
        compressed = 1.0 / pow(1.0 + pow(1.0 / normalized, exponent), 1.0 / exponent);
      }
      if (compressed > 0.99999) { compressed = 1.0; }
      let activationPosition = clamp(p[3] / 10.0, 0.0, 1.0);
      let activation = activationPosition * activationPosition * (3.0 - 2.0 * activationPosition);
      var targetValue: f32;
      if (activation >= 1.0) {
        targetValue = start + span * compressed;
      } else {
        targetValue = start + mix(y - start, span * compressed, activation);
      }
      return input * (targetValue / max(y, 0.00000001));
    }
    fn hdrPeakFit(input: vec3f) -> vec3f {
      if (p[74] != 1.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let channelPeak = max(max(input.r, input.g), input.b);
      let signal = select(y, max(channelPeak, 0.0), p[110] > 0.5);
      let start = max(p[53], 0.000001);
      let targetLevel = max(p[73], start + 0.0018);
      let peakLevel = max(p[75], targetLevel);
      if (peakLevel <= targetLevel) { return input; }
      let startStop = log2(start);
      let targetStop = log2(targetLevel);
      let peakStop = log2(peakLevel);
      let curveBias = p[77];
      let requestedRatio = (targetStop - startStop) / max(peakStop - startStop, 0.000001);
      let requiredRatio = clamp((1.0 / (1.0 + curveBias) + p[76] / (1.0 - curveBias)) / 3.0, 0.001, 0.95);
      var effectiveStartStop = startStop;
      if (requestedRatio < requiredRatio) {
        effectiveStartStop = (targetStop - requiredRatio * peakStop) / (1.0 - requiredRatio);
      }
      let effectiveStart = exp2(effectiveStartStop);
      if (signal <= effectiveStart) { return input; }
      let u = clamp((log2(signal) - effectiveStartStop) / max(peakStop - effectiveStartStop, 0.000001), 0.0, 1.0);
      let w = clamp(u + curveBias * u * (1.0 - u), 0.0, 1.0);
      let stopSpan = targetStop - effectiveStartStop;
      let m0 = (peakStop - effectiveStartStop) / max(stopSpan * (1.0 + curveBias), 0.000001);
      let m1 = p[76] * (peakStop - effectiveStartStop) / max(stopSpan * (1.0 - curveBias), 0.000001);
      let mapped = w * (1.0 - w) * (1.0 - w) * m0 + w * w * (3.0 - 2.0 * w) + w * w * (w - 1.0) * m1;
      let targetValue = exp2(effectiveStartStop + stopSpan * mapped);
      let mappedRgb = input * (targetValue / max(signal, 0.00000001));
      if (p[110] < 0.5) { return mappedRgb; }
      let progress = u * u * (3.0 - 2.0 * u);
      return vec3f(targetValue) + (mappedRgb - vec3f(targetValue)) * (1.0 - progress);
    }
    fn hdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let y = max(lumaAces(input), 0.0);
      let pivot = max(p[9], 0.000001);
      let stops = log2(max(y, 0.00000001) / pivot);
      var targetStops = stops;
      targetStops += 2.0 * p[5] * (1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, stops));
      let gammaSigma = max(p[57] / 2.355, 0.1);
      targetStops += 2.0 * p[6] * exp(-0.5 * pow((stops - p[56]) / gammaSigma, 2.0));
      let gainMask = smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, stops);
      let gainExponent = clamp(sqrt(p[59] / 4.0), 0.5, 1.0);
      targetStops += 2.0 * p[7] * pow(gainMask, gainExponent);
      if (y <= 0.00000001) { return input; }
      return input * (pivot * exp2(clamp(targetStops, -32.0, 32.0)) / y);
    }
    fn toneEqualizerNodeEv(index: u32) -> f32 { return p[21u + index]; }
    fn toneEqualizerTarget(index: u32) -> f32 {
      return toneEqualizerNodeEv(index) + p[37u + index];
    }
    fn toneEqualizerSlope(index: u32) -> f32 {
      let count = u32(p[20]);
      if (index == 0u) { return (toneEqualizerTarget(1u) - toneEqualizerTarget(0u)) / max(toneEqualizerNodeEv(1u) - toneEqualizerNodeEv(0u), 0.0001); }
      if (index + 1u >= count) { return (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001); }
      let previous = (toneEqualizerTarget(index) - toneEqualizerTarget(index - 1u)) / max(toneEqualizerNodeEv(index) - toneEqualizerNodeEv(index - 1u), 0.0001);
      let following = (toneEqualizerTarget(index + 1u) - toneEqualizerTarget(index)) / max(toneEqualizerNodeEv(index + 1u) - toneEqualizerNodeEv(index), 0.0001);
      if (previous <= 0.0 || following <= 0.0) { return 0.0; }
      return 2.0 * previous * following / (previous + following);
    }
    fn toneEqualizer(input: vec3f) -> vec3f {
      if (p[18] < 0.5) { return input; }
      let y = max(select(lumaSrgb(input), lumaAces(input), p[0] > 0.5), 0.0);
      if (y <= 0.00000001) { return input; }
      let inputEv = log2(max(y, 0.00000001) / 0.18);
      var targetEv = inputEv;
      let count = u32(p[20]);
      if (inputEv < -6.0) {
        targetEv += p[37];
      } else if (inputEv > 6.0) {
        targetEv += p[37u + count - 1u];
      } else {
        var segment = 0u;
        for (var index = 0u; index < 15u; index++) {
          if (index + 1u < count && inputEv >= toneEqualizerNodeEv(index + 1u)) { segment = index + 1u; }
        }
        segment = min(segment, count - 2u);
        let width = max(toneEqualizerNodeEv(segment + 1u) - toneEqualizerNodeEv(segment), 0.0001);
        let local = (inputEv - toneEqualizerNodeEv(segment)) / width;
        let y0 = toneEqualizerTarget(segment);
        let y1 = toneEqualizerTarget(segment + 1u);
        let m0 = toneEqualizerSlope(segment) * width;
        let m1 = toneEqualizerSlope(segment + 1u) * width;
        let local2 = local * local;
        let local3 = local2 * local;
        let cubic = (2.0 * local3 - 3.0 * local2 + 1.0) * y0
          + (local3 - 2.0 * local2 + local) * m0
          + (-2.0 * local3 + 3.0 * local2) * y1
          + (local3 - local2) * m1;
        let linear = mix(y0, y1, local);
        targetEv = mix(linear, cubic, clamp(p[19], 0.0, 1.0));
      }
      return input * (0.18 * exp2(clamp(targetEv, -32.0, 32.0)) / y);
    }
    fn srgbEncode(value: f32) -> f32 {
      return select(1.055 * pow(clamp(value, 0.0, 1.0), 1.0 / 2.4) - 0.055, value * 12.92, value <= 0.0031308);
    }
    fn srgbDecode(value: f32) -> f32 {
      return select(pow((clamp(value, 0.0, 1.0) + 0.055) / 1.055, 2.4), value / 12.92, value <= 0.04045);
    }
    fn displayEncodeChannel(value: f32) -> f32 {
      // Canvas colorSpace values use the nonlinear sRGB/Display-P3 transfer
      // function even when the swap-chain texture itself is floating point.
      let magnitude = abs(value);
      let encoded = select(1.055 * pow(magnitude, 1.0 / 2.4) - 0.055, magnitude * 12.92, magnitude <= 0.0031308);
      return sign(value) * encoded;
    }
    fn displayEncode(rgb: vec3f) -> vec3f {
      return vec3f(displayEncodeChannel(rgb.r), displayEncodeChannel(rgb.g), displayEncodeChannel(rgb.b));
    }
    fn sdrContrast(input: vec3f) -> vec3f {
      if (p[8] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      let targetValue = (encodedY - p[9]) * exp2(p[8] * 0.5) + p[9];
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn sdrPrimaries(input: vec3f) -> vec3f {
      if (p[5] == 0.0 && p[6] == 0.0 && p[7] == 0.0) { return input; }
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      let linearY = clamp(lumaSrgb(rgb), 0.0, 1.0);
      let encodedY = srgbEncode(linearY);
      var targetValue = encodedY;
      let zoneStops = log2(max(encodedY, 0.000001) / 0.5);
      let shadowMask = 1.0 - smoothRange(p[54] - p[55] * 0.5, p[54] + p[55] * 0.5, zoneStops);
      var highlightMask = smoothRange(p[58] - p[59] * 0.5, p[58] + p[59] * 0.5, zoneStops);
      let gainExponent = clamp(sqrt(p[59] / 4.0), 0.5, 1.0);
      highlightMask = pow(highlightMask, gainExponent);
      let gammaSigma = max(p[57] / 2.355, 0.1);
      let midtoneMask = exp(-0.5 * pow((zoneStops - p[56]) / gammaSigma, 2.0));
      targetValue += p[5] * 0.25 * shadowMask;
      if (p[6] != 0.0) { targetValue = mix(targetValue, pow(clamp(targetValue, 0.0, 1.0), exp2(-p[6])), midtoneMask); }
      if (p[7] > 0.0) { targetValue += p[7] * highlightMask * (1.0 - targetValue); }
      if (p[7] < 0.0) { targetValue += p[7] * highlightMask * targetValue; }
      let targetY = srgbDecode(clamp(targetValue, 0.0, 1.0));
      if (linearY > 0.000001) { return rgb * (targetY / linearY); }
      return vec3f(targetY);
    }
    fn highlightRecovery(input: vec3f) -> vec3f {
      if (p[3] <= 0.0) { return input; }
      let rgb = max(input, vec3f(0.0));
      let y = lumaSrgb(rgb);
      let pivot = 100.0 / 203.0;
      let span = 1.0 - pivot;
      let position = clamp((y - pivot) / span, 0.0, 1.0);
      let amount = 2.5 * (1.0 - exp(-0.5 * clamp(p[3], 0.0, 4.0)));
      let recoveredPosition = position - amount * position * position * (1.0 - position);
      let recoveredValue = pivot + span * recoveredPosition;
      let targetValue = select(y, recoveredValue, y > pivot);
      return select(vec3f(0.0), rgb * (targetValue / max(y, 0.00000001)), y > 0.00000001);
    }
    fn toneCurveLuma(y: f32) -> f32 {
      var mapped = 0.0;
      if (p[12] > 1.5) {
        let scaledY = y * 5.393743257820929;
        mapped = scaledY / (1.0 + scaledY);
      } else if (p[12] > 0.5) {
        let scaledY = y * 2.0294105241641414;
        mapped = ((scaledY * (2.51 * scaledY + 0.03)) / (scaledY * (2.43 * scaledY + 0.59) + 0.14)) / (2.51 / 2.43);
      } else {
        let basePower = 1.1 * clamp(p[13], 0.5, 1.5);
        let shadowPower = basePower * exp2(-0.75 * clamp(p[14], -1.0, 1.0));
        let highlightPower = basePower * exp2(0.75 * clamp(p[14], -1.0, 1.0));
        let sceneMiddleGray = 0.18;
        let displayReferenceWhite = 100.0 / 203.0;
        let logExposure = log(max(y, 0.00000001) / sceneMiddleGray);
        let localPower = mix(shadowPower, highlightPower, smoothRange(-0.5, 0.5, logExposure));
        let referenceOdds = log(displayReferenceWhite / (1.0 - displayReferenceWhite));
        mapped = select(0.0, 1.0 / (1.0 + exp(-clamp(referenceOdds + localPower * logExposure, -32.0, 32.0))), y > 0.0);
      }
      return clamp(mapped, 0.0, 1.0);
    }
    fn toneMap(input: vec3f) -> vec3f {
      let rgb = max(input, vec3f(0.0));
      let y = lumaAces(rgb);
      let mapped = toneCurveLuma(y);
      let scaled = select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001);
      return compressSrgbGamut(acescgToSrgb(scaled));
    }
    fn retoneMapSdrReference(input: vec3f) -> vec3f {
      let rgb = clamp(input, vec3f(0.0), vec3f(1.0));
      if (p[12] < 0.5 && abs(p[13] - 1.0) < 0.000001 && abs(p[14]) < 0.000001) { return rgb; }
      let y = lumaSrgb(rgb);
      let boundedY = clamp(y, 0.0000001, 0.9999999);
      let sceneMiddleGray = 0.18;
      let displayReferenceWhite = 100.0 / 203.0;
      let displayReferenceOdds = log(displayReferenceWhite / (1.0 - displayReferenceWhite));
      let encodedOdds = log(boundedY / (1.0 - boundedY));
      let sceneY = select(0.0, sceneMiddleGray * exp(clamp((encodedOdds - displayReferenceOdds) / 1.1, -32.0, 32.0)), y > 0.0);
      let mapped = toneCurveLuma(sceneY);
      return clamp(select(vec3f(0.0), rgb * (mapped / max(y, 0.00000001)), y > 0.00000001), vec3f(0.0), vec3f(1.0));
    }
    fn sceneColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return hdrColor(whiteBalance(input));
    }
    fn sdrReferenceColor(input: vec3f) -> vec3f {
      if (p[72] < 0.5) { return input; }
      return compressSrgbGamut(acescgToSrgb(sceneColor(srgbToAcescg(input))));
    }
    fn renderHdrBase(source: vec3f) -> vec3f {
      return max(applyColorGrading(applyCurves(hdrPrimaries(toneEqualizer(sceneColor(hdrPeakFit(hdrSoftCeiling(hdrContrast(hdrBase(source))))))), true), true), vec3f(0.0));
    }
    fn displayHdr(rgb: vec3f) -> vec3f {
      if (p[16] > 0.5) {
        // Chromium currently treats extended canvas values relative to its
        // 203-nit canvas convention. This is a qualified runtime convention,
        // not a universal WebGPU physical-nit guarantee.
        // Clamp in BT.2020 before converting to P3, exactly as the PQ encoder
        // does, so exposed highlights do not change at the settled handoff.
        let transportRgb = clamp(acescgToBt2020(rgb), vec3f(0.0), vec3f(p[17]));
        return bt2020ToP3(transportRgb) * (p[138] / p[139]) / 0.18;
      }
      let display = max(acescgToSrgb(rgb), vec3f(0.0));
      return display / (vec3f(1.0) + display);
    }
    fn renderSdrBase(source: vec3f) -> vec3f {
      var rgb: vec3f;
      if (p[1] > 0.5) {
        rgb = clamp(source, vec3f(0.0), vec3f(1.0)) * exp2(p[2]);
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaSrgb(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        if (p[60] > 0.5) { rgb = retoneMapSdrReference(rgb); }
        rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrReferenceColor(sdrContrast(toneEqualizer(highlightRecovery(rgb))))), false), false);
      } else {
        rgb = max(source * exp2(p[2]), vec3f(0.0));
        if (p[4] != 0.0) {
          let mask = 1.0 - smoothRange(0.0, 0.5, lumaAces(rgb));
          rgb = max(rgb + vec3f(p[4] * 0.08 * mask), vec3f(0.0));
        }
        rgb = applyColorGrading(applyCurves(sdrPrimaries(sdrContrast(toneEqualizer(highlightRecovery(toneMap(sceneColor(rgb)))))), false), false);
      }
      return clamp(rgb, vec3f(0.0), vec3f(1.0));
    }

    fn filmLuma(rgb: vec3f) -> f32 {
      return select(lumaSrgb(rgb), lumaAces(rgb), p[0] > 0.5);
    }
    fn filmSignalFromLuma(value: f32) -> f32 {
      return select(srgbEncode(clamp(value, 0.0, 1.0)), curveEncodeChannel(max(value, 0.0)), p[0] > 0.5);
    }
    fn filmLumaFromSignal(value: f32) -> f32 {
      return select(srgbDecode(clamp(value, 0.0, 1.0)), curveDecodeChannel(value), p[0] > 0.5);
    }
    fn filmResponse(input: vec3f) -> vec3f {
      if (p[78] < 0.5 || p[79] <= 0.0) { return input; }
      let sourceY = max(filmLuma(input), 0.0);
      var rgb = input;
      if (p[80] > 0.0 && sourceY > 0.0000001) {
        let signal = filmSignalFromLuma(sourceY);
        var mapped = 0.5 + (signal - 0.5) * exp2(0.55 * p[81]);
        mapped -= p[82] * 0.10 * (1.0 - smoothRange(0.08, 0.58, signal));
        mapped -= p[83] * 0.10 * smoothRange(0.42, 0.98, signal);
        if (p[0] < 0.5) { mapped = clamp(mapped, 0.0, 1.0); }
        let targetY = mix(sourceY, filmLumaFromSignal(mapped), p[80] * p[79]);
        rgb *= targetY / sourceY;
      }
      if (p[84] != 0.0) {
        let y = filmLuma(rgb);
        let neutral = vec3f(y);
        let maximum = max(rgb.r, max(rgb.g, rgb.b));
        let minimum = min(rgb.r, min(rgb.g, rgb.b));
        let relative = clamp((maximum - minimum) / max(abs(y), 0.00001), 0.0, 2.0);
        let density = p[84] * p[79];
        rgb = neutral + (rgb - neutral) * exp2(0.45 * density);
        rgb *= max(0.75, 1.0 - density * 0.045 * relative);
      }
      return max(rgb, vec3f(0.0));
    }
    fn boundedCoordinate(coordinate: vec2i) -> vec2i {
      let dimensions = textureDimensions(sourceTexture);
      return clamp(coordinate, vec2i(0), vec2i(dimensions) - vec2i(1));
    }
    fn sampleFilm(coordinate: vec2i) -> vec3f {
      return textureLoad(sourceTexture, boundedCoordinate(coordinate), 0).rgb;
    }
    fn spatialOffset(percentDiagonal: f32) -> i32 {
      let dimensions = vec2f(textureDimensions(sourceTexture));
      return max(1, i32(round(length(dimensions) * max(percentDiagonal, 0.0) / 100.0)));
    }
    fn filmBlur(coordinate: vec2i, percentDiagonal: f32) -> vec3f {
      let radius = spatialOffset(percentDiagonal);
      let halfRadius = max(1, radius / 2);
      var total = sampleFilm(coordinate) * 4.0;
      total += sampleFilm(coordinate + vec2i(radius, 0));
      total += sampleFilm(coordinate + vec2i(-radius, 0));
      total += sampleFilm(coordinate + vec2i(0, radius));
      total += sampleFilm(coordinate + vec2i(0, -radius));
      total += sampleFilm(coordinate + vec2i(halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, halfRadius));
      total += sampleFilm(coordinate + vec2i(halfRadius, -halfRadius));
      total += sampleFilm(coordinate + vec2i(-halfRadius, -halfRadius));
      return total / 12.0;
    }
    fn filmHighlightMask(rgb: vec3f, sensitivity: f32) -> f32 {
      let threshold = 0.92 - 0.50 * clamp(sensitivity, 0.0, 1.0);
      return smoothRange(threshold, threshold + 0.16, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
    }
    fn qualifiedSample(coordinate: vec2i, sensitivity: f32) -> vec3f {
      let rgb = sampleFilm(coordinate);
      return rgb * filmHighlightMask(rgb, sensitivity);
    }

    fn packedQualifiedSample(coordinate: vec2f) -> vec4f {
      let rgb = sampleFilm(vec2i(coordinate));
      let bloomMask = filmHighlightMask(rgb, p[94]);
      let halationMask = filmHighlightMask(rgb, p[87]);
      let bloom = rgb * bloomMask * select(0.0, 1.0, p[92] > 0.5 && p[93] > 0.0);
      let halation = max(filmLuma(rgb), 0.0) * halationMask * select(0.0, 1.0, p[85] > 0.5);
      return vec4f(bloom, halation);
    }
    fn sampleSpatial(uv: vec2f) -> vec4f {
      return textureSampleLevel(spatialTexture, spatialSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
    }
    fn spatialBlur(direction: vec2f, coordinate: vec2f) -> vec4f {
      let dimensions = vec2f(textureDimensions(spatialTexture));
      let uv = coordinate / dimensions;
      let bloomRadius = max(0.5, length(dimensions) * max(p[95], 0.0) / 100.0);
      let halationRadius = max(0.5, length(dimensions) * max(p[88], 0.0) / 100.0);
      var bloomTotal = vec3f(0.0);
      var halationTotal = 0.0;
      var weightTotal = 0.0;
      for (var index: i32 = -4; index <= 4; index = index + 1) {
        let normalized = f32(index) / 4.0;
        let weight = exp(-4.5 * normalized * normalized);
        let bloomUv = uv + direction * normalized * bloomRadius / dimensions;
        let halationUv = uv + direction * normalized * halationRadius / dimensions;
        bloomTotal += sampleSpatial(bloomUv).rgb * weight;
        halationTotal += sampleSpatial(halationUv).a * weight;
        weightTotal += weight;
      }
      return vec4f(bloomTotal / weightTotal, halationTotal / weightTotal);
    }
    fn grainHash(coordinate: vec2f, salt: f32) -> f32 {
      return fract(sin(dot(coordinate, vec2f(12.9898, 78.233)) + p[109] * 0.001 + salt) * 43758.5453) * 2.0 - 1.0;
    }
    fn grainValueNoise(coordinate: vec2f, salt: f32) -> f32 {
      let cell = floor(coordinate);
      let local = fract(coordinate);
      let blend = local * local * (vec2f(3.0) - 2.0 * local);
      let top = mix(grainHash(cell, salt), grainHash(cell + vec2f(1.0, 0.0), salt), blend.x);
      let bottom = mix(grainHash(cell + vec2f(0.0, 1.0), salt), grainHash(cell + vec2f(1.0, 1.0), salt), blend.x);
      return mix(top, bottom, blend.y);
    }
    fn applyFilmLook(coordinate: vec2i) -> vec3f {
      var rgb = sampleFilm(coordinate);
      if (p[78] < 0.5 || p[79] <= 0.0) { return applyVignette(rgb, coordinate); }
      let dimensions = vec2f(textureDimensions(sourceTexture));
      var spatial = vec4f(0.0);
      if (p[85] > 0.5 || (p[92] > 0.5 && p[93] > 0.0)) {
        spatial = sampleSpatial((vec2f(coordinate) + vec2f(0.5)) / dimensions);
      }
      if (p[85] > 0.5) {
        let qualified = rgb * filmHighlightMask(rgb, p[87]);
        let haloY = max(spatial.a - max(filmLuma(qualified), 0.0) * 0.35, 0.0);
        let angle = radians(12.0 + 45.0 * p[89]);
        let warm = vec3f(1.0, 0.34 + 0.18 * sin(angle), 0.07 + 0.10 * max(cos(angle), 0.0));
        let warmY = lumaSrgb(warm);
        let tint = mix(vec3f(warmY), warm, clamp(p[90], 0.0, 1.0));
        if (p[91] > 0.5) { return vec3f(clamp(filmSignalFromLuma(haloY), 0.0, 1.0)); }
        rgb += haloY * tint * (0.28 * p[86] * p[79]);
      }
      if (p[92] > 0.5 && p[93] > 0.0) {
        let qualified = rgb * filmHighlightMask(rgb, p[94]);
        let amount = p[93] * p[79];
        let additive = spatial.rgb * (0.22 * amount);
        let diffusion = (spatial.rgb - qualified) * ((1.0 - p[96]) * 0.35 * amount);
        rgb = max(rgb + additive + diffusion, vec3f(0.0));
      }
      if (p[97] > 0.5 && (abs(p[98]) > 0.000001 || abs(p[99]) > 0.000001)) {
        let structureBlur = filmBlur(coordinate, 0.06);
        let structureSource = rgb;
        rgb = structureSource
          + (structureBlur - structureSource) * p[98] * p[79] * 0.65
          + (structureSource - structureBlur) * p[99] * p[79] * 0.5;
      }
      if (p[108] < 1.0) {
        let resolutionLoss = (1.0 - p[108]) * p[79];
        rgb += (filmBlur(coordinate, 0.04 + 0.08 * resolutionLoss) - rgb) * resolutionLoss * 0.7;
      }
      rgb = applyVignette(rgb, coordinate);
      if (p[100] > 0.5 && p[101] > 0.0) {
        let dimensions = vec2f(textureDimensions(sourceTexture));
        var pixelsPerMm = max(dimensions.x / p[140], dimensions.y / p[141]);
        if (p[142] > 0.5 && p[142] < 1.5) { pixelsPerMm = dimensions.y / p[141]; }
        if (p[142] > 1.5) { pixelsPerMm = dimensions.x / p[140]; }
        let physicalPitch = pixelsPerMm * (6.0 + 24.0 * p[102]) / 1000.0;
        let pitch = max(1.0, physicalPitch);
        let pixelCoverage = min(1.0, physicalPitch);
        let grainCoordinate = vec2f(coordinate) / pitch;
        let mono = mix(grainValueNoise(grainCoordinate, 0.0), grainValueNoise(grainCoordinate * 0.53, 17.0), p[103] * 0.55);
        let signal = clamp(filmSignalFromLuma(max(filmLuma(rgb), 0.0)), 0.0, 1.0);
        let shadowWeight = pow(1.0 - signal, 2.0);
        let highlightWeight = pow(signal, 2.0);
        let midWeight = max(0.0, 1.0 - shadowWeight - highlightWeight);
        let response = shadowWeight * p[105] + midWeight * p[106] + highlightWeight * p[107];
        let amount = 0.18 * p[101] * p[79] * response * pixelCoverage;
        rgb *= exp2(vec3f(mono * amount));
        if (p[104] > 0.0) {
          let chroma = vec3f(grainValueNoise(grainCoordinate, 31.0), grainValueNoise(grainCoordinate, 59.0), grainValueNoise(grainCoordinate, 83.0));
          let chromaHighlightGuard = 1.0 - 0.8 * smoothRange(0.88, 1.0, signal);
          rgb *= exp2(chroma * amount * p[104] * chromaHighlightGuard * 0.45);
        }
      }
      return max(rgb, vec3f(0.0));
    }
    fn applyVignette(rgb: vec3f, coordinate: vec2i) -> vec3f {
      if (p[123] < 0.5 || abs(p[124]) < 0.000001) { return rgb; }
      let dimensions = vec2f(textureDimensions(sourceTexture));
      let center = vec2f(p[129], p[130]) * max(dimensions - vec2f(1.0), vec2f(1.0));
      let scale = max(1.0, 0.5 * min(dimensions.x, dimensions.y));
      let delta = abs((vec2f(coordinate) - center) / scale);
      let exponent = max(p[126], 1.0);
      let radius = pow(pow(delta.x, exponent) + pow(delta.y, exponent), 1.0 / exponent);
      var mask = smoothRange(p[125], p[125] + p[127], radius);
      if (p[124] < 0.0 && p[128] > 0.0) {
        let highlight = smoothRange(0.55, 0.95, filmSignalFromLuma(max(filmLuma(rgb), 0.0)));
        mask *= 1.0 - highlight * p[128];
      }
      return max(rgb * exp2(p[124] * mask), vec3f(0.0));
    }

    fn localSaturation(input: vec3f) -> vec3f {
      let y = lumaAces(input);
      let neutral = vec3f(y);
      let chroma = input - neutral;
      let maximum = max(input.r, max(input.g, input.b));
      let minimum = min(input.r, min(input.g, input.b));
      let denominator = max(max(abs(maximum), abs(minimum)), max(abs(y), 0.000001));
      let relativeChroma = clamp((maximum - minimum) / denominator, 0.0, 1.0);
      let vibranceWeight = pow(1.0 - relativeChroma, 2.0);
      return neutral + chroma * max(0.0, 1.0 + p[12] * vibranceWeight) * max(0.0, 1.0 + p[11]);
    }

    fn applyLocalGrade(input: vec3f) -> vec3f {
      let hdr = p[0] > 0.5;
      let sourceY = max(select(lumaSrgb(input), lumaAces(input), hdr), 0.00000001);
      let pivot = max(p[8], 0.000001);
      let stops = log2(sourceY / pivot);
      let blacks = clamp((-stops - 3.0) / 3.0, 0.0, 1.0);
      let shadows = clamp(1.0 - abs(stops + 2.0) / 2.5, 0.0, 1.0);
      let midtones = clamp(1.0 - abs(stops) / 2.5, 0.0, 1.0);
      let highlights = clamp((stops - 0.5) / 3.0, 0.0, 1.0);
      let zoneEv = p[6] * blacks + p[5] * shadows + p[4] * midtones + p[3] * highlights;
      let targetStops = stops * exp2(p[7]) + zoneEv + p[2];
      var rgb = input * (pivot * exp2(clamp(targetStops, -32.0, 24.0)) / sourceY);
      if (hdr) {
        let offset = (p[9] - 6500.0) / 6500.0;
        rgb *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = localSaturation(rgb);
      } else {
        var aces = srgbToAcescg(rgb);
        let offset = (p[9] - 6500.0) / 6500.0;
        aces *= vec3f(1.0 + offset * 0.15, 1.0 + p[10] * 0.08, 1.0 - offset * 0.15);
        rgb = acescgToSrgb(localSaturation(aces));
      }
      return max(rgb, vec3f(0.0));
    }

    @fragment fn baseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let output = select(renderSdrBase(source), renderHdrBase(source), p[0] > 0.5);
      return vec4f(output, 1.0);
    }

    @fragment fn localAdjustmentFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let source = textureLoad(sourceTexture, coordinate, 0).rgb;
      let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(dimensions);
      let influence = clamp(textureSampleLevel(spatialTexture, spatialSampler, uv, 0.0).r * p[1] * p[13], 0.0, 1.0);
      return vec4f(mix(source, applyLocalGrade(source), influence), 1.0);
    }

    @fragment fn filmResponseFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      return vec4f(filmResponse(textureLoad(sourceTexture, coordinate, 0).rgb), 1.0);
    }

    @fragment fn spatialExtractFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let sourceDimensions = vec2f(textureDimensions(sourceTexture));
      let targetDimensions = vec2f(textureDimensions(spatialTexture));
      let scale = sourceDimensions / targetDimensions;
      let center = input.position.xy * scale;
      let offset = scale * 0.25;
      return (
        packedQualifiedSample(center + vec2f(-offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, -offset.y))
        + packedQualifiedSample(center + vec2f(-offset.x, offset.y))
        + packedQualifiedSample(center + vec2f(offset.x, offset.y))
      ) * 0.25;
    }

    @fragment fn spatialBlurHorizontalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(1.0, 0.0), input.position.xy);
    }

    @fragment fn spatialBlurVerticalFragmentMain(input: VertexOut) -> @location(0) vec4f {
      return spatialBlur(vec2f(0.0, 1.0), input.position.xy);
    }

    @fragment fn scopeFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let targetDimensions = max(vec2f(p[136], p[137]), vec2f(1.0));
      let sourceDimensions = vec2f(textureDimensions(sourceTexture));
      let uv = clamp(input.position.xy / targetDimensions, vec2f(0.0), vec2f(0.999999));
      let coordinate = clamp(vec2i(uv * sourceDimensions), vec2i(0), vec2i(sourceDimensions) - vec2i(1));
      let filmOutput = applyFilmLook(coordinate);
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), max(filmOutput, vec3f(0.0)), p[0] > 0.5);
      return vec4f(output, 1.0);
    }

    @fragment fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = clamp(vec2i(input.position.xy), vec2i(0), vec2i(dimensions) - vec2i(1));
      let filmOutput = applyFilmLook(coordinate);
      let output = select(clamp(filmOutput, vec3f(0.0), vec3f(1.0)), displayHdr(filmOutput), p[0] > 0.5);
      var encoded = displayEncode(output);
      if (p[131] > 0.5) {
        let uv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(dimensions);
        let mask = textureSampleLevel(overlayMaskTexture, spatialSampler, uv, 0.0).r;
        encoded = mix(encoded, vec3f(p[133], p[134], p[135]), clamp(mask * p[132] * 0.52, 0.0, 0.52));
      }
      return vec4f(encoded, 1.0);
    }
  `;

  const LUMA_MASK_SHADER_SOURCE = String.raw`
    @group(0) @binding(0) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(1) var<storage, read> p: array<f32>;
    @group(0) @binding(2) var operandTexture: texture_2d<f32>;

    struct VertexOut { @builtin(position) position: vec4f }

    @vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
      var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
      var output: VertexOut;
      output.position = vec4f(positions[index], 0.0, 1.0);
      return output;
    }

    fn pixelCoordinate(position: vec2f) -> vec2i {
      let dimensions = textureDimensions(sourceTexture);
      return clamp(vec2i(position), vec2i(0), vec2i(dimensions) - vec2i(1));
    }

    @fragment fn sceneLuminanceFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let source = textureLoad(sourceTexture, pixelCoordinate(input.position.xy), 0).rgb;
      let luma = dot(source, vec3f(0.2722287, 0.6740818, 0.0536895));
      return vec4f(luma, luma, luma, 1.0);
    }

    @fragment fn lumaQualificationFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let luma = textureLoad(sourceTexture, pixelCoordinate(input.position.xy), 0).r;
      let ev = log2(max(luma, 0.00000001) / 0.18);
      let rise = clamp((ev - p[0]) / max(p[1] - p[0], 0.000001), 0.0, 1.0);
      let fall = clamp((p[3] - ev) / max(p[3] - p[2], 0.000001), 0.0, 1.0);
      let mask = min(rise, fall);
      return vec4f(mask, mask, mask, 1.0);
    }

    @fragment fn maskRefinementFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let dimensions = textureDimensions(sourceTexture);
      let coordinate = pixelCoordinate(input.position.xy);
      let sigma = select(p[0], p[1], p[2] > 0.5);
      var value = textureLoad(sourceTexture, coordinate, 0).r;
      if (sigma >= 0.25) {
        let direction = select(vec2f(1.0, 0.0), vec2f(0.0, 1.0), p[2] > 0.5);
        let stepSize = max(1.0, sigma * 0.25);
        var total = 0.0;
        var weightTotal = 0.0;
        for (var tap = -12; tap <= 12; tap = tap + 1) {
          let offset = f32(tap) * stepSize;
          let weight = exp(-0.5 * offset * offset / max(sigma * sigma, 0.000001));
          let sampleCoordinate = clamp(
            coordinate + vec2i(round(direction * offset)),
            vec2i(0),
            vec2i(dimensions) - vec2i(1),
          );
          total += textureLoad(sourceTexture, sampleCoordinate, 0).r * weight;
          weightTotal += weight;
        }
        value = total / max(weightTotal, 0.000001);
      }
      if (p[3] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }

    @fragment fn maskCombineFragmentMain(input: VertexOut) -> @location(0) vec4f {
      let coordinate = pixelCoordinate(input.position.xy);
      let left = clamp(textureLoad(sourceTexture, coordinate, 0).r * p[1], 0.0, 1.0);
      let right = clamp(textureLoad(operandTexture, coordinate, 0).r * p[2], 0.0, 1.0);
      var value = max(left, right);
      if (p[0] > 0.5 && p[0] < 1.5) { value = left * right; }
      if (p[0] > 1.5) { value = left * (1.0 - right); }
      if (p[3] > 0.5) { value = 1.0 - value; }
      return vec4f(value, value, value, 1.0);
    }
  `;
})();
