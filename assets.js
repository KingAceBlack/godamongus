/* Lossless asset delivery: two downloads at a time, progress-based stall detection, decoded blobs. */
(function(root){
  class TempleAssets {
    constructor({onProgress=()=>{},idleTimeout=45000,decodeTimeout=30000}={}){
      this.onProgress=onProgress;this.idleTimeout=idleTimeout;this.decodeTimeout=decodeTimeout;
      this.cache=new Map();this.items=new Map();this.queue=[];this.running=0;
    }
    notify(){this.onProgress([...this.items.values()].map(item=>({...item})));}
    schedule(task){return new Promise((resolve,reject)=>{this.queue.push({task,resolve,reject});this.pump();});}
    pump(){while(this.running<2&&this.queue.length){const job=this.queue.shift();this.running++;Promise.resolve().then(job.task).then(job.resolve,job.reject).finally(()=>{this.running--;this.pump();});}}
    async load(target,path,label){
      if(!this.cache.has(path)){
        const item={path,label,state:'queued',received:0,total:0,attempt:0,error:null};this.items.set(path,item);
        const job=this.schedule(async()=>{
          for(let attempt=1;attempt<=2;attempt++){
            Object.assign(item,{state:'downloading',received:0,total:0,attempt,error:null});this.notify();
            const controller=new AbortController();let timer,stalled=false,url;
            const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>{stalled=true;controller.abort();},this.idleTimeout);};
            try{
              reset();
              // Fresh requests bypass stuck image/cache entries from older builds. Successful decodes are reused.
              const response=await fetch(path+'?delivery=3&attempt='+attempt+'&t='+Date.now(),{cache:'no-store',signal:controller.signal});
              if(!response.ok)throw new Error('HTTP '+response.status);
              item.total=Number(response.headers.get('content-length'))||0;reset();this.notify();
              let blob;
              if(response.body?.getReader){
                const reader=response.body.getReader(),chunks=[];
                while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);item.received+=value.byteLength;reset();this.notify();}
                blob=new Blob(chunks,{type:response.headers.get('content-type')||'image/webp'});
              }else{blob=await response.blob();item.received=blob.size;}
              clearTimeout(timer);item.state='decoding';this.notify();
              const image=new Image();url=URL.createObjectURL(blob);image.src=url;
              await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('image decode timed out')),this.decodeTimeout);})]);
              if(!image.naturalWidth)throw new Error('empty image');
              item.state='ready';this.notify();return image;
            }catch(error){
              if(url)URL.revokeObjectURL(url);
              item.error=stalled?'no download progress for '+Math.round(this.idleTimeout/1000)+' seconds':error.message;
              item.state=attempt===1?'retrying':'failed';this.notify();
              if(attempt===2)throw new Error(`${label} (${path.split('/').pop()}): ${item.error}. Please retry.`);
            }finally{clearTimeout(timer);}
          }
        });
        this.cache.set(path,job);job.catch(()=>{if(this.cache.get(path)===job)this.cache.delete(path);});
      }
      const image=await this.cache.get(path);
      if(target.src!==image.src){target.src=image.src;await target.decode();}
      return target;
    }
  }
  if(typeof module==='object'&&module.exports)module.exports=TempleAssets;else root.TempleAssets=TempleAssets;
})(globalThis);
