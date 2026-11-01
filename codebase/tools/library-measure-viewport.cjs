// Executed in the Library frame on every observation; discovery can reorder rows.
function viewportTargets(){
 const b=document.getElementById('library-grid').getBoundingClientRect();
 return [...document.querySelectorAll('#grid-space .library-cell')].filter(c=>{const r=c.getBoundingClientRect();return r.top<b.bottom&&r.bottom>b.top;}).map(c=>c.dataset.path);
}
module.exports={viewportTargets};
