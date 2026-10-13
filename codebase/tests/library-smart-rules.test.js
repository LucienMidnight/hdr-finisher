const test=require("node:test"),assert=require("node:assert/strict");
const q=require("../frontend/library-query.js");
const original={path:"D:\\Shoot\\Summer-01.ARW",name:"Summer-01.ARW",type:"ARW",edited:true,camera:"Alpha",lens:"Wide",iso:800,focal_length:24,aperture:4,shutter:.01,capture_time:"2026-10-12T10:00:00",marks:{rating:4,pick:"pick",label:"green",tags:["Kids","Beach"]}};
const copy={...original,path:original.path+"|copy|abc",source_path:original.path,name:"Copy 1",copy_id:"abc",edited:false,marks:{rating:0,pick:"reject",label:"",tags:[]}};
test("every filter field is available to the smart album and handles is not",()=>{
 const values={copy:"original",state:"edited",camera:"alpha",lens:"wide",iso:800,rating:4,pick:"pick",label:"green",name:"Summer-01.ARW",focal_length:"24 mm",aperture:"f/4",shutter:"1/100 s",date:"2026-10-12",type:"arw",tag:"kids"};
 assert.deepEqual(Object.keys(values).sort(),Object.keys(q.FIELDS).sort());
 for(const [field,value] of Object.entries(values)){
  const rule={field,value,op:"is"};assert.equal(q.matches(original,rule),true,field);assert.equal(q.matches(original,{...rule,not:true}),false,field);
 }
});
test("comparisons, all/any and folder scopes use the same engine",()=>{
 for(const [op,value,want] of [["greater",799,true],["less",800,false],["at-least",800,true],["at-most",800,true],["is",800,true]])assert.equal(q.matches(original,{field:"iso",op,value}),want);
 for(const op of ["contains","starts","ends"])assert.equal(q.matches(original,{field:"camera",op,value:op==="ends"?"pha":"al"}),true);
 assert.equal(q.matches(original,{field:"iso",op:"range",from:400,to:800}),true);
 const rules=[{field:"tag",value:"kids"},{field:"state",value:"not edited"}];
 assert.equal(q.apply([original,copy],"name",false,{rules}).length,0);
 assert.equal(q.apply([original,copy],"name",false,{rules,any:true}).length,2);
 assert.equal(q.apply([original,copy],"name",false,{folders:["d:/shoot"]}).length,2);
 assert.equal(q.apply([original,copy],"name",false,{folders:["D:/Shoo"]}).length,0);
 assert.equal(q.apply([copy],"name",false,{rules:[{field:"name",value:"Summer",op:"contains"}]}).length,1,"copy filename is original filename");
 assert.equal(q.matches(original,{field:"future",value:"x"}),false);
});
test("membership is live after marks, tags and grades change",()=>{
 const photos=[structuredClone(original)],filters={rules:[{field:"rating",op:"at-least",value:5}]};
 assert.equal(q.apply(photos,"name",false,filters).length,0);photos[0].marks.rating=5;assert.equal(q.apply(photos,"name",false,filters).length,1);
 filters.rules=[{field:"tag",value:"new"}];assert.equal(q.apply(photos,"name",false,filters).length,0);photos[0].marks.tags.push("New");assert.equal(q.apply(photos,"name",false,filters).length,1);
 filters.rules=[{field:"state",value:"not edited"}];photos[0].edited=false;assert.equal(q.apply(photos,"name",false,filters).length,1);
});
test("unsorted worker count equals existing album membership for every rule and common control",()=>{
 const photos=[original,copy,{path:"d:/Other/Blank.jpg",name:"Blank.jpg",type:"JPG",marks:{}},
  {...original,path:"D:/Shoot/Night.NEF",name:"Night.NEF",type:"NEF",camera:"Éclair",iso:null,shutter:0.5,marks:{tags:["Straße","KIDS"],rating:5}}];
 const expressions=[{}, {raw:true},{type:"ARW"},{rating:"4"},{pick:"hide-rejected"},{pick:"unmarked"},{label:"green"},{search:" kids "},
  {folders:["d:/shoot/"]},{folders:["d:/shoo"]},{search:"copy",any:true,rules:[{field:"rating",value:0}]}];
 for(const field of Object.keys(q.FIELDS))for(const op of ["is","contains","starts","ends","range","greater","less","at-least","at-most"])
  for(const not of [false,true])for(const value of ["", "4", "kids", "2026-10-12"])
   expressions.push({rules:[{field,op,not,value,from:"",to:"800"}]});
 expressions.push({rules:[{field:"future",value:"x"}]},{rules:[{field:"future"}]});
 for(const filters of expressions)for(const any of [false,true]){
  const expression={...filters,any};
  assert.equal(q.count(photos,expression),q.apply(photos,"name",false,expression).length,JSON.stringify(expression));
 }
});
