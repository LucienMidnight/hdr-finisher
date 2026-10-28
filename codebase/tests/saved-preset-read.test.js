const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const film=require("../frontend/film-character.js");

for (const recipe of [{bloom_amount:20}, {stock_overrides:"damaged"}, "damaged"]) {
  test(`saved Film Look reaches recovery before unknown or damaged data is discarded: ${JSON.stringify(recipe)}`, async () => {
    let requested;
    const state={groupPresetContext:{groupId:"hdr-film-look",group:"film-look",lane:"hdr",paths:["hdr.film_look"]},adjustments:{hdr:{film_look:film.expand({})},sdr:{exposure:.7}}};
    const before=JSON.stringify(state.adjustments);
    const context=vm.createContext({state,Map,console,HDRFilmCharacter:film,els:{groupPresetStatus:{}},
      window:{HDRDialogs:{choose:async()=>"leave"}},
      fetch:async(url,options)=>{requested=JSON.parse(options.body);return {ok:true,json:async()=>({value:requested.value,notice:{reason:"Needs attention"}})};}});
    vm.runInContext(fs.readFileSync(require.resolve("../frontend/group-presets.js"),"utf8"),context);
    await context.applyGroupPreset({groupId:"hdr-film-look",values:{"hdr.film_look":recipe},app_version:"99.0.0",section_versions:{film_look:9}});
    assert.equal(requested.app_version,"99.0.0");
    assert.equal(requested.section_versions.film_look,9);
    if(typeof recipe === "string")assert.equal(requested.value.hdr.film_look,recipe);
    else for(const [key,value] of Object.entries(recipe))assert.deepEqual(requested.value.hdr.film_look[key],value);
    assert.equal(JSON.stringify(state.adjustments),before);
  });
}
