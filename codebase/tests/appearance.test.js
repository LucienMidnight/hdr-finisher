const {test}=require("node:test");
const assert=require("node:assert/strict");
const appearance=require("../frontend/appearance.js");
const {sanitizeApplicationPreferences}=require("../desktop/lib/application-preferences.js");
test("accent choices survive preference sanitization and match browser normalization",()=>{
 for(const preset of Object.keys(appearance.presets)){
  const accent={preset,color:"#ffffff"};
  assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,appearance.normalize(accent));
  assert.equal(appearance.normalize(accent).color,appearance.presets[preset]);
 }
 const accent={preset:"custom",color:"#A1B2C3"};
 assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,{preset:"custom",color:"#a1b2c3"});
});
test("malformed accents return the approved orange default",()=>{
 for(const accent of [null,{}, {preset:"custom",color:"red"},{preset:"custom",color:"#123"},{preset:"unknown"}])
  assert.deepEqual(sanitizeApplicationPreferences({accent}).accent,appearance.normalize());
});
test("accent foreground uses linearized sRGB luminance",()=>{
 assert.equal(appearance.luminance("#000000"),0);
 assert.equal(appearance.luminance("#ffffff"),1);
 assert.ok(appearance.luminance("#d0612a")>.18);
 assert.ok(appearance.luminance("#566481")<.18);
});
