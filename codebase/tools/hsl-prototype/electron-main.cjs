// Standalone window and disposable profile; does not start HDR Finisher's backend.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
app.setPath('userData', process.env.HDR_FINISHER_USER_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'hdr-hsl-prototype-')));
const files = new Map([['/','index.html'],['/index.html','index.html'],['/ui.mjs','ui.mjs'],['/engine.mjs','engine.mjs'],['/gpu.mjs','gpu.mjs'],['/frontend/hsl-engine.js','../../frontend/hsl-engine.js']]);
const server = http.createServer((req,res) => {
  const file = files.get(req.url);
  if (!file) { res.writeHead(404);res.end();return; }
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  fs.createReadStream(path.join(__dirname,file)).pipe(res);
});
app.whenReady().then(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const [width,height]=(process.env.HDR_FINISHER_ELECTRON_WINDOW_SIZE || '1440x1000').split('x').map(Number);
  const win=new BrowserWindow({width,height,show:process.env.HSL_PROTOTYPE_TEST!=='1',title:'HDR Finisher · HSL prototype',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  if (process.env.HSL_PROTOTYPE_TEST !== '1') win.show();
}).catch(e=>{console.error(e);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>server.close());
