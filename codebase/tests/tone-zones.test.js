const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parameters } = require("../frontend/tone-engine.js");
const { pythonExecutable } = require("../tools/lib/platform.cjs");

test("CPU and GPU parameter-only interval bounds agree across lanes, references, endpoints and extreme ranges", () => {
  const cases = [
    {}, { whites: 100 }, { whites: -100 }, { blacks: 100 },
    { shadows: 100 }, { shadows: 60, midtones: -40, highlights: 50 },
    { shadows: 100, midtones: -100, highlights: 100, blacks: 100, whites: -100 },
    { shadows: 100, midtones: -100, shadows_center: -12, midtones_center: 12, shadows_width: .5, midtones_width: 24 },
  ];
  const script = `import json,sys
from hdr_finisher.models import HDRAdjustments,SDRAdjustments
from hdr_finisher.tone import parameters
cases=json.loads(sys.argv[1]);result=[]
for hdr,cls in [(True,HDRAdjustments),(False,SDRAdjustments)]:
 for reference in [100,203]:
  for case in cases:
   branch=cls(**case);result.append(dict(branch=branch.model_dump(),hdr=hdr,reference=reference,expected=parameters(branch,hdr,reference)))
print(json.dumps(result))`;
  const root = path.join(__dirname, "..");
  const results = JSON.parse(execFileSync(pythonExecutable(), ["-c", script, JSON.stringify(cases)], {
    cwd: root, env: { ...process.env, PYTHONPATH: path.join(root, "backend") }, encoding: "utf8",
  }));
  for (const { branch, hdr, reference, expected } of results) {
    parameters(branch, hdr, reference).forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12, JSON.stringify({ hdr, reference, index, value, expected })));
  }
});

test("Whites alone retains the specified endpoint gains without limiting", () => {
  for (const hdr of [true, false]) {
    assert.equal(parameters({ whites: -100 }, hdr)[3], 1);
    assert.equal(parameters({ whites: 100 }, hdr)[3], 1);
  }
});
