const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const output = path.resolve('output/project-open-session-interaction');
fs.mkdirSync(output, { recursive: true });
const scratch = fs.mkdtempSync(path.join(output, 'run-'));
const photo = path.join(scratch, 'source.png');
fs.copyFileSync(path.join(__dirname, 'fixtures/sdr_gradient.png'), photo);
const project = process.env.HDR_FINISHER_FEEDBACK_PROJECT || path.join(scratch, 'saved.hdrfinisher');
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage(), errors = [], gradeFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && response.url().includes('/api/library/grade/')) gradeFailures.push(response.url()); });
  await page.goto(process.env.HDR_FINISHER_URL);
  await page.evaluate(async photo => openDesktopSelection({ kind: 'source', ...await desktop.grantSourcePath(photo) }), photo);
  assert.equal(await page.evaluate(() => HDRGradeSaving.active()), true);
  if (!process.env.HDR_FINISHER_FEEDBACK_PROJECT) {
   assert.equal(await page.evaluate(async project => {
    const selection = await desktop.grantProjectPath(project, 'project-save');
    const {response} = await projectIo.saveDesktopProject(fetch, {sessionId: state.session.session_id, projectGrant: selection.grant});
    return response.ok;
   }, project), true);
  }
  const bytes = fs.readFileSync(project);
  // A failed open must release the pause and keep checking the still-open Library photo.
  await page.evaluate(() => {
   window.gradeChecks = 0;
   const original = window.fetch;
   window.fetch = (...args) => { if (/\/api\/library\/grade\//.test(String(args[0]))) window.gradeChecks++; return original(...args); };
  });
  const invalidProject = path.join(scratch, 'invalid.hdrfinisher');
  fs.writeFileSync(invalidProject, 'invalid project');
  await page.evaluate(async project => openProjectFromPath(await desktop.grantProjectPath(project, 'project-open')), invalidProject);
  assert.equal(await page.evaluate(() => status.get('project-open')?.severity), 'error');
  const checks = await page.evaluate(() => window.gradeChecks);
  await page.waitForFunction(checks => window.gradeChecks > checks, checks);
  assert.equal(await page.evaluate(() => HDRGradeSaving.active()), true);
  // Delay delivery after the real backend replaces its session. Polling must stay paused.
  await page.evaluate(() => {
   window.checksAfterReplacement = 0;
   const original = window.fetch;
   window.fetch = async (...args) => {
    const url = String(args[0]);
    if (/\/sdr-match$/.test(url)) return new Promise(resolve => { window.finishOldMatch = () => resolve(new Response(JSON.stringify({detail:'Old photo Match failed'}), {status:500,headers:{'Content-Type':'application/json'}})); });
    if (window.backendReplaced && /\/api\/library\/grade\//.test(url)) window.checksAfterReplacement++;
    const response = await original(...args);
    if (url.includes('/api/desktop/project/open')) {
     window.backendReplaced = true;
     await new Promise(resolve => setTimeout(resolve, 1400));
    }
    return response;
   };
   state.sdrMatchCandidateRenderer = 'cpu';
   window.oldMatchFlight = setSdrMatch();
  });
  await page.waitForFunction(() => !!window.finishOldMatch);
  await page.evaluate(() => status.post({id:'match',severity:'error',message:'An earlier Match error'}));
  await page.evaluate(async project => openProjectFromPath(await desktop.grantProjectPath(project, 'project-open')), project);
  assert.equal(await page.evaluate(() => status.get('project-open')?.severity), 'success');
  assert.equal(await page.evaluate(() => state.projectPath), project);
  assert.equal(await page.evaluate(() => HDRGradeSaving.active()), false);
  assert.equal(await page.evaluate(() => !!status.get('match') || !!status.get('grade-save')), false);
  const sessionId = await page.evaluate(() => state.session.session_id);
  assert.equal(await page.evaluate(async () => { window.finishOldMatch(); return window.oldMatchFlight; }), false);
  assert.equal(await page.evaluate(() => state.session.session_id), sessionId);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(() => window.checksAfterReplacement), 0);
  assert.equal(await page.evaluate(() => !!status.get('match') || !!status.get('grade-save')), false);
  assert.deepEqual(gradeFailures, []);
  assert.deepEqual(fs.readFileSync(project), bytes, 'Opening must not rewrite the project');
  assert.equal(fs.existsSync(photo + '.hdrf'), false, 'Opening must not write photo settings');
  assert.deepEqual(errors, []);
  console.log('PASS: failed open resumes Library saving; successful delayed open stops old polling, clears old errors and ignores late Match replies without writing project or sidecar.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
