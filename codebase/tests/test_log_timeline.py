import json
from pathlib import Path
import subprocess
import sys


def test_timeline_connects_rotated_and_legacy_records_by_action(tmp_path):
    tool = Path(__file__).resolve().parents[1] / "tools" / "log_timeline.py"

    def record(time, event, **fields):
        return json.dumps(dict(time=time, event=event, action="one", area="denoise", proc="renderer_main", **fields))

    (tmp_path / "backend.log.1").write_text(
        record(1, "action_started", photo={"id": "frame", "name": "foo.ARW"}) + "\n"
        + record(2, "grain_gpu_refused", route="refused", reason="gpu_budget_exceeded", requested_bytes=90) + "\n"
        + record(2.1, "grain_eviction", evicted_bytes_by_kind={"source-proxy": 8}, presentation_kept=True) + "\n",
        encoding="utf-8",
    )
    (tmp_path / "backend.log").write_text(
        '[library] denoise_grain_prepared {"time":3,"action_id":"one","disk_bytes":128}\n'
        + record(4, "grain_presented", route="cpu", requested_bytes=10) + "\n"
        + '{"time":4,"event":"action_started","action":"other","area":"export"}\n'
        + '{partial\n',
        encoding="utf-8",
    )
    result = subprocess.run([sys.executable, str(tool), str(tmp_path), "--photo", "FOO.arw", "--area",
                             "denoise", "--since", "2", "--until", "4"], capture_output=True, text=True, check=True)
    output = result.stdout
    assert output.index("grain_gpu_refused") < output.index("denoise_grain_prepared") < output.index("grain_presented")
    assert "action_started" not in output
    assert "refusals=1" in output
    assert "requested_bytes=90" in output
    assert "disk_bytes=128" in output
    assert "evicted_bytes_by_kind={'source-proxy': 8}" in output
    assert "presentation_kept=True" in output
