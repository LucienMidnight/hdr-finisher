const {test} = require('node:test');
const assert = require('node:assert/strict');
const {HDRSourceTransport} = require('../frontend/source-transport.js');

function fixture() {
  const pixels = new Float32Array(8*6*4).fill(1);
  const texture = {pixels, destroyed:false, destroy(){this.destroyed=true;}};
  const proxy = {texture, width:8, height:6, longEdge:256, lane:'hdr', sessionId:'photo',
    geometrySignature:'{}', sourceIdentity:'source', pixelFormat:'rgba32float'};
  const reduced = {...proxy, width:4, height:3, texture:{destroy(){this.destroyed=true;}}};
  const renderer = {proxies:new Map([['native',proxy],['reduced',reduced]]), resourceGeneration:0,
    device:{queue:{writeTexture({texture,origin}, data, layout, size){
      const samples = new Float32Array(data);
      for(let y=0;y<size.height;y++) for(let x=0;x<size.width;x++) for(let c=0;c<4;c++) {
        texture.pixels[((origin.y+y)*(texture.width||8)+origin.x+x)*4+c] = samples[y*layout.bytesPerRow/4+x*4+c];
      }
    }}},
    resetSession(){this.resourceGeneration++;for(const p of this.proxies.values())p.texture.destroy();this.proxies.clear();},
    sourceAbortSignal(){return new AbortController().signal;},
    destroyAfterActiveRenders(fn){fn();},recordStage(){},
  };
  const options = {sessionId:'photo', editRevision:3, sourceSize:[8,6],
    geometry:{crop:{x:0,y:0,width:1,height:1}},
    records:[{enabled:true,recipe:{search_rect:[2,1,5,4]}}], isCurrent:()=>true};
  const respond = (url) => {
    const q = new URL(url,'http://test').searchParams;
    assert.equal(q.get('edit_revision'),'3');
    const data = new Float32Array(3*3*4).fill(7);
    return new Response(data.buffer,{headers:{
      'X-Geometry-Signature':'{}','X-Edit-Revision':'3','X-Source-Epoch':'4',
      'X-Pixel-Format':'rgba32float','X-Working-Space':'acescg',
      'X-Tile-X':'2','X-Tile-Y':'1','X-Tile-Width':'3','X-Tile-Height':'3',
      'X-Output-Width':'8','X-Output-Height':'6','X-Bytes-Per-Row':'48',
    }});
  };
  return {renderer,options,proxy,reduced,respond};
}

test('repair refresh changes only bounded native pixels and discards reduced evidence', async t => {
  const f=fixture(); let calls=0;
  t.mock.method(globalThis,'fetch',async url=>{calls++;return f.respond(url);});
  assert.equal(await HDRSourceTransport.refreshRepairs(f.renderer,f.options),true);
  assert.equal(calls,1);
  assert.equal(f.renderer.proxies.get('native'),f.proxy);
  assert.equal(f.proxy.texture.destroyed,false);
  assert.equal(f.reduced.texture.destroyed,true);
  for(let y=0;y<6;y++)for(let x=0;x<8;x++)for(let c=0;c<4;c++) {
    assert.equal(f.proxy.texture.pixels[(y*8+x)*4+c],x>=2&&x<5&&y>=1&&y<4?7:1);
  }
});

for(const failure of ['refused','stale','truncated'])test(`repair ${failure} refresh drops native cache for full reload`,async t=>{
  const f=fixture();
  t.mock.method(globalThis,'fetch',async url=>{
    if(failure==='refused')return new Response('',{status:409});
    if(failure==='stale')f.renderer.resourceGeneration++;
    const response=f.respond(url);
    if(failure==='truncated')return new Response(new ArrayBuffer(0),{headers:response.headers});
    return response;
  });
  assert.equal(await HDRSourceTransport.refreshRepairs(f.renderer,f.options),false);
  assert.equal(f.renderer.proxies.size,0);
  assert.equal(f.proxy.texture.destroyed,true);
});

test('resampled geometry uses the ordinary full source loader', async t=>{
  const f=fixture();f.options.geometry.straighten_angle=2;
  t.mock.method(globalThis,'fetch',async()=>{throw Error('must not request partial resampled pixels');});
  assert.equal(await HDRSourceTransport.refreshRepairs(f.renderer,f.options),false);
  assert.equal(f.renderer.proxies.size,0);
  assert.equal(f.proxy.texture.destroyed,true);
});

test('native region updates use texture-local coordinates', async t=>{
  const f=fixture();
  f.proxy.region={x:1,y:1,width:4,height:4};f.proxy.regionTransport=true;
  f.proxy.texture.width=4;f.proxy.texture.pixels=new Float32Array(4*4*4).fill(1);
  t.mock.method(globalThis,'fetch',async url=>f.respond(url));
  assert.equal(await HDRSourceTransport.refreshRepairs(f.renderer,f.options),true);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(let c=0;c<4;c++) {
    assert.equal(f.proxy.texture.pixels[(y*4+x)*4+c],x>=1&&y<3?7:1);
  }
});

for(const refused of [false,true])test(`held source bytes remain charged during ${refused?'failed':'successful'} refresh`,async t=>{
  const f=fixture();let liveBytes=0;
  f.proxy.byteSize=8*6*16;
  f.renderer.gpuAllocator={reserve({bytes}){liveBytes+=bytes;return{bytes};},releaseReservation(r){liveBytes-=r.bytes;}};
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(liveBytes,f.proxy.byteSize,'detached native texture disappeared from memory accounting');
    return refused?new Response('',{status:409}):f.respond(url);
  });
  assert.equal(await HDRSourceTransport.refreshRepairs(f.renderer,f.options),!refused);
  assert.equal(liveBytes,0,'temporary source reservation leaked');
});
