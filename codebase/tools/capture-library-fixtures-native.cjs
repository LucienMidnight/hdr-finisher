// Plain Electron fixture capture. Each invocation owns a new empty test profile.
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),arg=(k,d)=>process.argv.find(a=>a.startsWith('--'+k+'='))?.split('=')[1]??d;
const phase=arg('phase','after'),edge=Number(arg('edge',2560));
if(!['before','after','retry-before','retry-after'].includes(phase)||![640,2560].includes(edge))throw Error('Invalid capture');
const folder=path.join(root,'output/test-photos/library-mixed-v1-run'),out=path.join(root,'output/library-freeze-pixels',phase,String(edge));
fs.mkdirSync(out,{recursive:true});
const only=process.env.HDR_FINISHER_PIXEL_ONLY;
const photos=fs.readdirSync(folder).filter(n=>!n.endsWith('.hdrf')&&!n.startsWith('.')).map((n,index)=>({index,photo:path.join(folder,n)})).filter(p=>!only||only.split('|').includes(path.basename(p.photo)));
const profile=fs.mkdtempSync(path.join(root,'output/pixel-test-native-')),configPath=path.join(profile,'quick-config.json');
fs.writeFileSync(configPath,JSON.stringify({pixelCapture:{phase,edge,out,photos,resume:process.argv.includes('--resume')}}));
fs.writeFileSync(path.join(profile,'window-state.json'),JSON.stringify({x:0,y:0,width:2560,height:1440}));
const env={...process.env,HDR_FINISHER_USER_DATA_DIR:profile,HDR_FINISHER_QUICK_LIBRARY_CONFIG:configPath};delete env.ELECTRON_RUN_AS_NODE;
const desktop=path.join(root,'desktop'),app=spawn(require(path.join(desktop,'node_modules/electron')),[desktop],{cwd:desktop,env,windowsHide:true,stdio:'ignore'});
const kill=()=>{try{execFileSync('taskkill',['/PID',String(app.pid),'/T','/F'],{stdio:'ignore',timeout:5000});}catch{}};
const deadline=setTimeout(()=>{console.error('Pixel capture hard timeout',profile);kill();process.exit(1);},900000);
let last='';const poll=setInterval(()=>{
 try{
  const stage=JSON.parse(fs.readFileSync(path.join(profile,'quick-stage.json'),'utf8')).stage;
  if(stage!==last){console.log(stage);last=stage;}
  if(stage==='done'||stage==='failed'){
   clearInterval(poll);clearTimeout(deadline);kill();
   const result=path.join(profile,'quick-result.json');if(fs.existsSync(result))console.log(fs.readFileSync(result,'utf8'));
   console.log('Profile',profile);process.exitCode=stage==='failed'?1:0;
  }
 }catch{}
},500);
process.on('SIGINT',()=>{kill();process.exit(130);});process.on('SIGTERM',()=>{kill();process.exit(130);});
