# Crop & Rotate Reset renderer OOM

The debug Electron main process (PID 15076) logged window-unresponsive at
2026-09-04T04:25:10.524Z, then render-process-gone at 04:25:32.558Z with reason
oom and exit code -536870904. The main process and backend remained running.

The local Crashpad dump is preserved in the pre-audit archive at
`outer-output/diagnostics/2026-09-04-obs-highlight-black-screen/oom-crop-reset/renderer.dmp`.
Extracted V8 annotations are retained here in `v8-oom.json`. They report MarkCompactCollector: young object promotion
failed, approximately 4053.5 MB live heap / 4082.4 MB heap capacity, and a stack
through syncGlobalEditState and refreshScopes. This is JavaScript heap
exhaustion, not evidence that all physical RAM was exhausted. A post-crash
system snapshot reported 47,834,088 KiB free physical memory; this is not a
measurement of free RAM at the instant of the crash.

The source reproduces an unbounded Promise retry: refreshScopes sees dirty
global edits, calls syncGlobalEditState, then unconditionally retries.
Perspective mode deliberately defers global sync and leaves the dirty flag
set. Crop & Rotate Reset can enter that exact state while leaving Perspective
open. Repeated immediately resolved Promise continuations starve input and
retain a growing chain until V8 runs out of memory. queueEditCommand had an
equivalent retry hazard. Rejected syncs could also trigger these loops.

The fix defers scope work during Perspective and stops retrying on failed or
still-dirty sync results. Crop & Rotate Reset refreshes the transient
Perspective preview and preserves the separate reset in its cancel snapshot.

Validation: seven bounded edit-sync tests pass on the fix; six of them detect
unbounded retries on the original source. The browser regression reproduces
Perspective Reset followed by Crop & Rotate Reset, verifies an event-loop
timer still runs, and confirms Apply commits both resets. The existing
Perspective guide, Cancel, Apply, lane switching, and undo/redo checks pass.

This establishes the cause of the debug-instance crash. The earlier installed
instance had no renderer dump, so an identical cause for that incident cannot
be established from its available logs. The fix is in source, not an installed
application update. No crashed session was closed or reloaded during diagnosis.
