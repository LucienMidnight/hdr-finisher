"""Summarise Library fullscreen timing from the app's backend log (read-only).

Usage (from codebase):
    .venv/Scripts/python.exe tools/summarize_library_log.py            # latest app session
    .venv/Scripts/python.exe tools/summarize_library_log.py --since "2026-10-26 09:30"
    .venv/Scripts/python.exe tools/summarize_library_log.py --list      # per-request timeline

Reads %APPDATA%/hdr-finisher-desktop/logs/backend.log. Events are the
`page_picture_*` stopwatch lines (glossary terms: picture_size, step, view).
Never writes anything.
"""
import argparse
import collections
import datetime
import json
import os
import sys

LOG = os.path.expandvars(r"%APPDATA%\hdr-finisher-desktop\logs\backend.log")
STAGES = ("cache_check", "queue_wait", "lease_wait", "pixel_fetch", "upload",
          "denoise_prepare", "denoise_analysis", "render", "draw_complete",
          "development", "store")


def events(since):
    with open(LOG, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.startswith("[library] "):
                continue
            name, _, payload = line[10:].partition(" ")
            try:
                data = json.loads(payload)
            except ValueError:
                continue
            if data.get("time", 0) >= since:
                yield name, data


def latest_session_start():
    start = 0.0
    with open(LOG, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("[library] app_start "):
                try:
                    start = json.loads(line.split(" ", 2)[2])["time"]
                except (ValueError, KeyError, IndexError):
                    pass
    return start


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(p * len(values)))] if values else 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help='local time "YYYY-MM-DD HH:MM"; default: latest app launch')
    parser.add_argument("--list", action="store_true", help="print a per-request fullscreen timeline")
    args = parser.parse_args()
    since = (datetime.datetime.strptime(args.since, "%Y-%m-%d %H:%M").timestamp()
             if args.since else latest_session_start())
    print("since", datetime.datetime.fromtimestamp(since))

    outcomes, stages, developments = [], collections.defaultdict(list), []
    requests = collections.OrderedDict()
    startup = {}
    upkeep = []
    for name, d in events(since):
        if name in ("app_start", "backend_process_started", "helper_process_started", "backend_ready", "page_loaded", "page_ready"):
            startup[name] = d["time"]
        if name.startswith("startup_upkeep_"):
            upkeep.append((name, d))
        short = name.replace("page_picture_", "").replace("page_", "")
        if name == "page_picture_development":
            developments.append(d.get("duration_ms") or 0)
        if d.get("view") != "fullscreen":
            continue
        if name == "page_picture_review_outcome":
            outcomes.append(d)
        if short in STAGES and isinstance(d.get("duration_ms"), (int, float)):
            stages[(short, d.get("step") or "-")].append(d["duration_ms"])
        if args.list:
            r = requests.setdefault(d.get("request"), {"t": d["time"], "path": os.path.basename(str(d.get("path"))), "ev": []})
            r["ev"].append((short, d.get("step"), d.get("duration_ms"), d.get("reason")))

    origin = startup.get("backend_process_started", since)
    print("startup (from backend process):", " ".join(f"{name}={(stamp-origin)*1000:.0f}ms" for name, stamp in startup.items()))
    for name, d in upkeep:
        print(f"  {name}: {(d['time']-origin)*1000:.0f}ms; duration={d.get('duration_ms', 0):.0f}ms")
    sharp = [o["duration_ms"] for o in outcomes if o.get("sharp_draw")]
    hits = [o["duration_ms"] for o in outcomes if o.get("sharp_draw") and not o.get("quick_draw")]
    misses = [o["duration_ms"] for o in outcomes if o.get("sharp_draw") and o.get("quick_draw")]
    no_quick = [o["duration_ms"] for o in outcomes if o.get("sharp_draw") and not o.get("quick_draw") and o["duration_ms"] > 500]
    print(f"fullscreen outcomes {len(outcomes)}; blank {sum(1 for o in outcomes if o.get('blank'))}; "
          f"quick draw only {sum(1 for o in outcomes if o.get('quick_draw') and not o.get('sharp_draw'))}")
    for label, values in (("sharp draw (all)", sharp), ("ready-window hits", hits),
                          ("quick then sharp", misses), ("sharp, no quick draw, >0.5 s", no_quick),
                          ("developments (any view)", developments)):
        if values:
            print(f"  {label:30s} n={len(values):4d} p50={pct(values, .5):7.0f} p90={pct(values, .9):7.0f} max={max(values):7.0f} ms")
    print("stage timings (fullscreen):")
    for (stage, step), values in sorted(stages.items()):
        print(f"  {stage:17s} {step:11s} n={len(values):4d} p50={pct(values, .5):7.0f} p90={pct(values, .9):7.0f} max={max(values):7.0f} ms")
    print("slowest sharp draws:")
    for o in sorted((o for o in outcomes if o.get("sharp_draw")), key=lambda o: -o["duration_ms"])[:10]:
        print(f"  {datetime.datetime.fromtimestamp(o['time']):%H:%M:%S} {os.path.basename(o['path'])} "
              f"{o['duration_ms']:.0f} ms {'quick+sharp' if o.get('quick_draw') else 'sharp only'}")
    if args.list:
        for r in requests.values():
            text = " ".join(f"{s}{'/' + st if st else ''}{'' if ms is None else f'={ms:.0f}'}{'(' + why + ')' if why else ''}"
                            for s, st, ms, why in r["ev"] if s in STAGES + ("present", "review_outcome", "navigation_cancelled"))
            print(f"{datetime.datetime.fromtimestamp(r['t']):%H:%M:%S.%f}"[:-4], r["path"][:16], text)


if __name__ == "__main__":
    sys.exit(main())
