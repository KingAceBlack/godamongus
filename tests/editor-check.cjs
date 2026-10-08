const {chromium}=require('playwright');
const {executablePath,baseURL,artifact}=require('../tools/browser-env.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(baseURL);await page.waitForFunction(()=>window.templeDebug);
  if(!await page.evaluate(()=>templeDebug().editor.enabled)){
   assert(!await page.locator('#lobbyEditor').isVisible());assert(!await page.locator('#editorToggle').isVisible());assert(!await page.locator('#panel').isVisible());
   await page.evaluate(()=>document.querySelector('#lobbyEditor').click());assert(!await page.evaluate(()=>templeDebug().editor.open));
   assert.deepEqual(errors,[]);console.log('PASS editor intentionally hidden and guarded; retained editor interaction tests skipped while disabled');return;
  }
  await page.click('#lobbyEditor');
  await page.waitForFunction(()=>templeDebug().editor.open);
  const baseline=(await page.evaluate(()=>templeDebug())).editor.polygons.length;
  assert.equal((await page.evaluate(()=>templeDebug())).connected,false);
  const toScreen=async(x,y)=>page.evaluate(({x,y})=>{const {camera:c}=templeDebug();return {x:(x-c.x)*c.zoom+innerWidth/2,y:(y-c.y)*c.zoom+innerHeight/2};},{x,y});
  const p=(await page.evaluate(()=>templeDebug())).player;
  const pts=[[p.x+80,p.y-60],[p.x+190,p.y-60],[p.x+190,p.y+60],[p.x+80,p.y+60]];
  await page.click('#drawTool');for(const [x,y] of pts){const s=await toScreen(x,y);await page.mouse.click(s.x,s.y);}await page.keyboard.press('Enter');
  let d=await page.evaluate(()=>templeDebug());assert.equal(d.editor.polygons.length,baseline+1);assert.equal(d.editor.polygons[baseline].length,4);
  console.log('PASS drawing and finishing collision polygon');
  const vertex=d.editor.polygons[baseline][1],s=await toScreen(...vertex);
  await page.mouse.move(s.x,s.y);await page.mouse.down();await page.mouse.move(s.x+12,s.y,{steps:3});await page.mouse.up();
  d=await page.evaluate(()=>templeDebug());assert(d.editor.polygons[baseline][1][0]>vertex[0]+10);
  console.log('PASS vertex dragging updates collider');
  const downloadPromise=page.waitForEvent('download');await page.click('#downloadJson');const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'twin-temple-colliders.json');const downloaded=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(downloaded.mapId,'solar-temple');assert.equal(downloaded.map.image,'twin-temple.webp');assert.equal(downloaded.colliders.length,baseline+1);
  await page.selectOption('#editorArea','entrance');const cam1=(await page.evaluate(()=>templeDebug())).camera.x;
  await page.selectOption('#editorArea','sun-hall');const cam2=(await page.evaluate(()=>templeDebug())).camera.x;assert(cam2>cam1+1000);
  assert.equal((await page.evaluate(()=>templeDebug())).editor.polygons.length,baseline+1);
  assert.equal((await page.evaluate(()=>templeDebug())).mapId,'solar-temple');
  console.log('PASS room focusing pans one world and preserves all colliders');
  await page.click('#clearAll');assert.equal((await page.evaluate(()=>templeDebug())).editor.polygons.length,0);
  await page.setInputFiles('#colliderFile',{name:'twin-temple-colliders.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(downloaded))});
  await page.waitForFunction(n=>templeDebug().editor.polygons.length===n,baseline+1);
  await page.click('#testTool');await page.keyboard.down('d');await page.waitForTimeout(850);await page.keyboard.up('d');
  const after=await page.evaluate(()=>templeDebug());assert(after.player.x>p.x+20);assert(after.player.x<=pts[0][0]-13);assert(!after.connected);
  assert(await page.locator('#returnEditor').isVisible());
  console.log('PASS imported draft collision actually blocks local test movement without a network connection');
  await page.click('#returnEditor');await page.click('#exitEditor');await page.waitForFunction(n=>!templeDebug().editor.open&&templeDebug().editor.polygons.length===n,baseline);
  assert(await page.locator('#serverGate').isVisible());
  await page.click('#joinServer');await page.click('[data-character="solar-guardian"]');await page.click('#enterWorld');await page.waitForFunction(()=>templeDebug().connected&&templeDebug().joined);
  assert.equal((await page.evaluate(()=>templeDebug())).player.mapId,'solar-temple');
  await page.click('#editorToggle');await page.waitForFunction(()=>templeDebug().editor.open&&!templeDebug().connected);
  assert.equal((await page.evaluate(()=>templeDebug())).editor.polygons.length,baseline+1);
  console.log('PASS exiting editor restores published world; entering editor leaves multiplayer and restores draft');
  await page.click('#exitEditor');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const m=await mobile.newPage();
  m.on('pageerror',e=>errors.push(e.message));await m.goto(baseURL);await m.click('#lobbyEditor');
  assert(await m.locator('#editorArea').isVisible());await m.click('#testTool');assert(await m.locator('#joystick').isVisible());assert(await m.locator('#returnEditor').isVisible());
  await m.click('#returnEditor');await m.screenshot({path:artifact('sun-hall-mobile-editor.png')});
  assert.deepEqual(errors,[]);console.log('PASS mobile editor/test controls and no runtime errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
