const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const output = path.resolve('output/recent-projects-interaction');
fs.mkdirSync(output, {recursive:true});
const scratch = fs.mkdtempSync(path.join(output, 'run-'));
const photo = path.join(scratch, 'source.png');
fs.copyFileSync(path.join(__dirname, 'fixtures/sdr_gradient.png'), photo);
const projects = ['First.hdrfinisher','Second.hdrfinisher'].map(name=>path.join(scratch,name));
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.HDR_FINISHER_URL || 'http://127.0.0.1:8000');
  await page.locator('#project-recents').click();
  await page.locator('#recent-projects-dialog[open]').waitFor();
  assert.ok(await page.locator('#recent-projects-empty').isVisible());
  await page.locator('#recent-projects-close').click();
  await page.evaluate(async photo=>openDesktopSelection({kind:'source',...await desktop.grantSourcePath(photo)}),photo);
  for(const file of projects){
   await page.evaluate(()=>{window.recentSaveFlight=saveProjectToPath({saveAs:true});});
   await page.locator('#directory-browser[open]').waitFor();
   await page.evaluate(folder=>loadMediaDirectory(folder),scratch);
   await page.locator('#directory-browser-filename').fill(path.basename(file));
   await page.locator('#directory-browser-select').click();
   assert.equal(await page.evaluate(()=>window.recentSaveFlight),true);
   assert.ok(fs.existsSync(file));
  }
  const firstBytes=fs.readFileSync(projects[0]);
  await page.reload();
  await page.locator('#project-recents').click();
  await page.locator('#recent-projects-dialog[open]').waitFor();
  assert.deepEqual(await page.locator('#recent-projects-list strong').allTextContents(),['Second.hdrfinisher','First.hdrfinisher']);
  assert.deepEqual(await page.locator('#recent-projects-list span').allTextContents(),[projects[1],projects[0]]);
  await page.screenshot({path:path.join(output,'recent-projects.png')});
  await page.locator('#recent-projects-list button').filter({hasText:'First.hdrfinisher'}).click();
  await page.waitForFunction(file=>state.projectPath===file && status.get('project-open')?.severity==='success',projects[0],{timeout:120000});
  assert.equal(await page.evaluate(()=>HDRGradeSaving.active()),false);
  assert.deepEqual(fs.readFileSync(projects[0]),firstBytes,'Opening a recent project does not save it');
  await page.locator('#project-recents').click();
  assert.equal(await page.locator('#recent-projects-list strong').first().textContent(),'First.hdrfinisher');
  await page.locator('#recent-projects-close').click();
  // A missing entry reports an error and leaves the current project intact.
  fs.unlinkSync(projects[1]);
  await page.locator('#project-recents').click();
  await page.locator('#recent-projects-list button').filter({hasText:'Second.hdrfinisher'}).click();
  await page.waitForFunction(()=>status.get('project-open')?.severity==='error');
  assert.equal(await page.evaluate(()=>state.projectPath),projects[0]);
  assert.equal(fs.existsSync(photo+'.hdrf'),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: Save As appears in Recent projects, persists across reload, reopens without browsing or writing, and handles missing files.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
