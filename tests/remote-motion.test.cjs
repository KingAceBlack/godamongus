const {test}=require('node:test'),assert=require('node:assert/strict');
const Motion=require('../remote-motion.js'),Physics=require('../physics.js');
const pose=(seq,capturedAt,x=100,y=100,extra={})=>({id:'remote',name:'Traveler',character:'ember-warden',seq,capturedAt,x,y,z:0,vx:280,vy:0,vz:0,facing:1,moving:true,...extra});
const geometry={map:{worldWidth:1000,sourceWidth:1000,sourceHeight:1000,spawn:[100,100]},colliders:[{points:[[500,0],[501,0],[501,800],[500,800]]}]};
test('different source clock origins produce identical playback; remote speed never follows packet arrival spacing',()=>{
 const a=new Motion(),b=new Motion();let previous=null,last=0;
 for(let now=0;now<=2500;now+=10){
  // Every 200 ms, four old samples arrive in a burst instead of evenly at 50 ms.
  if(now%200===0)for(let i=Math.max(0,now-150);i<=now;i+=50){const p=pose(i/50,i,100+i*.28);a.ingest([p],now,'self');b.ingest([{...p,capturedAt:p.capturedAt+12345678}],now,'self');}
  const pa=a.sample(now)[0],pb=b.sample(now)[0];assert(Math.abs(pa.x-pb.x)<1e-6);
  if(previous)assert(Math.abs(pa.x-previous.x)<=300*(now-last)/1000+1e-6,'no burst fast-forward');previous=pa;last=now;
 }
 const info=a.diagnostics();assert(info.players[0].bufferMs>150&&info.players[0].bufferMs<=300);assert(info.players[0].snapshots<=32);
});
test('outage freezes remote animation, then repositions without traversing a catch-up path',()=>{
 const m=new Motion();m.ingest([pose(1,1000,100)],0,'self');m.sample(0);
 const frozen=m.sample(300)[0];assert.equal(frozen.x,100);assert.equal(frozen.moving,false);
 m.ingest([pose(2,3000,600)],2000,'self');const recovered=m.sample(2000)[0];assert.equal(recovered.x,600);assert.equal(recovered.moving,false);assert(m.resyncs>0);assert.equal(m.tracks.get('remote').history.length,1);
});
test('duplicates/out-of-order states do not grow history; appearance changes are preserved',()=>{
 const m=new Motion();m.ingest([pose(2,1000)],0,'self');
 m.ingest([pose(1,900,500)],20,'self');m.ingest([pose(2,1000,500,100,{character:'sun-priestess'})],40,'self');
 m.ingest([pose(3,999,600)],60,'self');const result=m.sample(100)[0];assert.equal(result.x,100);assert.equal(result.character,'sun-priestess');assert.equal(m.tracks.get('remote').history.length,1);
 m.ingest([],120,'self');assert.equal(m.sample(120).length,0);
});
test('swept-circle checks catch thin walls, crossings and radius-only contacts',()=>{
 const w=Physics.world(geometry);assert(!w.blocked(480,100));assert(!w.blocked(520,100));assert(w.pathBlocked(480,100,520,100));
 assert(w.pathBlocked(487,810,515,810));assert(!w.pathBlocked(480,830,520,830));assert(!w.pathBlocked(100,100,200,200));
});
test('interpolation never enters a wall or invents a route around a missing corner',()=>{
 const m=new Motion();m.world=Physics.world(geometry);m.ingest([pose(1,0,480)],0,'self');m.sample(0);
 m.ingest([pose(2,200,520)],200,'self');const seen=[];
 for(let now=200;now<=500;now+=10){const p=m.sample(now)[0];seen.push(p.x);assert(!m.world.blocked(p.x,p.y));assert(p.x===480||p.x===520);}
 assert(seen.includes(480)&&seen.includes(520));assert(m.resyncs>0);
 m.ingest([pose(3,250,500)],550,'self');assert.equal(m.sample(550)[0].x,520);assert(m.rejected>0);
});
test('resume after a rendering pause discards the old playback timeline',()=>{
 const m=new Motion();m.ingest([pose(1,0)],0,'self');m.sample(0);
 for(let t=50;t<=1200;t+=50)m.ingest([pose(t/50+1,t,100+t*.28)],t,'self');
 assert(Math.abs(m.sample(1200)[0].x-436)<1e-8);assert.equal(m.tracks.get('remote').history.length,1);
});
test('collider fingerprints are stable across parsing and change with edited geometry',()=>{
 const clone=JSON.parse(JSON.stringify(geometry));assert.equal(Physics.version(geometry),Physics.version(clone));clone.colliders[0].points[0][0]++;
 assert.notEqual(Physics.version(geometry),Physics.version(clone));
});
