/* Use the same Electron Chromium on macOS and Windows. Run through gpu-run-lock.py. */
const fs=require('node:fs'),path=require('node:path');
process.chdir(path.resolve(__dirname,'..'));
if(!process.versions.electron){
 const {spawnSync}=require('node:child_process');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('../desktop/node_modules/electron'),[__filename],{stdio:'inherit',env});
 process.exit(result.status??1);
}
const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1024,height:1024,useContentSize:true,transparent:true,webPreferences:{backgroundThrottling:false}});
 try{
  const svg=fs.readFileSync('desktop/assets/icon.svg','utf8');
  await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`));
  fs.mkdirSync('output/review/ui-polish',{recursive:true});
  for(const size of [1024,16,24,32,48]){
   win.setContentSize(size,size);
   await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   const image=(await win.webContents.capturePage()).resize({width:size,height:size});
   fs.writeFileSync(size===1024?'desktop/assets/icon.png':`output/review/ui-polish/icon-${size}.png`,image.toPNG());
  }
 }finally{win.destroy();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
