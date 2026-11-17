const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const {pythonExecutable} = require('../tools/lib/platform.cjs');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(execFileSync(pythonExecutable(), [path.join(__dirname, 'helpers/denoise_calibration_fixture.py')], {
  cwd: root, env: {...process.env, PYTHONPATH: path.join(root, 'backend')}, encoding: 'utf8',
}));
const context = vm.createContext({window: {}});
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/denoise-measurement.js'), 'utf8'), context);
const measurement = context.window.HDRDenoiseMeasurement;

test('CPU and GPU host fit sparse or repeated brightness observations alike', () => {
  for (const fixture of data.fits) {
    const model = measurement.fitInformative(fixture.observations, data.rules);
    for (const term of ['a', 'b', 'c']) {
      assert.ok(Math.abs(model[term]-fixture.model[term]) <= Math.abs(fixture.model[term])*1e-6+1e-12,
        `${term}: GPU host ${model[term]}, CPU ${fixture.model[term]}, ${JSON.stringify(fixture.observations)}`);
    }
  }
});

test('measurement revision agrees with the CPU source contract', () => {
  assert.equal(measurement.version, data.version);
  assert.notEqual(measurement.version, 'adaptive-measure-signed-source-v2');
});

for (const fixture of data.fixtures) {
  test(`CPU and GPU host choose the same ${fixture.name} calibration`, () => {
    const selection = measurement.calibrationBlocks(fixture.spreads, fixture.zero_fractions, data.rules);
    assert.equal(selection.informed, fixture.informed);
    assert.deepEqual(Array.from(selection.indices), fixture.selected);
    const model = measurement.fitInformative(fixture.observations, data.rules);
    if (fixture.model === null) assert.equal(model, null);
    else for (const term of ['a', 'b', 'c']) {
      assert.ok(Math.abs(model[term] - fixture.model[term]) <= Math.abs(fixture.model[term])*1e-6+1e-12,
        `${term}: GPU host ${model[term]}, CPU ${fixture.model[term]}`);
    }
  });
}

test('exactly one quarter numerical zeros is excluded and ties stay selected', () => {
  const selection = measurement.calibrationBlocks(Array(10).fill(1), [.25, 1, ...Array(8).fill(.249)], data.rules);
  assert.equal(selection.informed, true);
  assert.deepEqual(Array.from(selection.indices), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(measurement.calibrationBlocks(Array(9).fill(1), [.25, 1, ...Array(7).fill(0)], data.rules).informed, false);
});

for (const scale of [1/64, 1, 64]) {
  test(`informative fit keeps nonnegative shot/read/relative terms at scale ${scale}`, () => {
    const rows = [.001, .003, .01, .03, .1, .3].map(signal => ({
      signal: signal*scale, variance: (.003*signal+2e-6+.01*signal**2)*scale**2,
      pixels: 1000, zero_fraction: 0,
    }));
    rows.push({signal: 1.25*scale, variance: 0, pixels: 1000, zero_fraction: 1});
    rows.push({signal: 1.5*scale, variance: scale**2, pixels: 1000, zero_fraction: .25});
    const model = measurement.fitInformative(rows, data.rules);
    for (const [term, expected] of Object.entries({a: .003*scale, b: 2e-6*scale**2, c: .01})) {
      assert.ok(Math.abs(model[term]-expected) < Math.abs(expected)*1e-8, `${term}: ${model[term]} != ${expected}`);
    }
  });
}
