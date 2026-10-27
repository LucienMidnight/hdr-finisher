"""Read a bounded Library log window using explicit Bangkok local times.

Never opens the Library database or writes to a photo folder.
"""
import argparse,collections,datetime,json
from pathlib import Path
import summarize_library_log as log

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--start",default="2026-10-27 12:40")
    parser.add_argument("--end",default="2026-10-27 12:48")
    parser.add_argument("--log",default=log.LOG)
    parser.add_argument("--output",default="output/hsl-library-return/live-log-summary.json")
    args=parser.parse_args()
    zone=datetime.timezone(datetime.timedelta(hours=7))
    stamp=lambda s:datetime.datetime.strptime(s,"%Y-%m-%d %H:%M").replace(tzinfo=zone).timestamp()
    start,end=stamp(args.start),stamp(args.end)
    log.LOG=args.log
    rows=[(name,d) for name,d in log.events(start) if d["time"]<=end]
    milestones=[dict(event=n,**d) for n,d in rows if n in (
        "app_start","page_ready","startup_upkeep_started","startup_upkeep_finished",
        "startup_phase","folder_open_started","page_folder_first_picture_requested",
        "page_folder_first_grid_picture","page_folder_twenty_fifth_picture")]
    groups=collections.defaultdict(list)
    for n,d in rows:
        if n in ("page_picture_gpu_wait","page_picture_queue_wait","page_picture_cache_check",
                 "page_picture_local_masks","page_picture_render") and "duration_ms" in d:
            groups[n].append(d)
    stages={n:dict(count=len(ds),mean_ms=sum(d["duration_ms"] for d in ds)/len(ds),
                   longest=max(ds,key=lambda d:d["duration_ms"])) for n,ds in groups.items()}
    failures=[dict(event=n,**d) for n,d in rows if n=="page_picture_work_failed"]
    result=dict(timezone="Asia/Bangkok (UTC+07:00)",start=args.start,end=args.end,
                milestones=milestones,stages=stages,picture_failures=failures)
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps(result,indent=2))

if __name__=="__main__":
    main()
