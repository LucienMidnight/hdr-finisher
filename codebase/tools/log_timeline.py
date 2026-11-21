"""Read HDR Finisher's current and rotated logs as a chronological timeline."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re


LEGACY = re.compile(r"^\[library\] (\S+) (\{.*\})$")
MEMORY = ("requested_bytes", "budget_bytes", "resident_bytes", "allocator_bytes",
          "app_ram_bytes", "system_free_bytes", "scratch_bytes", "disk_bytes")


def parse_line(line):
    legacy = LEGACY.match(line)
    try:
        row = json.loads(legacy[2] if legacy else line)
    except ValueError:
        return None
    if not isinstance(row, dict):
        return None
    timestamp = row.get("time")
    if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or not 0 <= timestamp <= 253402300799:
        return None
    if legacy:
        row.update(event=legacy[1], action=row.get("action_id", row.get("action")), legacy=True)
        row.setdefault("area", "denoise" if legacy[1].startswith("denoise_") else "library")
        row.setdefault("proc", "legacy")
    return row if row.get("event") else None


def paths_for(arguments):
    found = set()
    for argument in arguments:
        base = argument / "backend.log" if argument.is_dir() else argument
        files = [base]
        if base.name.endswith(".log"):
            rotations = [path for path in base.parent.glob(base.name + ".*") if path.suffix[1:].isdigit()]
            files = sorted(rotations, key=lambda path: int(path.suffix[1:]), reverse=True) + files
        for file in files:
            if file.is_file() and file.resolve() not in found:
                found.add(file.resolve())
                yield file


def parse_time(value):
    try:
        return float(value)
    except ValueError:
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise argparse.ArgumentTypeError("Use an ISO-8601 timestamp or Unix seconds.") from error
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)).timestamp()


def matching(rows, args):
    for row in rows:
        if args.action and row.get("action") != args.action:
            continue
        if args.area and row.get("area") not in args.area:
            continue
        if args.since is not None and row["time"] < args.since or args.until is not None and row["time"] > args.until:
            continue
        yield row


def photo_matches(row, photo):
    return any(photo in str(row.get(key, "")).casefold() for key in ("photo", "source", "session", "session_id", "path"))


def rows_from(files):
    for file in files:
        with file.open(encoding="utf-8", errors="replace") as source:
            for line in source:
                row = parse_line(line.removesuffix("\n"))
                if row:
                    yield row


def render(rows, *, summary_only=False):
    counts = Counter()
    reasons = Counter()
    peaks = {}
    for row in rows:
        event = row["event"]
        reason = row.get("reason")
        amount = row.get("repeat_count", 1) if row.get("repeat_summary") else 1
        counts["events"] += amount
        if not row.get("legacy"):
            route = row.get("route")
            if route == "refused" and event not in {"grain_cancelled", "grain_eviction"}:
                counts["refusals"] += amount
                if reason:
                    reasons[reason] += amount
            if event == "grain_cpu_prepare_started" or "fallback" in event:
                counts["fallbacks"] += amount
            if row.get("level") in {"error", "warn"}:
                counts["errors" if row["level"] == "error" else "warnings"] += amount
        for key in MEMORY:
            value = row.get(key, row.get("totalBytes") if key == "app_ram_bytes" else None)
            if isinstance(value, (int, float)) and math.isfinite(value):
                peaks[key] = max(value, peaks.get(key, value))
        if summary_only:
            continue
        timestamp = datetime.fromtimestamp(row["time"], timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        detail = " ".join(f"{key}={row[key]}" for key in (
            "route", "reason", "prior_reason", "status", "method", "stage", "lane", "outcome", "duration_ms",
            "evicted_count", "evicted_bytes", "evicted_bytes_by_kind", "presentation_kept",
            "reservation_limit_bytes", "attempt", *MEMORY,
        ) if row.get(key) is not None)
        photo = row.get("photo")
        name = (photo.get("name") or photo.get("id")) if isinstance(photo, dict) else photo
        if name:
            detail += f" photo={name}"
        if row.get("repeat_summary"):
            detail += f" repeated={amount}"
        print(f"{timestamp} {row.get('proc', '?')}/{row.get('area', '?')} {event}"
              f" action={row.get('action') or '-'} {detail}".rstrip())
    print("Summary")
    print("  " + "  ".join(f"{key}={counts[key]}" for key in ("events", "fallbacks", "refusals", "errors", "warnings")))
    if reasons:
        print("  refusal reasons " + ", ".join(f"{reason}={count}" for reason, count in reasons.most_common()))
    if peaks:
        print("  memory maxima " + "  ".join(f"{key}={value}" for key, value in peaks.items()))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="Log directory, backend.log or individual rotated files")
    parser.add_argument("--action", help="Exact action ID")
    parser.add_argument("--photo", help="Substring of a photo's name, identity or path")
    parser.add_argument("--area", action="append", help="Repeat to include several areas")
    parser.add_argument("--since", type=parse_time, help="Lower time bound (ISO-8601 or Unix seconds)")
    parser.add_argument("--until", type=parse_time, help="Upper time bound (ISO-8601 or Unix seconds)")
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args(argv)
    files = list(paths_for(args.files))
    if not files:
        parser.error("No log files found.")
    rows = sorted(rows_from(files), key=lambda row: row["time"])
    if args.photo:
        target = args.photo.casefold()
        actions = {row.get("action") for row in rows if photo_matches(row, target)} - {None, ""}
        rows = (row for row in rows if row.get("action") in actions or photo_matches(row, target))
    render(matching(rows, args), summary_only=args.summary_only)


if __name__ == "__main__":
    main()
