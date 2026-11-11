"""Run a Grade diagnostic plan with atomic shared-folder acquisition.

Usage: .venv/Scripts/python.exe tools/run_grade_batch.py plan.json
The plan is a JSON array of arrays containing grade-release-sweep.js arguments.
One controller, one Electron driver per lock. No test project is saved.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
LOCK = Path(r"D:\AI\AI Projects\HDR Finisher Tool\gpu-run.lock")
OUT = ROOT / "output/performance/grade-0-9-2"


def now():
    return datetime.now(timezone.utc).isoformat()


def stop(child):
    if child.poll() is not None:
        return
    script = "const {stopProcessTree}=require('./tests/release/process-tree.cjs');const r=stopProcessTree([{pid:Number(process.argv[1])}]);process.exit(r.survivors.length?1:0);"
    subprocess.run(["node", "-e", script, str(child.pid)], cwd=ROOT, check=True)
    child.wait(timeout=30)


def acquire(label):
    token = str(uuid.uuid4())
    branch = subprocess.check_output(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, text=True).strip()
    while True:
        try:
            os.mkdir(LOCK)  # Win32 CreateDirectory: ERROR_ALREADY_EXISTS is an error.
            break
        except FileExistsError:
            time.sleep(.5)
    text = f"{branch} {label} {now()} pid={os.getpid()} token={token}\n"
    try:
        with (LOCK / "owner.txt").open("x", encoding="utf-8") as stream:
            stream.write(text)
    except Exception:
        # A legacy non-atomic creator may have raced us. Do not remove its folder.
        raise
    return text


def owns(text):
    try:
        return (LOCK / "owner.txt").read_text(encoding="utf-8-sig") == text
    except OSError:
        return False


def main():
    plan = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    OUT.mkdir(parents=True, exist_ok=True)
    ledger_path = OUT / "w10-launches.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {"startedAt": now(), "runs": []}
    for arguments in plan:
        label = arguments[arguments.index("--label") + 1] if "--label" in arguments else arguments[arguments.index("--batch") + 1]
        owner = acquire(label)
        entry = {"label": label, "startedAt": now(), "arguments": arguments}
        ledger["runs"].append(entry)
        child = None
        try:
            # Give a legacy competing creator time to publish its conflicting owner.
            time.sleep(.2)
            if not owns(owner):
                raise RuntimeError("Shared lock ownership changed before launch")
            print(f"Starting serialized Grade batch: {label}", flush=True)
            env = dict(os.environ, HDR_FINISHER_ELECTRON_WINDOW_SIZE="2560x1440")
            child = subprocess.Popen(["node", "tests/run-in-electron.js", "tests/performance/grade-release-sweep.js", *arguments], cwd=ROOT, env=env)
            started = time.monotonic()
            while child.poll() is None:
                if not owns(owner):
                    stop(child)
                    raise RuntimeError("Shared lock ownership changed during driver; observations invalid")
                if time.monotonic() - started > 15 * 60:
                    stop(child)
                    raise RuntimeError("Driver exceeded the 15-minute batch bound")
                time.sleep(.5)
            entry["exitCode"] = child.returncode
        except BaseException as error:
            entry["error"] = str(error)
            if child is not None:
                stop(child)
            raise
        finally:
            entry["completedAt"] = now()
            (OUT / "w10-launches.json").write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")
            if owns(owner):
                os.unlink(LOCK / "owner.txt")
                os.rmdir(LOCK)
        report_path = OUT / f"{label}.json"
        if report_path.exists() and "allowance reached" in json.loads(report_path.read_text()).get("stopped", ""):
            print("Measurement allowance exhausted; remaining plan not launched.", flush=True)
            break
        time.sleep(15)  # Let another worker acquire the GPU between batches.


if __name__ == "__main__":
    main()
