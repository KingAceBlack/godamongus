const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {chromium}=require('playwright'),catalog=require('../characters.js');
const {executablePath,baseURL,artifact,waitForAsync}=require('../tools/browser-env.cjs');
const character=process.env.CHARACTER||'golden-envoy',meta=catalog[character],selector=`[data-character="${character}"]`;
(async()=>{
 const browser=await chromium.launch({executablePath,args:['--no-sandbox']});const errors=[];
 async function newPage(options={}){
  const context=await browser.newContext(options),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{window.spriteDraws=new Set();const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(this.canvas.id==='world'&&image.naturalWidth===2048){window.lastSprite=image.src;window.spriteDraws.add(image.src);}return draw.call(this,image,...args);};});
  await p.goto(baseURL);return p;
 }
 async function choose(p,skin){await p.click('#joinServer');assert.equal(await p.locator('.character-option').count(),Object.keys(catalog).length);await p.click(`[data-character="${skin}"]`);}
 try{
  const a=await newPage({viewport:{width:1440,height:900}});await choose(a,character);
  assert.equal(await a.locator('#showcaseName').textContent(),meta.name);assert.equal(await a.locator('#guardianRole').textContent(),meta.role);
  const portrait=await a.locator(selector+' img').evaluate(im=>({w:im.naturalWidth,h:im.naturalHeight}));assert.deepEqual(portrait,{w:2048,h:256});
  await a.waitForTimeout(400);await a.screenshot({path:artifact(`${character}-selection-desktop.png`)});await a.click('#enterWorld');await a.waitForFunction(()=>templeDebug().joined);
  const first=await a.evaluate(()=>templeDebug());assert.equal(first.player.character,character);
  await a.waitForFunction(s=>spriteDraws.has(document.querySelector(s+' img').src),selector);
  // Other live players and airborne sprites may be drawn last. Check all drawn sheets,
  // not the final draw call, against the exact selected walk asset's byte hash.
  await a.evaluate(()=>{spriteDraws.clear();window.spriteHashes={};});
  await a.locator('#world').focus();await a.keyboard.down('d');
  const expectedHash=crypto.createHash('sha256').update(fs.readFileSync('assets/'+meta.walk)).digest('hex');
  await waitForAsync(a,async expected=>{
   if(!templeDebug().player.moving)return false;
   for(const src of spriteDraws){
    if(!spriteHashes[src]){const bytes=await (await fetch(src)).arrayBuffer();spriteHashes[src]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
    if(spriteHashes[src]===expected)return true;
   }
   return false;
  },expectedHash);
  await a.keyboard.up('d');
  console.log(`PASS ${meta.name}: selection, unchanged sprite dimensions and correct idle/walk rendering`);
  const b=await newPage({viewport:{width:1100,height:800}});await choose(b,'solar-guardian');await b.click('#enterWorld');
  await b.waitForFunction(({id,character})=>templeDebug().remotes.some(p=>p.id===id&&p.character===character),{id:first.id,character});
  await b.waitForFunction(s=>spriteDraws.has(document.querySelector(s+' img').src),selector);
  for(const skin of Object.keys(catalog)){
   await a.click('#changeCharacter');await a.click(`[data-character="${skin}"]`);await a.click('#enterWorld');
   await a.waitForFunction(s=>!templeDebug().selecting&&templeDebug().player.character===s,skin);
   await b.waitForFunction(({id,skin})=>templeDebug().remotes.some(p=>p.id===id&&p.character===skin),{id:first.id,skin});assert.equal((await a.evaluate(()=>templeDebug())).id,first.id);
  }
  console.log('PASS all roster characters switch and replicate without changing identity');await a.close();await b.close();
  for(const viewport of [{width:390,height:844},{width:320,height:568}]){
   const m=await newPage({viewport,isMobile:true,hasTouch:true});await choose(m,character);
   for(const locator of [selector,'#enterWorld']){const r=await m.locator(locator).boundingBox();assert(r&&r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1);}
   await m.waitForTimeout(400);await m.screenshot({path:artifact(`${character}-selection-mobile-${viewport.width}.png`)});await m.click('#enterWorld');await m.waitForFunction(c=>templeDebug().player.character===c&&templeDebug().joined,character);assert(await m.locator('#joystick').isVisible());await m.close();
  }
  console.log('PASS mobile and small-screen roster, joining and touch controls');assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
