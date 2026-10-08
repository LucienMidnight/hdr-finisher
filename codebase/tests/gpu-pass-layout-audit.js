const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {skipLiteral}=require('./frontend-source');
const clean=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,'');
function recordWrites(source){
 const writes=[];
 for(const m of source.matchAll(/PASS_LAYOUTS\.record\("(\w+)",\s*\{/g)){
  let i=m.index+m[0].length,depth=1,expectKey=true;
  while(depth&&i<source.length){const end=skipLiteral(source,i);if(end!==i){i=end;continue;}
   if(depth===1&&expectKey){const key=/^\s*([A-Za-z_]\w*)\s*:/.exec(source.slice(i));if(key){writes.push([m[1],key[1]]);i+=key[0].length;expectKey=false;continue;}}
   if('({['.includes(source[i]))depth++;
   if(')}]'.includes(source[i]))depth--;
   if(source[i]===','&&depth===1)expectKey=true;
   i++;
  }
 }
 return writes;
}
function auditPassUses(sources,layouts){
 const written=new Set(),read=new Set(),errors=[];
 const add=(target,layout,name)=>{if(!layouts[layout]||!Object.hasOwn(layouts[layout].indices,name))errors.push(`Unknown ${layout}.${name}`);else target.add(layout+'.'+name);};
 for(const raw of sources){const source=clean(raw);
  for(const [layout,name] of recordWrites(source))add(written,layout,name);
  for(const m of source.matchAll(/\bvalues\[MASK_PARAMS\.(\w+)\.(\w+)\]\s*(?:\+=|=(?!=))/g))add(written,m[1],m[2]);
  // Only shader template readers count; host bounds reads cannot hide an absent GPU reader.
  for(let i=0;i<source.length;i++){
   const end=skipLiteral(source,i);
   if(end!==i){if(source[i]==='`'){
    const template=source.slice(i,end);
    if(/\bp\[|\bparams\[|settings\.\$\{/.test(template)){
     for(const m of template.matchAll(/MASK_PARAMS\.(\w+)\.(\w+)/g))add(read,m[1],m[2]);
     if(/\b(?:p|params)\[\s*\d/.test(template))errors.push('Bare shader parameter position');
    }
   }i=end-1;}
  }
 }
 for(const [layout,{fields}] of Object.entries(layouts))for(const field of fields){
  const name=layout+'.'+field.name;
  if(field.reserved){if(read.has(name))errors.push(name+' reserved but read');continue;}
  if(!written.has(name))errors.push(name+' read but never written');
  if(!read.has(name))errors.push(name+' written but never read');
 }
 return {errors,written,read};
}
module.exports={auditPassUses,recordWrites};
