const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),{chromium}=require('playwright');
const jumpHash=crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,'../assets',require('../characters.js')['golden-envoy'].jump))).digest('hex');
const {executablePath,baseURL,artifact,waitForAsync}=require('../tools/browser-env.cjs');
// Inspect actual canvas draw order rather than trusting a debug flag about intended layers.
function onLayer({skin,airborne}){
 const draws=window.lastWorldDraws||[],src=airborne&&skin==='golden-envoy'?window.goldenJumpURL:document.querySelector(`[data-character="${skin}"] img`).src;
 const foreground=draws.map((d,i)=>({...d,index:i})).filter(d=>d.width===1906)[1];
 const bodies=draws.map((d,i)=>({...d,index:i})).filter(d=>d.src===src);
 if(!foreground||bodies.length!==1)return false;
 const p=[templeDebug().player,...templeDebug().remotes].find(p=>p.character===skin);
 if(!p)return false;
 const shadow=draws.findIndex(d=>d.kind==='shadow'&&Math.abs(d.x-p.x)<16&&Math.abs(d.y-(p.y+2))<16);
 return (bodies[0].index>foreground.index)===airborne&&shadow>=0&&shadow<foreground.index;
}
(async()=>{
 const browser=await chromium.launch({executablePath,args:['--no-sandbox']}),errors=[];
 try{
  async function join(skin,options={}){
   const page=await (await browser.newContext(options)).newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    window.spriteBlobs=[];const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);spriteBlobs.push({url,blob});return url;};
    const proto=CanvasRenderingContext2D.prototype,fill=proto.fillRect,draw=proto.drawImage,ellipse=proto.ellipse;
    proto.fillRect=function(...args){if(this.canvas.id==='world'&&this.fillStyle==='#050505'){window.lastWorldDraws=window.worldDraws||[];window.worldDraws=[];}return fill.apply(this,args);};
    proto.drawImage=function(image,...args){if(this.canvas.id==='world'){const d={src:image.src,width:image.naturalWidth,frame:args[0]/args[2]};window.worldDraws?.push(d);window.sheetHistory??=[];sheetHistory.push(d);if(sheetHistory.length>2400)sheetHistory.splice(0,600);}return draw.call(this,image,...args);};
    proto.ellipse=function(x,y,...args){if(this.canvas.id==='world')window.worldDraws?.push({kind:'shadow',x,y});return ellipse.call(this,x,y,...args);};
   });
   await page.goto(baseURL);assert(!await page.locator('#lobbyEditor').isVisible());
   await page.click('#joinServer');await page.click(`[data-character="${skin}"]`);await page.click('#enterWorld');await page.waitForFunction(()=>templeDebug().joined);
   for(const id of ['lobbyEditor','editorToggle','panel'])assert(!await page.locator('#'+id).isVisible());
   await page.evaluate(()=>{document.querySelector('#editorToggle').click();document.querySelector('#lobbyEditor').click();});
   assert.equal(await page.evaluate(()=>templeDebug().editor.open),false);assert(await page.evaluate(()=>templeDebug().connected));
   await page.evaluate(async expected=>{
    for(const {url,blob} of spriteBlobs){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash===expected){window.goldenJumpURL=url;return;}}
    throw new Error('Expected jump asset was not loaded');
   },jumpHash);return page;
  }
  const skin='sun-priestess',a=await join(skin,{viewport:{width:1440,height:900}}),b=await join('solar-guardian');
  for(const p of [a,b])await p.waitForFunction(onLayer,{skin,airborne:false});
  await a.keyboard.press('Space');
  for(const p of [a,b])await p.waitForFunction(onLayer,{skin,airborne:true});
  await a.screenshot({path:artifact('jump-front-layer-desktop.png')});
  for(const p of [a,b])await p.waitForFunction(onLayer,{skin,airborne:false});
  assert.equal(await a.evaluate(()=>templeDebug().player.z),0);
  console.log('PASS local and remote jumps render once above foreground; shadows remain below; landing restores original layer');
  // Same renderer must select the actual jump sheet for the local player and observers.
  await a.click('#changeCharacter');await a.click('[data-character="golden-envoy"]');await a.click('#enterWorld');
  for(let repeat=0;repeat<2;repeat++){
   for(const p of [a,b]){await p.waitForFunction(onLayer,{skin:'golden-envoy',airborne:false});await p.evaluate(()=>{sheetHistory=[];});}
   await a.keyboard.press('Space');
   for(const p of [a,b])await p.waitForFunction(onLayer,{skin:'golden-envoy',airborne:true,jumpHash});
   if(!repeat)await a.screenshot({path:artifact('golden-envoy-jump.png')});
   for(const p of [a,b])await p.waitForFunction(onLayer,{skin:'golden-envoy',airborne:false});
   const frames=await a.evaluate(()=>sheetHistory.filter(d=>d.src===goldenJumpURL).map(d=>d.frame));
   assert.deepEqual([...new Set(frames)],[0,1,2,3,4,5,6,7]);assert(frames.every((v,i)=>!i||v>=frames[i-1]));
  }
  console.log('PASS Golden Envoy jump-sheet byte hash, ordered eight-frame playback, repeat restart and remote presentation');
  // Moving jumps use the jump sheet too, then immediately return to the walk sheet.
  await a.keyboard.down('d');await a.keyboard.press('Space');
  await a.waitForFunction(onLayer,{skin:'golden-envoy',airborne:true,jumpHash});
  await a.waitForFunction(()=>{const p=templeDebug().player;return p.z===0&&p.moving;});
  const walkHash=crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,'../assets',require('../characters.js')['golden-envoy'].walk))).digest('hex');
  await waitForAsync(a,async expected=>{for(const d of lastWorldDraws.filter(d=>d.width===2048)){const bytes=await (await fetch(d.src)).arrayBuffer();const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash===expected)return true;}return false;},walkHash);
  await a.keyboard.up('d');await a.close();await b.close();
  console.log('PASS moving jump prioritizes jump animation and returns to walking on landing');
  const mobileSkin='golden-envoy',mobile=await join(mobileSkin,{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await mobile.waitForFunction(onLayer,{skin:mobileSkin,airborne:false});await mobile.locator('#jumpButton').tap();
  await mobile.waitForFunction(onLayer,{skin:mobileSkin,airborne:true,jumpHash});
  await mobile.waitForFunction(onLayer,{skin:mobileSkin,airborne:false});
  await mobile.screenshot({path:artifact('editor-hidden-mobile.png')});
  assert.deepEqual(errors,[]);console.log('PASS touch jump layer restoration, hidden/guarded editor on desktop/mobile and no runtime errors');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
