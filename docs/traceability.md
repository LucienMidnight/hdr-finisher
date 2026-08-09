# Implementation Traceability

This index maps user-facing areas to their current state model, implementation, and documentation. It is a maintenance aid, not a substitute for reading the code.

## Workflow and diagnostics

| User area | State/API | Backend/frontend implementation | Manual |
|---|---|---|---|
| Import/eject/test pattern | Session routes | `main.py`, `sessions.py`, `loader.py`, `test_pattern.py`, `app.js` | [Import](user-guide/import.md) |
| Interpretation | `SourceInterpretationOverride` | `loader.py`, `color.py`, interpretation UI in `app.js` | [Import](user-guide/import.md) |
| Metadata/classification | `SourceImageDescriptor`, `MetadataPayload`, `HDRAnalysis` | `metadata.py`, `analysis.py`, `loader.py` | [Import](user-guide/import.md) |
| HDR/SDR viewer | `PreviewRequest`, `PreviewKind` | `preview.py`, `render_cache.py`, `webgpu-preview.js`, `app.js` | [Viewer](user-guide/viewer-and-analysis.md) |
| A/B and zoom | Frontend state | `app.js`, `styles.css` | [Viewer](user-guide/viewer-and-analysis.md) |
| Histogram/waveform/parade | `ScopeResponse` | `scopes.py`, scope drawing in `app.js` | [Viewer](user-guide/viewer-and-analysis.md) |
| False color/zebras | `SharedAdjustments.overlay_*` | `overlay.py`, overlay UI in `app.js` | [Viewer](user-guide/viewer-and-analysis.md) |
| Technical panel | Session/display/preview payloads | `display_probe.py`, `app.js` | [Viewer](user-guide/viewer-and-analysis.md) |

## HDR grade

| UI group/control | Model field(s) | Processing function/area | Manual |
|---|---|---|---|
| Tone bypass/reset | `hdr.tone_section_enabled` | `_apply_hdr_adjustments` | [HDR grade](user-guide/grade-hdr.md#tone) |
| Exposure | `hdr.exposure` | `_apply_hdr_base_adjustments` | [HDR grade](user-guide/grade-hdr.md#exposure) |
| Highlight Rolloff/Start | `hdr.highlight_rolloff`, `highlight_rolloff_start_nits` | `_rolloff_scene_highlights` | [HDR grade](user-guide/grade-hdr.md#highlight-rolloff) |
| Contrast/Pivot | `hdr.contrast`, `contrast_pivot` | `_apply_luminance_section_controls` | [HDR grade](user-guide/grade-hdr.md#contrast-and-pivot) |
| Shadow / Black | `hdr.shadow_lift` | `_apply_hdr_base_adjustments` | [HDR grade](user-guide/grade-hdr.md#shadow--black) |
| Exposure Bands | `hdr.tone_equalizer_*` | `_apply_hdr_tone_equalizer`, monotonic mapping helpers | [HDR grade](user-guide/grade-hdr.md#exposure-bands) |
| Temperature/Tint | `hdr.white_balance_kelvin`, `hdr.tint` | `_apply_white_balance` through `_apply_hdr_color` | [HDR grade](user-guide/grade-hdr.md#color) |
| Saturation/Vibrance | `hdr.saturation`, `hdr.vibrance` | `_apply_saturation_vibrance` | [HDR grade](user-guide/grade-hdr.md#saturation) |
| RGB Primaries/Tint | `hdr.*_hue`, `hdr.*_purity` | `rgb_primaries_adjustment_matrix` | [HDR grade](user-guide/grade-hdr.md#rgb-primaries) |
| Lift/Gamma/Gain | `hdr.lift/gamma/gain`, pivots/ranges | `_primary_zone_masks`, `_apply_luminance_section_controls` | [HDR grade](user-guide/grade-hdr.md#lift-gamma-gain) |
| Curves | `hdr.curves_enabled`, channel curves | `_apply_curves`, `_apply_curve_set` | [HDR grade](user-guide/grade-hdr.md#curves) |

## SDR grade

| UI group/control | Model field(s) | Processing function/area | Manual |
|---|---|---|---|
| Base Rendition | `sdr.base_section_enabled`, `tone_mapper` | `_tone_map_sdr`, `_retone_map_sdr_reference` | [SDR grade](user-guide/grade-sdr.md#base-rendition) |
| Curve Contrast/Skew | `sdr.tone_contrast`, `tone_skew` | `_map_sdr_luma` Filmic path | [SDR grade](user-guide/grade-sdr.md#filmic) |
| Exposure/Shadow | `sdr.exposure`, `sdr.shadow` | SDR branch entry processing | [SDR grade](user-guide/grade-sdr.md#tone) |
| Highlight Recovery | `sdr.highlight_recovery` | `_apply_sdr_highlight_recovery` | [SDR grade](user-guide/grade-sdr.md#highlight-recovery) |
| Contrast/Pivot | `sdr.contrast`, `contrast_pivot` | `_apply_luminance_section_controls` | [SDR grade](user-guide/grade-sdr.md#contrast-and-pivot) |
| Follow HDR Color | `sdr.match_hdr_color` | `_effective_sdr_color_settings` | [SDR grade](user-guide/grade-sdr.md#follow-hdr-color) |
| Independent color | SDR color/primary fields | `_apply_hdr_color` via SDR conversion path | [SDR grade](user-guide/grade-sdr.md#follow-hdr-color) |
| Lift/Gamma/Gain | SDR values, pivots/ranges | `_primary_zone_masks` and luminance controls | [SDR grade](user-guide/grade-sdr.md#lift-gamma-gain-and-curves) |
| Curves | SDR channel curves | `_apply_curves` in SDR domain | [SDR grade](user-guide/grade-sdr.md#lift-gamma-gain-and-curves) |

## Proof and export

| User area | State/API | Implementation | Manual |
|---|---|---|---|
| Proof artifact | `ProofArtifactRequest/Response` | `proofing.py`, `/api/proof/artifact` | [Proof](user-guide/proof.md) |
| Fixed/Auto/Full target | `ProofReconstructionTarget` | proof reconstruction and display selection | [Proof](user-guide/proof.md#target-display-peak) |
| Windows display list | `/api/display` | `display_probe.py` | [Windows](setup/windows.md#what-hdr-finisher-can-read) |
| JPEG Ultra HDR export | `ExportSettings` JPEG fields | `JPEGUltraHDRExportBackend` | [Export](user-guide/export.md#jpeg-ultra-hdr) |
| AVIF gain map export | `ExportSettings.quality` | `AVIFGainMapExportBackend` | [Export](user-guide/export.md#avif--gain-map) |
| SDR PNG export | `ExportSettings` | `SDRPNGExportBackend` | [Export](user-guide/export.md#png-sdr) |
| Hosting verification | CLI/local report | `hosting_probe.py`, `verify_hosted_gainmap.py` | [Export](user-guide/export.md#validate-publication) |

## Tests by behavior

| Behavior | Primary automated coverage |
|---|---|
| Source loaders and fixture interpretation | `test_loader_fixtures.py`, `test_core.py` |
| Adjustments and curves/equalizer/color | `test_adjustments.py` |
| API contracts and session paths | `test_api.py` |
| Preview/display encoding | `test_preview_display.py`, `test_render_cache.py` |
| Frontend labels/state contract | `test_frontend_contract.py` |
| Capabilities | `test_capability_gates.py` |
| AVIF inspection | `test_avif_info.py` |
| Ultra HDR encoding/validation | `test_ultrahdr_export.py` |
| Proofing/reconstruction | `test_proofing.py` |
| Hosting survival inspection | `test_hosting_probe.py` |
| Folder picker behavior | `test_folder_picker.py` |

Use [Automated Testing Index](testing/Automated_Testing_Index.md) for the maintained requirement-level inventory.

## Source of truth

When entries disagree, resolve them in this order:

1. Active backend/frontend behavior and tests
2. Reproducible generated evidence
3. Durable validation records in `docs/testing/`
4. This user manual
5. Product requirements and design history
6. Backup copies

Fix both implementation and documentation when the discrepancy represents a bug rather than intentional behavior.
