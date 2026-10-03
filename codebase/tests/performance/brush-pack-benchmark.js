/** Repeated packing-only A/B, separated from queue waits and classification. */
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const args=process.argv.slice(2),at=args.indexOf('--output');
const output=path.resolve(at<0?'output/performance/brush-pack-benchmark.json':args[at+1]);
(async()=>{const browser=await chromium.launch();try{
  const page=await browser.newPage();await page.goto(process.env.HDR_FINISHER_URL||'http://127.0.0.1:8765');
  const results=await page.evaluate(()=>{
    const lookup=new Uint8Array(65536);
    for(let word=0;word<32768;word++){
      const exponent=(word>>10)&31,mantissa=word&1023;
      lookup[word]=Math.round(Math.min(1,exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24)*255);
    }
    const results=[];
    for(const [width,height] of [[1600,1067],[3200,2133]]){
      const stride=Math.ceil(width*2/256)*128,words=new Uint16Array(stride*height),old=new Uint8Array(width*height),next=new Uint8Array(old.length);
      for(let i=0;i<words.length;i++)words[i]=i%15361;
      const observations=[];
      for(let run=0;run<17;run++)for(const mode of run%2?['lookup','formula']:['formula','lookup']){
        const result=mode==='lookup'?next:old,start=performance.now();
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
          const word=words[y*stride+x];
          if(mode==='lookup')result[y*width+x]=lookup[word];
          else {
            const exponent=(word>>10)&31,mantissa=word&1023;
            const value=(word&32768)?0:exponent?(1+mantissa/1024)*2**(exponent-15):mantissa*2**-24;
            result[y*width+x]=Math.round(Math.min(1,value)*255);
          }
        }
        if(run>=2)observations.push({run,mode,ms:performance.now()-start});
      }
      if(old.some((value,i)=>value!==next[i]))throw Error('Packing outputs differ');
      results.push({width,height,repeats:15,identicalBytes:true,observations});
    }
    return results;
  });
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results},null,2)+'\n');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
