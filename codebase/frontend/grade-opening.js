(function(root){
  function create({fetch, socket, url, current, timer=setTimeout, clear=clearTimeout, interval=setInterval, clearIntervalFn=clearInterval}) {
    let channel=null, connection=null, beat=null, pending=null, retry=null, flight=null, presented=null, ticket=null, generation=0;
    function connect() {
      if(connection)return connection;
      connection=new Promise((resolve,reject)=>{
        const ownerChannel=channel=socket(url);
        ownerChannel.onmessage=event=>{const message=JSON.parse(event.data);if(message.owner)resolve(message.owner);};
        ownerChannel.onopen=()=>{beat=interval(()=>ownerChannel.send(JSON.stringify({type:'heartbeat'})),5000);};
        ownerChannel.onclose=()=>{clearIntervalFn(beat);channel=null;connection=null;reject(Error('Grade opening window disconnected.'));};
        ownerChannel.onerror=()=>ownerChannel.close();
      });
      return connection;
    }
    function retire(sessionId) {
      if(pending===sessionId){pending=null;clear(retry);}
      if(channel?.readyState===1)channel.send(JSON.stringify({type:'retire',session_id:sessionId,...(ticket?{job_id:ticket}:{})}));
    }
    async function acknowledge(sessionId) {
      if(!sessionId||!current(sessionId)||presented===sessionId)return;
      pending=sessionId;
      if(flight)return;
      flight=sessionId;
      const epoch=generation, params=new URLSearchParams({session_id:sessionId});
      if(ticket)params.set('job_id',ticket);
      try {
        const response=await fetch('/api/import-jobs/presented?'+params,{method:'POST'});
        if(response.ok&&epoch===generation){presented=sessionId;if(pending===sessionId)pending=null;}
      } catch {} finally {
        flight=null;
        if(pending&&current(pending)){clear(retry);retry=timer(()=>{void acknowledge(pending);},250);}
      }
    }
    function close(){clear(retry);pending=null;channel?.close();}
    function reset(jobId=null){clear(retry);pending=null;presented=null;ticket=jobId;generation++;}
    return {connect,acknowledge,retire,close,reset};
  }
  if(typeof module==='object')module.exports={create};else root.HDRGradeOpening={create};
})(globalThis);
