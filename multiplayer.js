/* Client-owned movement. Protocol 3 relays numbered, source-timestamped poses; only OTHER players are smoothed. */
class TempleNetwork extends EventTarget {
  constructor(){
    super();this.socket=null;this.connected=false;this.id=null;this.character=null;this.mapId='solar-temple';this.worldVersion=null;
    this.motion=new TempleRemoteMotion();this.wanted=false;this.retry=0;this.lastPublished=0;this.sequence=0;
    this.count=0;this.capacity=32;this.joining=false;this.pingAt=0;this.latency=null;
    this.lastReceived=performance.now();this.lastClose=null;this.requiresReload=false;
    this.pendingSnapshot=null;this.snapshotSeq=-1;this.clockOffset=Infinity;this.bestRTT=Infinity;this.droppedSnapshots=0;
    setInterval(()=>{
      if(!this.connected)return;
      if(performance.now()-this.lastReceived>75000){this.socket?.close(4000,'Connection timed out');return;}
      this.ping();
    },5000);
  }
  configureWorld(world,version){this.motion.world=world;this.worldVersion=version;}
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  send(message){
    if(this.socket?.readyState!==WebSocket.OPEN)return false;
    // No outgoing pose queue. Next render publishes the latest state once the transport is writable.
    if(message.type==='state'&&this.socket.bufferedAmount>0)return false;
    try{this.socket.send(JSON.stringify(message));return true;}catch{return false;}
  }
  ping(){this.pingAt=performance.now();this.send({type:'ping',clientTime:this.pingAt});}
  incompatible(text='The world was updated. Reload game to use matching colliders.'){
    this.requiresReload=true;this.wanted=false;this.joining=false;clearTimeout(this.retryTimer);
    this.emit('error',text);this.socket?.close(4009,'Reload required');
  }
  connect(){
    if(this.requiresReload){this.emit('error','Reload game to use matching colliders.');return;}
    this.wanted=true;clearTimeout(this.retryTimer);
    if(this.socket&&this.socket.readyState<=WebSocket.OPEN)return;
    this.pendingSnapshot=null;this.snapshotSeq=-1;this.clockOffset=Infinity;this.bestRTT=Infinity;this.motion.clear();
    this.emit('status',{state:'connecting',text:this.retry?'Reconnecting…':'Connecting…'});
    let ws;try{ws=this.socket=new WebSocket(window.TempleBackend?.socketURL||`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);}catch{
      this.emit('status',{state:'disconnected',text:'Connection failed. Retrying…'});this.retryTimer=setTimeout(()=>this.connect(),2000);return;
    }
    const deadline=setTimeout(()=>{if(ws===this.socket&&!this.connected)ws.close();},15000);
    ws.addEventListener('message',event=>{
      if(ws!==this.socket)return;
      const receivedAt=this.lastReceived=performance.now();
      let m;try{m=JSON.parse(event.data);}catch{return;}
      if(m.type==='hello'){
        clearTimeout(deadline);
        if(m.protocol!==3||m.worldVersions?.[this.mapId]!==this.worldVersion){this.incompatible();return;}
        this.clockOffset=receivedAt-m.serverTime;this.connected=true;this.retry=0;
        this.updateCount(m.count,m.capacity);this.ping();this.emit('status',{state:'connected',text:'Connected'});
        if(this.character)this.join(this.character);
      }else if(m.type==='joined'){
        if(m.worldVersion!==this.worldVersion){this.incompatible();return;}
        this.id=m.player.id;this.character=m.player.character;this.joining=false;this.lastPublished=0;this.sequence=0;this.motion.clear();
        this.motion.ingest(m.players,receivedAt,this.id);this.emit('joined',m.player);
      }else if(m.type==='snapshot'){
        if(m.worldVersion!==this.worldVersion){this.incompatible();return;}
        if(!Number.isSafeInteger(m.seq)||m.seq<=this.snapshotSeq||!Number.isFinite(m.serverTime)||!Array.isArray(m.players)){this.droppedSnapshots++;return;}
        this.snapshotSeq=m.seq;this.clockOffset=Math.min(this.clockOffset,receivedAt-m.serverTime);
        if(receivedAt-m.serverTime-this.clockOffset>600){this.droppedSnapshots++;return;}
        // Several packets delivered together become ONE latest frame, not a fast-forward replay queue.
        if(this.pendingSnapshot)this.droppedSnapshots++;
        this.pendingSnapshot={players:m.players,receivedAt};
      }else if(m.type==='skin'){
        this.character=m.player.character;this.joining=false;this.emit('skin',m.player);
      }else if(m.type==='count')this.updateCount(m.count,m.capacity);
      else if(m.type==='arrival'||m.type==='departure'){
        if(m.type==='departure'){
          this.motion.remove(m.id);
          if(this.pendingSnapshot)this.pendingSnapshot.players=this.pendingSnapshot.players.filter(p=>p.id!==m.id);
        }
        if(this.id)this.emit('notice',`${m.name} ${m.type==='arrival'?'joined':'left'} the temple`);
      }else if(m.type==='error'){
        this.joining=false;if(m.code==='RELOAD_REQUIRED'){this.incompatible(m.message);return;}this.emit('error',m.message);
      }else if(m.type==='pong'&&Number.isFinite(m.clientTime)&&Number.isFinite(m.serverTime)){
        this.latency=Math.max(0,Math.round(receivedAt-m.clientTime));
        if(this.latency<=this.bestRTT*1.25){this.bestRTT=Math.min(this.bestRTT,this.latency);this.clockOffset=(receivedAt+m.clientTime)/2-m.serverTime;}
        this.emit('latency',this.latency);
      }
    });
    ws.addEventListener('close',event=>{
      clearTimeout(deadline);if(ws!==this.socket)return;
      this.lastClose={code:event.code,reason:event.reason,at:Date.now()};
      this.socket=null;this.connected=false;this.id=null;this.joining=false;this.motion.clear();this.pendingSnapshot=null;
      this.emit('status',{state:'disconnected',text:this.requiresReload?'World updated · reload required':this.wanted?'Reconnecting · playing locally':'Not connected'});
      if(this.wanted){const delay=Math.min(8000,1000*2**this.retry++);this.retryTimer=setTimeout(()=>this.connect(),delay);}
    });
    ws.addEventListener('error',()=>{});
  }
  updateCount(count,capacity){this.count=count;this.capacity=capacity;this.emit('count',{count,capacity});}
  join(character){
    if(!this.connected||this.joining||this.requiresReload)return false;
    this.character=character;this.joining=true;
    if(!this.send({type:'join',protocol:3,worldVersion:this.worldVersion,capturedAt:performance.now(),character,mapId:this.mapId})){this.joining=false;return false;}
    return true;
  }
  publish(p,force=false){
    if(!this.id||!this.connected)return false;
    const now=performance.now();if(!force&&now-this.lastPublished<50)return false;
    const sent=this.send({type:'state',seq:this.sequence+1,capturedAt:now,x:p.x,y:p.y,z:p.z,vx:p.vx,vy:p.vy,vz:p.vz,facing:p.facing,moving:p.moving});
    if(sent){this.lastPublished=now;this.sequence++;}return sent;
  }
  sample(now=performance.now()){
    if(this.pendingSnapshot){const pending=this.pendingSnapshot;this.pendingSnapshot=null;this.motion.ingest(pending.players,pending.receivedAt,this.id);}
    return this.motion.sample(now);
  }
  diagnostics(){return {...this.motion.diagnostics(),droppedSnapshots:this.droppedSnapshots,worldVersion:this.worldVersion,requiresReload:this.requiresReload};}
  leave(){
    this.wanted=false;this.character=null;clearTimeout(this.retryTimer);
    this.send({type:'leave'});this.socket?.close(1000);this.id=null;this.motion.clear();this.pendingSnapshot=null;
  }
}
window.TempleNetwork=TempleNetwork;
