# Session recorder

Records how HDR Finisher behaves while someone uses it normally, to catch
stalls and slowdowns the automated checks miss. It only watches; it changes
nothing in the app, its settings or the photos.

## Use

Double-click `Record a session.cmd`, or from `codebase`:

```
node tools/session-recorder/record.js
```

The app starts from source with your normal profile. Use it as usual. Press
**F9** in any window when something feels slow ("Marked" appears briefly).
Close the app to finish. Output goes to `output/recorder/<date-time>/`:

| File | Contents |
|---|---|
| `alerts.log` | Moments worth a look: stalls of 500 ms+, inputs slower than 300 ms, frame gaps of 500 ms+, errors, CPU fallbacks, F9 markers |
| `events.jsonl` | Everything, timestamped |
| `report.md` | Summary: per-window stalls, each F9 marker with what happened in the 15 s before, the ten worst moments, errors, GPU export turns, memory |

Rebuild a report with `node tools/session-recorder/report.js <session folder>`.

## What it records

- Each window (Grade, Library, the hidden GPU delivery renderer): main-thread
  tasks over 50 ms, inputs over 100 ms from click or key to paint, frame gaps
  over 100 ms while visible, console errors, crashes, JavaScript memory.
- `backend.log` and `desktop.log` from the profile: Library events,
  `gpu_delivery_turn` stage timings, errors and fallbacks.
- The machine: GPU load and graphics memory (`nvidia-smi`, NVIDIA only), CPU
  load, free RAM, disk activity, app and backend process memory.

## Notes

- The app runs with a debugging port on `127.0.0.1:9333` (local only) for the
  session. Set `HDR_RECORDER_PORT` to change it.
- `HDR_FINISHER_USER_DATA_DIR` points it at another profile (used for dry runs).
- Steve's RTX 4070 Ti has faulty graphics memory; isolated bright specks are
  the card, not the app.
