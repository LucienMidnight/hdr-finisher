# HDR Finisher Usability Remediation Sprint PRD (2026-09-28)

## Summary

A small, low-risk pass in three stages:

1. Fix the broken local-adjustment controls.
2. Make the false-color overlay honour its opacity slider.
3. Merge transient feedback into one status bar.

Stages 1 and 2 are independent and can ship alone. Stage 3 is the only one that adds a new internal API.

**Out of scope, deferred to separate sprints** (see `HDR_Finisher_PRD_v1.2.md`, "Deferred: separate sprints for local-grade transfer and preview settling"): copying, moving, or matching local grades between the HDR and SDR lanes, and all preview resolution, settling, and refinement-timing changes.

## Implementation Changes

### 1. Local-adjustment controls

**Gizmo visibility**

- Add a `Hide gizmo` / `Show gizmo` toggle beside the selected mask controls.
- It applies only to the selected local adjustment.
- When hidden, skip only the `renderPhase: "gizmo"` drawing pass (handles, rails, paths, brush cursor). The adjustment and its optional red mask overlay stay active.
- While hidden, pointer handle hit-testing for that adjustment is off, so invisible handles can't be dragged. Brush/Eraser painting and Path node creation are paused, and the toggle reads "Show gizmo to edit". Creating or starting to edit a mask shows the gizmo again automatically.
- Visibility is remembered per adjustment ID for the current session. It is not saved in the project and not recorded in undo history.

**Path feather slider**

- The Path mask feather slider is missing its rail and fill because `createPathFeatherControl` (`frontend/app.js`) never calls `enhanceRangeControl`.
- Call `enhanceRangeControl(input)` after `label.append(...)`, because it needs a parent node.
- Match the child order the other local sliders use (heading, input, output).
- `enhanceRangeControl` switches `step` to a finer value. Check that:
  - the invalid-geometry rollback (`input.value = previous * 200`) still lands on a valid value and redraws the fill;
  - double-click reset to `data-default-value="4"` sends the same input and change events as the other sliders;
  - drag commits still end with one `commitSelectedLocal()` per gesture.

### 2. False color

- In `backend/hdr_finisher/overlay.py::_false_color_overlay`, replace `alpha = opacity × (0.45 + 0.55 × normalized)` with a uniform `alpha = opacity × 255`.
- At 100% every pixel shows its palette colour. Lower values blend evenly with the preview.
- Keep the luminance band thresholds, palette, peak-nit normalization, zebra behaviour, and slider range (10–100%) unchanged.
- **Compatibility:** `shared.overlay_opacity` is saved in projects (default 0.72). With uniform alpha, dark regions that used to show at about 32% will show at 72%. Lower the default for new projects to 0.5 and leave stored values alone. Note the visual change in the release notes.
- **Edges:** make sure the overlay's scaling and smoothing leave no image showing through at the frame edges at 100%.
- **Lag:** at high opacity a stale overlay hides the live edit. While a new overlay is pending after an image-affecting edit, drop the old one or fade it to 50% of its set opacity. Never show an overlay from a different generation at full strength.

### 3. Unified status bar

**Status manager**

- Add a small frontend status manager (its own module, not more code in `app.js`).
- Each entry has: `id`/channel, severity (`info | progress | success | error | attention`), message, optional progress (determinate or indeterminate), an optional action `{label, run}`, and lifecycle rules.
- An entry with the same channel replaces the previous one. Different channels show side by side, so save and export never overwrite each other.
- Feature code calls the manager. It no longer writes directly to badges or status elements.

**Placement**

- Turn `#viewer-status-dock` into the application status bar.
- It must still show when no image is loaded, because project-open failures can happen then. Either move it out of the viewer header area or add a fallback slot for the empty state.
- Keep the existing attention rows (source interpretation review) as `attention` entries. They never auto-dismiss, because they ask the user for a decision.

**What gets routed through it**

- Project saving, saved, and save failures.
- Export queued, rendering, encoding, completed, cancelled, and failed. `els.exportStatus` keeps only durable results and actions, such as opening the output location, and stops repeating progress text.
- Failures from: project open or import, edits, Match, proof generation, path-mask processing, and external links.

**Project badge**

- The top project badge shows only the project name and unsaved state. Remove its transient messages.

**Lifecycle**

- Progress stays until it finishes.
- Success messages dismiss after about 4 s. Hovering or keyboard focus pauses the timer.
- Errors stay until dismissed, or until the same channel later succeeds.

**Accessibility**

- Each entry has its own role: `role="status"` for info and progress, `role="alert"` for errors.
- Remove `aria-live` from the dock container to stop double announcements.
- Dismiss and action buttons are reachable by keyboard. Dismissing moves focus somewhere sensible.

**Dialogs that move into the status bar**

- Project-open failures from the Open Project controls.
- Project-save failures from Save or Save As.
- Failure to open documentation or other external help links.

**Dialogs that stay modal**

- The Save/Discard/Cancel prompt when closing the window.
- The unsaved-project warning at Windows shutdown or session end.
- Backend startup failure and unexpected backend exit.
- Renderer-process crash.
- Project-open failures from the OS or a deep link before the renderer is ready.
- The About dialog.
- Native file and folder pickers, and overwrite confirmations.

## Interfaces and State

- There is no project-file schema change. Gizmo visibility lives only in session state.
- New: the frontend status-manager module, with a narrow API such as `status.post(entry)`, `status.update(id, patch)`, `status.clear(id)`.
- The false-color alpha formula is the only change to backend rendering. The `overlay_opacity` default drops to 0.5 for new projects only.

## Test Plan

**Gizmo**

- Test the toggle for radial, linear, path, brush, and AI masks.
- Confirm the adjustment and mask overlay stay active while the gizmo is hidden.
- Confirm hidden handles can't be hit-tested and brush painting is paused.
- Confirm visibility is per adjustment and survives switching between adjustments.
- Confirm it isn't saved in the project or recorded in undo.

**Path feather**

- Add a DOM regression test that the Path feather slider gets its rail and fill, and that value updates, the output label, and double-click reset work.
- Confirm one drag is one undo step.
- Confirm that when invalid geometry is rolled back, both the value and the fill show the previous value.

**False color**

- Unit-test that alpha is exactly 10%, 50%, and 100% for both dark and bright pixels.
- Add a composited-image regression test: at 100%, the output equals the palette with no image showing through, edges included.
- Confirm that stored projects keep their saved opacity value and new projects get 0.5.
- Confirm that a stale overlay is never shown at full strength after an edit.

**Status bar**

- Run a save and an export at the same time and check both entries show.
- Check that progress replaces earlier progress, that errors stay and are cleared by a successful retry, that success messages dismiss on time and pause on hover or focus, and that the action buttons work.
- Check screen-reader announcements, with one announcement per event.
- Check that the status bar shows when no image is loaded.
- Confirm the dialogs that stay modal still appear where they should (the existing `in-app-confirmations.js` and `confirmation-focus.js` cover this).

## Implementation note (2026-09-29)

Implemented in the specified three-commit order. Gizmo visibility is per-adjustment session state and never enters project data or history; coverage targets the four mask types the application currently implements (Brush, Linear Gradient, Luma Range, and Path), per product clarification. False Color now uses uniform alpha, new projects default to 50%, saved opacity values are preserved, and an invalidated overlay is dimmed until its current-generation replacement arrives. The new status manager owns independent lifecycle channels for project, import/edit, Match, proof, path-mask, export, and external-link feedback. The status bar remains in the viewer-header location and is always visible, per product clarification; the source-interpretation attention prompt remains persistent and retains both decision actions. Modal confirmation, crash, startup, and native-picker boundaries were not changed.
