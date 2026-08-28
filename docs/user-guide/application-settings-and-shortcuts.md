# Application settings and shortcuts

In the desktop app, open **Settings** from **File > Settings** or use the assigned **Open Settings** shortcut. These preferences belong to HDR Finisher itself rather than to one saved project.

## General defaults

**HDR reference white** updates the active project when one is open and also sets the starting reference white for newly imported source sessions. Saved projects keep their stored reference-white value when reopened.

**Rendering mode** controls interactive preview rendering:

- **Auto** uses WebGPU when it is available and falls back to the backend renderer when needed.
- **GPU preferred** requests the WebGPU preview path when the current hardware and content support it.
- **CPU compatibility** keeps preview rendering on the backend.

Rendering mode does not change final export quality.

## Default folders

The Locations section can set independent starting folders for project save, project import, finished-file save, source-file import, and the shared HDRF preset library. Clearing a location restores its default. Folder selection is available in the desktop application because it uses native file dialogs.

The preset library is the common root for keyboard-shortcut presets and grading presets. HDR Finisher creates separate **Keyboard Shortcuts** and **Grading** subfolders so both systems can share one portable library without mixing file types. A portable or otherwise writable installation uses an **HDR Finisher Presets** folder beside the executable when possible. Installed macOS bundles and read-only application folders fall back to the application's writable local-data directory. Use **Reveal** to open the effective library in Finder or Explorer, or **Choose** to move future preset saves to a custom location.

## Adjustment-group presets

Each global grading group has a **Preset** button beside **Reset**. A preset captures only the values owned by that group and the active HDR or SDR rendition. For example, an HDR Tone preset stores HDR Tone controls without changing Color, Curves, crop geometry, local adjustments, section bypass state, proof settings, export settings, or project metadata.

Choose **Preset**, select **Apply** beside a saved preset, or enter a name and choose **Save current**. Saving with an existing name offers to replace that group preset. Presets can also be deleted from the same dialog. Desktop presets are individual `.hdrf-grade.json` files in the **Grading** subfolder of the configured HDRF preset library, making them reusable across projects. Browser-only development sessions use local browser storage instead.

Film Look also includes read-only built-in presets for Large Format Fine, 35mm Fine, 35mm Balanced, 35mm Fast, and 16mm Fine. These replace the former Reference Model dropdown. Built-ins can be applied and then edited, but they cannot be overwritten or deleted. Film Look's normal Reset state is Neutral.

## Custom shortcuts

The Shortcuts section lists application commands and continuous grading controls. Select the shortcut field next to a command and press the desired key combination. Press **Backspace** or **Delete** while recording to remove a binding, or **Escape** to cancel.

If a key combination is already assigned, HDR Finisher offers to move it to the new command. Each row can be reset independently, and **Reset all** restores the complete default mapping.

The defaults are intentionally conservative. They cover conventional application commands such as Settings, Help, Open/Import, Save, Save As, Export, Undo, and Redo. Viewer controls, grading adjustments, crop tools, compare actions, and other quick actions start unassigned. On macOS, HDR Finisher uses the standard **Command-Shift-Z** convention for Redo and avoids assigning system combinations used for screenshots, Spotlight, application switching, window management, and other operating-system features. If you deliberately record a known macOS system combination, the app warns that macOS may consume it before HDR Finisher receives it.

Named presets capture the currently resolved shortcut map. Use **Save preset** to store a map and **Load** to activate one. This is useful for switching between a laptop layout and a dedicated editing-controller layout.

## Stream Decks, control wheels, and accessibility

Every continuous slider exposed by the editor receives three assignable actions: **Increase**, **Decrease**, and **Reset**. These actions use the control's own step size and limits, so they behave like operating the on-screen slider.

- Hold an assigned key to repeat an increase or decrease.
- Hold **Ctrl** while operating an assigned Increase or Decrease command for a step ten times finer. On macOS this remains the Control key, not Command.
- Map a wheel's clockwise and counter-clockwise events to the paired Increase and Decrease shortcuts.
- Map a Stream Deck button to Reset when a quick neutral return is useful.

The shortcut acts on the named HDR, SDR, or shared control. Actions labeled **Active rendition controls** follow whichever HDR or SDR rendition is currently selected.

## Slider and graph modifiers

- Hold **Ctrl** while dragging a slider or pressing its arrow keys for approximately 10× finer adjustment. You can press or release Ctrl during a drag without making the value jump.
- Hold **Shift** while dragging a slider to land on its authored semantic positions. **Shift+Arrow** moves to the next landing position. The rail stays visually empty; the landing profile still includes the control's home value and uses meaningful EV, percentage, Kelvin, degree, nit, or dynamic-range anchors where applicable.
- When Ctrl and Shift are held together on a slider, snapping takes precedence.
- Curves and Exposure Bands use **Ctrl** for fine graph movement. Shift does not snap graph points.
- In Exposure Bands, **Ctrl/Command+Left/Right** keeps its established meaning: move the selected band horizontally. **Ctrl+Up/Down** and Ctrl-drag provide fine adjustment.

Home/End, direct numeric entry, and double-click reset keep their existing behavior. Alt/Option is not a precision modifier.

## Updates

The desktop app can check the public GitHub Releases feed at startup or on demand. It compares the installed version with the latest release tag and shows a dismissible notice when a newer release exists. It does not download or install updates automatically, and an offline or failed check does not interrupt editing.
