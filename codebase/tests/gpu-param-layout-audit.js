// Audit the production global buffer writers and compiled shader consumers.
const assert=require('node:assert/strict');
function withoutComments(source) { return source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\r\n]*/g,''); }
function aliasesOf(source,indices) {
 const result={...indices, BLACK_AND_WHITE_PARAM: indices.BLACK_AND_WHITE_ENABLED};
 for(const match of source.matchAll(/\bconst\s+(\w+)\s*(?::\s*u32\s*)?=\s*(?:GPU_PARAMS\.(\w+)|(\d+)u?)\s*;/g)) {
  const value=match[2]?indices[match[2]]:Number(match[3]);
  if(Number.isInteger(value)&&value<190)result[match[1]]=value;
 }
 return result;
}
function positionsOf(expression,indices,aliases) {
 let indexLimit=1;
 const named=[...expression.matchAll(/GPU_PARAMS\.(\w+)/g)].map(m=>m[1]);
 for(const name of named)assert.ok(Object.hasOwn(indices,name),'Unknown parameter '+name);
 const replaced=expression.replace(/GPU_PARAMS\.(\w+)/g,(_,name)=>indices[name]).replace(/\b([A-Z][A-Z_]+)\b/g,(_,name)=>Object.hasOwn(aliases,name)?aliases[name]:name);
 const numbers=replaced.match(/\d+/g)||[];
 const base=numbers.map(Number).find(n=>n>=21)||Number(numbers[0]);
 if(/\bindex\b/.test(replaced)) {
  if(base===21||base===37)indexLimit=16;
  else if(base===61)indexLimit=9;
  else if(base>=114&&base<=116)indexLimit=3;
  else if(base===177||base===178)indexLimit=8;
  else throw Error('Unclassified indexed parameter expression '+expression);
 }
 const outputs=new Set();
 const indexStart=/\bindex\b/.test(replaced)&&base===177&&!/177\s*\+\s*1/.test(replaced)?1:0;
 for(let index=indexStart;index<indexStart+indexLimit;index++) {
  let expr=replaced.replace(/\b(?:base|offset)\b/g,'0').replace(/\bindex\b/g,String(index));
  // JS bracket expressions in these buffers contain only integer arithmetic.
  if(!/^[\d\s+*()-]+$/.test(expr))continue;
  const value=Function('return ('+expr+')')();
  if(Number.isInteger(value)&&value>=0&&value<190)outputs.add(value);
 }
 return outputs;
}
function auditGlobalParameterUses(jsSources,shaderSource,fields) {
 const indices=Object.fromEntries(fields.map(f=>[f.name,f.index]));
 const written=new Set(),read=new Set(),shaderRead=new Set();
 const sharedAliases=aliasesOf(jsSources.join("\n"),indices);
 for(const raw of jsSources) {
  const source=withoutComments(raw).replace(/^([ \t]*)function buildLocalParams\([\s\S]*?^\1}/gm,''),aliases=sharedAliases;
  for(const m of source.matchAll(/\b(params|slots|patchValues|values)\[([^\]\r\n]+)\]/g)) {
   if(m[1]==='values'&&!/GPU_PARAMS|_INDEX|\b1[1-8]\d\b/.test(m[2]))continue;
   const positions=positionsOf(m[2],indices,aliases);
   for(const position of positions) {
    if(m[1]==='values'&&position<111)continue; // independent local prefix/readbacks
    const following=source.slice(m.index+m[0].length);
    (/^\s*=(?!=)/.test(following)?written:read).add(position);
   }
  }
 }
 const local=new Set(['localSaturation','applyLocalGrade','localDetailRadii','localDetailCompositeFragmentMain','localAdjustmentFragmentMain','peakCandidateLocalFragmentMain','localDetailMixFragmentMain']);
 const source=withoutComments(shaderSource),aliases=aliasesOf(source,indices),functions=[...source.matchAll(/\bfn (\w+)\(/g)];
 for(let i=0;i<functions.length;i++) {
  const fn=functions[i],body=source.slice(fn.index,functions[i+1]?.index??source.length);
  for(const m of body.matchAll(/\b(?:p|peakParams)\[([^\]]+)\]/g)) {
   let expr=m[1].replace(/(\d+)u\b/g,'$1');
   if(/\boffset\b/.test(expr)&&body.includes('let offset = 114 + index * 3;')) {
    expr=expr.replace(/\boffset\b/g,'(114 + index * 3)');
   }
   // Tone-node helper arguments span the fixed 16-entry group; the contract tests pin the clamp.
   expr=expr.replace(/\bcount\b/g,'16');
   for(const position of positionsOf(expr,indices,aliases))if(!local.has(fn[1])||position>=111){read.add(position);shaderRead.add(position);}
  }
 }
 const errors=[];
 for(const field of fields) {
  if(field.reserved) {if(read.has(field.index)||written.has(field.index))errors.push(field.name+' is reserved but used');continue;}
  if(!written.has(field.index))errors.push(field.name+' is read but never written');
  if(!(field.hostOnly?read:shaderRead).has(field.index))errors.push(field.name+' is written but never read');
 }
 return {errors,written,read,shaderRead};
}
module.exports={auditGlobalParameterUses,positionsOf};function bareGlobalPositions(sources, skipLiteral) {
  const issues=[];
  for (let file=0; file<sources.length; file++) {
    const source=sources[file];let code='',cursor=0;
    while(cursor<source.length) {
      const end=skipLiteral(source,cursor);
      if(end!==cursor){code+=source.slice(cursor,end).replace(/[^\r\n]/g,' ');cursor=end;}
      else code+=source[cursor++];
    }
    for(const match of code.matchAll(/\b(params|slots|patchValues|values)\[\s*(?:(?:base|offset)\s*\+\s*)?(\d+)[^\]]*\]/g)) {
      if(match[1]==='values'&&Number(match[2])<111)continue;
      issues.push(`source ${file}: ${match[0]}`);
    }
    for(const match of code.matchAll(/\bconst\s+\w+(?:_INDEX|_PARAM)\s*=\s*(\d+)\s*;/g)) {
      if(Number(match[1])<190)issues.push(`source ${file}: ${match[0]}`);
    }
  }
  return issues;
}
module.exports.bareGlobalPositions=bareGlobalPositions;