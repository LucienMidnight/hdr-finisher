// Shared engine now lives in the production app; prototype behavior is unchanged.
import '../../frontend/hsl-engine.js';
export const {MAX_RANGES,clamp,wrap,delta,smooth,decode,encode,toLab,fromLab,describe,newRecipe,validateRecipe,addSample,rangeWeight,selection,applyPixel,processCPU,sampleNeighborhood} = globalThis.HDRHSL;
