const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../frontend/delivery-settings.js"), "utf8");

async function setup(policy) {
  const input = {disabled:true, checked:false, addEventListener(_event, callback) { this.change = callback; }};
  const status = {textContent:""};
  const calls = [];
  const window = {};
  vm.runInNewContext(source, {window, document:{getElementById(id) {return id === "settings-force-cpu-delivery" ? input : status;}},
    fetch:async (url, options) => {calls.push({url, options}); if(options?.body) policy.force_cpu = JSON.parse(options.body).force_cpu;
      return {ok:true, json:async () => ({...policy,effective_force_cpu:policy.force_cpu || policy.environment_override})};}});
  await window.HDRDeliverySettings.refresh();
  return {input, status, calls};
}

test("delivery setting saves a CPU override and can turn it off", async () => {
  const {input, status, calls} = await setup({force_cpu:false, environment_override:false});
  assert.equal(input.disabled, false);
  input.checked = true;
  await input.change();
  assert.equal(input.checked, true);
  assert.match(status.textContent, /CPU forced/);
  assert.equal(calls.at(-1).url, "/api/delivery/preferences");
  assert.equal(JSON.parse(calls.at(-1).options.body).force_cpu, true);
  input.checked = false;
  await input.change();
  assert.equal(input.checked, false);
});

test("environment override shows the effective CPU selection and locks the control", async () => {
  const {input, status} = await setup({force_cpu:false, environment_override:true});
  assert.equal(input.disabled, true);
  assert.equal(input.checked, true);
  assert.match(status.textContent, /HDR_FINISHER_FORCE_CPU_DELIVERY/);
});
