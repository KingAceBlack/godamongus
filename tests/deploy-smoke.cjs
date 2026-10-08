// Bounded production smoke test: starts and stops its own isolated server. No browser/dev packages needed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{WebSocket}=require('ws');
const Physics=require('../physics.js'),maps=require('../maps.js'),characters=require('../characters.js');
const root=path.join(__dirname,'..'),port=Number(process.env.SMOKE_PORT||4182),base=`http://127.0.0.1:${port}`;
function message(ws,type,predicate=()=>true){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{ws.off('message',listener);reject(new Error('Timed out waiting for '+type));},5000);
 function listener(raw){const m=JSON.parse(raw);if(m.type===type&&predicate(m)){clearTimeout(timer);ws.off('message',listener);resolve(m);}}
 ws.on('message',listener);
});}
(async()=>{
 const sockets=[],child=spawn(process.execPath,['server.cjs'],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(new Error('Server startup timeout: '+logs)),8000);
   const data=d=>{if(String(d).includes('Solar Temple listening'))finish();};
   const exit=()=>finish(new Error('Server exited: '+logs));
   const finish=error=>{clearTimeout(timer);child.stdout.off('data',data);child.off('exit',exit);child.off('error',finish);error?reject(error):resolve();};
   child.stdout.on('data',data);child.once('exit',exit);child.once('error',finish);
  });
  const status=await (await fetch(base+'/api/status')).json();assert.equal(status.capacity,32);assert.equal(status.players,0);
  const html=await (await fetch(base+'/')).text();assert(html.includes('id="joinServer"'));
  const files=new Set([...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]).filter(s=>!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(s)));
  for(const m of html.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))if(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(m[1]))files.add(m[1]);
  for(const map of Object.values(maps))for(const file of [map.image,map.colliders,...map.foreground,...(map.hazards||[]).map(h=>h.image)])files.add('assets/'+file);
  for(const skin of Object.values(characters))for(const file of [skin.idle,skin.walk,skin.jump].filter(Boolean))files.add('assets/'+file);
  for(const file of files){const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,file)),file+' bytes');}
  for(const file of ['server.cjs','package.json','render.yaml','DEPLOYMENT.md','.env','tools/browser-env.cjs'])assert.equal((await fetch(base+'/'+file)).status,404,file+' must not be public');
  console.log('PASS production PORT binding, health endpoint, all '+files.size+' active files and private-file boundaries');
  const map=maps['solar-temple'],data=JSON.parse(fs.readFileSync(path.join(root,'assets',map.colliders)));data.map.spawn=map.spawn;
  const worldVersion=Physics.version(data),skin=Object.keys(characters).at(-1),players=[];
  for(let i=0;i<2;i++){
   const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);sockets.push(ws);const hello=await message(ws,'hello');assert.equal(hello.protocol,3);assert.equal(hello.worldVersions[map.id],worldVersion);
   const joined=message(ws,'joined');ws.send(JSON.stringify({type:'join',protocol:3,mapId:map.id,worldVersion,character:skin,capturedAt:performance.now()}));players.push((await joined).player);
  }
  const received=message(sockets[1],'snapshot',m=>m.players.some(p=>p.id===players[0].id&&p.seq===1));
  sockets[0].send(JSON.stringify({...players[0],type:'state',seq:1,capturedAt:performance.now(),x:players[0].x+20}));
  const snapshot=await received;assert.equal(snapshot.players.find(p=>p.id===players[0].id).x,players[0].x+20);
  assert.equal((await (await fetch(base+'/api/status')).json()).players,2);
  console.log('PASS two production WebSocket clients, collider compatibility, latest character and state relay');
 }finally{
  for(const ws of sockets)ws.terminate();
  if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
