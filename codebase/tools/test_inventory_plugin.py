"""Optional measurement plugin: HDR_TEST_INVENTORY_REPORT selects the JSON output prefix."""
import json
import os
from pathlib import Path

_items = {}


def pytest_collection_finish(session):
    for item in session.items:
        _items[item.nodeid] = {"markers": sorted({m.name for m in item.iter_markers()}), "seconds": 0.0}


def pytest_runtest_logreport(report):
    entry = _items.setdefault(report.nodeid, {"markers": [], "seconds": 0.0})
    entry["seconds"] += report.duration
    if report.when == "call" or report.skipped or report.failed:
        entry["outcome"] = report.outcome


def pytest_sessionfinish(session):
    prefix = os.environ.get("HDR_TEST_INVENTORY_REPORT")
    if prefix and not hasattr(session.config, "workerinput"):
        path = Path(f"{prefix}-{os.getpid()}.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_items, indent=2, sort_keys=True) + "\n", encoding="utf-8")
