/* Local movement/collisions at render cadence. Server uses only world bounds and safe spawning. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TemplePhysics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DT = 1 / 60, RADIUS = 14, SPEED = 280, JUMP_SPEED = 410, GRAVITY = 920;
  // Derive animation progress from the rendered jump pose, including buffered remote poses.
  // Height plus ascent/descent avoids rewinding when a landing snapshot resets vz to zero.
  function jumpProgress(p){
    const edge=Math.sqrt(Math.max(0,1-Math.max(0,p.z)*2*GRAVITY/(JUMP_SPEED*JUMP_SPEED)));
    return (1+(p.vz>0?-edge:edge))/2;
  }
  function inside(x, y, points) {
    let c = false;
    for (let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[i],b=points[j];
      if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) c=!c;
    }
    return c;
  }
  function world(data) {
    const width=data.map.worldWidth, height=data.map.sourceHeight*width/data.map.sourceWidth;
    const polygons=data.colliders.map(c=>c.points);
    const bounds=polygons.map(p=>({minX:Math.min(...p.map(v=>v[0]))-RADIUS,maxX:Math.max(...p.map(v=>v[0]))+RADIUS,minY:Math.min(...p.map(v=>v[1]))-RADIUS,maxY:Math.max(...p.map(v=>v[1]))+RADIUS}));
    function blocked(x,y) {
      if(x<RADIUS||y<RADIUS||x>width-RADIUS||y>height-RADIUS)return true;
      for(let n=0;n<polygons.length;n++) {
        const b=bounds[n],p=polygons[n];
        if(x<b.minX||x>b.maxX||y<b.minY||y>b.maxY)continue;
        if(inside(x,y,p))return true;
        // Circle/edge intersection also catches thin polygons missed by point sampling.
        for(let i=0;i<p.length;i++) {
          const a=p[i],b=p[(i+1)%p.length],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
          const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l)):0;
          if((x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2<RADIUS*RADIUS)return true;
        }
      }
      return false;
    }
    // Swept player circle: a remote interpolation chord must not cross even a thin wall.
    function pathBlocked(ax,ay,bx,by){
      if(blocked(ax,ay)||blocked(bx,by))return true;
      const dist=(x,y,cx,cy,dx,dy)=>{const vx=dx-cx,vy=dy-cy,l=vx*vx+vy*vy,t=l?Math.max(0,Math.min(1,((x-cx)*vx+(y-cy)*vy)/l)):0;return (x-cx-t*vx)**2+(y-cy-t*vy)**2;};
      for(let n=0;n<polygons.length;n++){
        const box=bounds[n];if(Math.max(ax,bx)<box.minX||Math.min(ax,bx)>box.maxX||Math.max(ay,by)<box.minY||Math.min(ay,by)>box.maxY)continue;
        const points=polygons[n];
        for(let i=0;i<points.length;i++){
          const [cx,cy]=points[i],[dx,dy]=points[(i+1)%points.length],rx=bx-ax,ry=by-ay,sx=dx-cx,sy=dy-cy,den=rx*sy-ry*sx;
          if(Math.abs(den)>1e-9){const t=((cx-ax)*sy-(cy-ay)*sx)/den,u=((cx-ax)*ry-(cy-ay)*rx)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return true;}
          if(Math.min(dist(ax,ay,cx,cy,dx,dy),dist(bx,by,cx,cy,dx,dy),dist(cx,cy,ax,ay,bx,by),dist(dx,dy,ax,ay,bx,by))<RADIUS*RADIUS)return true;
        }
      }
      return false;
    }
    function nearest(x,y) {
      let best=null,distance=Infinity;
      for(const poly of polygons)for(let i=0;i<poly.length;i++) {
        const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
        if(!l2)continue;
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l2)),ox=x-a[0]-dx*t,oy=y-a[1]-dy*t,d=ox*ox+oy*oy;
        if(d<distance){distance=d;const l=Math.sqrt(l2),dist=Math.sqrt(d);best={tx:dx/l,ty:dy/l,nx:dist?ox/dist:-dy/l,ny:dist?oy/dist:dx/l};}
      }
      return best;
    }
    function step(p,input,dt=DT) {
      let x=input.x,y=input.y;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}
      const blend=1-Math.exp(-(m?13:10)*dt);
      p.vx+=(x*SPEED-p.vx)*blend;p.vy+=(y*SPEED-p.vy)*blend;
      const dx=p.vx*dt,dy=p.vy*dt,startX=p.x,startY=p.y;
      const nx=Math.max(RADIUS,Math.min(width-RADIUS,startX+dx)),ny=Math.max(RADIUS,Math.min(height-RADIUS,startY+dy));
      let movedX=Math.abs(dx)<.001,movedY=Math.abs(dy)<.001,slid=false;
      if(!blocked(nx,ny)){p.x=nx;p.y=ny;movedX=movedY=true;}
      else {
        const edge=nearest(startX,startY);
        if(edge){const amount=dx*edge.tx+dy*edge.ty;if(Math.abs(amount)>.001){const v=p.vx*edge.tx+p.vy*edge.ty;for(const offset of [0,.5,1,2,3]){
          const sx=startX+edge.tx*amount+edge.nx*offset,sy=startY+edge.ty*amount+edge.ny*offset;
          if(!blocked(sx,sy)){p.x=sx;p.y=sy;p.vx=edge.tx*v;p.vy=edge.ty*v;movedX=movedY=slid=true;break;}
        }}}
        if(!slid){if(Math.abs(dx)>=.001&&!blocked(nx,startY)){p.x=nx;movedX=true;}if(Math.abs(dy)>=.001&&!blocked(p.x,ny)){p.y=ny;movedY=true;}}
      }
      if(!movedX)p.vx=0;if(!movedY)p.vy=0;
      if(input.jump&&p.z===0)p.vz=JUMP_SPEED;
      if(p.z>0||p.vz>0){p.vz-=GRAVITY*dt;p.z+=p.vz*dt;if(p.z<=0){p.z=0;p.vz=0;}}
      p.moving=Math.hypot(p.vx,p.vy)>9;
      if(Math.abs(p.vx)>5)p.facing=p.vx<0?-1:1;
      return p;
    }
    function spawn(occupied=[]) {
      const [spawnX,spawnY]=data.map.spawn||[540,665];
      const base={x:spawnX*width/data.map.sourceWidth,y:spawnY*width/data.map.sourceWidth};
      for(let ring=0;ring<20;ring++)for(let i=0;i<(ring?16:1);i++){
        const a=i*Math.PI/8,x=base.x+Math.cos(a)*ring*96,y=base.y+Math.sin(a)*ring*96;
        if(!blocked(x,y)&&occupied.every(p=>Math.hypot(p.x-x,p.y-y)>90))return {x,y,vx:0,vy:0,z:0,vz:0,facing:1,moving:false,radius:RADIUS};
      }
      throw new Error('No safe spawn available');
    }
    return {width,height,blocked,pathBlocked,step,spawn};
  }
  // Compatibility fingerprint, not an anti-cheat/security signature. Same function runs on both ends.
  function version(data){
    // Increment hazard revision when changing lethal layout/rules, so old tabs must reload.
    const text=JSON.stringify({physics:1,hazards:1,data});let a=2166136261,b=3339675911;
    for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,2246822519);}
    return 'world-v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  return {DT,RADIUS,SPEED,world,version,jumpProgress};
});
