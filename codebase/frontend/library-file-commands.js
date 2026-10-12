/* Original file controls always preview through the backend before confirming. */
(() => {
 'use strict';
 const {make,ask}=HDRLibraryDialogs;
 function create(options) {
  async function destination(title='Move to folder') {
   return new Promise(resolve=>{
    const dialog=make('dialog','application-dialog library-ask'),form=make('form'),body=make('div','library-ask-body'),actions=make('div','app-dialog-actions');
    dialog.setAttribute('aria-label',title);form.append(make('h2','application-dialog-header',title));
    const select=make('select');select.setAttribute('aria-label','Destination folder');
    const seen=new Set();const add=(path,label)=>{if(!seen.has(path)){seen.add(path);select.add(new Option(label,path));}};
    for(const pin of options.pins())if(pin.available)add(pin.path,pin.name);
    const expand=make('button','button-secondary','Show subfolders');expand.type='button';
    const error=make('p','library-filter-note');
    expand.addEventListener('click',async()=>{try{const tree=await options.api('/api/library/tree',{path:select.value});for(const child of tree.children)add(child.path,child.path);error.textContent=tree.children.length?'Subfolders added to the list.':'No subfolders here.';}catch(e){error.textContent=e.message;}});
    const cancel=make('button','button-secondary','Cancel'),choose=make('button','button-primary','Choose folder');cancel.type='button';choose.type='submit';choose.disabled=!select.options.length;
    body.append(select,expand,error);actions.append(cancel,choose);form.append(body,actions);dialog.append(form);document.body.append(dialog);
    let answer=null;cancel.addEventListener('click',()=>dialog.close());form.addEventListener('submit',e=>{e.preventDefault();answer=select.value;dialog.close();});dialog.addEventListener('close',()=>{dialog.remove();resolve(answer);});dialog.showModal();select.focus();
   });
  }
  async function clash(item) {
   return new Promise(resolve=>{
    const dialog=make('dialog','application-dialog library-ask'),body=make('div','library-ask-body'),actions=make('div','app-dialog-actions');dialog.setAttribute('aria-label','Name clash');
    body.append(make('h2','','Name clash'),make('p','',`${item.name} already exists at the destination. Nothing has been moved or overwritten yet.`));
    let answer='cancel';for(const [key,label] of [['keep','Keep both'],['skip','Skip this one'],['cancel','Cancel move']]){const b=make('button','button-secondary',label);b.addEventListener('click',()=>{answer=key;dialog.close();});actions.append(b);}
    dialog.append(body,actions);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();resolve(answer);});dialog.showModal();actions.lastChild.focus();
   });
  }
  async function finish(plan,action,confirmation=true) {
   if(!plan.token)return;
   if(!plan.count){options.status(plan.warnings.join(' ')||'Nothing changed.');return;}
   if(confirmation && !await ask({title:'Move photos',message:`Move ${plan.count} photos, with their settings, grades and virtual copies, to ${plan.destination}? ${plan.warnings.join(' ')}`,confirm:'Move photos'}))return;
   const result=await options.api('/api/library/file-command',{action,paths:[],token:plan.token});await options.changed(result);
   options.status(result.queued?'Move recorded. Activity shows progress, Pause and Cancel.':`${result.count} photos ${action==='rename'?'renamed':'moved'}. ${result.warnings.join(' ')}${result.undo_available?' Ctrl+Z undoes it.':''}`);
  }
  async function rename(photo) {
   let message=`The file ending stays ${photo.name.slice(photo.name.lastIndexOf('.'))}.`,name=photo.name.slice(0,photo.name.lastIndexOf('.'));
   for(;;){const answer=await ask({title:'Rename photo',message,fields:[{name:'name',label:'Photo name',value:name}],confirm:'Rename photo'});if(!answer)return;name=answer.name;
    try{const plan=await options.api('/api/library/file-command',{action:'rename',paths:[photo.path],name});await finish(plan,'rename',false);return;}catch(e){message=e.message;}
   }
  }
  async function move(photos,target=null) {
   const paths=photos.filter(p=>!p.copy_id).map(p=>p.path);if(!paths.length){options.status('Select original photos to move. Virtual copies stay with their original.');return;}
   target ||= await destination();if(!target)return;
   const choices={};let plan;
   for(;;){plan=await options.api('/api/library/file-command',{action:'move',paths,destination:target,choices});if(!plan.clashes?.length)break;
    for(const item of plan.clashes){const choice=await clash(item);if(choice==='cancel'){options.status('Move cancelled. Nothing was moved.');return;}choices[item.path]=choice;}
   }
   await finish(plan,'move');
  }
  async function folder(action,paths) {
   if(action==='folder_rename') {
    let name=paths[0].split(/[\\/]/).pop(),message='Everything inside follows the new folder name.';
    for(;;){const answer=await ask({title:'Rename folder',message,fields:[{name:'name',label:'Folder name',value:name}],confirm:'Rename folder'});if(!answer)return;name=answer.name;
     try{const plan=await options.api('/api/library/file-command',{action,paths,name});await folderFinish(plan,action);return;}catch(e){message=e.message;}
    }
   }
   const target=await destination('Move folder');if(!target)return;
   const plan=await options.api('/api/library/file-command',{action,paths,destination:target});
   if(!plan.count){options.status(plan.warnings.join(' ')||'Nothing moved.');return;}
   if(!await ask({title:'Move folders',message:`Move ${plan.count} folders, including every file inside, to ${plan.destination}? ${plan.warnings.join(' ')}`,confirm:'Move folders'}))return;
   await folderFinish(plan,action);
  }
  async function folderFinish(plan,action){
   if(!plan.count){options.status(plan.warnings.join(' ')||'Nothing changed.');return;}
   const result=await options.api('/api/library/file-command',{action,paths:[],token:plan.token});await options.changed(result);
   options.status(`${result.count} folders ${action==='folder_rename'?'renamed':'moved'}. ${result.warnings.join(' ')}${result.undo_available?' Ctrl+Z undoes it.':''}`);
  }
  return Object.freeze({rename,move,folder,destination,clash});
 }
 window.HDRLibraryFileCommands=Object.freeze({create});
})();
