const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {executablePath,baseURL}=require('../tools/browser-env.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const errors=[];
 async function page(context){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(baseURL);return p;}
 async function join(p){await p.click('#joinServer');await p.click('[data-character="ember-warden"]');await p.click('#enterWorld');await p.waitForFunction(()=>templeDebug().joined);}
 try{
  const ca=await browser.newContext(),cb=await browser.newContext();
  await ca.addInitScript(()=>{
   const Original=WebSocket,queue=[];
   window.WebSocket=class extends Original{send(data){if(JSON.parse(data).type==='state'){queue.push([this,data]);return;}return super.send(data);}};
   setInterval(()=>{const batch=queue.splice(0);for(const [socket,data] of batch)if(socket.readyState===Original.OPEN)Original.prototype.send.call(socket,data);if(batch.length){const [socket,data]=batch[0];if(socket.readyState===Original.OPEN)Original.prototype.send.call(socket,data);}},200);
  });
  await cb.addInitScript(()=>{
   const Original=WebSocket;window.buffer=[];window.batch=false;window.hold=false;
   window.WebSocket=class extends Original{addEventListener(type,listener,...rest){
    if(type!=='message')return super.addEventListener(type,listener,...rest);
    return super.addEventListener(type,event=>{const m=JSON.parse(event.data);if(m.type==='snapshot'&&window.batch){buffer.push(()=>listener(event));return;}listener(event);},...rest);
   }};
   setInterval(()=>{if(window.hold)return;const pending=buffer.splice(0);for(const deliver of pending)deliver();if(pending.length)pending[0]();},250);
  });
  const a=await page(ca),b=await page(cb);await join(a);await join(b);
  const id=await a.evaluate(()=>templeDebug().id);await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id),id);
  const data=JSON.parse(fs.readFileSync('assets/twin-temple-colliders.json'));
  await b.evaluate(({id,data})=>{
   window.batch=true;window.trace=[];const world=TemplePhysics.world(data);
   const tick=()=>{const now=performance.now(),d=templeDebug(),p=d.remotes.find(p=>p.id===id);if(p)trace.push({now,x:p.x,y:p.y,moving:p.moving,blocked:world.blocked(p.x,p.y),resyncs:d.remoteTiming.resyncs,buffer:d.remoteTiming.players.find(p=>p.id===id)?.bufferMs});requestAnimationFrame(tick);};requestAnimationFrame(tick);
  },{id,data});
  await a.locator('#world').focus();await a.keyboard.down('d');await a.waitForTimeout(2600);await a.keyboard.up('d');await a.waitForTimeout(700);
  const trace=await b.evaluate(()=>trace);assert(trace.length>10);
  let smoothMoves=0;for(let i=1;i<trace.length;i++){
   const p=trace[i-1],q=trace[i];assert(!q.blocked,'remote entered a collider');assert(q.buffer>=150&&q.buffer<=300);
   if(p.resyncs===q.resyncs){const distance=Math.hypot(q.x-p.x,q.y-p.y);assert(distance<=300*(q.now-p.now)/1000+2,'burst caused a speed spike');if(distance>.01)smoothMoves++;}
  }
  assert(smoothMoves>0);assert(trace.some(p=>p.buffer>150));assert((await b.evaluate(()=>templeDebug().remoteTiming.droppedSnapshots))>0);
  console.log('PASS sender + receiver packet batches and duplicates: adaptive buffer, bounded speed, collision-safe rendering');
  await b.evaluate(()=>{window.hold=true;buffer.length=0;});
  const start=await a.evaluate(()=>templeDebug().player.x);await a.keyboard.down('a');await a.waitForTimeout(1300);await a.keyboard.up('a');
  assert((await a.evaluate(()=>templeDebug().player.x))<start-15,'local movement frozen by observer network');
  const frozen1=await b.evaluate(id=>templeDebug().remotes.find(p=>p.id===id),id);await b.waitForTimeout(350);
  const frozen2=await b.evaluate(id=>templeDebug().remotes.find(p=>p.id===id),id);assert(Math.hypot(frozen2.x-frozen1.x,frozen2.y-frozen1.y)<.01);assert(!frozen2.moving);
  const resyncs=await b.evaluate(()=>templeDebug().remoteTiming.resyncs);await b.evaluate(()=>{window.hold=false;});
  await b.waitForFunction(n=>templeDebug().remoteTiming.resyncs>n,resyncs);
  await a.waitForFunction(()=>Math.hypot(templeDebug().player.vx,templeDebug().player.vy)<.1);
  const target=await a.evaluate(()=>templeDebug().player);
  await b.waitForFunction(({id,x,y})=>{const p=templeDebug().remotes.find(p=>p.id===id);return p&&Math.hypot(p.x-x,p.y-y)<3;},{id,x:target.x,y:target.y});
  console.log('PASS long delivery gap: remote holds still, local movement continues, backlog resynchronizes');
  await a.close();await b.close();
  const cc=await browser.newContext(),c=await cc.newPage();c.on('pageerror',e=>errors.push(e.message));
  const stale=structuredClone(data);stale.colliders[0].points[0][0]+=1;
  await c.route('**/assets/twin-temple-colliders.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(stale)}));
  await c.goto(baseURL);await c.click('#joinServer');await c.waitForFunction(()=>templeDebug().remoteTiming.requiresReload);
  assert(!await c.evaluate(()=>templeDebug().joined));await c.waitForFunction(()=>document.querySelector('#joinServer').textContent==='Reload game');
  await c.unroute('**/assets/twin-temple-colliders.json');await c.click('#joinServer');await join(c);
  console.log('PASS stale collider layout is refused, with a working Reload game action');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
