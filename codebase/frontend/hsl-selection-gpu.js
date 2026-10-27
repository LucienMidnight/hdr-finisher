/* Experimental native colour-selection pass. Deliberately not loaded by index.html.
 * Input: the owner's native pre-HSL D65 linear-sRGB texture, including signed/HDR values.
 * Output: rgba32float (coverage, circular circularTarget degrees, 0, 1). No RGB is altered.
 */
(function () {
  const shader = `
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var coarse: texture_2d<f32>;
@group(0) @binding(2) var work: texture_2d<f32>;
@group(0) @binding(3) var output: texture_storage_2d<rgba32float,write>;
@group(0) @binding(4) var<storage,read> p: array<f32>;
@group(0) @binding(5) var<storage,read> ranges: array<vec4f>;
fn reflectIndex(v:i32,n:i32)->i32 {
 let period=2*n; let q=((v%period)+period)%period;
 return select(q,period-1-q,q>=n);
}
fn readSample(t:texture_2d<f32>,xy:vec2i)->vec4f {
 let size=vec2i(textureDimensions(t));
 return textureLoad(t,vec2i(reflectIndex(xy.x,size.x),reflectIndex(xy.y,size.y)),0);
}
fn lab(rgb:vec3f)->vec3f {
 let x=vec3f(dot(rgb,vec3f(.4122214708,.5363325363,.0514459929)),dot(rgb,vec3f(.2119034982,.6806995451,.1073969566)),dot(rgb,vec3f(.0883024619,.2817188376,.6299787005)));
 let v=sign(x)*pow(abs(x),vec3f(1.0/3.0));
 return vec3f(dot(v,vec3f(.2104542553,.793617785,-.0040720468)),dot(v,vec3f(1.9779984951,-2.428592205,.4505937099)),dot(v,vec3f(.0259040371,.7827717662,-.808675766)));
}
fn fields(xy:vec2i)->vec3f {
 let v=lab(readSample(source,xy).xyz); let light=max(abs(v.x),1e-6);
 return vec3f(v.yz/light,log2(max(light,1e-4)));
}
fn interpolate(xy:vec2i)->vec2f {
 let size=vec2i(textureDimensions(coarse));
 let position=(vec2f(xy)+.5)*vec2f(size)/vec2f(p[0],p[1])-.5;
 let base=vec2i(floor(position));let f=fract(position);
 // OpenCV resize clamps the outermost sample rather than reflecting it.
 let a=textureLoad(coarse,clamp(base,vec2i(0),size-1),0).xy;
 let b=textureLoad(coarse,clamp(base+vec2i(1,0),vec2i(0),size-1),0).xy;
 let c=textureLoad(coarse,clamp(base+vec2i(0,1),vec2i(0),size-1),0).xy;
 let d=textureLoad(coarse,clamp(base+1,vec2i(0),size-1),0).xy;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
fn qualify(ab:vec2f)->vec4f {
 let h=degrees(atan2(ab.y,ab.x));var inc=0.;var exc=0.;var circularTarget=vec2f(0.);
 for(var j=0u;j<u32(p[5]);j++){
  let r=ranges[j];let delta=abs((h-r.x+180.)-floor((h-r.x+180.)/360.)*360.-180.);
  let w=1.-smoothstep(r.y,r.y+r.z,delta);
  if(r.w>.5){exc=max(exc,w);}else{inc=max(inc,w);circularTarget+=w*vec2f(cos(radians(r.x)),sin(radians(r.x)));}
 }
 var angle=h;if(length(circularTarget)>1e-5){angle=degrees(atan2(circularTarget.y,circularTarget.x));}
 return vec4f(inc*(1.-exc)*smoothstep(p[4],p[4]+.04,length(ab)),circularTarget,angle);
}
fn qualifiedAt(xy:vec2i)->vec4f {
 let size=vec2i(textureDimensions(coarse));
 return qualify(textureLoad(coarse,clamp(xy,vec2i(0),size-1),0).xy);
}
fn interpolatedSelection(xy:vec2i)->vec2f {
 let size=vec2i(textureDimensions(coarse));
 let position=(vec2f(xy)+.5)*vec2f(size)/vec2f(p[0],p[1])-.5;
 let base=vec2i(floor(position));let f=fract(position);
 let q=mix(mix(qualifiedAt(base),qualifiedAt(base+vec2i(1,0)),f.x),
           mix(qualifiedAt(base+vec2i(0,1)),qualifiedAt(base+1),f.x),f.y);
 let ab=interpolate(xy);var angle=degrees(atan2(ab.y,ab.x));
 if(length(q.yz)>1e-5){angle=degrees(atan2(q.z,q.y));}
 return vec2f(q.x,angle);
}
@compute @workgroup_size(8,8) fn reduce(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);let size=vec2i(textureDimensions(output));if(any(xy>=size)){return;}
 // Area average: every source pixel contributes, including odd-sized edges.
 let lo=vec2f(xy)*vec2f(p[0],p[1])/vec2f(size);
 let hi=vec2f(xy+1)*vec2f(p[0],p[1])/vec2f(size);
 var sum=vec2f(0.);var total=0.;
 for(var y=i32(floor(lo.y));y<i32(ceil(hi.y));y++){
  for(var x=i32(floor(lo.x));x<i32(ceil(hi.x));x++){
   let overlap=max(vec2f(0.),min(hi,vec2f(vec2i(x+1,y+1)))-max(lo,vec2f(vec2i(x,y))));
   let weight=overlap.x*overlap.y;sum+=fields(vec2i(x,y)).xy*weight;total+=weight;
  }
 }
 textureStore(output,xy,vec4f(sum/max(total,1e-8),0.,1.));
}
fn blur(xy:vec2i,axis:vec2i)->vec4f{
 var sum=vec4f(0.);var total=0.;
 for(var i=-4;i<=4;i++){let w=exp(-.5*f32(i*i));sum+=readSample(coarse,xy+axis*i)*w;total+=w;}
 return sum/total;
}
@compute @workgroup_size(8,8) fn horizontal(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);if(any(xy>=vec2i(textureDimensions(output)))){return;}textureStore(output,xy,blur(xy,vec2i(1,0)));
}
@compute @workgroup_size(8,8) fn vertical(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);if(any(xy>=vec2i(textureDimensions(output)))){return;}textureStore(output,xy,blur(xy,vec2i(0,1)));
}
@compute @workgroup_size(8,8) fn qualification(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);if(any(xy>=vec2i(textureDimensions(output)))){return;}
 let f=fields(xy);textureStore(output,xy,vec4f(interpolatedSelection(xy).x,f.z,0.,1.));
}
@compute @workgroup_size(8,8) fn coefficients(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);if(any(xy>=vec2i(textureDimensions(output)))){return;}
 var means=vec4f(0.);
 for(var y=-4;y<=4;y++){for(var x=-4;x<=4;x++){
  let v=readSample(work,xy+vec2i(x,y)).xy;means+=vec4f(v.y,v.x,v.x*v.y,v.y*v.y);
 }}
 means/=81.;let a=(means.z-means.x*means.y)/max(means.w-means.x*means.x+.03,.03);
 textureStore(output,xy,vec4f(a,means.y-a*means.x,0.,1.));
}
@compute @workgroup_size(8,8) fn refinement(@builtin(global_invocation_id) id:vec3u){
 let xy=vec2i(id.xy);if(any(xy>=vec2i(textureDimensions(output)))){return;}
 var mean=vec2f(0.);for(var y=-4;y<=4;y++){for(var x=-4;x<=4;x++){mean+=readSample(work,xy+vec2i(x,y)).xy;}}
 mean/=81.;let f=fields(xy);let averaged=interpolate(xy);
 var surround=0.;for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){surround+=fields(xy+vec2i(x,y)).z;}}
 let contrast=f.z-surround/25.;
 let protection=(1.-smoothstep(.07,.30,contrast))*(1.-smoothstep(.04,.16,length(f.xy-averaged))*smoothstep(.025,.12,abs(contrast)));
 let selected=clamp((mean.x*f.z+mean.y)*protection,0.,1.);
 textureStore(output,xy,vec4f(selected,interpolatedSelection(xy).y,0.,1.));
}
`;
  class HslSelectionGpu {
    constructor(device) { this.device=device;this.prepared=null;this.serial=0; }
    async initialize() {
      const d=this.device;
      this.layout=d.createBindGroupLayout({entries:[
        ...[0,1,2].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:"unfilterable-float"}})),
        {binding:3,visibility:GPUShaderStage.COMPUTE,storageTexture:{access:"write-only",format:"rgba32float"}},
        ...[4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}})),
      ]});
      const module=d.createShaderModule({code:shader});
      const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==="error");
      if(errors.length)throw Error(errors.map(e=>e.message).join("\n"));
      const layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]});
      this.pipelines=Object.fromEntries(await Promise.all(["reduce","horizontal","vertical","qualification","coefficients","refinement"].map(async entry=>[entry,await d.createComputePipelineAsync({layout,compute:{module,entryPoint:entry}})])));
      return this;
    }
    texture(width,height,label) {
      return this.device.createTexture({label,size:[width,height],format:"rgba32float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
    }
    encode(encoder,entry,source,coarse,work,output,params,ranges) {
      const pass=encoder.beginComputePass({label:"HSL selection "+entry});
      pass.setPipeline(this.pipelines[entry]);
      pass.setBindGroup(0,this.device.createBindGroup({layout:this.layout,entries:[
        ...[source,coarse,work,output].map((t,binding)=>({binding,resource:t.createView()})),
        {binding:4,resource:{buffer:params}},{binding:5,resource:{buffer:ranges}},
      ]}));
      pass.dispatchWorkgroups(Math.ceil(output.width/8),Math.ceil(output.height/8));pass.end();
    }
    buffer(values) {
      const b=this.device.createBuffer({size:Math.max(16,values.byteLength),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(b,0,values);return b;
    }
    prepare(source,key) {
      if(this.prepared?.source===source&&this.prepared.key===key)return this.prepared;
      this.clear();
      const width=source.width,height=source.height,cw=Math.max(1,Math.floor(width/4)),ch=Math.max(1,Math.floor(height/4));
      const owned=[];const make=(w,h,label)=>{const t=this.texture(w,h,label);owned.push(t);return t;};
      const params=this.buffer(new Float32Array([width,height,cw,ch,0,0,0,0]));
      try {
        const reduced=make(cw,ch,"HSL reduced chroma"),horizontal=make(cw,ch,"HSL horizontal chroma"),chroma=make(cw,ch,"HSL prepared chroma");
        const ranges=this.buffer(new Float32Array(4));const encoder=this.device.createCommandEncoder();
        this.encode(encoder,"reduce",source,source,source,reduced,params,ranges);
        this.encode(encoder,"horizontal",source,reduced,source,horizontal,params,ranges);
        this.encode(encoder,"vertical",source,horizontal,source,chroma,params,ranges);
        this.device.queue.submit([encoder.finish()]);params.destroy();ranges.destroy();
        reduced.destroy();horizontal.destroy();
        this.prepared={source,key,width,height,chroma,serial:++this.serial};return this.prepared;
      }catch(error){for(const t of owned)t.destroy();params.destroy();throw error;}
    }
    select(recipe,floor=.02) {
      if(!this.prepared)throw Error("Prepare a native pre-HSL texture first");
      if(!Array.isArray(recipe.ranges)||recipe.ranges.length>32)throw Error("Selection requires at most 32 ranges");
      const {source,chroma,width,height}=this.prepared;
      const params=this.buffer(new Float32Array([width,height,0,0,floor,recipe.ranges.length,0,0]));
      const packed=new Float32Array(Math.max(4,recipe.ranges.length*4));
      recipe.ranges.forEach((r,i)=>packed.set([r.center,r.width,r.feather,r.subtract?1:0],i*4));
      const ranges=this.buffer(packed),owned=[];
      const make=label=>{const t=this.texture(width,height,label);owned.push(t);return t;};
      try {
        const coverage=make("HSL qualification"),coefficients=make("HSL guided coefficients"),selection=make("HSL selection");
        const encoder=this.device.createCommandEncoder();
        this.encode(encoder,"qualification",source,chroma,source,coverage,params,ranges);
        this.encode(encoder,"coefficients",source,chroma,coverage,coefficients,params,ranges);
        this.encode(encoder,"refinement",source,chroma,coefficients,selection,params,ranges);
        this.device.queue.submit([encoder.finish()]);
        coverage.destroy();coefficients.destroy();return selection; // caller owns this texture
      }catch(error){for(const t of owned)t.destroy();throw error;}
      finally{params.destroy();ranges.destroy();}
    }
    clear() {this.prepared?.chroma.destroy();this.prepared=null;}
    destroy() {this.clear();}
  }
  globalThis.HDRHslSelectionGpu=HslSelectionGpu;
  if(typeof module!=="undefined")module.exports={HslSelectionGpu,shader};
})();
