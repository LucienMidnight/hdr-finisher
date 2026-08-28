# HDR Finisher — UI redesign notes

Prototype: `HDR Finisher.dc.html`. Self-contained, no backend; mock data and one still from your Blender test scene. Scopes (waveform / histogram / parade) are computed live from that image, so they behave like real scopes.

## Structure

- **Top bar** — product lockup + filename on the left, the four workflow tabs dead center as the only tabbed surface in the app, encoder status + gear on the right. Nothing else lives up here; Import / Eject / Test pattern moved into the Import stage and Settings.
- **Left rail** — source only: classification badge with headroom meter, interpretation, file facts, pipeline chips, scope disclaimer pinned to the bottom. No floating metadata anywhere else in the app.
- **Center** — viewer bar (branch, A/B, zoom, overlays), image, probe strip, then the scopes dock.
- **Right rail** — settings for the active stage. One panel per stage, same header shape each time.

## Workflow tabs

Numbered `01–04`, 12.5 px medium, 2 px teal underline on the active tab and a teal ordinal. Inactive tabs are `#8b9399` on the same background — no chrome, no pills. They are the tallest interactive target in the bar, so they read as navigation rather than as buttons.

## Control groups

- Header is a 38 px band: caret, uppercase title, modified count, `Reset` (only when modified), then the **eye at the far right**, separated by its own hover target.
- Bypassed group: eye becomes eye-off, badge reads `BYPASSED` in orange, body drops to 35 % opacity. State is unmistakable from the header alone.
- Group bodies have **no fill** — they sit flush on the rail and are separated by 1 px hairlines. The open header gets a barely-there `#111416` band so you can see which group is expanded. That replaces the boxed panel look.

## Sliders

2 px track, fill drawn **from the control's default** to the current value (so bipolar controls fill outward from center), 2 px × 14 px bar handle. Modified controls turn the fill and readout teal; untouched ones stay neutral grey. Whole row is the drag target; double-click resets.

## Color

- Teal `#4fb3c9` — the calm functional accent: active tab, active state, modified values, HDR branch, confirmed pre-flight. Dimmed to `#2b5b68` for borders.
- Orange `#e8963c` — reserved for attention only: PQ ceiling on the bands graph, selected band node, stale proof, bypassed groups, above-display-headroom, and the single Export button.
- Everything else is the neutral grey ramp `#0a0b0c → #e8ecee`. IBM Plex Sans for UI, IBM Plex Mono for every number.

## Renames / moves

- **Tone Equalizer → Exposure Bands.** Applied throughout.
- **Lift / Gamma / Gain** now sits last, collapsed, labelled as legacy compatibility, per the PRD deprecation note.
- **Settings modal** (gear, far right): Test patterns, Debug, Experimental, Preferences.

## Implementation

Values, formatting and modified-state live in one table (`DEFS`) keyed by backend path — `hdr.exposure`, `sdr.recovery`, etc. — so group membership, modified counts, group reset and slider geometry all derive from it. Porting this to the real app is mostly mapping that table onto your existing `data-path` attributes.

Not carried over from the current build (deliberate): rail splitters, tooltips, the RGB-primaries block, and the SDR "follow HDR color" logic are stubbed as static rows in the prototype — they were behaviour, not layout questions.
