const fs=require("node:fs"),q=require("../../frontend/library-query.js"),{performance}=require("node:perf_hooks");
const file=process.argv[2],photos=JSON.parse(fs.readFileSync(file,"utf8")).photos;
const start=performance.now(),folder=q.apply(photos,"name",false,{}),folderMs=performance.now()-start;
const then=performance.now(),album=q.apply(photos,"name",false,{rules:[{field:"pick",value:"pick"}]}),albumMs=performance.now()-then;
if(folder.length!==50000||album.length!==5000)throw Error("Wrong trial count");
console.log(JSON.stringify({photos:folder.length,matched:album.length,folder_query_ms:+folderMs.toFixed(2),smart_query_ms:+albumMs.toFixed(2),engine:"shared Library rule engine",display_measurement:false}));
