const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
  const detached = false;
  const requests = [], listeners = [];
  const timers = new Map();
  let suspended = 0;
  const c = { suspendGradeInstruments:()=>suspended++, state: { activeWorkflow: "grade" },
    document: { createElement: () => ({hidden:true,contains:()=>true,setAttribute(){},addEventListener(){}}), body:{append(){}},
      getElementById: () => ({hidden:true,contains:()=>true,addEventListener(){}}),
      addEventListener: (name, fn, capture) => listeners.push({surface:"document",name,fn,capture}) },
    addEventListener: (name, fn, capture) => listeners.push({surface:"window",name,fn,capture}),
    setInterval(){}, setTimeout: fn => {const id=Symbol();timers.set(id,fn);return id;}, clearTimeout:id=>timers.delete(id),
    HDRLibraryHost:{isDetached:()=>detached}, fetch: async (url,options)=>{requests.push(JSON.parse(options.body));return {ok:true};} };
  c.window=c; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../frontend/grade-saving.js"),"utf8"),c);
  return {c,requests,get suspended(){return suspended;},async fire(name,{swallowed=false,elementBlur=false}={}) {
    // A canvas tool stops the event during document capture (HSL) or at the target (Retouch).
    for(const l of listeners.filter(l=>l.name===name).sort((a,b)=>Number(Boolean(b.capture))-Number(Boolean(a.capture)))) {
      if(elementBlur && !l.capture)continue;
      if(swallowed && !(l.surface==="window" && l.capture))continue;
      l.fn({target:{closest:()=>true}});
    }
    for(const [id,fn] of [...timers]){timers.delete(id);fn();}
    for(let i=0;i<8;i++)await Promise.resolve();
  }};
}

for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) {
  test(`Grade resumes when a canvas tool consumes ${end}`, async () => {
    const h=harness();await h.fire("pointerdown");await h.fire(end,{swallowed:true});
    assert.deepEqual(h.requests.map(r=>r.paused),[true,false]);
  });
}
test("leaving Grade releases an interrupted gesture", async()=>{
  const h=harness();await h.fire("pointerdown");h.c.state.activeWorkflow="import";
  await h.fire("hdrfinisher:workflowchange");
  assert.equal(h.suspended,1);
  assert.equal(h.requests.at(-1).grade_active,false);
  assert.deepEqual(h.requests.map(r=>r.paused),[true,false]);
});

test("moving focus between controls keeps the gesture paused; leaving the window releases it", async()=>{
  const h=harness();await h.fire("pointerdown");await h.fire("blur",{elementBlur:true});
  assert.deepEqual(h.requests.map(r=>r.paused),[true]);
  await h.fire("blur");assert.deepEqual(h.requests.map(r=>r.paused),[true,false]);
});
test("hiding Grade releases an interrupted gesture",async()=>{
  const h=harness();await h.fire("pointerdown");h.c.document.hidden=true;
  await h.fire("visibilitychange");assert.deepEqual(h.requests.map(r=>r.paused),[true,false]);
});

test("Grade gestures send the accepted pause reason and release it after the gesture", async () => {
  const documentEvents = new Map(), windowEvents = new Map(), timers = new Map(), requests = [];
  const context = {
    state: { activeWorkflow: "grade" },
    document: {
      createElement: () => ({ setAttribute() {}, addEventListener() {} }),
      body: { append() {} },
      getElementById: () => ({ addEventListener() {} }),
      addEventListener: (name, handler) => documentEvents.set(name, handler),
    },
    addEventListener: (name, handler) => windowEvents.set(name, handler),
    suspendGradeInstruments() {},
    setInterval() {},
    setTimeout: handler => { const id = Symbol(); timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, "/api/library-worker/pause");
      // These are the backend's public pause reasons. A UI-only name is rejected.
      assert.ok(["grading", "export", "manual"].includes(body.reason));
      requests.push(body);
      return { ok: true };
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../frontend/grade-saving.js"), "utf8"), context);
  const control = { target: { closest: () => true } };
  documentEvents.get("pointerdown")(control);
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(requests.map(({reason,paused})=>({reason,paused})), [{ reason: "grading", paused: true }]);
  windowEvents.get("pointerup")();
  for (const callback of timers.values()) callback();
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.deepEqual(requests.map(({reason,paused})=>({reason,paused})), [{ reason: "grading", paused: true }, { reason: "grading", paused: false }]);
  context.state.activeWorkflow = "library";
  documentEvents.get("pointerdown")(control);
  assert.equal(requests.length, 2);
});


test("a delayed hold cannot re-enable Grade after rapid tab changes",async()=>{
  const h=harness();let finish;
  h.c.fetch=async(url,options)=>{
    h.requests.push(JSON.parse(options.body));
    if(h.requests.length===1)await new Promise(resolve=>{finish=resolve;});
    return {ok:true};
  };
  await h.fire("pointerdown");
  h.c.state.activeWorkflow="import";await h.fire("hdrfinisher:workflowchange");
  h.c.state.activeWorkflow="grade";await h.fire("hdrfinisher:workflowchange");
  h.c.state.activeWorkflow="import";await h.fire("hdrfinisher:workflowchange");
  assert.equal(h.requests.length,1);
  finish();for(let i=0;i<50;i++)await Promise.resolve();
  assert.equal(h.requests.length,4);
  assert.ok(h.requests.slice(1).every(r=>!r.paused&&r.grade_active===false));
});
