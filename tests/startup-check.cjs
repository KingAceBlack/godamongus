const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {executablePath,baseURL}=require('../tools/browser-env.cjs');
const meta=require('../maps.js')['solar-temple'];
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 const errors=[];
 async function page(){const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));return p;}
 async function enter(p){await p.click('[data-character="sun-priestess"]');await p.click('#enterWorld');await p.waitForFunction(()=>templeDebug().joined);await p.click('#leaveServer');}
 try{
  const p=await page();await p.route('https://bash.tv/bash/v1.js',()=>{});
  await p.goto(baseURL,{waitUntil:'commit'});
  await p.click('#joinServer',{timeout:10000});await enter(p);await p.close();
  console.log('PASS stalled Bash SDK does not block Join, character selection or gameplay');
  for(const [name,asset] of [['foreground',meta.foreground[0]],['character','guardian-idle.webp'],['collider JSON',meta.colliders]]){
   const p=await page();await p.route('https://bash.tv/bash/v1.js',r=>r.abort());
   const match=`**/assets/${asset}*`;
   await p.route(match,r=>r.fulfill({status:503,body:'Temporary failure'}));
   if(name==='foreground')await p.route(`**/assets/${meta.colliders}`,async r=>{await new Promise(resolve=>setTimeout(resolve,350));await r.continue();});
   await p.goto(baseURL,{waitUntil:'commit'});
   await p.waitForFunction(()=>document.querySelector('#joinServer').textContent==='Retry loading',{},{timeout:8000});
   assert.equal(await p.locator('#joinServer').isEnabled(),true);
   await p.unroute(match);await p.click('#joinServer');await enter(p);await p.close();
   console.log(`PASS ${name} failure exposes working retry and recovers without page reload`);
  }
  const slow=await page();await slow.route('https://bash.tv/bash/v1.js',r=>r.abort());
  await slow.route(`**/assets/${meta.foreground[0]}*`,async r=>{await new Promise(resolve=>setTimeout(resolve,23000));await r.continue();});
  await slow.goto(baseURL,{waitUntil:'commit'});
  await slow.waitForFunction(()=>document.querySelector('#serverMessage').textContent.includes('front layer'));
  await slow.click('#joinServer',{timeout:35000});await enter(slow);
  const asset=await slow.evaluate(file=>templeDebug().assets.find(a=>a.path.endsWith(file)),meta.foreground[0]);
  assert.equal(asset.state,'ready');assert.equal(asset.attempt,1);await slow.close();
  console.log('PASS a 23-second image download succeeds on its first attempt instead of hitting the old 20-second deadline');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
