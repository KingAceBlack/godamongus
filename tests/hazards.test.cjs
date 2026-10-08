const test=require('node:test'),assert=require('node:assert/strict'),Hazards=require('../hazards.js'),Physics=require('../physics.js'),maps=require('../maps.js');
const meta={center:[100,100],size:100,frames:2,fps:12},alpha=new Uint8Array(200*100);
for(let y=0;y<100;y++)alpha[y*200+50]=255;
const blade=Hazards.create(meta,alpha,200,100,1);
test('hazard uses animated opaque pixels, not transparent corners or the whole frame',()=>{
 assert(blade.hit({x:100,y:100},{x:100,y:100},14,0));
 assert(!blade.hit({x:55,y:55},{x:55,y:55},14,0));
 assert(!blade.hit({x:100,y:100},{x:100,y:100},14,1));
 assert(!blade.hit({x:100,y:300},{x:100,y:300},14,0));
 assert.equal(blade.frame(0),0);assert.equal(blade.frame(1/12),1);assert.equal(blade.frame(2/12),0);
});
test('swept contact catches crossing a thin blade even with clear endpoints',()=>{
 assert(blade.hit({x:20,y:100},{x:180,y:100},14,0));
 assert(!blade.hit({x:20,y:140},{x:180,y:140},14,1));
});
test('second-room hazard is reachable and first-room respawn is safe',()=>{
 const map=maps['solar-temple'],data=require('../assets/twin-temple-colliders.json');
 const world=Physics.world({...data,map:{...data.map,spawn:map.spawn}}),h=map.hazards[0],s=map.worldWidth/map.sourceWidth;
 assert(!world.blocked(h.center[0]*s,h.center[1]*s));
 assert(!world.blocked(h.center[0]*s-220,h.center[1]*s));
 const spawn=world.spawn();assert(!world.blocked(spawn.x,spawn.y));
 assert(Math.hypot(spawn.x-h.center[0]*s,spawn.y-h.center[1]*s)>h.size+1000);
 assert.equal(data.colliders.length,16);assert.equal(data.colliders.reduce((n,p)=>n+p.points.length,0),211);
});
