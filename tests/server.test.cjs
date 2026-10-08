const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {WebSocket}=require('ws');
const Physics=require('../physics.js');
const data=require('../assets/twin-temple-colliders.json'),world=Physics.world(data),worldVersion=Physics.version(data);
const joinPacket=(character='sun-priestess',mapId='solar-temple')=>({type:'join',protocol:3,worldVersion,capturedAt:performance.now(),character,mapId});
const port=4181,base=`http://127.0.0.1:${port}`,clients=[];
let processHandle;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function message(ws,type,predicate=()=>true){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.off('message',handler);reject(new Error(`Timed out: ${type}`));},5000);function handler(data){const m=JSON.parse(data);if(m.type===type&&predicate(m)){clearTimeout(timeout);ws.off('message',handler);resolve(m);}}ws.on('message',handler);});}
async function connect(){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);clients.push(ws);ws.seq=0;ws.hello=await message(ws,'hello');return ws;}
async function join(ws,character='sun-priestess',mapId='solar-temple'){const joined=message(ws,'joined');ws.send(JSON.stringify(joinPacket(character,mapId)));return (await joined).player;}
const publish=(ws,p,changes={})=>ws.send(JSON.stringify({...p,type:'state',seq:++ws.seq,capturedAt:performance.now(),...changes}));
before(async()=>{processHandle=spawn(process.execPath,['server.cjs'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});await once(processHandle.stdout,'data');});
after(async()=>{for(const ws of clients)ws.terminate();const exited=once(processHandle,'exit');processHandle.kill('SIGTERM');await exited;});
test('public server status; source and traversal are not served',async()=>{
  assert.equal((await (await fetch(base+'/api/status')).json()).capacity,32);
  assert.equal((await fetch(base+'/server.cjs')).status,404);
  assert.equal((await fetch(base+'/node_modules/ws/package.json')).status,404);
  assert.equal((await fetch(base+'/assets/%2e%2e%2fserver.cjs')).status,404);
  assert.equal((await fetch(base+'/physics.js')).status,200);
});
test('relay preserves client state, identity, safe spawn, jump, skin and disconnect',async()=>{
  const a=await connect(),b=await connect();const pa=await join(a),pb=await join(b,'solar-guardian');
  assert.notEqual(pa.id,pb.id);assert.notEqual(pa.name,pb.name);
  assert(!world.blocked(pa.x,pa.y));assert(!world.blocked(pb.x,pb.y));assert(Math.hypot(pa.x-pb.x,pa.y-pb.y)>90);
  const snapshot=await message(b,'snapshot',m=>m.players.length===1);
  assert.equal(snapshot.players[0].id,pa.id); // Only OTHER players, no local corrections.
  const jumping=message(b,'snapshot',m=>m.players.some(p=>p.id===pa.id&&p.z===42));
  publish(a,pa,{z:42,vz:123});await jumping;
  const moving=message(b,'snapshot',m=>m.players.some(p=>p.id===pa.id&&p.x===pa.x+150));
  publish(a,pa,{x:pa.x+150,vx:280,moving:true,name:'Spoof',id:pb.id});
  const moved=(await moving).players.find(p=>p.id===pa.id);assert(moved.moving);assert.equal(moved.name,pa.name);
  await wait(200);const held=(await message(b,'snapshot')).players[0];assert.equal(held.x,pa.x+150); // No server simulation.
  const skin=message(b,'snapshot',m=>m.players.some(p=>p.id===pa.id&&p.character==='solar-guardian'));
  a.send(JSON.stringify(joinPacket('solar-guardian')));await skin;
  const departure=message(b,'departure',m=>m.id===pa.id);a.close();await departure;
  await message(b,'snapshot',m=>m.players.length===0);b.close();await wait(80);
});
test('invalid state is ignored without disconnecting or poisoning remote rendering',async()=>{
  const a=await connect(),b=await connect();const invalid=message(a,'error');a.send(JSON.stringify({type:'join',character:'fake'}));assert.match((await invalid).message,/valid/);
  const p=await join(a);await join(b);publish(a,p,{x:null,z:'NaN'});
  const next=(await message(b,'snapshot')).players.find(v=>v.id===p.id);assert.equal(next.x,p.x);assert.equal(a.readyState,WebSocket.OPEN);
  const good=message(b,'snapshot',m=>m.players.some(p=>p.x===1500));publish(a,p,{x:1500});await good;
  a.close();b.close();await wait(80);
});
test('packet bursts are dropped rather than disconnecting; latest state resumes',async()=>{
  const a=await connect(),b=await connect();const p=await join(a);await join(b);
  for(let i=0;i<800;i++)publish(a,p,{x:1000+i/10});await wait(300);
  assert.equal(a.readyState,WebSocket.OPEN);
  const latest=message(b,'snapshot',m=>m.players.some(v=>v.id===p.id&&v.x===1700));publish(a,p,{x:1700});await latest;
  a.close();b.close();await wait(80);
});
test('both chambers share one multiplayer coordinate system and presence',async()=>{
  const a=await connect(),b=await connect();const pa=await join(a),pb=await join(b,'solar-guardian');
  assert.equal(pa.mapId,pb.mapId);
  const relay=message(a,'snapshot',m=>m.players.some(p=>p.id===pb.id&&p.x===4200));publish(b,pb,{x:4200,y:1100});await relay;
  const invalid=message(a,'error');a.send(JSON.stringify({type:'join',mapId:'sun-hall',character:'solar-guardian'}));assert.match((await invalid).message,/valid map/);
  a.close();b.close();await wait(80);
});
test('protocol and collider fingerprint reject stale clients before joining',async()=>{
  const a=await connect();assert.equal(a.hello.protocol,3);assert.equal(a.hello.worldVersions['solar-temple'],worldVersion);
  for(const overrides of [{protocol:2},{worldVersion:'old-colliders'}]){const failure=message(a,'error');a.send(JSON.stringify({...joinPacket(),...overrides}));assert.equal((await failure).code,'RELOAD_REQUIRED');}
  assert.equal((await (await fetch(base+'/api/status')).json()).players,0);
  await join(a,'ember-warden');a.close();await wait(80);
});
test('source timestamps and sequences survive relay; duplicate/backward movement is ignored',async()=>{
  const a=await connect(),b=await connect();const p=await join(a);await join(b);
  const capturedAt=performance.now()+100;
  let next=message(b,'snapshot',m=>m.players.some(v=>v.seq===10));publish(a,p,{seq:10,capturedAt,x:1000});let m=await next;
  assert(Number.isFinite(m.serverTime));assert(Number.isSafeInteger(m.seq));assert.equal(m.worldVersion,worldVersion);assert.equal(m.players[0].capturedAt,capturedAt);
  publish(a,p,{seq:9,capturedAt:capturedAt+10,x:4000});publish(a,p,{seq:10,capturedAt:capturedAt+20,x:4000});publish(a,p,{seq:11,capturedAt:capturedAt-10,x:4000});
  await wait(60);m=await message(b,'snapshot');assert.equal(m.players[0].x,1000);assert.equal(m.players[0].seq,10);
  next=message(b,'snapshot',m=>m.players.some(v=>v.seq===12));publish(a,p,{seq:12,capturedAt:capturedAt+100,x:1028});await next;
  a.close();b.close();await wait(80);
});
test('continuous walk from entrance to Sun Hall and back without teleport or collision dead-end',()=>{
  const p=world.spawn(),s=5200/1568;
  const route=[[360,353],[490,353],[650,352],[820,352],[1030,353],[1180,420],[1030,353],[820,352],[650,352],[490,353],[360,353],[260,432]];
  for(const [sx,sy] of route){let steps=0;const x=sx*s,y=sy*s;
    while(Math.hypot(p.x-x,p.y-y)>9&&steps++<2000){const d=Math.hypot(x-p.x,y-p.y);world.step(p,{x:(x-p.x)/d,y:(y-p.y)/d,jump:false});assert(!world.blocked(p.x,p.y));}
    assert(steps<2000,`Passage blocked approaching ${sx},${sy}`);
  }
});
test('local collision physics works at 30, 60 and 144 fps',()=>{
  for(const hz of [30,60,144]){const p=world.spawn();for(let i=0;i<hz*10;i++){const n=Math.ceil(60/hz);for(let j=0;j<n;j++)world.step(p,{x:1,y:-1,jump:i%hz===0&&j===0},1/hz/n);assert(!world.blocked(p.x,p.y));assert(p.z>=0&&p.z<100);}}
});
