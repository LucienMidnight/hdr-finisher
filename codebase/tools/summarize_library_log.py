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
import re
import sys

LOG = os.path.expandvars(r"%APPDATA%\hdr-finisher-desktop\logs\backend.log")
STAGES = ("cache_check", "queue_wait", "lease_wait", "pixel_fetch", "upload",
          "denoise_prepare", "denoise_analysis", "render", "draw_complete",
          "development", "store", "stored_screen_preview_draw")


def events(since):
    with open(LOG, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            # Also recover entries joined by older concurrent log writers.
            for match in re.finditer(r"\[library\] (\S+) ", line):
                try:
                    data, _ = json.JSONDecoder().raw_decode(line[match.end():])
                except ValueError:
                    continue
                if data.get("time", 0) >= since:
                    yield match[1], data


def latest_session_start():
    return max((data["time"] for name, data in events(0) if name == "app_start"), default=0.0)


def pct(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(p * len(values)))] if values else 0.0


def main():
    global LOG
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", default=LOG, help="read a disposable profile log")
    parser.add_argument("--since", help='local time "YYYY-MM-DD HH:MM"; default: latest app launch')
    parser.add_argument("--list", action="store_true", help="print a per-request fullscreen timeline")
    args = parser.parse_args()
    LOG = args.log
    since = (datetime.datetime.strptime(args.since, "%Y-%m-%d %H:%M").timestamp()
             if args.since else latest_session_start())
    print("since", datetime.datetime.fromtimestamp(since))

    outcomes, stages, developments = [], collections.defaultdict(list), []
    requests = collections.OrderedDict()
    startup = {}
    upkeep = []
    phases = []
    first_thumbnail = None
    folder_listed = None
    routes = collections.defaultdict(list)
    stored = collections.defaultdict(list)
    measurements = collections.defaultdict(list)
    switches = []
    scrolls, detail_reads, recovery = [], collections.defaultdict(list), []
    folder_opens = collections.OrderedDict()
    grid_presentations = []
    disk_pages = collections.defaultdict(list)
    for name, d in events(since):
        if name == "page_grid_scroll_settled": scrolls.append(d)
        if name == "folder_disk_page": disk_pages[(d.get("folder"),d.get("request"))].append(d)
        if name == "camera_details_read": detail_reads[d.get("demand","unknown")].append(d)
        if name == "recovery_piece": recovery.append(d)
        if name.startswith("folder_open_") or name in ("page_folder_rows_usable","page_folder_first_picture_requested","page_folder_first_rows","page_folder_first_grid_picture","page_folder_first_camera_preview","page_folder_first_thumbnail","page_folder_complete"):
            key=d.get("request")
            if key:
                row=folder_opens.setdefault(key,{"folder":d.get("folder",d.get("path")),"events":{}})
                row["events"].setdefault(name,d)
        # Recover actual draws in older logs too: the old folder stopwatch missed
        # normal GPU thumbnails and recorded a much later pool reuse instead.
        if d.get("view") == "grid" and name in ("page_picture_shown", "page_picture_navigation_to_present"):
            grid_presentations.append({**d, "picture_size": "thumbnail" if name == "page_picture_shown" else d.get("picture_size")})
        if name == "denoise_measurement":
            measurements[(d.get("usage", "CPU path"), d.get("route", "-"), d.get("width"), d.get("height"))].append(d.get("duration_ms",0))
        if name == "page_rendition_switch":
            switches.append(d)
        if name in ("picture_camera_preview_ready", "page_picture_thumbnail_reused", "page_picture_thumbnail_reclaim", "helper_job_started", "helper_job_finished", "picture_helper_job_started", "picture_helper_job_finished", "page_picture_source_gpu_fallback", "page_picture_source_cpu_fallback", "page_picture_development_admitted", "picture_denoise_model", "page_picture_quick_draw_unavailable", "picture_rgb_decode", "picture_source_cpu_fallback", "picture_avif_reconstruction", "picture_avif_native_stages"):
            if d.get("format"):
                routes[(name, d["format"])].append(d.get("duration_ms", 0))
            for field in ("queue_ms", "work_ms", "yield_ms", "decode_ms", "reconstruction_ms", "discarded_decode_ms"):
                if field in d:
                    routes[(name, str(d.get("operation", "-")) + "/" + field)].append(d[field])
            routes[(name, d.get("route", "-"))].append(d.get("duration_ms", 0))
        if name.startswith(('stored_screen_preview_', 'page_picture_stored_screen_preview_')):
            stored[(name, d.get('rendition', '-'), d.get('result', '-'))].append(d)
        if name in ("app_start", "backend_process_started", "helper_process_started", "helper_ready", "writer_start", "backend_ready", "app_ready", "window_created", "window_visible", "page_loaded", "page_ready"):
            startup[name] = d["time"]
        if name == "page_picture_shown" and d.get("view") == "grid" and first_thumbnail is None:
            first_thumbnail = d["time"]
        if name == "page_folder_listed" and folder_listed is None:
            folder_listed = d["time"]
        if name in ("startup_phase", "startup_import", "desktop_startup_join"):
            phases.append((name, d))
        if name.startswith("startup_upkeep_"):
            upkeep.append((name, d))
        short = name.replace("page_picture_", "").replace("page_", "")
        if name == "page_picture_development":
            developments.append(d.get("duration_ms") or 0)
            for field in ("sensor_ms", "gpu_ms", "quantiles_ms", "handoff_ms"):
                if d.get(field) is not None:
                    routes[(name, field)].append(d[field])
            for field, value in (d.get("gpu_stages_ms") or {}).items():
                routes[(name, "gpu/" + field)].append(value)
        if d.get("view") != "fullscreen":
            continue
        if name == "page_picture_review_outcome":
            outcomes.append(d)
        if short in STAGES and isinstance(d.get("duration_ms"), (int, float)):
            stages[(short, d.get("step") or "-")].append(d["duration_ms"])
        if args.list:
            r = requests.setdefault(d.get("request"), {"t": d["time"], "path": os.path.basename(str(d.get("path"))), "ev": []})
            r["ev"].append((short, d.get("step"), d.get("duration_ms"), d.get("reason")))

    starts = sorted((row["events"]["folder_open_started"]["time"], key)
                    for key, row in folder_opens.items() if "folder_open_started" in row["events"])
    for position, (started, key) in enumerate(starts):
        row = folder_opens[key]
        end = starts[position+1][0] if position+1 < len(starts) else float("inf")
        end = min(end, row["events"].get("folder_open_closed", {}).get("time", float("inf")))
        prefix = str(row["folder"]).replace("/", "\\").rstrip("\\").casefold()+"\\"
        for item in sorted(grid_presentations, key=lambda value:value["time"]):
            if not started <= item["time"] < end or not str(item.get("path", "")).replace("/", "\\").casefold().startswith(prefix):
                continue
            for event in ("page_folder_first_grid_picture", "page_folder_first_thumbnail" if item.get("picture_size") == "thumbnail" else "page_folder_first_camera_preview"):
                previous = row["events"].get(event)
                if previous is None or item["time"] < previous["time"]:
                    row["events"][event] = {**item, "duration_ms":(item["time"]-started)*1000}

    print("settled grid scrolls:",len(scrolls),"zero requests:",sum(d.get("picture_requests")==0 for d in scrolls))
    for d in scrolls:
        print("  grid",d.get("path"),"range",d.get("range_start"),d.get("range_end"),"of",d.get("total"),"requests",d.get("picture_requests"))
    for (folder,request),pages in disk_pages.items():
        print("disk pages:",folder,"request",request,"pages",len(pages),"photos",sum(d.get("count",0) for d in pages))
        for field in ("helper_ms","accept_ms"):
            values=[d.get(field,0) for d in pages]
            print(" ",field,"median",round(pct(values,.5),1),"total",round(sum(values),1),"ms")
    for demand,reads in detail_reads.items():
        print("camera details:",demand,"batches",len(reads),"photos",sum(d.get("count",0) for d in reads),"median ms",round(pct([d.get("duration_ms",0) for d in reads],.5),1))
    if recovery: print("recovery pieces:",len(recovery),"photos",sum(d.get("count",0) for d in recovery),"max ms",round(max(d.get("duration_ms",0) for d in recovery),1))
    for row in folder_opens.values():
        milestones=row["events"]
        print("folder open:",row["folder"])
        for event,label in (("folder_open_first_rows","first rows"),("page_folder_rows_usable","rows usable on page"),("page_folder_first_picture_requested","first picture requested"),("page_folder_first_grid_picture","first grid picture"),("page_folder_first_camera_preview","first camera preview"),("page_folder_first_thumbnail","first finished thumbnail"),("folder_open_all_rows","all indexed rows"),("folder_open_disk_finished","disk check finished"),("folder_open_closed","closed")):
            item=milestones.get(event)
            if item:
                print(" ",label,f"{item.get('duration_ms',0):.0f}ms", " ".join(f"{field}={item[field]}" for field in ("rows","added","removed","changed","settings","unreadable","reason") if field in item))
        failure=milestones.get("folder_open_failed")
        if failure: print("  failed:",failure.get("reason"))
    origin = startup.get("backend_process_started", since)
    print("startup (from backend process):", " ".join(f"{name}={(stamp-origin)*1000:.0f}ms" for name, stamp in startup.items()))
    app_origin = startup.get("app_start", origin)
    print("startup (from app launch):", " ".join(f"{name}={(stamp-app_origin)*1000:.0f}ms" for name, stamp in startup.items()))
    for label, stamp in (("first folder listed", folder_listed), ("first finished thumbnail shown", first_thumbnail)):
        if stamp is not None:
            print(f"  {label}: {(stamp-origin)*1000:.0f}ms from backend; {(stamp-app_origin)*1000:.0f}ms from app")
    for name, d in phases:
        print(f"  {name} {d.get('phase', d.get('module'))}: {(d['time']-origin)*1000:.0f}ms; duration={d['duration_ms']:.0f}ms")
    for name, d in upkeep:
        print(f"  {name}: {(d['time']-origin)*1000:.0f}ms; duration={d.get('duration_ms', 0):.0f}ms")
    print('stored screen previews:')
    for (name, lane, result), rows in sorted(stored.items()):
        times = [row.get('decode_ms', row.get('write_ms', row.get('duration_ms', 0))) for row in rows]
        print(f'  {name} {lane} {result}: n={len(rows)} p50={pct(times, .5):.0f}ms max={max(times):.0f}ms')
        for part in ('read_ms', 'codec_ms', 'pack_ms'):
            values = [row[part] for row in rows if part in row]
            if values: print(f'    {part}: p50={pct(values, .5):.0f}ms max={max(values):.0f}ms')
    print("Denoise measurements (Library, Grade, export/Proof):")
    for (usage, route, width, height), times in sorted(measurements.items(),key=lambda item:str(item[0])):
        print(f"  {usage} {route} {width}x{height}: n={len(times)} p50={pct(times,.5):.1f}ms max={max(times):.1f}ms")
    for switch in switches:
        print(f"  HDR/SDR switch {datetime.datetime.fromtimestamp(switch['time']):%H:%M:%S.%f}: "
              f"{switch.get('rendition')} epoch={switch.get('display_epoch')} view={switch.get('view')} thumbnails={switch.get('visible_thumbnails')}")
    print("Library routes:")
    for (name, route), times in sorted(routes.items()):
        print(f"  {name} {route}: n={len(times)} p50={pct(times, .5):.0f}ms max={max(times):.0f}ms")
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
