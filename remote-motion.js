/* Remote presentation only. Captured timestamps retain their source clock; each avatar has a local clock anchor. */
(function(root){
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  class TempleRemoteMotion{
    constructor(){this.world=null;this.tracks=new Map();this.resyncs=0;this.rejected=0;}
    clear(){this.tracks.clear();}
    remove(id){this.tracks.delete(id);}
    safe(p){return !this.world||!this.world.blocked(p.x,p.y);}
    chord(a,b){return !this.world||!this.world.pathBlocked(a.x,a.y,b.x,b.y);}
    reset(track,p,now,reason){
      track.history=[p];track.anchor=now-p.capturedAt;track.playhead=p.capturedAt-track.delay;
      track.shown={...p,moving:false,vx:0,vy:0};track.lastRender=now;track.reason=reason;
      if(reason!=='arrival')this.resyncs++;
    }
    ingest(players,now,selfId){
      const ids=new Set();
      for(const raw of players){
        if(raw.id===selfId)continue;ids.add(raw.id);
        if(!Number.isSafeInteger(raw.seq)||raw.seq<0||!['capturedAt','x','y','z'].every(k=>Number.isFinite(raw[k])))continue;
        let track=this.tracks.get(raw.id);
        if(track&&raw.seq<track.seq)continue;
        if(track&&raw.seq===track.seq){
          // Appearance may change without a movement packet. Duplicate poses never advance the timeline.
          for(const p of track.history){p.character=raw.character;p.name=raw.name;}
          if(track.shown){track.shown.character=raw.character;track.shown.name=raw.name;}
          continue;
        }
        if(track&&raw.capturedAt<=track.lastCapture){this.rejected++;continue;}
        const p={...raw};
        if(!this.safe(p)){this.rejected++;continue;}
        if(!track){
          track={history:[],delay:150,jitter:0,gapEstimate:50,seq:p.seq,lastCapture:p.capturedAt,lastReceive:now,lastRender:now,shown:null};
          this.tracks.set(p.id,track);this.reset(track,p,now,'arrival');
        }else{
          const prev=track.history[track.history.length-1],sourceGap=p.capturedAt-track.lastCapture,receiveGap=now-track.lastReceive;
          if(sourceGap>500||receiveGap>500||Math.hypot(p.x-prev.x,p.y-prev.y)>320*sourceGap/1000+4){
            // An outage/teleport has no trustworthy intermediate path. Reposition, never race through it.
            this.reset(track,p,now,'gap');
          }else{
            track.jitter+=(Math.min(500,Math.abs(receiveGap-sourceGap))-track.jitter)*.15;
            track.gapEstimate=Math.max(receiveGap,track.gapEstimate*.95);
            track.delay=clamp(Math.max(150+track.jitter*2,track.gapEstimate+50),150,300);
            // Relative capture deltas handle arbitrary sender clock origins. Arrival bursts cannot compress time.
            track.anchor=Math.min(track.anchor,now-p.capturedAt);
            if(now-track.anchor-p.capturedAt>500){this.rejected++;continue;}
            p.clearFromPrevious=this.chord(prev,p);track.history.push(p);
            if(track.history.length>32)track.history.shift();
          }
        }
        track.seq=p.seq;track.lastCapture=p.capturedAt;track.lastReceive=now;
      }
      for(const id of this.tracks.keys())if(!ids.has(id))this.tracks.delete(id);
    }
    sample(now){
      const result=[];
      for(const track of this.tracks.values()){
        const history=track.history,last=history[history.length-1];if(!last)continue;
        const elapsed=Math.max(0,now-track.lastRender),desired=now-track.anchor-track.delay;
        if(elapsed>500||desired-track.playhead>500){this.reset(track,last,now,'resume');result.push({...track.shown});continue;}
        // Playback never runs faster than real time. Extra jitter buffering drains only while stationary.
        const stationary=history.length>1&&history.every(p=>Math.hypot(p.x-last.x,p.y-last.y)<.01&&Math.abs(p.z-last.z)<.01);
        if(stationary)track.playhead=Math.max(track.playhead,Math.min(desired,last.capturedAt));
        else track.playhead=Math.max(track.playhead,Math.min(desired,track.playhead+elapsed));
        let a=history[0],b=a;
        for(const p of history){b=p;if(p.capturedAt>=track.playhead)break;a=p;}
        const t=b.capturedAt>a.capturedAt?clamp((track.playhead-a.capturedAt)/(b.capturedAt-a.capturedAt),0,1):1;
        let pose={...b,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t},resync=false;
        if(a!==b&&b.clearFromPrevious===false){pose={...(t<1?a:b)};resync=t===1;}
        const previous=track.shown;
        if(previous&&elapsed>0){
          if(!this.chord(previous,pose)){resync=true;}
          else if(!resync){
            const dx=pose.x-previous.x,dy=pose.y-previous.y,d=Math.hypot(dx,dy),max=300*elapsed/1000;
            if(d>max&&d>0)pose={...pose,x:previous.x+dx*max/d,y:previous.y+dy*max/d};
          }
        }
        if(!this.safe(pose)){pose={...previous};resync=false;}
        if(resync){this.resyncs++;track.reason='wall';}
        const distance=previous?Math.hypot(pose.x-previous.x,pose.y-previous.y):0;
        pose.moving=!resync&&elapsed>0&&distance/elapsed>.009;
        if(!pose.moving){pose.vx=0;pose.vy=0;}
        track.shown=pose;track.lastRender=now;result.push({...pose});
        while(history.length>2&&history[1].capturedAt<track.playhead)history.shift();
      }
      return result;
    }
    diagnostics(){return {resyncs:this.resyncs,rejected:this.rejected,players:[...this.tracks.entries()].map(([id,t])=>({id,bufferMs:Math.round(t.delay),snapshots:t.history.length,lastSeq:t.seq,reason:t.reason}))};}
  }
  if(typeof module==='object'&&module.exports)module.exports=TempleRemoteMotion;else root.TempleRemoteMotion=TempleRemoteMotion;
})(globalThis);
