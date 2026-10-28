"""Section recovery used only by projects.validate_saved; live edits stay strict."""
from copy import deepcopy
import re
from pydantic import ValidationError
from .config import APP_VERSION

SECTION_NAMES = {
    "tone": "Tone", "highlight": "Highlight Compression", "tone_equalizer": "Exposure Bands",
    "color": "Color", "hsl": "HSL", "curves": "Curves", "color_grading": "Color Grading",
    "detail": "Detail", "black_and_white": "Black & White", "film_look": "Film Look",
    "vignette": "Vignette",
}
SECTION_VERSIONS = {name: 1 for name in (
    *SECTION_NAMES, "geometry", "local_adjustments", "repairs", "denoise",
    "source", "interpretation_override", "framing", "sdr_match")}
# Removed controls' neutral values, for notices only; never converts an old grade.
REMOVED_DEFAULTS = {
    "lift": 0, "gamma": 0, "gain": 0, "shadow_lift": 0, "shadow": 0,
    "lift_pivot": -2, "gamma_pivot": 0, "gain_pivot": 2,
    "lift_range": 4, "gamma_range": 4.25, "gain_range": 4,
    "primaries_section_enabled": True,
}

def section(field):
    if field in REMOVED_DEFAULTS:
        return "tone"
    if field.startswith("highlight_compression") or field == "highlight_section_enabled":
        return "highlight"
    if field.startswith("tone_equalizer"):
        return "tone_equalizer"
    if field.endswith("_curve") or field == "curves_section_enabled":
        return "curves"
    for name in ("color_grading", "black_and_white", "film_look", "vignette", "detail", "hsl"):
        if field == name or field == name + "_section_enabled":
            return name
    if field in ("exposure", "contrast", "contrast_pivot", "blacks", "tone_section_enabled") or field.startswith(("shadows", "midtones", "highlights")):
        return "tone"
    return "color"

def version(value):
    return tuple(int(n) for n in re.findall(r"\d+", str(value))[:3])

def notice(value):
    return getattr(value, "_saved_grade_notice", None)

def _at(data, path):
    for key in path:
        if isinstance(data, dict) and key in data or isinstance(data, list) and isinstance(key, int) and 0 <= key < len(data):
            data = data[key]
        else:
            return None
    return data

def _remove(data, path):
    parent = _at(data, path[:-1])
    if isinstance(parent, dict) and path[-1] in parent:
        del parent[path[-1]]
        return True
    return False

def _boundary(model, data, loc):
    """Return panel path, member fields and a human label."""
    name = model.__name__
    prefix = ("global_adjustments",) if name == "EditDocument" else ()
    offset = len(prefix)
    if name in ("HDRAdjustments", "SDRAdjustments"):
        group = section(str(loc[0])) if loc else "highlight"
        fields = [f for f in model.model_fields if section(f) == group]
        return (), fields, SECTION_NAMES[group]
    if (name == "AdjustmentState" or name == "EditDocument" and loc[:1] == prefix) and len(loc) > offset:
        lane = loc[offset]
        if lane in ("hdr", "sdr"):
            if not isinstance(_at(data, prefix + (lane,)), dict):
                return prefix, [lane], lane.upper() + " grade"
            group = section(str(loc[offset+1])) if len(loc) > offset+1 else "highlight"
            from .models import HDRAdjustments, SDRAdjustments
            cls = HDRAdjustments if lane == "hdr" else SDRAdjustments
            return prefix + (lane,), [f for f in cls.model_fields if section(f) == group], lane.upper() + " " + SECTION_NAMES[group]
        if lane == "shared":
            key = loc[offset+1] if len(loc) > offset+1 else "geometry"
            return prefix + ("shared",), [key], "Geometry" if key == "geometry" else "Shared settings"
    if name == "EditDocument" and loc and loc[0] in ("local_adjustments", "repairs"):
        key = loc[0]
        index = loc[1] if len(loc) > 1 and isinstance(loc[1], int) else None
        item = _at(data, (key, index)) if index is not None else None
        label = ("Local adjustment" if key == "local_adjustments" else "Retouch repair")
        if isinstance(item, dict):
            label += " " + str(item.get("name") or item.get("id") or index+1)
        return (key,), [index] if index is not None else [], label
    if name == "AdjustmentState" and loc and loc[0] == "shared":
        return (), ["shared"], "Shared settings"
    if name == "EditDocument" and len(loc) > 1 and loc[0] == "source":
        if loc[1] in ("raw_import_settings", "luminance"):
            return ("source",), [loc[1]], "RAW development" if loc[1] == "raw_import_settings" else "Source luminance"
    key = loc[0] if loc else None
    labels = {"denoise": "Denoise", "source": "Source settings", "framing": "Framing",
              "interpretation_override": "Source interpretation", "sdr_match": "SDR Match"}
    return (), [key] if key else [], labels.get(key, "Saved grade")

def read_saved(model, original):
    from .models import EditDocument
    data = deepcopy(original)
    issues = []
    dropped = []
    newer = False
    def issue(label, reason, path, kind="unreadable"):
        item = dict(section=label, reason=reason, path=".".join(map(str, path)), kind=kind)
        if item not in issues:
            issues.append(item)
    if model is EditDocument:
        if not isinstance(data, dict):
            data = {}
            issue("Saved grade", "The grade could not be read. Showing the default look.", ())
        app = data.get("app_version")
        formats = data.get("section_versions", {})
        newer = bool(app and version(app) > version(APP_VERSION))
        if newer:
            issue("Saved grade", "This grade came from a newer version. Saving is paused until you choose.", (), "newer")
        if isinstance(formats, dict):
            for key, number in formats.items():
                if isinstance(number, int) and number > SECTION_VERSIONS.get(key, 0):
                    newer = True
                    issue(SECTION_NAMES.get(key, key.replace("_", " ").capitalize()),
                          "This section came from a newer version.", (key,), "newer")
                    # Keep only sections whose format this app understands.
                    if key in SECTION_NAMES:
                        for lane in ("hdr", "sdr"):
                            branch = _at(data, ("global_adjustments", lane))
                            if isinstance(branch, dict):
                                for field in list(branch):
                                    if section(field) == key: del branch[field]
                    elif key == "geometry":
                        _remove(data, ("global_adjustments", "shared", "geometry"))
                    elif key in SECTION_VERSIONS:
                        data.pop(key, None)
        if data.get("schema_version", 4) != 4:
            source = data.get("source")
            data = {"source": source} if isinstance(source, dict) else {}
            issue("Saved grade", "This grade format could not be read. Showing the default look.", ())
        # Source lookup remains the caller's responsibility. Placeholder facts
        # allow a wholly damaged grade to display the actual selected photo.
        data.setdefault("hdr_reference_white_nits", 203)
        if "source" not in data:
            issue("Saved grade", "The grade has no readable source settings. Showing the default look.", ())
        data.setdefault("source", {"filename": "Photo", "luminance": {
            "luminance_semantics": "scene_relative", "transfer_function": "unknown"}})
        data["app_version"] = APP_VERSION
        data["section_versions"] = dict(SECTION_VERSIONS)
    for attempt in range(4096):
        try:
            value = model.model_validate(data)
            break
        except ValidationError as exc:
            # Handle one section at a time so list indexes cannot move under us.
            error = exc.errors()[0]
            loc = error["loc"]
            path, fields, label = _boundary(model, data, loc)
            repair = model.__name__ in ("RepairRecord", "InpaintRecipe") or loc[:1] == ("repairs",)
            if error["type"] in ("extra_forbidden", "literal_error", "enum") and not repair:
                old = _at(data, loc)
                if _remove(data, loc):
                    dropped.append(".".join(map(str, loc)))
                    field = str(loc[-1])
                    neutral = REMOVED_DEFAULTS.get(field, None)
                    # Range/centre controls have no effect without their strength.
                    # The strength itself provides the single look-change notice.
                    parent = _at(original, loc[:-1])
                    inactive = field == "primaries_section_enabled" or field.endswith(("_pivot", "_range")) and field.split("_")[0] in ("lift", "gamma", "gain")
                    if field in ("lift", "gamma", "gain") and isinstance(parent, dict) and parent.get("primaries_section_enabled") is False:
                        inactive = True
                    if not inactive and old != neutral and old not in (None, False, 0, {}, [], ""):
                        name = "Lift/Gamma/Gain" if field.startswith(("lift", "gamma", "gain")) else field.replace("_", " ").capitalize()
                        issue(label, f"This photo used {name}, which this version replaced. It may look different.", loc, "look")
                    continue
            issue(label, "Could not read this section: " + error["msg"].removeprefix("Value error, "), loc)
            container = _at(data, path)
            if path[:1] in (("local_adjustments",), ("repairs",)):
                if fields and isinstance(container, list):
                    del container[fields[0]]
                else:
                    data[path[0]] = []
            elif fields and isinstance(container, dict):
                changed = False
                for field in fields:
                    if field in container:
                        del container[field]
                        changed = True
                if path == ("source",) and fields == ["luminance"]:
                    data["source"]["luminance"] = {"luminance_semantics": "scene_relative", "transfer_function": "unknown"}
                elif model is EditDocument and fields == ["source"]:
                    data["source"] = {"filename": "Photo", "luminance": {
                        "luminance_semantics": "scene_relative", "transfer_function": "unknown"}}
                elif model is EditDocument and fields == ["hdr_reference_white_nits"]:
                    data["hdr_reference_white_nits"] = 203
                elif not changed:
                    raise
            else:
                # Standalone damaged locals/repairs must be skipped by their list
                # owner, never fabricated with a different mask or fill.
                raise
    else:
        raise ValueError("Saved grade recovery did not finish.")
    if issues:
        report = dict(issues=issues, newer=newer, needs_choice=True,
                      reason=" ".join(dict.fromkeys(item["reason"] for item in issues)),
                      sections=list(dict.fromkeys(item["section"] for item in issues)))
        object.__setattr__(value, "_saved_grade_notice", report)
        object.__setattr__(value, "_saved_grade_original", deepcopy(original))
    return value, dropped
