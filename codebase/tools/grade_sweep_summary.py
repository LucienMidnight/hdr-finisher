"""Summarize the release diagnostic without treating coverage gaps as passes."""
import csv
import json
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/performance/grade-0-9-2"


def median(values):
    return statistics.median(values) if values else None


def main():
    complete_inventory()
    inventory = json.loads((OUT / "inventory-complete.json").read_text())
    value_types = {}
    for control in inventory["controls"]:
        data = control.get("data", {})
        key = (control.get("path") or control.get("id") or
               ("local." + data["localGrade"] if data.get("localGrade") else
                ("local.hsl." if control.get("group") == "local-adjustments" else "hsl.") + data["hslKey"] if data.get("hslKey") else None))
        if key:
            value_types[key] = control.get("type")
    rows = []
    batches = []
    for file in sorted(OUT.glob("*.json")):
        if file.name.startswith("inventory") or file.name == "summary.json":
            continue
        report = json.loads(file.read_text(encoding="utf-8"))
        if "rows" not in report:
            continue
        batches.append({"file": file.name, "fatal": report.get("fatal"),
                        "stopped": report.get("stopped"), "invalidatedReason": report.get("invalidatedReason"), "errors": report.get("errors", [])})
        for row in report["rows"]:
            measurements = [o["ms"] for o in row["observations"] if not o.get("restore")]
            drained = [o["drainedMs"] for o in row["observations"]
                       if not o.get("restore") and o.get("drainedMs") is not None]
            if report.get("invalidatedReason"):
                measurements = []
            before = median(row.get("referenceBefore", []))
            active = median(row.get("referenceActive", []))
            reset = median(row.get("referenceReset", []))
            issues = []
            if row.get("referenceNotMeasured"):
                issues.append(row["referenceNotMeasured"])
            if row.get("typedMatches") is False:
                issues.append("typed value differs from entered value")
            if (row["zoom"] == "fit" and value_types.get(row["path"]) in ("range", "number")
                    and row.get("typedMatches") is not True):
                issues.append("typed entry not confirmed")
            if report["batch"] in ("hdr-tone", "sdr-tone") and report["date"] < "2026-11-11T07:42:25":
                issues.append("early first-exact observation; complete-settlement rerun required")
            if len(measurements) < 3:
                issues.append("fewer than three change measurements")
            if row.get("status") != "Preview changed":
                issues.append(row.get("status") or "unfinished")
            if row.get("resetPixelsMatch") is not True:
                issues.append("reset picture not confirmed")
            if row.get("errors") or row.get("runtimeErrors"):
                issues.append("driver/runtime errors; inspect source report")
            if measurements and median(measurements) >= 1000:
                issues.append("settled preview at or over 1 second")
            fps = row.get("drag", {}).get("presentationsPerSecond")
            if fps is not None and fps < 20:
                issues.append("drag below 20 presentations/s; review whether pointwise")
            if before and active and active > before * 1.25:
                issues.append("Exposure reference over 25% slower with effect active")
            if before and reset and reset > before * 1.25:
                issues.append("Exposure reference over 25% slower after reset")
            if report.get("invalidatedReason"):
                issues = [report["invalidatedReason"]]
            rows.append({"control": row["path"], "lane": row["lane"], "zoom": row["zoom"],
                         "batch": report["batch"], "date": report["date"], "commit": report.get("commit"),
                         "photo": report.get("conditions", {}).get("source", {}).get("filename"),
                         "samples": len(measurements), "minimumMs": min(measurements, default=None),
                         "medianMs": median(measurements), "maximumMs": max(measurements, default=None),
                         "latencyContract": report.get("latencyContract", "Settlement including background drain; conservative upper bound"),
                         "backgroundDrainedMedianMs": median(drained),
                         "imageChanged": row.get("status") == "Preview changed",
                         "resetPictureConfirmed": row.get("resetPixelsMatch") is True,
                         "typedEntryConfirmed": row.get("typedMatches") is True,
                         "dragPresentationsPerSecond": fps, "typedValue": row.get("typed"),
                         "referenceBeforeMs": before, "referenceActiveMs": active, "referenceResetMs": reset,
                         "issues": issues, "observationStatus": "Not met" if issues else "Met",
                         "source": file.name})
    latest = {}
    for row in sorted(rows, key=lambda r: r["date"]):
        latest[(row["control"], row["lane"], row["zoom"])] = row
    rows = list(latest.values())
    for row in rows:
        fit = latest.get((row["control"], row["lane"], "fit"))
        no_change = "Needs investigation: no screen change"
        if (row["zoom"] == "actual" and no_change in row["issues"] and fit
                and fit["samples"] == 3 and not any("reset picture" in i or "no screen change" in i
                                                     or "driver/runtime" in i for i in fit["issues"])):
            row["note"] = "Native sampled crop unchanged; full-frame Fit change/reset passed. Not a native pixel-agreement check."
    controls = {r["control"] for r in rows if r["samples"] >= 3}
    image_checks = [r for r in rows if r["samples"] >= 3 and r["imageChanged"] and r["resetPictureConfirmed"]]
    fully_observed = []
    for control in controls:
        items = [r for r in rows if r["control"] == control]
        lanes = {"hdr"} if control.startswith("hdr.") else {"sdr"} if control.startswith("sdr.") else {"hdr", "sdr"}
        expected = {(lane, zoom) for lane in lanes for zoom in ("fit", "actual")}
        if ({(r["lane"], r["zoom"]) for r in items if r["samples"] >= 3 and not r["issues"]} == expected
                and all(r["typedEntryConfirmed"] for r in items if r["zoom"] == "fit")):
            fully_observed.append(control)
    result = {"purpose": "Observation ledger, not release sign-off. Missing controls and untested gestures remain open.",
              "coverage": {"distinctControlsWithThreeSamples": len(controls),
                           "changeAndReturnObservations": len(image_checks),
                           "distinctControlsWithAChangeAndReturnObservation": len({r["control"] for r in image_checks}),
                           "controlsWithAllLaneZoomTimingAndTypedChecks": sorted(fully_observed)},
              "batches": batches, "rows": rows}
    (OUT / "summary.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if rows:
        with (OUT / "timings.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(dict.fromkeys(key for row in rows for key in row)))
            writer.writeheader()
            writer.writerows(rows)
    print(json.dumps({"rows": len(rows), "observationsWithoutIssues": sum(not r["issues"] for r in rows),
                      "batchesWithFatalErrors": [b["file"] for b in batches if b["fatal"]]}))
    if "--update-docs" in sys.argv:
        update_docs(rows)


def complete_inventory():
    runtime = OUT / "inventory-runtime.json"
    if not runtime.exists():
        return
    snapshots = [("initial Grade/viewer", json.loads(runtime.read_text()))]
    variants = OUT / "inventory-variants.json"
    if variants.exists():
        snapshots.extend((item["type"], item["controls"]) for item in json.loads(variants.read_text()))
    controls = {}
    for variant, items in snapshots:
        for item in items:
            data = item.get("data", {})
            binding = item.get("path") or data.get("sectionPath") or item.get("id")
            if not binding:
                binding = json.dumps([item.get("group"), item.get("tag"), item.get("role"), data, item.get("label")], sort_keys=True)
            if binding not in controls:
                controls[binding] = {**item, "seenIn": []}
            controls[binding]["seenIn"].append(variant)
    static_file = OUT / "inventory-static.json"
    static = json.loads(static_file.read_text()) if static_file.exists() else {"controls": []}
    missing = sorted({c["path"] for c in static["controls"]} - {c.get("path") for c in controls.values()})
    report = {
        "scope": "Grade and viewer widgets, including hidden controls, five mask modes and three Retouch modes. Repeated user-created list items and canvas handles are represented by their authoring families.",
        "runtimeWidgetCount": len(controls),
        "valueWidgetCount": sum(c.get("tag") in ("INPUT", "SELECT") for c in controls.values()),
        "missingStaticBoundPaths": missing,
        "sources": ["frontend/index.html", "inventory-runtime.json", "inventory-variants.json", "inventory-static.json"],
        "controls": list(controls.values()),
        "canvasAndRepeatedFamilies": [
            {"family": "Curves", "controls": ["Luma/R/G/B channel", "add point", "point X/Y drag and keyboard movement", "remove interior point"], "source": "frontend/curve-editor.js"},
            {"family": "Exposure Bands", "controls": ["add/remove node", "horizontal/vertical node drag", "selected EV", "influence", "smoothing", "Match HDR bands"], "source": "frontend/tone-equalizer.js"},
            {"family": "Color wheels", "controls": ["range tabs", "hue/saturation pad", "selected-range reset", "whole-module reset"], "source": "frontend/color-wheels.js"},
            {"family": "HSL", "controls": ["global/local channel or quick-start", "custom channel selector", "pick/add/subtract", "range centre/width/softness/target handles", "remove range", "show selection", "reset/delete channel"], "source": "frontend/hsl-panel.js"},
            {"family": "Local masks", "controls": ["paint/erase", "gradient placement/fan", "luminance sampling and range handles", "hue sampling and ranges", "Path points/Bezier handles/edge modes", "mask invert, opacity and Boolean structure", "list selection, bypass, rename, remove"], "source": "frontend/mask-controls.js; frontend/mask-gestures.js; frontend/local-adjustments-ui.js"},
            {"family": "Retouch", "controls": ["Inpaint/Heal/Clone", "source/destination placement and move", "repair list select/enable/remove/retry", "Apply settings", "Cancel"], "source": "frontend/retouch-ui.js"},
            {"family": "Geometry", "controls": ["crop handles/ratio", "straighten gesture", "perspective guides", "rotation/flip/apply/reset"], "source": "frontend/geometry-tools.js"},
            {"family": "Vignette", "controls": ["centre X/Y pad and sliders"], "source": "frontend/color-wheels.js"},
            {"family": "Film Look", "controls": ["stock", "stage shortcuts", "per-stock reset dots", "Push/Pull segments", "SDR copy actions"], "source": "frontend/group-presets.js; frontend/adjustment-controls.js"},
            {"family": "Grade commands", "controls": ["Match entire HDR grade", "group copy/reset/bypass", "presets", "undo/redo"], "source": "frontend/sdr-match-ui.js; frontend/group-presets.js; frontend/adjustment-controls.js"},
        ],
        "qualification": "Inventory is not a claim that every listed workflow has been exercised. Consult the timing/coverage ledger.",
    }
    (OUT / "inventory-complete.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if missing:
        raise RuntimeError(f"Runtime inventory missed static paths: {missing}")


def update_docs(rows):
    complete = json.loads((OUT / "inventory-complete.json").read_text(encoding="utf-8"))
    inventory = complete["controls"]
    controls = {}
    for c in inventory:
        if c["tag"] not in ("INPUT", "SELECT"):
            continue
        data = c.get("data", {})
        key = c.get("path") or c.get("id") or ("local." + data["localGrade"] if data.get("localGrade") else
              ("local.hsl." if c.get("group") == "local-adjustments" else "hsl.") + data["hslKey"] if data.get("hslKey") else
              "mask." + data["localMaskParam"] if data.get("localMaskParam") else
              f"mask.range.{c.get('label', 'handle')}.{data['rangeHandle']}" if "rangeHandle" in data else
              f"{c.get('group', 'Grade')}.{c.get('label', 'anonymous value')}")
        if key:
            controls[key] = c
    for row in rows:
        controls.setdefault(row["control"], {})
    checked = {r["control"] for r in rows if r["samples"] >= 3}
    responded = {r["control"] for r in rows if r["samples"] >= 3 and r["imageChanged"] and r["resetPictureConfirmed"]}

    def seconds(items):
        values = [r["medianMs"] / 1000 for r in items if r.get("medianMs") is not None]
        return f"{min(values):.3f}–{max(values):.3f}" if values else "Not measured"

    text = ["<!-- grade-sweep-start -->", "### 0.9.2 Grade control observations (November 11, 2026)", "",
            "Release bar: settled preview under 1.0 s at Fit and 100%; pointwise drag at least 20 presentations/s; "
            "Exposure reference no more than 25% slower with the effect active or after reset. "
            "These observations do **not** establish complete release acceptance. Missing controls, prerequisites, "
            "gestures, reset/typed checks and driver errors remain open. A no-change patch is an investigation item, not proof of a broken control.", "",
            "Conditions: disposable 6000×4000 resized photo TIFF, Electron 43.4.0, Windows, NVIDIA Lovelace, "
            "2560×1440, DPR 1; one GPU batch at a time. Raw samples, exact commit/date, preparations, errors "
            "and before/active/reset reference times: `codebase/output/performance/grade-0-9-2/summary.json` "
            "and the named batch JSON files. Fit/100% columns show the range of lane medians, not a best sample. "
            "RAW-only reconstruction is not qualified by this TIFF. Earlier rows include background catch-up drain "
            "and are conservative upper bounds; later rows time visible exact settlement and retain the separate "
            "backgroundDrainedMedianMs in JSON/CSV. These metrics must not be used as a before/after speed claim. "
            "Three collided launches are invalidated and excluded from acceptance.", "",
            f"**Review stopped at the two-hour measurement allowance.** {len(checked)} distinct control values had three-sample "
            f"observations; {len(responded)} changed and returned to their starting picture in at least one lane/view. That is "
            "response evidence, not proof that all 174 work correctly in every condition. Full acceptance remains open. "
            "Vignette, Geometry/Crop, highlight handling, Exposure Bands, Curves, Match, RAW-only controls, most authoring "
            "gestures, native Film Look/Local and the unfinished Black & White/SDR Tone cases need coverage. No heavy "
            "reconstruction timing exception has been claimed from the resized TIFF.", "",
            "**Unresolved speed observations:** SDR Exposure reference after Denoise Amount went from 31 ms to "
            "235 ms active / 245 ms reset; after Retouch Opacity from 36 ms to 235 / 233 ms at Fit (three-trial medians). "
            "These exceed the 25% limit. The scheduler/source invalidation work needs focused profiling and a strong "
            "fixture before a safe fix (estimate 1–2 hours plus focused pixel checks); this was not started after the cap. "
            "Film print exposure and stock colour controls produced about 15 presentations/s, also below the "
            "pointwise target; lens controls were about 10–12 presentations/s. These are unresolved, not exceptions. "
            "Smaller frame-quantized reference increases remain in the ledger without being waived.", "",
            "**Correctness follow-up:** a behaviour regression reproduced generic percentage readouts using a stale "
            "unit and clamping typed percentages. The focused fix captures the unit before edit mode; the regression "
            "passes, but the app rerun was prevented by the measurement cap. Original failed typed observations stay "
            "in the ledger. Superseded source-tile HTTP 409 responses are retained as errors requiring review, not "
            "silently suppressed. Earlier Push/Pull probes injected fractional stops into its hidden integer input, "
            "causing HTTP 400 validation errors; the driver now uses its real whole-stop buttons, but that rerun is "
            "unperformed. This is a fixture error, not evidence of a broken segmented control. "
            "Retouch method/feather/hardness/texture need separated repairs on a visible defect; "
            "Local range-handle setup and Sharpen Radius also need stronger fixtures. Sharpen Amount/Threshold "
            "responded at 100%; Fit is inconclusive, consistent with the existing native-view judgement requirement. "
            "No processing formula was changed, and this diagnostic does not prove preview/export colour agreement.", "",
            "| Control | Range | Fit (s) | 100% (s) | Fit drag (presentations/s) | Status / open check | Photo / commit |",
            "| --- | --- | --- | --- | --- | --- | --- |"]
    for key, control in sorted(controls.items()):
        items = [r for r in rows if r["control"] == key]
        fit = [r for r in items if r["zoom"] == "fit"]
        native = [r for r in items if r["zoom"] == "actual"]
        rates = [r["dragPresentationsPerSecond"] for r in fit if r.get("dragPresentationsPerSecond") is not None]
        issues = sorted({issue for r in items for issue in r["issues"]})
        if not fit or not native:
            issues.append("Fit/100% coverage incomplete")
        expected = {"hdr"} if key.startswith("hdr.") else {"sdr"} if key.startswith("sdr.") else {"hdr", "sdr"}
        if {r["lane"] for r in fit} != expected or {r["lane"] for r in native} != expected:
            issues.append("HDR/SDR lane coverage incomplete")
        if not items:
            status = "Not met: not checked"
        elif issues:
            status = "Not met: " + "; ".join(issues)
        else:
            status = "Met (measured observations only)"
        minimum, maximum = control.get("min"), control.get("max")
        bounds = f"{minimum} to {maximum}" if minimum not in (None, "") else "Discrete / see inventory"
        fps = f"{min(rates):.1f}–{max(rates):.1f}" if rates else "Not measured / N/A"
        conditions = "; ".join(sorted({f"{r.get('photo') or 'see JSON'} / `{(r.get('commit') or 'unrecorded')[:8]}`" for r in items})) or "—"
        text.append(f"| `{key}` | {bounds} | {seconds(fit)} | {seconds(native)} | {fps} | {status} | {conditions} |")
    for family in complete["canvasAndRepeatedFamilies"]:
        text.append(f"| {family['family']} authoring/actions family | {'; '.join(family['controls'])} | Not measured | Not measured | Not measured | Not met: gestures/actions not qualified | `{family['source']}`; November 11 inventory |")
    text.extend(["", "Gestures and actions need separate evidence: Curves point add/drag/remove/channel; Exposure Bands "
                 "node add/drag/remove/influence/Match; colour-wheel pads; HSL picking, selection structure and edges; "
                 "Local mask painting, Boolean structure and each mask type; Retouch repair creation/moves and method settings; "
                 "crop handles/rotation/flips; module bypass/reset/copy actions and SDR Match. A value-control timing row does not qualify these actions.",
                 "", "<!-- grade-sweep-end -->", ""])
    file = ROOT.parent / "docs/technical/performance-table.md"
    original = file.read_bytes()
    newline = "\r\n" if b"\r\n" in original else "\n"
    source = original.decode("utf-8").replace("\r\n", "\n")
    start, end = "<!-- grade-sweep-start -->", "<!-- grade-sweep-end -->"
    block = "\n".join(text)
    if start in source:
        first, tail = source.split(start, 1)
        _, tail = tail.split(end, 1)
        source = first + block + tail.lstrip("\n")
    else:
        source = source.replace("## 5. Grade (editing)\n", "## 5. Grade (editing)\n\n" + block, 1)
    file.write_bytes(source.replace("\n", newline).encode("utf-8"))


if __name__ == "__main__":
    main()
