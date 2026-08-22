# HDR Reference White

HDR Reference White sets the brightness assigned to the image's ordinary white. Brighter highlights can still go above it. It is a project/mastering setting, not a monitor control.

| Setting | Use it for |
|---|---|
| **203 nits — Standard HDR photography** | New HDR photo work and normal ISO HDR or gain-map delivery. This is the default for every new project. |
| **100 nits — Controlled 100-nit workflow** | A workflow intentionally mastered around 100-nit white or a specified technical comparison. |

Changing the setting is a reversible grade edit. It immediately updates the HDR preview, scopes and nit labels, false-color bands that follow the project, proof state, export preflight, and exported HDR pixels. With absolute-nit highlight controls disabled, changing 100 to 203 raises HDR placement by exactly 2.03×, about 1.02 stops. It does not rescale a generated SDR fallback, and it never replaces an imported authored SDR rendition.

Keep these controls separate:

- **Source diffuse white** describes the source or an explicit import assumption.
- **HDR Reference White** maps project-linear `0.18` to 203 or 100 nits.
- **Measured content peak** reports the current image; **export/mastering peak** constrains or signals delivery intent.
- **Display peak** describes hardware; **proof target** simulates available display capacity.
- **Highlight-compression target** is a grading control.
- **False-color band anchor** and **false-color ceiling** only configure analysis.
- **Windows SDR white** affects Windows/Chromium presentation and does not alter the project or file.

The current Chromium extended-canvas path uses 203 nits as a qualified runtime convention. It is not a universal WebGPU promise of physical monitor nits. Exact emitted-light claims require a recorded OS/browser/display configuration and, where needed, measurement.

HLG input remains supported under the documented import assumption, but HLG output and HLG proofing are outside this release.
