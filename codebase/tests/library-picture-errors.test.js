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
