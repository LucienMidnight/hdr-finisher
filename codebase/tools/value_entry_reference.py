"""Write docs/user-guide/typed-values-reference.md from a value_entry_audit.js run."""
import json, re, sys
S, target = sys.argv[1], sys.argv[2]
audit = json.load(open(S + "/audit.json", encoding="utf-8"))

def fmt(value):
    if value is None: return ""
    value = round(float(value), 4)
    return f"{value:,.0f}" if value == int(value) else f"{value:g}"

def unit(text):
    text = text.replace("−", "-")
    m = re.match(r"^[+-]?[\d.,]+\s*(.*)$", text)
    u = (m.group(1) if m else "").strip()
    if "×" in u: u = ""
    return {"% 35mm gate": "% of 35mm gate", "% output diag": "% of output diagonal"}.get(u, u)

GROUPS = [
    ("hdr-tone", "Tone (HDR)"), ("hdr-highlights", "Highlight Compression (HDR)"), ("hdr-equalizer", "Exposure Bands (HDR)"),
    ("hdr-color", "Color and Lift, Gamma, Gain (HDR)"), ("hdr-zones", "Lift, Gamma, Gain (HDR)"),
    ("sdr-tone", "Tone (SDR)"), ("sdr-highlights", "Highlight Compression (SDR)"), ("sdr-equalizer", "Exposure Bands (SDR)"),
    ("sdr-color", "Color and Lift, Gamma, Gain (SDR)"), ("sdr-zones", "Lift, Gamma, Gain (SDR)"),
    ("color-grading", "Color Grading"), ("black-and-white", "Black & White"), ("detail", "Detail"),
    ("film-look", "Film Look"), ("vignette", "Vignette"), ("geometry", "Crop & Rotate"), ("perspective", "Perspective"),
    ("denoise", "Denoise"), ("raw-highlights", "RAW highlight reconstruction"),
    ("local-adjustments", "Local Adjustments"), ("local-grade-section", "Local Adjustments: grade"),
    ("local-mask-subpanel", "Local Adjustments: mask"), ("gradient-luma-control", "Local Adjustments: gradient luminance ramp"),
    ("overlay-popover", "Overlays"), ("export-sheet", "Export"),
]
names = dict(GROUPS)
rows_by_group = {}
seen = set()
for lane in ("hdr", "sdr"):
    for row in audit["lanes"][lane]:
        if row["kind"] != "readout": continue
        resolved = row.get("resolved")
        # Per-rendition modules appear once; their ranges are the same for HDR and SDR.
        key = re.sub(r"^(hdr|sdr)\.(color_grading|black_and_white|detail|film_look|vignette)\.", r"current.\2.", resolved) if resolved else (row.get("id") or row["group"] + "/" + row["label"])
        if key in seen: continue
        seen.add(key)
        rows_by_group.setdefault(row["group"], []).append(row)

NOTES = {
    "highlight_protection": "Only when Amount is negative (darkening); otherwise the control is off.",
    "tone-equalizer-band-output": "Each band is also held so it cannot cross its neighbours.",
    "sdr-tone-equalizer-band-output": "Each band is also held so it cannot cross its neighbours.",
}
out = []
count = {"beyond": 0, "same": 0, "slider": 0, "none": 0}
for group, title in GROUPS:
    rows = rows_by_group.pop(group, [])
    if not rows: continue
    out.append(f"\n### {title}\n")
    out.append("| Control | Slider | Typed value | Notes |")
    out.append("| --- | --- | --- | --- |")
    for row in rows:
        label = re.sub(r"\d+%$|[+-]?\d.*$", "", row["label"].split(" ·")[0]).strip() or row["label"] or "(handles)"
        if row.get("id") in ("tone-equalizer-band-output", "sdr-tone-equalizer-band-output"): label = "Selected band"
        if row.get("id") in ("tone-equalizer-radius", "sdr-tone-equalizer-radius"): label = "Influence"
        resolved = row.get("resolved") or ""
        m = re.search(r"\.(lift|gamma|gain)_(range|pivot)$", resolved)
        if m: label = f"{m.group(1).title()} {m.group(2).title()}"
        m = re.search(r"color_grading\.(\w+)\.luminance_ev$", resolved)
        if m: label = f"{m.group(1).title()} Luminance"
        u = unit(row["text"])
        slider = row["slider"]; rule = row["rule"]
        scale = (rule or {}).get("entryScale", 1)
        pct = (not rule) and "%" in row["text"] and slider and slider["max"] <= 1
        if pct: scale = 100
        if rule and scale == 100: u = "%"
        srange = f"{fmt(slider['min'] * scale)} to {fmt(slider['max'] * scale)} {u}".strip() if slider else "n/a"
        note = next((text for key, text in NOTES.items() if key in (row.get("resolved") or row.get("id") or "")), "")
        if not row["editable"]:
            typed = "Not typed"; count["none"] += 1
            note = note or "Several handles share one row; drag them."
        elif rule:
            typed = f"{fmt(rule['min'] * scale)} to {fmt(rule['max'] * scale)} {u}".strip()
            beyond = slider and (rule["min"] < slider["min"] - 1e-9 or rule["max"] > slider["max"] + 1e-9)
            if beyond: typed = f"**{typed}**"; count["beyond"] += 1
            else: count["same"] += 1
        elif "tone-equalizer-band" in (row.get("id") or ""):
            typed = "-2 to +2 EV"; srange = "drag the band"; count["same"] += 1
        elif "tone-equalizer-radius" in (row.get("id") or ""):
            typed = "0.25 to 12 EV"; srange = "no slider"; count["same"] += 1
        else:
            typed = "Same as slider"; count["slider"] += 1
        out.append(f"| {label} | {srange} | {typed} | {note} |")
left = {g: len(r) for g, r in rows_by_group.items()}

header = f"""# Typed values reference

Every number shown beside a slider can be typed: double-click it, or focus it
and press Enter, type the value, and press Enter again. Escape cancels.

This page lists every such number, the range its slider covers and the range a
typed value is held to. It was produced from a run of
`codebase/tools/value_entry_audit.js`, which types above, below and inside the
range of every readout in the running app. Run it again after adding or
changing a control:

```
node tests/run-in-electron.js tools/value_entry_audit.js audit-folder/audit.json
python tools/value_entry_reference.py audit-folder ../docs/user-guide/typed-values-reference.md
```

## How typed values behave

- **Bold ranges go beyond the slider.** {count['beyond']} controls accept typed
  values past the ends of their slider. The slider then sits at its end and is
  marked, and the typed value is what is saved, previewed and exported.
  Dragging the slider afterwards brings the value back inside the slider's
  range.
- **A value outside the typed range is not refused.** It is set to the nearest
  allowed value and the number flashes once. This limit is the most the saved
  project and the renderer accept for that control, so it is the same in the
  preview and in export.
- **"Same as slider"** means a typed value is passed to the slider itself, so
  it cannot leave the slider's range. These controls have no wider saved limit
  to type into.
- **Percentages are typed as percentages.** Saturation and Vibrance are typed
  as -100 to 300, Denoise and opacity values as 0 to 100.
- **A control that is switched off cannot be typed into**, exactly as its
  slider cannot be dragged: Denoise sliders while Denoise is off, RAW clipping
  threshold on a file that is not RAW, Vignette Highlight Protection unless
  Amount is negative.
- Text that is not a number is ignored and the previous value stays.

## Not typed

- Rows with several handles on one track: the Local Adjustments luminance
  range, its refine range and the gradient luminance ramp. Drag the handles.
- Curves, the Color Grading wheels (their Hue and Saturation have ordinary
  number boxes beside the wheel), crop and perspective handles on the picture.
- Number boxes (zoom, Vignette Center X and Y, custom crop ratio, export size,
  custom proof peak, lens data, film gate size) are ordinary fields with their
  own limits and are not listed here.

## The list
"""
open(target, "w", encoding="utf-8", newline="\n").write(header + "\n".join(out) + "\n")
print(count, "unlisted groups:", left)
