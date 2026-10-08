'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,randomInt}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {WebSocketServer,WebSocket}=require('ws');
const Physics=require('./physics.js');
const MAPS=require('./maps.js');
const worldVersions={};
const worlds=Object.fromEntries(Object.values(MAPS).map(map=>{
  const data=JSON.parse(fs.readFileSync(path.join(__dirname,'assets',map.colliders),'utf8'));data.map.spawn=map.spawn;
  worldVersions[map.id]=Physics.version(data);return [map.id,Physics.world(data)];
}));
const SKINS=new Set(Object.keys(require('./characters.js')));
const MAX_PLAYERS=32, MAX_CONNECTIONS=64;
// Exact browser origins for the separately hosted Vercel frontend. Not authentication.
const allowedOrigins=new Set((process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean));
const players=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.json':'application/json'};
const publicFiles=new Set(['backend-config.js','index.html','game.js','hazards.js','assets.js','physics.js','remote-motion.js','multiplayer.js','multiplayer.css','maps.js','characters.js','editor.css']);
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  if(pathname==='/api/status'){
    res.setHeader('Vary','Origin');
    if(allowedOrigins.has(req.headers.origin))res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({name:'Solar Temple',players:players.size,capacity:MAX_PLAYERS}));return;
  }
  const name=pathname==='/'?'index.html':pathname.slice(1);
  if(!(publicFiles.has(name)||/^assets\/[a-zA-Z0-9._-]+$/.test(name))){res.writeHead(404);res.end('Not found');return;}
  const file=path.join(__dirname,name);
  fs.stat(file,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(name)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':name.startsWith('assets/')?'public, max-age=3600':'no-store'});
    if(req.method==='HEAD'){res.end();return;}
    const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
  });
});
const wss=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
server.on('upgrade',(req,socket,head)=>{
  // Public anonymous room. Only the game protocol is accepted; no cookies or account data used.
  if(allowedOrigins.size&&req.headers.origin&&!allowedOrigins.has(req.headers.origin)){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  if(req.url!=='/ws'||wss.clients.size>=MAX_CONNECTIONS){socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
function send(ws,data){
  if(ws.readyState!==WebSocket.OPEN)return;
  // Full-state snapshots are replaceable. Skip congested frames instead of kicking the player.
  if(data.type==='snapshot'&&ws.bufferedAmount>0)return;
  ws.send(JSON.stringify(data));
}
function broadcast(data,except){for(const ws of wss.clients)if(ws!==except&&(!data.mapId||ws.player?.mapId===data.mapId))send(ws,data);}
function count(){broadcast({type:'count',count:players.size,capacity:MAX_PLAYERS});}
function state(p){const stale=performance.now()-p.updatedAt>1500;return {id:p.id,name:p.name,character:p.character,mapId:p.mapId,seq:p.seq,capturedAt:p.capturedAt,x:p.x,y:p.y,vx:stale?0:p.vx,vy:stale?0:p.vy,z:stale?0:p.z,vz:stale?0:p.vz,facing:p.facing,moving:!stale&&p.moving};}
function name(){
  const starts=['Amber','Ash','Dawn','Ember','Golden','Lunar','River','Solar','Star','Temple'];
  const ends=['Fox','Hawk','Ibis','Lion','Lotus','Owl','Sage','Sun','Warden'];
  let n;do{n=starts[randomInt(starts.length)]+ends[randomInt(ends.length)]+randomInt(10,1000);}while([...players.values()].some(p=>p.name===n));return n;
}
wss.on('connection',ws=>{
  ws.player=null;ws.created=performance.now();ws.lastSeen=ws.created;ws.tokens=400;ws.refill=ws.created;
  ws.on('pong',()=>ws.lastSeen=performance.now());
  ws.on('error',()=>{});
  send(ws,{type:'hello',protocol:3,serverTime:performance.now(),worldVersions,count:players.size,capacity:MAX_PLAYERS});
  ws.on('message',(raw,binary)=>{
    const now=performance.now();ws.lastSeen=now;ws.tokens=Math.min(400,ws.tokens+(now-ws.refill)*.2);ws.refill=now;
    // A packet burst is dropped, never accumulated in a simulation queue or treated as a disconnect.
    if(ws.tokens<1)return;ws.tokens--;
    let m;try{m=JSON.parse(raw.toString());}catch{ws.close(1008,'Invalid JSON');return;}
    if(binary||!m||typeof m!=='object'||Array.isArray(m)){ws.close(1008,'Invalid message');return;}
    if(m.type==='join'){
      const mapId=m.mapId||'solar-temple',world=worlds[mapId];
      if(!Object.hasOwn(worlds,mapId)){send(ws,{type:'error',message:'Choose a valid map.'});return;}
      if(ws.player&&ws.player.mapId!==mapId){send(ws,{type:'error',message:'Leave your current map before changing maps.'});return;}
      if(!SKINS.has(m.character)){send(ws,{type:'error',message:'Choose a valid guardian.'});return;}
      if(m.protocol!==3||m.worldVersion!==worldVersions[mapId]){send(ws,{type:'error',code:'RELOAD_REQUIRED',message:'The world was updated. Reload game to use matching colliders.'});return;}
      if(!Number.isFinite(m.capturedAt)||m.capturedAt<0||m.capturedAt>1e12){send(ws,{type:'error',message:'Invalid movement clock. Reload game.'});return;}
      if(ws.player){ws.player.character=m.character;send(ws,{type:'skin',player:state(ws.player)});return;}
      if(players.size>=MAX_PLAYERS){send(ws,{type:'error',message:'The server is full. Try again in a moment.'});return;}
      let spawn;try{spawn=world.spawn([...players.values()].filter(p=>p.mapId===mapId));}catch{send(ws,{type:'error',message:'No spawn available. Try again shortly.'});return;}
      const p={...spawn,id:randomUUID(),name:name(),character:m.character,mapId,seq:0,capturedAt:m.capturedAt,updatedAt:now};
      ws.player=p;players.set(p.id,p);
      send(ws,{type:'joined',worldVersion:worldVersions[mapId],serverTime:now,player:state(p),players:[...players.values()].filter(v=>v.mapId===mapId).map(state)});
      broadcast({type:'arrival',id:p.id,name:p.name,mapId:p.mapId},ws);count();return;
    }
    if(m.type==='state'){
      const p=ws.player;if(!p)return;const world=worlds[p.mapId];
      // Sanity checks protect the renderer, not anti-cheat. Position, collision and jump are client-owned.
      if(!['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(m[k]))||![1,-1].includes(m.facing)||typeof m.moving!=='boolean')return;
      if(!Number.isSafeInteger(m.seq)||m.seq<=p.seq||!Number.isFinite(m.capturedAt)||m.capturedAt<=p.capturedAt||m.capturedAt>1e12)return;
      const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
      Object.assign(p,{seq:m.seq,capturedAt:m.capturedAt,x:clamp(m.x,0,world.width),y:clamp(m.y,0,world.height),z:clamp(m.z,0,500),vx:clamp(m.vx,-2000,2000),vy:clamp(m.vy,-2000,2000),vz:clamp(m.vz,-2000,2000),facing:m.facing,moving:m.moving,updatedAt:now});return;
    }
    if(m.type==='input'){if(!ws.legacyNotified){send(ws,{type:'error',message:'Networking updated. Please reload the game.'});ws.legacyNotified=true;}return;}
    if(m.type==='ping'){send(ws,{type:'pong',clientTime:m.clientTime,serverTime:now});return;}
    if(m.type==='leave'){ws.close(1000,'Left temple');return;}
    ws.close(1008,'Unknown message');
  });
  ws.on('close',(code,reason)=>{
    if(ws.player)console.log(`Disconnected ${ws.player.name}: ${code} ${reason.toString().slice(0,100)}`);
    if(ws.player){players.delete(ws.player.id);broadcast({type:'departure',id:ws.player.id,name:ws.player.name,mapId:ws.player.mapId});count();}
  });
});
// Relay only: no simulation, replay, acknowledgements, or corrections to the sender.
let snapshotSequence=0;
const snapshots=setInterval(()=>{
  if(!players.size)return;
  const all=[...players.values()].map(state),seq=++snapshotSequence,serverTime=performance.now();
  for(const ws of wss.clients)if(ws.player)send(ws,{type:'snapshot',seq,serverTime,worldVersion:worldVersions[ws.player.mapId],players:all.filter(p=>p.id!==ws.player.id&&p.mapId===ws.player.mapId)});
},50);
const heartbeat=setInterval(()=>{
  const now=performance.now();
  for(const ws of wss.clients){
    if(now-ws.lastSeen>90000||(!ws.player&&now-ws.created>1800000)){console.log('Expired silent connection');ws.terminate();continue;}
    if(ws.readyState===WebSocket.OPEN)ws.ping();
  }
},15000);
server.listen(Number(process.env.PORT)||4173,'0.0.0.0',()=>console.log(`Solar Temple listening on ${server.address().port}; one room, ${MAX_PLAYERS} players`));
function shutdown(){clearInterval(snapshots);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();wss.close();server.close(()=>process.exit(0));}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
