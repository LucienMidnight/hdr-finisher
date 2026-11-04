"""Summarize independent 4d samples. All figures use decimal GB."""
import json
from pathlib import Path
from statistics import median
OUT = Path(__file__).resolve().parents[1] / "output/library-grade-4d"
def lines(name):
    return [json.loads(s) for s in (OUT/name).read_text(encoding="utf-8").splitlines() if s]
points, samples, gpu = lines("points.jsonl"), lines("memory.jsonl"), lines("gpu.jsonl")
steps=json.loads((OUT/"steps.json").read_text())
# The early-launch census may precede Electron role data; resolve from all points.
roles={}
for p in points:
    for e in p["electron"]:
        roles[e["pid"]]="main" if e["type"]=="Browser" else "GPU" if e["type"]=="GPU" else "utility" if e["type"]=="Utility" else "renderer" if e["type"]=="Tab" else e["type"]
    for w in p["windows"]:
        roles[w["pid"]]="delivery" if "gpu-delivery" in w["url"] else "Library popout" if "/library" in w["url"] else "main renderer"
backend=points[0]["memory"]["backendPid"]
def role(r):
    return "backend" if r["pid"]==backend else roles.get(r["pid"],"Python helpers" if r["name"].lower().startswith("python") else "other helpers")
def grouped(sample,field):
    result={}
    for r in sample["processes"]:
        key=role(r);result[key]=result.get(key,0)+r.get(field,0)
    return result
def pair(rows,fn,start,end):
    active=[s for s in rows if start<=s["at"]<=end]
    tail=[s for s in active if s["at"]>=end-2500]
    if not active:return [None,None]
    return [max(fn(s) for s in active),median(fn(s) for s in tail) if tail else None]
def fmt(pair):
    return " / ".join("â€”" if n is None else f"{n/1e9:.3f}" for n in pair)
summary=[]
for step in steps:
    start,end=step["start"],step["end"]
    row={**step,"duration_s":(end-start)/1000}
    row["total"]=pair(samples,lambda s:s["totalBytes"],start,end)
    row["working_set"]=pair(samples,lambda s:s["workingSetBytes"],start,end)
    row["roles"]={key:{field:pair(samples,lambda s:grouped(s,field).get(key,0),start,end) for field in ("chargedBytes","workingSetBytes","privateBytes")} for key in sorted(set(roles.values())|{"backend","Python helpers","other helpers"}) if key!="renderer"}
    row["gpu"]={key:{field:pair(gpu,lambda s:sum(r[field] for r in s["processes"] if roles.get(r["pid"],"unknown")==key),start,end) for field in ("dedicatedBytes","sharedBytes")} for key in sorted(set(roles.get(r["pid"],"unknown") for s in gpu for r in s["processes"]))}
    row["caches"]={key:pair(points,lambda p:p["memory"]["caches"][key]["bytes"],start,end) for key in points[0]["memory"]["caches"]}
    row["grade"]=pair(points,lambda p:p["memory"]["gradeBytes"],start,end)
    summary.append(row)
(OUT/"summary.json").write_text(json.dumps({"steps":summary,"roles":roles,"sampleIntervalMs":median(b["at"]-a["at"] for a,b in zip(samples,samples[1:])),"gpuCounterDurationMs":median(s["durationMs"] for s in gpu)},indent=2))
columns=[("Total RAM",lambda r:r["total"]),("Working set",lambda r:r["working_set"])]
columns += [(key,lambda r,key=key:r["roles"][key]["chargedBytes"]) for key in summary[0]["roles"]]
text="| Step | "+" | ".join(c[0] for c in columns)+" |\n|---|"+"---|"*len(columns)+"\n"
for r in summary:text+="| "+r["name"]+" | "+" | ".join(fmt(fn(r)) for _,fn in columns)+" |\n"
text+="\n| Step | Thumbnails | Sharp | Camera | RAW | Handoff | Working | Grade retained | GPU dedicated | GPU shared |\n|---|"+"---|"*9+"\n"
for r in summary:
    gp=lambda field:[sum(v[field][i] or 0 for v in r["gpu"].values()) for i in (0,1)]
    text+="| "+r["name"]+" | "+" | ".join(fmt(r["caches"][key]) for key in ("thumbnails","sharp","camera","raw","handoff","working"))+" | "+fmt(r["grade"])+" | "+fmt(gp("dedicatedBytes"))+" | "+fmt(gp("sharedBytes"))+" |\n"
(OUT/"tables.md").write_text(text,encoding="utf-8")
print(text)

# Inspectable per-PID table includes helpers and both host-memory measures.
import csv
with (OUT/"process-table.csv").open("w",newline="",encoding="utf-8") as f:
    writer=csv.writer(f)
    writer.writerow(["step","pid","role","name","charged_peak_GB","charged_settled_GB","working_set_peak_GB","working_set_settled_GB","gpu_dedicated_peak_GB","gpu_dedicated_settled_GB","gpu_shared_peak_GB","gpu_shared_settled_GB"])
    pids={r["pid"]:r for s in samples for r in s["processes"]}
    for step in steps:
        start,end=step["start"],step["end"]
        for pid,proc in pids.items():
            if not any(start<=s["at"]<=end and any(r["pid"]==pid for r in s["processes"]) for s in samples):continue
            values=[]
            for field in ("chargedBytes","workingSetBytes"):
                values+=pair(samples,lambda s:sum(r.get(field,0) for r in s["processes"] if r["pid"]==pid),start,end)
            for field in ("dedicatedBytes","sharedBytes"):
                values+=pair(gpu,lambda s:sum(r[field] for r in s["processes"] if r["pid"]==pid),start,end)
            writer.writerow([step["name"],pid,role(proc),proc["name"],*[round(v/1e9,6) if v is not None else None for v in values]])
