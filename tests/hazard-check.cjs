const assert=require('node:assert/strict'),{chromium}=require('playwright');
const {executablePath,baseURL,artifact}=require('../tools/browser-env.cjs'),map=require('../maps.js')['solar-temple'];
const scale=map.worldWidth/map.sourceWidth,h=map.hazards[0],x=h.center[0]*scale,y=h.center[1]*scale;
(async()=>{
 const browser=await chromium.launch({executablePath,args:['--no-sandbox']}),errors=[];
 try{
  async function pageAt(position,options={}){
   const context=await browser.newContext(options),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   // Test-only initial position fixture. No mutable debug/teleport hooks are shipped with the game.
   if(position)await page.addInitScript(position=>{
    const native=WebSocket.prototype.addEventListener;let placed=false;
    WebSocket.prototype.addEventListener=function(type,fn,options){
     if(type==='message'){const callback=fn;fn=function(event){let m;try{m=JSON.parse(event.data);}catch{}if(m?.type==='joined'&&!placed){placed=true;Object.assign(m.player,position);event=new MessageEvent('message',{data:JSON.stringify(m)});}return callback.call(this,event);};}
     return native.call(this,type,fn,options);
    };
   },position);
   await page.goto(baseURL);await page.click('#joinServer');await page.click('[data-character="golden-envoy"]');await page.click('#enterWorld');await page.waitForFunction(()=>templeDebug().joined);await page.waitForTimeout(350);return page;
  }
  const observer=await pageAt(null,{viewport:{width:1000,height:700}});
  const page=await pageAt({x:x-220,y},{viewport:{width:1440,height:900}});
  const before=await page.evaluate(()=>templeDebug());assert.equal(before.hazards.length,1);
  await page.screenshot({path:artifact('sunblade-hazard-desktop.png')});
  const frame=before.hazards[0].frame;await page.waitForFunction(frame=>templeDebug().hazards[0].frame!==frame,frame);
  await page.keyboard.down('d');await page.waitForFunction(()=>templeDebug().death!==null);
  const dead=await page.evaluate(()=>templeDebug());assert.equal(dead.deaths,1);assert.equal(dead.player.vx,0);assert.equal(dead.player.moving,false);
  await page.screenshot({path:artifact('sunblade-death.png')});
  await page.waitForFunction(()=>templeDebug().death===null&&templeDebug().deaths===1);await page.keyboard.up('d');
  const after=await page.evaluate(()=>templeDebug());
  assert.equal(after.id,before.id);assert.equal(after.player.character,before.player.character);
  assert(Math.hypot(after.player.x-map.spawn[0]*scale,after.player.y-map.spawn[1]*scale)<1);
  assert.equal(after.player.vx,0);assert.equal(after.player.z,0);
  await observer.waitForFunction(({id,x,y})=>templeDebug().remotes.some(p=>p.id===id&&Math.hypot(p.x-x,p.y-y)<1),{id:after.id,x:after.player.x,y:after.player.y});
  console.log('PASS animated blade contact, death freeze, safe respawn, preserved identity/skin and remote teleport');
  // Retained editor checks run only when editing is enabled for development.
  if(await page.evaluate(()=>templeDebug().editor.enabled)){
  await page.click('#editorToggle');await page.selectOption('#editorArea','sun-hall');await page.click('#placePlayer');
  const screen=await page.evaluate(({x,y})=>{const c=templeDebug().camera;return{x:(x-c.x)*c.zoom+innerWidth/2,y:(y-c.y)*c.zoom+innerHeight/2};},{x,y});
  await page.mouse.click(screen.x,screen.y);await page.waitForTimeout(900);
  const editor=await page.evaluate(()=>templeDebug());assert(editor.editor.open);assert.equal(editor.editor.tool,'test');assert.equal(editor.connected,false);assert.equal(editor.deaths,1);assert.equal(editor.death,null);
  assert(Math.hypot(editor.player.x-x,editor.player.y-y)<5);
  console.log('PASS editor remains offline and non-lethal; published colliders unchanged');
  }else{
   assert(!await page.locator('#editorToggle').isVisible());await page.evaluate(()=>document.querySelector('#editorToggle').click());
   const state=await page.evaluate(()=>templeDebug());assert(!state.editor.open);assert.equal(state.id,before.id);assert(state.connected);
   console.log('PASS disabled editor cannot interrupt the multiplayer session');
  }
  const mobile=await pageAt({x,y},{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.waitForFunction(()=>templeDebug().deaths===1&&templeDebug().death===null);
  assert(await mobile.locator('#joystick').isVisible());assert(await mobile.locator('#jumpButton').isVisible());
  assert((await mobile.evaluate(()=>templeDebug())).player.x<1500);
  await mobile.screenshot({path:artifact('sunblade-mobile-respawn.png')});
  assert.deepEqual(errors,[]);console.log('PASS mobile death/respawn, reachable touch controls and no runtime errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
