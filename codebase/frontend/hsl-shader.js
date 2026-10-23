/* One pointwise GPU operation, sharing the app's device and parameter buffer. */
(function(){
  const wgsl = `
fn hslLab(rgb: vec3f) -> vec3f {
  let x = vec3f(dot(rgb,vec3f(.4122214708,.5363325363,.0514459929)),dot(rgb,vec3f(.2119034982,.6806995451,.1073969566)),dot(rgb,vec3f(.0883024619,.2817188376,.6299787005)));
  let v = sign(x)*pow(abs(x),vec3f(1.0/3.0));
  return vec3f(dot(v,vec3f(.2104542553,.793617785,-.0040720468)),dot(v,vec3f(1.9779984951,-2.428592205,.4505937099)),dot(v,vec3f(.0259040371,.7827717662,-.808675766)));
}
fn hslRgb(v: vec3f) -> vec3f {
  let t=vec3f(dot(v,vec3f(1,.3963377774,.2158037573)),dot(v,vec3f(1,-.1055613458,-.0638541728)),dot(v,vec3f(1,-.0894841775,-1.291485548)));
  let q=t*t*t;
  return vec3f(dot(q,vec3f(4.0767416621,-3.3077115913,.2309699292)),dot(q,vec3f(-1.2684380046,2.6097574011,-.3413193965)),dot(q,vec3f(-.0041960863,-.7034186147,1.707614701)));
}
fn hslDelta(h:f32,c:f32)->f32{return fract((h-c+180.0)/360.0)*360.0-180.0;}
// Same CAT02-adapted inverse used by local SDR colour and color.py.
fn hslSrgbToAces(rgb:vec3f)->vec3f {
 return vec3f(dot(rgb,vec3f(.61311781290644,.34118199585562525,.04578734428233729)),dot(rgb,vec3f(.06993408230751336,.9181030375085815,.011932775530201238)),dot(rgb,vec3f(.0204629926377373,.1067686633825107,.8727159106194422)));
}
fn applyHsl(input:vec3f,hdr:bool)->vec3f {
 let count=u32(p[198]);
 if(count==0u){return input;}
 var original=input;
 if(hdr){original=acescgToSrgb(input);}
 let v=hslLab(original);let C=length(v.yz);let h=degrees(atan2(v.z,v.y));
 var result=original;
 for(var k=0u;k<count;k++){
  let at=200u+k*136u;
  var inc=0.0;var exc=0.0;var cv=vec2f(0.0);
  for(var j=0u;j<u32(p[at+4u]);j++){
   let ri=at+8u+4u*j;let center=p[ri];let width=p[ri+1u];let feather=p[ri+2u];
   let weight=1.0-smoothstep(width,width+feather,abs(hslDelta(h,center)));
   if(p[ri+3u]>0.5){exc=max(exc,weight);}else{inc=max(inc,weight);cv+=weight*vec2f(cos(radians(center)),sin(radians(center)));}
  }
  let weight=inc*(1.0-exc)*smoothstep(.02,.06,C/max(abs(v.x),1e-6))*p[at+5u];
  if(weight==0.0){continue;}
  var hueTarget=h;if(length(cv)>1e-5){hueTarget=degrees(atan2(cv.y,cv.x));}
  let angle=radians(h+hslDelta(hueTarget,h)*p[at+3u]/100.0+p[at]);
  let gain=exp2(p[at+2u]/3.0);let chroma=C*(1.0+p[at+1u]/100.0)*gain;
  let changed=hslRgb(vec3f(v.x*gain,chroma*cos(angle),chroma*sin(angle)));
  result+=weight*(changed-original);
 }
 if(hdr){return hslSrgbToAces(result);}
 return result;
}
`;
  globalThis.HDRHslShader=wgsl;
  if(typeof module!=="undefined" && module.exports)module.exports=wgsl;
})();
