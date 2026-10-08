const test=require('node:test'),assert=require('node:assert/strict'),P=require('../physics.js');
const world=P.world(require('../assets/twin-temple-colliders.json'));
test('jump animation plays all eight frames in order and restarts on every jump at 30/60/144 fps',()=>{
 for(const fps of [30,60,144]){
  const p=world.spawn();
  for(let jump=0;jump<2;jump++){
   const frames=[];let first=true;
   do{
    const dt=Math.min(1/fps,.04),steps=Math.ceil(dt/P.DT);
    for(let i=0;i<steps;i++){world.step(p,{x:0,y:0,jump:first},dt/steps);first=false;}
    if(p.z>0)frames.push(Math.min(7,Math.floor(P.jumpProgress(p)*8)));
   }while(p.z>0);
   assert.deepEqual([...new Set(frames)],[0,1,2,3,4,5,6,7],String(fps));
   assert(frames.every((v,i)=>!i||v>=frames[i-1]));assert.equal(p.vz,0);
  }
 }
});
test('remote landing velocity reset holds the final jump frame rather than rewinding to the apex',()=>{
 assert.equal(Math.min(7,Math.floor(P.jumpProgress({z:1,vz:0})*8)),7);
 for(const z of [1,50,90,500])for(const vz of [-410,0,410])assert(P.jumpProgress({z,vz})>=0&&P.jumpProgress({z,vz})<=1);
});
