const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){const window={dispatchEvent(){}};vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/library-picture-errors.js'),'utf8'),{window,Event});const changed=[];return {errors:window.HDRLibraryPictureErrors.create({api:()=>{},status:()=>{},changed:paths=>changed.push(...paths)}),changed};}
test('interpretation refusal stays blocked through folder rechecks, until explicitly cleared or source changes',()=>{
 const {errors,changed}=setup();const refusal={path:'DSC01287.exr',reason:'Choose source interpretation in Grade',revision:'source-v1',time:1};
 errors.remember(refusal);let starts=0;
 for(let check=0;check<20;check++){errors.update([refusal],check+2);if(errors.canPrepare(refusal.path))starts++;}
 assert.equal(starts,0);assert.deepEqual(changed,[]);
 errors.update([],25);assert.ok(errors.canPrepare(refusal.path));assert.deepEqual(changed,[refusal.path]);
});
test('a readable grade warning still permits picture preparation',()=>{
 const {errors}=setup();errors.remember({path:'photo.dng',grade_warning:true});assert.ok(errors.canPrepare('photo.dng'));assert.ok(errors.canPrepare('healthy.dng'));
});


test('a late camera preview survives source refusal and exposes the reason on hover',async()=>{
 const {errors}=setup(),controller=new AbortController();let resolve,removed=false;
 errors.remember({path:'refused.raf',reason:'Unsupported recipe'});
 const classes=new Map(),tag={remove(){removed=true;}};
 const cell={photo:{path:'refused.raf'},controller,element:{querySelector:()=>tag,classList:{toggle:(key,value)=>classes.set(key,value)}}};
 cell.previewPromise=new Promise(r=>resolve=r);
 const failure=errors.failed(cell,()=>!controller.signal.aborted);
 await Promise.resolve();assert.equal(controller.signal.aborted,false);
 cell.hasCameraPreview=true;resolve();await failure;
 assert.equal(controller.signal.aborted,false);assert.equal(removed,true);
 assert.equal(classes.get('picture-failed'),false);assert.equal(cell.element.title,'Unsupported recipe');
});

test('a missing preview still releases the failed cell and an obsolete preview cannot repaint it',async()=>{
 const {errors}=setup();let paints=0;
 const cell={photo:{path:'no-picture.raf'},controller:new AbortController(),previewPromise:Promise.resolve(),element:{querySelector:()=>null,classList:{toggle:()=>paints++}}};
 await errors.failed(cell,()=>true);assert.equal(cell.controller.signal.aborted,true);assert.equal(paints,1);
 paints=0;await errors.failed(cell,()=>false);assert.equal(paints,0);
});
