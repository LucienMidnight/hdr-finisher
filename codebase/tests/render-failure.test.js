const assert = require("node:assert/strict");
const test = require("node:test");

const { HDRRenderFailure, HDRRenderFailurePolicy } = require("../frontend/render-failure.js");

test("every Section 5.8 class is recognized from the error it produces", () => {
  const cases = [
    [Object.assign(new Error("The operation was aborted"), { name: "AbortError" }), {}, "superseded"],
    [new Error("superseded before presentation"), {}, "superseded"],
    [new Error("Failed to fetch"), {}, "transport"],
    [new Error("device lost"), {}, "device-lost"],
    [new Error("validation: Scissor rect is not contained in the render area"), {}, "validation"],
    [new Error("Failed to allocate a 512 MiB buffer"), {}, "allocation"],
    [new Error("unsupported graph for this lane"), {}, "unsupported"],
    [new Error("No WebGPU adapter was returned"), { init: true }, "init"],
  ];
  for (const [error, context, expected] of cases) {
    assert.equal(HDRRenderFailure.classify(error, context).kind, expected, error.message);
  }
});

test("recoverable classes never disable WebGPU", () => {
  const policy = new HDRRenderFailurePolicy();
  for (const [error, context] of [
    [new Error("Failed to fetch"), {}],
    [new Error("Failed to allocate a buffer"), {}],
    [new Error("unsupported graph"), {}],
    [new Error("device lost"), { deviceLost: true }],
    [Object.assign(new Error("aborted"), { name: "AbortError" }), {}],
  ]) {
    const verdict = policy.record(error, context);
    assert.equal(verdict.recoverable, true, error.message);
    assert.equal(verdict.disabled, false, error.message);
  }
  assert.equal(policy.snapshot().disabled, false);
});

test("only repeated validation failure is sticky, and success resets the count", () => {
  const policy = new HDRRenderFailurePolicy({ validationThreshold: 3 });
  const validation = () => policy.record(new Error("validation error: invalid value"));

  assert.equal(validation().disabled, false);
  policy.noteSuccess();
  assert.equal(validation().disabled, false);
  assert.equal(validation().disabled, false);
  assert.equal(validation().disabled, true, "the third consecutive failure after a success disables");
  assert.equal(policy.snapshot().disabled, true);

  const fresh = new HDRRenderFailurePolicy({ validationThreshold: 3 });
  fresh.record(new Error("validation error"));
  fresh.record(new Error("validation error"));
  fresh.noteSuccess();
  assert.equal(fresh.record(new Error("validation error")).disabled, false);
  assert.equal(fresh.snapshot().consecutiveValidation, 1);
});

test("a superseded failure neither counts toward nor resets the validation chain", () => {
  const policy = new HDRRenderFailurePolicy({ validationThreshold: 2 });
  policy.record(new Error("validation error"));
  policy.record(Object.assign(new Error("aborted"), { name: "AbortError" }));
  const verdict = policy.record(new Error("validation error"));
  assert.equal(verdict.disabled, true);
  assert.equal(policy.snapshot().consecutiveValidation, 2);
});

test("initialization failure is permanent on the first record", () => {
  const policy = new HDRRenderFailurePolicy();
  const verdict = policy.record(new Error("No WebGPU adapter was returned"), { init: true });
  assert.equal(verdict.kind, "init");
  assert.equal(verdict.recoverable, false);
  assert.equal(verdict.disabled, true);
  assert.equal(policy.snapshot().disabled, true);
});

test("retryable failures carry a retry flag that a disabled policy withholds", () => {
  const policy = new HDRRenderFailurePolicy();
  assert.equal(policy.record(new Error("Failed to fetch")).retryable, true);
  assert.equal(policy.record(new Error("unsupported graph")).retryable, false);
  policy.record(new Error("no adapter"), { init: true });
  assert.equal(policy.record(new Error("Failed to fetch")).retryable, false);
});
