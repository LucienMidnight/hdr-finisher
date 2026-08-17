# Compact Workspace Validation

Use this checklist for both the macOS and Windows desktop builds after responsive workspace changes.

## Automated acceptance

Run `node tools/playwright_layout_qa.js` from `codebase/` against a running backend. The viewport matrix covers 1100×720, 1280×720, 1366×768, 1406×756, and the 1600×900 wide layout. Generated screenshots and JSON evidence belong under ignored `codebase/output/design-qa/`.

The run must confirm:

- no page-level horizontal overflow;
- Metadata begins collapsed below 1500 px and reopens as an overlay without moving the workspace;
- the Control Panel remains at least 300 px wide;
- Scopes begins open, renders at a nonzero size, and can be collapsed and reopened;
- comparison, zoom, Fit, 100%, and Viewer options remain visible;
- Viewer options and Metadata restore focus after Escape;
- the source-interpretation warning and both actions remain inside the viewer;
- the existing wide-layout splitters, defaults, and preview cadence still pass.

## Packaged desktop acceptance

1. Start with no saved window state, then open the application on the smallest supported display.
2. Resize the outer window to 1100×720. Confirm there is no document scrollbar and no content is hidden behind the Control Panel.
3. Open and dismiss Metadata by pointer and keyboard. Confirm it overlays the viewer and does not resize it.
4. Open Viewer options, operate Overlays and High-res Preview, then close with Escape. Confirm focus returns to Viewer options.
5. Load an ambiguous HDR source. Confirm the interpretation warning stacks when required and both actions are fully visible.
6. Collapse and reopen Scopes. Confirm the preview grows and returns without stale or stretched scope rendering.
7. Move the saved window state from a larger display to the small display and relaunch. Confirm the entire window is clamped inside the current work area.
8. Repeat steps 2–7 in the packaged macOS and Windows applications before release sign-off.
