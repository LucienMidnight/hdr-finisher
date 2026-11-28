const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

test('a truncated Match candidate response stops the GPU worker without rejecting', async () => {
 const calls = [], errors = [];
 const context = vm.createContext({
  state: {session: {session_id: 'photo', source: {width: 800, height: 600}},
   gpuPreview: {renderMatchCandidate: () => calls.push('render')}},
  fetch: async url => {
   calls.push(url);
   return {ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON'); }};
  },
  performance, console: {warn: (_message, error) => errors.push(error.name)},
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/sdr-match-ui.js'), 'utf8'), context);
 await context.serveSdrMatchCandidates('photo', 2, () => false);
 assert.deepEqual(calls, ['/api/session/photo/sdr-match/candidate?wait_ms=500']);
 assert.deepEqual(errors, ['SyntaxError']);
});

for (const responseStatus of [200, 409, 500]) {
 test(`a Match response (${responseStatus}) for a replaced photo cannot update the new photo`, async () => {
  let finish, requested;
  const pending = new Promise(resolve => { requested = resolve; });
  const messages = [], effects = [];
  const document = { global_adjustments: {} };
  const context = {
   state: { session: {session_id: 'old'}, editDocument: document, editRevision: 2, renderingMode: 'cpu' },
   els: { sdrMatchEntire: {} }, syncGlobalEditState: async () => true,
   setIndeterminatePreviewMessage() {}, hidePreviewMessage: () => effects.push('hide'), renderLaneChrome: () => effects.push('chrome'),
   fetch: () => { requested(); return new Promise(resolve => { finish = resolve; }); },
   safeJson: response => response.json(),
   refreshEditState: async () => effects.push('refresh'),
   responseErrorMessage: result => result.detail,
   status: { post: message => messages.push(message) }, console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/sdr-match-ui.js'), 'utf8'), context);
  const flight = context.setSdrMatch();
  await pending;
  context.state.session = {session_id: 'new'};
  finish({status: responseStatus, ok: responseStatus === 200, json: async () => ({revision: 99, document: {}, detail: 'old error'})});
  assert.equal(await flight, false);
  assert.equal(context.state.editDocument, document);
  assert.equal(context.state.editRevision, 2);
  assert.deepEqual(messages, []);
  assert.deepEqual(effects, []);
 });
}

test('a Match error still belongs to the photo that requested it', async () => {
 const messages = [], effects = [];
 const context = {
  state: {session: {session_id: 'current'}, editDocument: {}, renderingMode: 'cpu'}, els: {},
  syncGlobalEditState: async () => true, setIndeterminatePreviewMessage() {},
  fetch: async () => ({status:500,ok:false,json:async()=>({detail:'Cannot match this photo'})}),
  safeJson: response=>response.json(), responseErrorMessage: result=>result.detail,
  hidePreviewMessage: ()=>effects.push('hide'), renderLaneChrome: ()=>effects.push('chrome'),
  status: {post: message=>messages.push(message)}, console: {error(){}},
 };
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/sdr-match-ui.js'), 'utf8'), context);
 assert.equal(await context.setSdrMatch(),false);
 assert.equal(messages.length,1);assert.equal(messages[0].message,'Cannot match this photo');
 assert.deepEqual(effects,['hide','chrome']);
});
