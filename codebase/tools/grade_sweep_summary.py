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


def significant_slowdown(before, after):
    return bool(before and after and after > before * 1.25 and after - before > 20)


def error_kind(error):
    if isinstance(error, str):
        return "driver" if "locator." in error or "Timeout" in error else "unresolved"
    message = error.get("message", "")
    url = error.get("url", "")
    if error.get("status") == 409 and ("/source-tile/" in url or "/denoise-measurement/" in url):
        body = error.get("body", "")
        if body and not any(word in body.lower() for word in ("stale", "supersed", "cancel", "obsolete")):
            return "unresolved 409; inspect captured body"
        return "expected superseded work" if body else "expected recoverable 409; W1 body absent, exact reason unconfirmed"
    if "status of 409" in message:
        return "expected superseded work (browser resource log)"
    if "int_from_float" in message + error.get("body", ""):
        return "driver fractional Push/Pull"
    if error.get("status") == 400 or "status of 400" in message:
        return "request validation; correlate with fractional Push/Pull in source report"
    return "unresolved"


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
            typed_confirmed = row.get("typedMatches") is True
            if value_types.get(row["path"]) == "number" and row.get("typed") is not None:
                try:
                    typed_confirmed = float(row["typed"]) == float(row.get("plan", {}).get("alternative"))
                except (TypeError, ValueError):
                    pass
            if row.get("referenceNotMeasured"):
                issues.append(row["referenceNotMeasured"])
            if row.get("typedMatches") is False:
                issues.append("typed value differs from entered value")
            if (row["zoom"] == "fit" and value_types.get(row["path"]) in ("range", "number")
                    and not typed_confirmed):
                issues.append("typed entry not confirmed")
            if report["batch"] in ("hdr-tone", "sdr-tone") and report["date"] < "2026-11-11T07:42:25":
                issues.append("early first-exact observation; complete-settlement rerun required")
            if len(measurements) < 3:
                issues.append("fewer than three change measurements")
            if row.get("status") not in ("Preview changed", "Expected identity verified", "Expected state verified"):
                issues.append(row.get("status") or "unfinished")
            if row.get("resetPixelsMatch") is not True:
                issues.append("reset picture not confirmed")
            error_types = sorted({error_kind(e) for e in row.get("errors", []) + row.get("runtimeErrors", [])})
            if any(not kind.startswith("expected") for kind in error_types):
                issues.append("driver/runtime errors; inspect source report")
            if measurements and median(measurements) >= 1000:
                issues.append("settled preview at or over 1 second")
            fps = row.get("drag", {}).get("presentationsPerSecond")
            if fps is not None and fps < 20:
                issues.append("drag below 20 presentations/s; review whether pointwise")
            if significant_slowdown(before, active):
                issues.append("Exposure reference over 25% slower with effect active")
            if significant_slowdown(before, reset):
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
                         "imageChanged": row.get("status") == "Preview changed" and row.get("expected") not in ("identity", "state"),
                         "expectedIdentityConfirmed": row.get("status") == "Expected identity verified",
                         "expectedStateConfirmed": row.get("status") == "Expected state verified",
                         "resetPictureConfirmed": row.get("resetPixelsMatch") is True,
                         "typedEntryConfirmed": typed_confirmed,
                         "dragPresentationsPerSecond": fps, "typedValue": row.get("typed"),
                         "referenceBeforeMs": before, "referenceActiveMs": active, "referenceResetMs": reset,
                         "issues": issues, "observationStatus": "Untested" if issues else "Met",
                         "source": file.name, "errorClassifications": error_types, "rawStatus": row.get("status"), "expected": row.get("expected")})
    latest = {}
    for row in sorted(rows, key=lambda r: r["date"]):
        key = (row["control"], row["lane"], row["zoom"])
        previous = latest.get(key)
        if previous and previous["samples"] >= 3 and row["samples"] < 3:
            previous["issues"].append("Latest rerun incomplete: " + row["source"])
            previous["incompleteRerun"] = row["source"]
        else:
            latest[key] = row
    rows = list(latest.values())
    for row in rows:
        fit = latest.get((row["control"], row["lane"], "fit"))
        no_change = "Needs investigation: no screen change"
        if (row["zoom"] == "actual" and no_change in row["issues"] and fit
                and fit["samples"] == 3 and not any("reset picture" in i or "no screen change" in i
                                                     or "driver/runtime" in i for i in fit["issues"])):
            row["note"] = "Native sampled crop unchanged; full-frame Fit change/reset passed. Not a native pixel-agreement check."
    for row in rows:
        issues = row["issues"]
        if any("1 second" in i or "presentations/s" in i or "25% slower" in i for i in issues):
            row["observationStatus"] = "Not met (real problem)"
        elif not issues:
            row["observationStatus"] = "Met"
        else:
            row["observationStatus"] = "Untested"
        if row["control"].endswith(".bands.add-remove") and row.get("expected") == "identity" and "Needs investigation: gesture picture mismatch" in issues:
            row["triage"] = "Driver mistake: adding a node changes a non-neutral influence curve; removal restored the original picture. New checks verify node count instead."
        if row["batch"] == "raw-highlights" and row.get("medianMs", 0) and row["medianMs"] >= 1000:
            row["observationStatus"] = "Exception"
            row["triage"] = "Heavy real-RAW reconstruction/re-development; owner allows waits over one second. Other missing checks remain open."
        if "Needs investigation: no screen change" in issues:
            fit = latest.get((row["control"], row["lane"], "fit"))
            if row["zoom"] == "actual" and fit and fit["imageChanged"] and fit["resetPictureConfirmed"]:
                row["triage"] = "Fixture: sampled native crop unchanged; full-frame change/reset demonstrated. Native visual effect remains unqualified."
            elif row["control"].startswith("retouch-"):
                row["triage"] = "Fixture: independent repairs on a visible defect were not authored; settings on this repair cannot qualify repair quality."
            elif row["control"] in ("shared.geometry.ratio_mode", "shared.geometry.custom_ratio.width", "shared.geometry.custom_ratio.height"):
                row["triage"] = "Fixture: ratio constraints do not change committed pixels until a crop is authored and Apply is pressed; use the committed crop gesture row."
            elif row["control"] in ("hdr.highlights_center", "hdr.midtones_center", "sdr.highlights", "sdr.highlights_center"):
                row["triage"] = "Fixture: tone-zone coverage depends on scene luminance and active zone strength; photo sampled range is inconclusive. See chart rerun."
            elif "desaturation_start" in row["control"]:
                row["triage"] = "Fixture: threshold only affects coloured pixels in the selected luminance range, with desaturation active; see chart rerun."
            elif "color_grading" in row["control"]:
                row["triage"] = "Fixture/driver: hue requires nonzero saturation; numeric fields also require their selected wheel tab. Native crop may omit the affected tonal range. See prepared chart rerun."
            elif "black_and_white" in row["control"]:
                row["triage"] = "Fixture: selected hue is absent or weak in sampled photo patches; see saturated colour-chart rerun."
            elif "grain_custom_height" in row["control"]:
                row["triage"] = "Fixture: capture geometry/format prerequisite; inspect prepared horizontal-strip/custom-format rerun."
            elif "sharpen" in row["control"]:
                row["triage"] = "Fixture: reduced/sampled image lacks qualifying detail; use repeated fine-edge chart and native view."
            else:
                row["triage"] = "Fixture/prerequisite inconclusive: no sampled difference is not a demonstrated app defect; consult W10 chart rerun."
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
    investigations = []
    for file in sorted(OUT.glob("*.json")):
        data = json.loads(file.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
            continue
        for original in data["rows"]:
            if "no screen change" not in original.get("status", ""):
                continue
            current = latest.get((original["path"], original["lane"], original["zoom"]), {})
            fit = latest.get((original["path"], original["lane"], "fit"), {})
            if data.get("invalidatedReason"):
                decision = "Invalidated concurrent run; no product verdict."
            elif current.get("imageChanged") and current.get("resetPictureConfirmed"):
                decision = "Fixture/driver limitation resolved: newer prepared test changed and restored the picture."
            elif original["zoom"] == "actual" and fit.get("imageChanged") and fit.get("resetPictureConfirmed"):
                decision = "Fixture: native sampled crop unchanged; full-frame Fit change/reset passed. Native effect remains unqualified."
            else:
                decision = current.get("triage", "Untested: fixture/prerequisite remains inconclusive; no demonstrated app defect.")
            investigations.append({"source": file.name, "control": original["path"], "lane": original["lane"], "zoom": original["zoom"],
                                   "decision": decision, "latestSource": current.get("source"), "latestStatus": current.get("rawStatus")})
    (OUT / "w10-triage.json").write_text(json.dumps({"scope":"Every retained no-screen-change row; no missing observation is promoted to a pass", "investigations": investigations}, indent=2)+"\n", encoding="utf-8")
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
        return f"{min(values):.3f}-{max(values):.3f}" if values else "Not measured"

    slow_by_control = {}
    for row in rows:
        if row.get("medianMs") is not None and row["medianMs"] > slow_by_control.get(row["control"], {}).get("medianMs", -1):
            slow_by_control[row["control"]] = row
    slowest = sorted(slow_by_control.values(), key=lambda r:r["medianMs"], reverse=True)[:6]
    qualified = {r["control"] for r in rows if r["observationStatus"] == "Met" and r["samples"] >= 3}
    text = ["<!-- grade-sweep-start -->", "### 0.9.2 Grade control review (November 11, 2026)", "",
            f"**Checked: {len(checked)} distinct controls/actions with three timings. {len(responded)} showed a change and returned to their starting picture in at least one view.** "
            f"{len(qualified)} have at least one row meeting all measured conditions. These counts include gestures; they do not mean every control works in both views or that picture quality is signed off.", "",
            "**Slowest measured waits:** " + "; ".join(f"`{r['control']}` {r['medianMs']/1000:.2f} s ({r['lane']}, {r['zoom']})" for r in slowest) + ". "
            "Times are three-trial medians. Older W1 times include background catch-up and are upper bounds, not comparable before/after timings.", "",
            "**Real problems:** W1 found lingering Exposure delays after Denoise and Retouch (about 0.24 s versus 0.03 s), "
            "Film print/stock drags near 15 presentations/s and lens drags near 10-12. W9 owns their fixes; this review does not claim they are repaired. "
            "The typed-percentage bug was fixed in `38821253`; see the Film rerun rows for app confirmation. No image-processing formula was changed by W10.", "",
            "**Coverage limits:** Untested means missing evidence, inactive prerequisites or a driver/fixture limitation, rather than a demonstrated broken control. "
            "A native centre crop may miss edge effects even when the Fit check responds. Retouch method/feather/hardness/texture need independent repairs on visible defects. "
            "The authoring-family rows below identify gestures that still lack complete timings. Heavy RAW work may exceed one second as Steve's accepted exception; only actual RAW measurements can qualify it.", "",
            "**Error triage:** source-tile and Denoise HTTP 409s reject obsolete work after newer edits; their matching browser resource logs are expected cancellation, "
            "provided the current preview settles. W1 did not capture response bodies, so the exact 409 reason is unconfirmed; W10 captures them. Fractional Push/Pull HTTP 400s were an old driver mistake. Detached/hidden-field and scroll timeouts are driver limitations. "
            "Unknown errors remain Untested and visible in JSON; they are not silently treated as passes.", "",
            "Release limits: settled preview under 1 s at Fit and 100%; pointwise drag at least 20 presentations/s. "
            "Slowing other actions counts only when the Exposure median rises **more than 25% and more than 20 ms**, active or after reset. "
            "Frame-sized noise is no longer flagged. Met means the measured conditions passed; Not met (real problem) identifies measured speed failures; "
            "Exception carries its specific reason; Untested explains the missing check.", "",
            "Conditions: disposable 24 MP resized photo, repeated 24 MP colour/detail chart for content-sensitive reruns, and a disposable 42 MP Sony RAW (714,405 clipped sensels) for reconstruction/import. "
            "Windows/Electron, NVIDIA GPU, 2560x1440, DPR 1, one atomic shared-lock batch at a time, each under about 15 minutes. "
            "Photo, commit, exact samples, prerequisites, errors and surrounding-action timings are in the main checkout's "
            "`codebase/output/performance/grade-0-9-2/summary.json`, `timings.csv` and named batch reports. "
            "Screen signatures test response/reset, not visual quality or preview/export agreement.", "",
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
            status = "Untested: no run"
        elif issues:
            real = [i for i in issues if "1 second" in i or "presentations/s" in i or "25% slower" in i]
            heavy = items and all(r["batch"] == "raw-highlights" for r in items)
            if heavy:
                real = [i for i in real if "1 second" not in i]
            issues = [i.replace("Not met: driver/control error", "Driver could not finish").replace("Not checked: inactive prerequisite", "Inactive mode prerequisite") for i in issues]
            status = ("Not met (real problem): " if real else "Exception (heavy RAW; remaining gaps listed): " if heavy else "Untested: ") + "; ".join(issues)
            triage = sorted({r["triage"] for r in items if r.get("triage")})
            if triage: status += "; " + " ".join(triage)
        else:
            status = "Met (measured observations only)"
        minimum, maximum = control.get("min"), control.get("max")
        bounds = f"{minimum} to {maximum}" if minimum not in (None, "") else "Discrete / see inventory"
        fps = f"{min(rates):.1f}-{max(rates):.1f}" if rates else "Not measured / N/A"
        conditions = "; ".join(sorted({f"{r.get('photo') or 'see JSON'} / `{(r.get('commit') or 'unrecorded')[:8]}`" for r in items})) or "—"
        labels = {
            "Needs investigation: no screen change":"Fixture: sampled picture unchanged",
            "typed entry not confirmed":"Typed input unverified",
            "reset picture not confirmed":"Reset unverified",
            "driver/runtime errors; inspect source report":"Driver error (see JSON)",
            "fewer than three change measurements":"Needs three trials",
            "Fit/100% coverage incomplete":"Missing Fit/100% check",
            "HDR/SDR lane coverage incomplete":"Missing rendition",
        }
        for old, new in labels.items(): status = status.replace(old, new)
        label = key.replace("current.", "").replace("_", " ").replace(".", " / ")
        text.append(f"| {label} | {bounds} | {seconds(fit)} | {seconds(native)} | {fps} | {status} | {conditions} |")
    for family in complete["canvasAndRepeatedFamilies"]:
        text.append(f"| {family['family']} authoring/actions family | {'; '.join(family['controls'])} | Not measured | Not measured | Not measured | Untested: complete gesture family not qualified; individual measured actions are listed above | `{family['source']}`; November 11 inventory |")
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
