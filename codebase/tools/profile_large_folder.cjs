const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'), profile=path.resolve(process.argv[2]);
const {_electron}=require(path.join(root,'node_modules/playwright'));
(async()=>{
 const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile,PYTHONPATH:profile,HDR_PROFILE_BACKEND:path.join(root,'backend'),HDR_FINISHER_ELECTRON_WINDOW_SIZE:'2560x1440'};
 delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require(path.join(root,'desktop/node_modules/electron')),args:[path.join(root,'desktop')],cwd:root,env,timeout:90000});
 const result={folder:'D:\\Photos'};
 try {
  const page=await app.firstWindow();await page.waitForURL(/^http:/,{timeout:90000});
  const frame=await page.waitForFunction(()=>!!document.querySelector('iframe[src*="library"]'));
  const library=page.frames().find(f=>/\/library(?:\?|$)/.test(f.url()));
  await library.waitForFunction(()=>window.HDRLibrary?.getSnapshot().count>150000,{},{timeout:90000});
  result.snapshot=await library.evaluate(()=>({path:HDRLibrary.getSnapshot().path,count:HDRLibrary.getSnapshot().count}));
  if(result.snapshot.path!=='D:\\Photos')throw Error('Wrong folder '+result.snapshot.path);
  await library.waitForFunction(()=>document.querySelectorAll('#grid-space canvas[data-picture-key],#grid-space img[data-preview="true"]').length>=25,{},{timeout:90000});
  await page.screenshot({path:path.join(profile,'first-screen.png')});
  await page.waitForTimeout(1500);
  const log=fs.readFileSync(path.join(profile,'logs/backend.log'),'utf8');
  if(!log.includes('"folder": "D:\\\\Photos"'))throw Error('Folder path missing from log');
  fs.writeFileSync(path.join(profile,'folder-log.txt'),log.split('\n').filter(line=>/folder_|page_picture_present/.test(line)).join('\n'));
  const events=log.split('\n').filter(line=>line.startsWith('[library] ')).flatMap(line=>{try{return [{stage:line.slice(10,line.indexOf(' {')), ...JSON.parse(line.slice(line.indexOf('{')))}]}catch{return []}});
  result.milestones=events.filter(e=>/page_folder_(rows_usable|first_rows|first_picture_requested|first_grid_picture)/.test(e.stage));
  const opened=events.find(e=>e.stage==='page_folder_open');
  const seen=new Set();
  const presented=events.filter(e=>e.stage==='page_picture_present' && e.view==='grid' && !seen.has(e.path) && seen.add(e.path));
  result.first_ms=presented.length?(presented[0].time-opened.time)*1000:null;
  result.picture25_ms=presented.length>=25?(presented[24].time-opened.time)*1000:null;
 } catch(e){result.error=String(e)} finally {
  fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));await app.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
