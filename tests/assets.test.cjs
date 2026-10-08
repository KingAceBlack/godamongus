const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const Assets=require('../assets.js');
const realFetch=global.fetch,realImage=global.Image;
class TestImage{async decode(){this.naturalWidth=100;}}
afterEach(()=>{global.fetch=realFetch;global.Image=realImage;});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('progressing downloads may take longer than the stall timeout; successful images are reused',async()=>{
 global.Image=TestImage;let calls=0;
 global.fetch=async()=>{calls++;return new Response(new ReadableStream({async start(controller){for(let i=0;i<8;i++){await pause(30);controller.enqueue(new Uint8Array([1,2]));}controller.close();}}),{headers:{'Content-Length':'16','Content-Type':'image/webp'}});};
 const assets=new Assets({idleTimeout:120});await assets.load(new Image(),'assets/slow.webp','Slow image');await assets.load(new Image(),'assets/slow.webp','Slow image');
 assert.equal(calls,1);assert.equal(assets.items.get('assets/slow.webp').received,16);assert.equal(assets.items.get('assets/slow.webp').attempt,1);
});
test('a genuinely stalled request is aborted and retried automatically',async()=>{
 global.Image=TestImage;let calls=0,aborted=false;
 global.fetch=async(url,{signal})=>{if(++calls>1)return new Response('image');return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));}));};
 const assets=new Assets({idleTimeout:20});await assets.load(new Image(),'assets/stalled.webp','Foreground');
 assert(aborted);assert.equal(calls,2);assert.equal(assets.items.get('assets/stalled.webp').state,'ready');
});
test('failed requests name the file and HTTP error, and manual retry starts cleanly',async()=>{
 global.Image=TestImage;global.fetch=async()=>new Response('',{status:503});const assets=new Assets();
 await assert.rejects(assets.load(new Image(),'assets/front.webp','Front layer'),/Front layer \(front.webp\): HTTP 503/);
 global.fetch=async()=>new Response('image');await assets.load(new Image(),'assets/front.webp','Front layer');assert.equal(assets.items.get('assets/front.webp').state,'ready');
});
test('downloads are limited to two concurrent requests',async()=>{
 global.Image=TestImage;let active=0,peak=0;
 global.fetch=async()=>{peak=Math.max(peak,++active);await pause(20);active--;return new Response('image');};
 const assets=new Assets();await Promise.all(Array.from({length:6},(_,i)=>assets.load(new Image(),`assets/${i}.webp`,'Image')));assert.equal(peak,2);
});
test('decode errors report the specific file instead of a generic loading timeout',async()=>{
 global.Image=class{async decode(){throw new Error('invalid image data');}};global.fetch=async()=>new Response('corrupt');
 await assert.rejects(new Assets().load(new Image(),'assets/bad.webp','Guardian'),/Guardian \(bad.webp\): invalid image data/);
});
