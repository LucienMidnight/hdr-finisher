/* Profiler only: avoid DevTools serializing full binary scene uploads into
 * requestWillBeSent messages (TIFF can exceed its 256 MiB socket limit).
 * This changes debug metadata, not the application request or its pixels. */
const ws=require('../node_modules/playwright-core/lib/utilsBundle').ws;
const send=ws.prototype.send;
ws.prototype.send=function(data,...args){
 if(typeof data==='string'&&data.includes('Network.enable')){
  const message=JSON.parse(data);if(message.method==='Network.enable'){message.params={...message.params,maxPostDataSize:1};data=JSON.stringify(message);}
 }
 return send.call(this,data,...args);
};
const emit=ws.prototype.emit;ws.prototype.emit=function(event,...args){if(event==='error')console.error('[profiler-debug-socket]',String(args[0]));return emit.call(this,event,...args);};
