const {chromium}=require('playwright');
const {executablePath,baseURL,artifact}=require('../tools/browser-env.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const errors=[];
  try{
    const ctxA=await browser.newContext({viewport:{width:1280,height:800}}),ctxB=await browser.newContext({viewport:{width:1280,height:800}});
    await ctxA.addInitScript(()=>{
      const Original=window.WebSocket;
      window.WebSocket=class extends Original{
        constructor(...args){super(...(window.testOffline?['ws://127.0.0.1:1/ws']:args));window.testSocket=this;}
        send(data){if(window.testDropStates&&JSON.parse(data).type==='state')return;super.send(data);}
        addEventListener(type,listener,...options){if(type!=='message')return super.addEventListener(type,listener,...options);super.addEventListener(type,e=>{if(window.testDropSnapshots&&JSON.parse(e.data).type==='snapshot')return;listener(e);},...options);}
      };
    });
    const a=await ctxA.newPage(),b=await ctxB.newPage();
    for(const p of [a,b]){p.on('pageerror',e=>errors.push(e.message));await p.goto(baseURL);}
    async function join(p,skin){await p.click('#joinServer');await p.click(`[data-character="${skin}"]`);await p.click('#enterWorld');await p.waitForFunction(()=>window.templeDebug().joined);}
    await join(a,'sun-priestess');await join(b,'solar-guardian');
    const before=await a.evaluate(()=>templeDebug());const other=await b.evaluate(()=>templeDebug());
    assert.notEqual(before.id,other.id);assert.notEqual(before.player.name,other.player.name);
    await a.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id),other.id);
    await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id),before.id);
    console.log('PASS two browser contexts, unique names, mutually visible avatars');
    await a.screenshot({path:artifact('multiplayer-two-players.png')});
    await a.locator('#world').focus();await a.keyboard.down('d');await a.waitForTimeout(450);await a.keyboard.up('d');
    await b.waitForFunction(({id,x})=>templeDebug().remotes.some(p=>p.id===id&&p.x>x+12),{id:before.id,x:before.player.x});
    console.log('PASS keyboard movement arrives at other browser');
    await a.keyboard.press('Space');await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id&&p.z>3),before.id,{timeout:3000});
    console.log('PASS remote jump height');
    await a.click('#changeCharacter');await a.click('[data-character="solar-guardian"]');await a.click('#enterWorld');
    await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id&&p.character==='solar-guardian'),before.id);
    assert.equal((await a.evaluate(()=>templeDebug())).id,before.id);
    console.log('PASS character switching keeps identity and broadcasts skin');
    // Wait for the local skin acknowledgement too (the observer can receive its snapshot first).
    await a.waitForFunction(()=>!templeDebug().selecting);await a.bringToFront();
    // A stalled state channel must not freeze local controls or overflow an acknowledgement queue.
    await a.evaluate(()=>{window.testDropStates=true;window.testDropSnapshots=true;});
    const lagStart=await a.evaluate(()=>templeDebug());
    await a.locator('#world').focus();await a.keyboard.down('a');
    await a.waitForFunction(x=>templeDebug().player.x<x-35,lagStart.player.x,{timeout:5000});await a.keyboard.up('a');
    const lagMoved=await a.evaluate(()=>templeDebug());assert(lagMoved.player.x<lagStart.player.x-30);
    await a.waitForTimeout(8500);
    assert.equal((await a.evaluate(()=>templeDebug())).id,lagStart.id);
    assert.equal((await a.evaluate(()=>templeDebug())).connected,true);
    const noCorrection=await a.evaluate(()=>templeDebug().player);
    await a.evaluate(()=>{window.testDropStates=false;window.testDropSnapshots=false;});await a.waitForTimeout(400);
    const recovered=await a.evaluate(()=>templeDebug().player);assert(Math.abs(recovered.x-noCorrection.x)<1);
    console.log('PASS 9-second state-channel stall: local movement continues, no queue disconnect, no snap-back');
    // Simulate an outage across retries, while continuing to move locally.
    const offlineStart=await a.evaluate(()=>templeDebug());
    await a.evaluate(()=>{window.testOffline=true;window.testSocket.close();});
    await a.waitForTimeout(200);await a.keyboard.down('d');await a.waitForFunction(x=>templeDebug().player.x>x+35,offlineStart.player.x,{timeout:5000});await a.keyboard.up('d');
    await a.waitForFunction(()=>Math.abs(templeDebug().player.vx)<.1,{},{timeout:8000});
    const offlineMoved=await a.evaluate(()=>templeDebug());assert(offlineMoved.joined);assert(!offlineMoved.connected);
    assert(offlineMoved.player.x>offlineStart.player.x+30);assert.equal(await a.locator('#serverGate').isVisible(),false);
    await a.evaluate(()=>{window.testOffline=false;});
    await a.waitForFunction(old=>templeDebug().joined&&templeDebug().connected&&templeDebug().id&&templeDebug().id!==old,before.id,{timeout:16000});
    assert(Math.abs((await a.evaluate(()=>templeDebug())).player.x-offlineMoved.player.x)<1);
    console.log('PASS outage: game remains playable, reconnect retains local position');
    const rejoined=await a.evaluate(()=>templeDebug());
    await b.waitForFunction(({old,next})=>!templeDebug().remotes.some(p=>p.id===old)&&templeDebug().remotes.some(p=>p.id===next),{old:before.id,next:rejoined.id});
    console.log('PASS disconnect removes ghost; automatic reconnect creates fresh session');
    await a.click('#leaveServer');await b.waitForFunction(id=>!templeDebug().remotes.some(p=>p.id===id),rejoined.id);
    assert.equal(await a.locator('#serverGate').isVisible(),true);
    await b.click('#leaveServer');
    console.log('PASS leave returns to lobby and removes avatar');
    // Mobile: touch controls, room HUD and zoom remain reachable after selection.
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const m=await mobile.newPage();m.on('pageerror',e=>errors.push(e.message));await m.goto(baseURL);await join(m,'solar-guardian');
    assert(await m.locator('#joystick').isVisible());await m.click('#mapZoomIn');assert.equal(await m.locator('#mapZoomLevel').textContent(),'86%');
    await m.screenshot({path:artifact('multiplayer-mobile.png')});
    await m.click('#leaveServer');console.log('PASS mobile join, joystick visibility, zoom, leave');
    assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
