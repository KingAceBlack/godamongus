(() => {
  'use strict';
  const $=s=>document.querySelector(s),canvas=$('#world'),ctx=canvas.getContext('2d',{alpha:false}),minimap=$('#minimap'),miniCtx=minimap.getContext('2d');
  // Temporarily disabled. Set true to restore the existing local editor and its entry points.
  const EDITOR_ENABLED=false;
  for(const id of ['lobbyEditor','editorToggle','panel'])$('#'+id).hidden=!EDITOR_ENABLED;
  let PLAYER_NAME='Wanderer';const miniBase=document.createElement('canvas');miniBase.width=minimap.width;miniBase.height=minimap.height;
  let map=new Image(),foreground=[],activeMap='solar-temple',sceneData=null,sceneEpoch=0;
  const scenes=new Map(),drafts=new Map();
  let hazards=[],death=null,deaths=0,respawnFlash=0;const DEATH_SECONDS=.65;
  const characters=Object.fromEntries(Object.entries(TempleCharacters).map(([id,meta])=>[id,{...meta,idleImage:new Image(),walkImage:new Image(),jumpImage:meta.jump?new Image():null}]));
  let WORLD_W=2600;const FRAMES=8;
  let sourceW=1585,sourceH=992,worldScale=WORLD_W/sourceW,worldH=sourceH*worldScale,ready=false;
  let W=0,H=0,dpr=1,last=performance.now(),clock=0,zoom=.75,targetZoom=.75,used=false,joined=false,hasEntered=false,selectedCharacter=null;
  const player={x:540*worldScale,y:665*worldScale,vx:0,vy:0,z:0,vz:0,facing:1,moving:false,radius:14};
  const camera={x:player.x,y:player.y},keys=new Set(),touchMove={x:0,y:0,pointer:null};let moveTarget=null,lastTap=0;
  const net=new TempleNetwork();let physicsWorld=null,jumpRequested=false,remoteRender=[],selecting=false;
  const editor={open:false,tool:'select',polygons:[],draft:[],selected:-1,dragPoint:-1,panning:false,pointer:null,lastX:0,lastY:0,contacts:[],hitPolygon:-1,hitTimer:0};

  function resize(){W=innerWidth;H=innerHeight;dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);canvas.style.width=W+'px';canvas.style.height=H+'px';ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';}
  addEventListener('resize',resize,{passive:true});resize();
  const assetLoader=new TempleAssets({onProgress:items=>{
    if(ready)return;
    const item=items.find(i=>i.state==='downloading'||i.state==='decoding'||i.state==='retrying');if(!item)return;
    const progress=item.total?`${Math.min(100,Math.round(item.received/item.total*100))}%`:`${Math.round(item.received/1024)} KB`;
    const text=`${item.attempt>1?'Retrying':'Loading'} ${item.label} · ${item.state==='decoding'?'decoding':progress}`;
    $('#serverMessage').textContent=text;if(selecting)$('#selectionStatus').textContent=text;
  }});
  function showLoadFailure(error){
    ready=false;$('#joinServer').disabled=false;$('#joinServer').textContent='Retry loading';$('#lobbyEditor').disabled=true;
    $('#serverMessage').textContent=error.name==='AbortError'?'Map loading timed out. Please retry.':error.message;
    $('#status').textContent=$('#serverMessage').textContent;updateEnterButton();
  }
  function saveDraft(){if(sceneData)drafts.set(activeMap,editor.polygons.map(p=>p.map(v=>[...v])));}
  function rebuildPhysics(){if(sceneData)physicsWorld=TemplePhysics.world({...sceneData,colliders:editor.polygons.map(points=>({points}))});}
  async function loadScene(id,useDraft=false,retry=false){
    if(!Object.hasOwn(TempleMaps,id))return false;
    const epoch=++sceneEpoch,meta=TempleMaps[id];
    if(editor.open&&ready)saveDraft();ready=false;
    $('#joinServer').disabled=true;$('#lobbyEditor').disabled=true;$('#editorArea').disabled=true;updateEnterButton();
    try{
      let scene=scenes.get(id);
      if(!scene){
        const image=new Image(),layers=meta.foreground.map(()=>new Image()),hazardImages=(meta.hazards||[]).map(()=>new Image());
        const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),20000);let data;
        try{
          const response=await fetch(`assets/${meta.colliders}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('Map data could not load. Please retry.');
          data=await response.json();
        }finally{clearTimeout(deadline);}
        data.map.spawn=meta.spawn;
        await Promise.all([assetLoader.load(image,`assets/${meta.image}`,'temple map'),...layers.map((im,i)=>assetLoader.load(im,`assets/${meta.foreground[i]}`,'front layer')),...hazardImages.map((im,i)=>assetLoader.load(im,`assets/${meta.hazards[i].image}`,meta.hazards[i].name))]);scene={image,layers,data,hazards:hazardImages.map((im,i)=>TempleHazards.fromImage(meta.hazards[i],im,meta.worldWidth/meta.sourceWidth))};scenes.set(id,scene);
      }
      if(epoch!==sceneEpoch)return false;
      map=scene.image;foreground=scene.layers;hazards=scene.hazards;death=null;respawnFlash=0;sceneData=scene.data;activeMap=id;net.mapId=id;
      net.configureWorld(TemplePhysics.world(sceneData),TemplePhysics.version(sceneData));
      WORLD_W=meta.worldWidth;sourceW=map.naturalWidth;sourceH=map.naturalHeight;worldScale=WORLD_W/sourceW;worldH=sourceH*worldScale;
      editor.polygons=(useDraft&&drafts.has(id)?drafts.get(id):sceneData.colliders.map(c=>c.points)).map(p=>p.map(v=>[...v]));
      editor.draft=[];editor.selected=-1;editor.dragPoint=-1;editor.contacts=[];rebuildPhysics();
      let spawn;try{spawn=physicsWorld.spawn();}catch{spawn={x:meta.spawn[0]*worldScale,y:meta.spawn[1]*worldScale,vx:0,vy:0,z:0,vz:0,moving:false,facing:1};}
      Object.assign(player,spawn,{mapId:id});camera.x=player.x;camera.y=player.y;clearInput();
      miniBase.height=minimap.height=Math.round(minimap.width*sourceH/sourceW);
      document.documentElement.style.setProperty('--mini-height-desktop',`${220*sourceH/sourceW}px`);
      document.documentElement.style.setProperty('--mini-height-mobile',`${145*sourceH/sourceW}px`);
      const mg=miniBase.getContext('2d');mg.clearRect(0,0,miniBase.width,miniBase.height);mg.drawImage(map,0,0,miniBase.width,miniBase.height);for(const image of foreground)mg.drawImage(image,0,0,miniBase.width,miniBase.height);
      $('#editorArea').value='world';$('#editorMapName').textContent=meta.name;$('.minimap span').textContent=meta.name.toUpperCase();
      ready=true;$('#joinServer').disabled=false;$('#lobbyEditor').disabled=false;$('#editorArea').disabled=false;refreshUI();updateEnterButton();if(editor.open)fitMap();return true;
    }catch(error){if(epoch===sceneEpoch){showLoadFailure(error);$('#editorArea').disabled=false;}return false;}
  }
  let assetLoading=null;
  function initializeGame(retry=false){
    if(assetLoading)return assetLoading;
    $('#joinServer').disabled=true;$('#joinServer').textContent='Loading…';$('#lobbyEditor').disabled=true;$('#serverMessage').textContent='Loading temple…';
    const sprites=Object.entries(characters).flatMap(([id,skin])=>[
      [skin.idleImage,skin.idle,skin.name,id],[skin.walkImage,skin.walk,skin.name+' walk',null],
      ...(skin.jump?[[skin.jumpImage,skin.jump,skin.name+' jump',null]]:[])
    ]);
    assetLoading=(async()=>{
      try{
        await Promise.all(sprites.map(async([image,file,label,id])=>{
          await assetLoader.load(image,`assets/${file}`,label);
          if(id)document.querySelector(`[data-character="${id}"] .portrait img`).src=image.src;
        }));
        if(!await loadScene(activeMap,false,retry))return false;
        $('#joinServer').textContent='Join server';$('#serverMessage').textContent='No account needed. You’ll receive a random traveler name.';return true;
      }catch(error){showLoadFailure(error);return false;}finally{assetLoading=null;}
    })();
    return assetLoading;
  }
  initializeGame();

  function inside(x,y,points){let c=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
  function blocked(x,y,record=false){
    for(let pi=0;pi<editor.polygons.length;pi++){
      const p=editor.polygons[pi];
      if(inside(x,y,p)){if(record){editor.contacts.push([x,y]);editor.hitPolygon=pi;editor.hitTimer=.16;}return true;}
      for(let i=0;i<12;i++){const a=i*Math.PI/6,cx=x+Math.cos(a)*player.radius,cy=y+Math.sin(a)*player.radius;if(inside(cx,cy,p)){if(record){editor.contacts.push([cx,cy]);editor.hitPolygon=pi;editor.hitTimer=.16;}return true;}}
    }
    return false;
  }
  function nearestColliderEdge(x,y){let best=null,bestD=Infinity;for(const poly of editor.polygons)for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l2)),qx=a[0]+dx*t,qy=a[1]+dy*t,ox=x-qx,oy=y-qy,d=ox*ox+oy*oy;if(d<bestD){const l=Math.sqrt(l2),distance=Math.sqrt(d);bestD=d;best={tx:dx/l,ty:dy/l,nx:distance?ox/distance:-dy/l,ny:distance?oy/distance:dx/l};}}return best;}
  function clampCamera(){if(editor.open&&editor.tool!=='test')return;const hx=W/(2*zoom),hy=H/(2*zoom);camera.x=hx*2>=WORLD_W?WORLD_W/2:Math.max(hx,Math.min(WORLD_W-hx,camera.x));camera.y=hy*2>=worldH?worldH/2:Math.max(hy,Math.min(worldH-hy,camera.y));}
  function screenToWorld(x,y){return{x:(x-W/2)/zoom+camera.x,y:(y-H/2)/zoom+camera.y};}
  function setZoom(v){const min=editor.open ? .04 : .1;targetZoom=Math.max(min,Math.min(1.6,v));$('#mapZoomLevel').value=`${Math.round(targetZoom*100)}%`;$('#mapZoomOut').disabled=targetZoom<=min;$('#mapZoomIn').disabled=targetZoom>=1.6;}
  $('#mapZoomOut').onclick=()=>{setZoom(targetZoom/1.15);markUsed();canvas.focus({preventScroll:true});};
  $('#mapZoomIn').onclick=()=>{setZoom(targetZoom*1.15);markUsed();canvas.focus({preventScroll:true});};
  function markUsed(){if(used)return;used=true;setTimeout(()=>$('#hint').classList.add('hidden'),700);}
  function jump(){if(joined&&!selecting&&player.z===0){jumpRequested=true;markUsed();}}

  function die(hazard){
    if(death||editor.open)return;
    death={remaining:DEATH_SECONDS,hazard:hazard.id};deaths++;clearInput();moveTarget=null;
    Object.assign(player,{vx:0,vy:0,vz:0,z:0,moving:false});net.publish(player,true);
    showJoinToast('Defeated by the Sunblade · returning to the entrance');
  }
  function respawn(){
    Object.assign(player,physicsWorld.spawn());death=null;respawnFlash=.45;clearInput();moveTarget=null;
    camera.x=player.x;camera.y=player.y;clampCamera();net.publish(player,true);
    showJoinToast('Respawned in the entrance chamber');
  }
  function update(dt){
    if(!ready)return;clock+=dt;respawnFlash=Math.max(0,respawnFlash-dt);remoteRender=editor.open?[]:net.sample();
    if(!joined)return;
    if(death){death.remaining-=dt;if(death.remaining<=0)respawn();else net.publish(player);return;}
    zoom+=(targetZoom-zoom)*(1-Math.exp(-12*dt));
    if(editor.open&&editor.tool!=='test'){
      const speed=700/zoom;let x=0,y=0;
      if(keys.has('KeyA')||keys.has('ArrowLeft'))x--;if(keys.has('KeyD')||keys.has('ArrowRight'))x++;
      if(keys.has('KeyW')||keys.has('ArrowUp'))y--;if(keys.has('KeyS')||keys.has('ArrowDown'))y++;
      camera.x+=x*speed*dt;camera.y+=y*speed*dt;clampCamera();return;
    }
    let x=0,y=0;
    if(!selecting&&!document.hidden){
      if(keys.has('KeyA')||keys.has('ArrowLeft'))x--;if(keys.has('KeyD')||keys.has('ArrowRight'))x++;
      if(keys.has('KeyW')||keys.has('ArrowUp'))y--;if(keys.has('KeyS')||keys.has('ArrowDown'))y++;
      x+=touchMove.x;y+=touchMove.y;
    }
    const magnitude=Math.hypot(x,y);if(magnitude>1){x/=magnitude;y/=magnitude;}
    // Simulate each rendered frame, not at the network tick. Small substeps retain collision accuracy.
    const steps=Math.max(1,Math.ceil(dt/(1/60)));
    for(let i=0;i<steps;i++){
      const before={x:player.x,y:player.y};
      physicsWorld.step(player,{x,y,jump:jumpRequested},dt/steps);jumpRequested=false;
      if(!editor.open){const hit=hazards.find(h=>h.hit(before,player,player.radius,h.frame()));if(hit){die(hit);break;}}
    }
    if(editor.open){
      editor.contacts=[];editor.hitPolygon=-1;editor.hitTimer=0;
      if(x||y)blocked(player.x+x*20,player.y+y*20,true);
      updateCollisionReadout();
    }else net.publish(player); // Editor drafts never enter the shared world.
    camera.x+=(player.x-camera.x)*(1-Math.exp(-7*dt));camera.y+=(player.y-camera.y)*(1-Math.exp(-7*dt));clampCamera();
  }

  function worldTransform(){ctx.translate(W/2,H/2);ctx.scale(zoom,zoom);ctx.translate(-camera.x,-camera.y);}
  function path(points,close=true){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));if(close)ctx.closePath();}
  function drawLayer(image){
    // Crop to the camera before scaling: larger worlds must not resample the entire atlas every frame.
    const left=Math.max(0,camera.x-W/(2*zoom)-2),top=Math.max(0,camera.y-H/(2*zoom)-2);
    const right=Math.min(WORLD_W,camera.x+W/(2*zoom)+2),bottom=Math.min(worldH,camera.y+H/(2*zoom)+2);
    if(right<=left||bottom<=top)return;
    ctx.drawImage(image,left/worldScale,top/worldScale,(right-left)/worldScale,(bottom-top)/worldScale,left,top,right-left,bottom-top);
  }
  function draw(){
    ctx.fillStyle='#050505';ctx.fillRect(0,0,W,H);if(!ready)return;ctx.save();worldTransform();drawLayer(map);drawHazards();
    if(moveTarget&&!editor.open){const p=.5+.5*Math.sin(clock*5);ctx.strokeStyle=`rgba(255,202,72,${.45+p*.4})`;ctx.lineWidth=2/zoom;ctx.beginPath();ctx.arc(moveTarget.x,moveTarget.y,10+p*5,0,Math.PI*2);ctx.stroke();}
    const visible=joined?[player,...remoteRender].sort((a,b)=>a.y-b.y):[];
    const drawCharacter=(p,part)=>{ctx.save();if(p===player&&death)ctx.globalAlpha=Math.max(0,death.remaining/DEATH_SECONDS);drawPlayer(p,part);ctx.restore();};
    // Shadows stay on the floor. Airborne bodies render above all world foreground layers.
    visible.forEach(p=>drawCharacter(p,p.z>0?'shadow':'all'));
    for(const image of foreground)drawLayer(image);
    visible.filter(p=>p.z>0).forEach(p=>drawCharacter(p,'body'));
    // Landing (z === 0) automatically restores normal ground-depth ordering next frame.
    visible.filter(p=>p!==player||!death).forEach(drawNameTag);drawEditor();ctx.restore();drawMinimap();
    if(death||respawnFlash){ctx.fillStyle=death?`rgba(180,20,10,${.13*death.remaining/DEATH_SECONDS})`:`rgba(255,207,116,${.15*respawnFlash/.45})`;ctx.fillRect(0,0,W,H);}
  }
  function drawHazards(){
    for(const h of hazards){const fw=h.image.naturalWidth/h.frames;ctx.save();ctx.fillStyle='rgba(12,5,2,.3)';ctx.beginPath();ctx.ellipse(h.x,h.y+12,h.width*.38,h.height*.25,0,0,Math.PI*2);ctx.fill();ctx.drawImage(h.image,h.frame()*fw,0,fw,h.image.naturalHeight,h.x-h.width/2,h.y-h.height/2,h.width,h.height);ctx.restore();}
  }
  function drawNameTag(p){ctx.save();ctx.translate(p.x,p.y-p.z-105);ctx.scale(1/zoom,1/zoom);ctx.font='700 11px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const label=p.name||PLAYER_NAME,w=ctx.measureText(label).width+16;ctx.fillStyle='rgba(10,8,8,.82)';ctx.beginPath();ctx.roundRect(-w/2,-10,w,20,7);ctx.fill();ctx.strokeStyle=p===player?'rgba(255,211,123,.65)':'rgba(104,225,227,.65)';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle=p===player?'#fff3d2':'#b7f7fa';ctx.fillText(label,0,.5);ctx.restore();}
  function drawMinimap(){const w=minimap.width,h=minimap.height,sx=w/WORLD_W,sy=h/worldH;miniCtx.clearRect(0,0,w,h);miniCtx.drawImage(miniBase,0,0);miniCtx.strokeStyle='#67eef6';miniCtx.lineWidth=1;miniCtx.strokeRect((camera.x-W/(2*zoom))*sx,(camera.y-H/(2*zoom))*sy,W/zoom*sx,H/zoom*sy);miniCtx.fillStyle='#5af3fa';miniCtx.shadowColor='#41eaf4';miniCtx.shadowBlur=6;miniCtx.beginPath();miniCtx.arc(player.x*sx,player.y*sy,3.2,0,Math.PI*2);miniCtx.fill();miniCtx.shadowBlur=0;miniCtx.fillStyle='#ffbd62';for(const p of remoteRender){miniCtx.beginPath();miniCtx.arc(p.x*sx,p.y*sy,2.5,0,Math.PI*2);miniCtx.fill();}}
  function drawPlayer(p,part='all'){const skin=characters[p.character]||characters['sun-priestess'],jumping=p.z>0&&skin.jumpImage,sprite=jumping?skin.jumpImage:p.moving?skin.walkImage:skin.idleImage;if(!sprite.naturalWidth)return;const fw=sprite.naturalWidth/FRAMES,frame=jumping?Math.min(FRAMES-1,Math.floor(TemplePhysics.jumpProgress(p)*FRAMES)):Math.floor(clock*(p.moving?10:5))%FRAMES,size=112,j=Math.min(1,p.z/85);if(part!=='body'){ctx.fillStyle=`rgba(10,6,5,${.34-j*.15})`;ctx.beginPath();ctx.ellipse(p.x,p.y+2,32-j*7,9-j*2,0,0,Math.PI*2);ctx.fill();}if(part==='shadow')return;ctx.save();ctx.translate(p.x,p.y-p.z);ctx.scale(p.facing,1);ctx.drawImage(sprite,frame*fw,0,fw,sprite.naturalHeight,-size/2,-size*.88,size,size);ctx.restore();}
  function handle(x,y,first=false){ctx.beginPath();ctx.arc(x,y,(first?7:5)/zoom,0,Math.PI*2);ctx.fillStyle=first?'#fff':'#071215';ctx.fill();ctx.strokeStyle=first?'#60f0fb':'#ff687d';ctx.lineWidth=2/zoom;ctx.stroke();}
  function drawEditor(){if(!editor.open)return;ctx.lineJoin='round';editor.polygons.forEach((p,i)=>{const hit=editor.tool==='test'&&i===editor.hitPolygon;path(p);ctx.fillStyle=hit?'#ff183f88':i===editor.selected?'#ff3e5a55':'#ff9b3242';ctx.fill();ctx.strokeStyle=hit?'#fff':i===editor.selected?'#ff6278':'#ffab45';ctx.lineWidth=(hit?4:2)/zoom;ctx.stroke();if(i===editor.selected&&editor.tool!=='test')p.forEach(v=>handle(v[0],v[1]));});if(editor.draft.length){path(editor.draft,false);ctx.strokeStyle='#58effa';ctx.lineWidth=2/zoom;ctx.stroke();editor.draft.forEach((v,i)=>handle(v[0],v[1],i===0));}if(editor.tool==='test')drawCollisionDebug();}
  function drawCollisionDebug(){
    ctx.save();ctx.setLineDash([7/zoom,5/zoom]);ctx.strokeStyle='#5ff5ff';ctx.lineWidth=2/zoom;ctx.beginPath();ctx.arc(player.x,player.y,player.radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5ff5ff';ctx.beginPath();ctx.arc(player.x,player.y,2.5/zoom,0,Math.PI*2);ctx.fill();
    const speed=Math.hypot(player.vx,player.vy);if(speed>3){ctx.strokeStyle='#72f7ff';ctx.lineWidth=2/zoom;ctx.beginPath();ctx.moveTo(player.x,player.y);ctx.lineTo(player.x+player.vx*.18,player.y+player.vy*.18);ctx.stroke();}
    for(const c of editor.contacts){ctx.strokeStyle='#fff';ctx.lineWidth=4/zoom;ctx.beginPath();ctx.arc(c[0],c[1],7/zoom,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ff244c';ctx.beginPath();ctx.arc(c[0],c[1],5/zoom,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ff244c';ctx.lineWidth=1.5/zoom;ctx.beginPath();ctx.moveTo(player.x,player.y);ctx.lineTo(c[0],c[1]);ctx.stroke();}ctx.restore();}
  function frame(t){const dt=Math.min((t-last)/1000,.04);last=t;update(dt);draw();const preview=$('#selectedPreview');if(preview&&preview.getAttribute('src'))preview.style.transform=`translateX(-${(Math.floor(t/150)%8)*12.5}%)`;requestAnimationFrame(frame);}requestAnimationFrame(frame);

  function updateCollisionReadout(){const el=$('#collisionReadout'),hit=editor.hitTimer>0&&editor.hitPolygon>=0;el.classList.toggle('hit',hit);el.innerHTML=hit?`COLLIDING: COLLIDER ${editor.hitPolygon+1}<small>Red marker: blocked contact point</small>`:'CLEAR<small>Cyan circle: player collider</small>';}
  function setTool(tool){if(tool==='test'){
    rebuildPhysics();if(physicsWorld.blocked(player.x,player.y)){try{Object.assign(player,physicsWorld.spawn());}catch{toast('Player is inside a collider. Use Place test player.');return;}}
    clearInput();setZoom(Math.max(.6,targetZoom));
  }editor.tool=tool;editor.contacts=[];editor.hitPolygon=-1;moveTarget=null;document.body.classList.toggle('testing',tool==='test');$('#selectTool').classList.toggle('active',tool==='select');$('#drawTool').classList.toggle('active',tool==='draw');$('#panTool').classList.toggle('active',tool==='pan');$('#testTool').classList.toggle('active',tool==='test');$('#collisionReadout').classList.toggle('show',tool==='test');$('#returnEditor').classList.toggle('show',tool==='test');if(editor.open)$('#panel').classList.toggle('open',tool!=='test');if(tool==='test')updateCollisionReadout();canvas.style.cursor=['draw','spawn'].includes(tool)?'crosshair':tool==='pan'?'grab':'default';refreshUI();if(tool==='spawn')$('#status').textContent='Click or tap a clear point to place the test player';canvas.focus();}
  function fitMap(){
    if(!ready)return;const side=W>760?400:0,bottom=W<=760?H*.45:0;
    setZoom(Math.min((W-side-36)/WORLD_W,(H-bottom-100)/worldH));zoom=targetZoom;
    camera.x=WORLD_W/2+side/(2*zoom);camera.y=worldH/2+(bottom/2-30)/zoom;
  }
  function openEditor(){
    if(!EDITOR_ENABLED||!ready)return;editor.open=true;net.leave();hasEntered=false;joined=true;selecting=false;remoteRender=[];moveTarget=null;clearInput();
    player.id='local-editor';player.name='Editor preview';player.character=selectedCharacter||player.character||'sun-priestess';
    if(drafts.has(activeMap))editor.polygons=drafts.get(activeMap).map(p=>p.map(v=>[...v]));
    rebuildPhysics();document.body.classList.add('editor-open','in-world');$('#serverGate').hidden=true;$('#joinFlow').classList.add('hidden');$('#roomHud').hidden=true;$('#editorBanner').hidden=false;
    $('#editorMapName').textContent=TempleMaps[activeMap].name;$('#panel').classList.add('open');setTool('select');fitMap();canvas.focus();
  }
  async function closeEditor(){
    saveDraft();editor.open=false;editor.dragPoint=-1;editor.panning=false;document.body.classList.remove('editor-open','testing');$('#panel').classList.remove('open');$('#editorBanner').hidden=true;$('#collisionReadout').classList.remove('show','hit');$('#returnEditor').classList.remove('show');canvas.style.cursor='default';
    leaveWorld();await loadScene(activeMap);setZoom(.75);zoom=targetZoom;
  }
  function finishPolygon(){if(editor.draft.length<3)return;const poly=editor.draft.filter((v,i,a)=>!i||Math.hypot(v[0]-a[i-1][0],v[1]-a[i-1][1])>2);if(poly.length>=3){editor.polygons.push(poly);editor.selected=editor.polygons.length-1;}editor.draft=[];setTool('select');refreshUI();}
  function deletePolygon(i){if(i<0||i>=editor.polygons.length)return;editor.polygons.splice(i,1);if(editor.selected===i)editor.selected=-1;else if(editor.selected>i)editor.selected--;refreshUI();}
  function renderLayers(){const box=$('#layers');if(!editor.polygons.length){box.innerHTML='<div class="empty">No collision polygons. The map is fully open.</div>';return;}box.innerHTML=editor.polygons.map((p,i)=>`<div class="layer ${i===editor.selected?'selected':''}" data-layer="${i}"><span class="swatch"></span><span>Collider ${i+1}</span><small>${p.length} points</small><button data-delete="${i}" title="Delete">×</button></div>`).join('');box.querySelectorAll('[data-layer]').forEach(el=>el.onclick=()=>{editor.selected=Number(el.dataset.layer);setTool('select');refreshUI();});box.querySelectorAll('[data-delete]').forEach(el=>el.onclick=e=>{e.stopPropagation();deletePolygon(Number(el.dataset.delete));});}
  function refreshUI(){if(editor.open&&ready){saveDraft();rebuildPhysics();}const count=editor.polygons.length;$('#status').textContent=editor.tool==='test'?'Testing collisions — use WASD to move':editor.draft.length?`${editor.draft.length} points in unfinished polygon`:count?`${count} active collider${count===1?'':'s'}`:'No colliders — the map is fully open';$('#finishPolygon').disabled=editor.draft.length<3;$('#undoPoint').disabled=!editor.draft.length;$('#deleteSelected').disabled=editor.selected<0;$('#clearAll').disabled=!count&&!editor.draft.length;renderLayers();}
  function nearestHandle(p){if(editor.selected<0)return-1;let best=-1,d=13/zoom;editor.polygons[editor.selected].forEach((v,i)=>{const n=Math.hypot(v[0]-p.x,v[1]-p.y);if(n<d){d=n;best=i;}});return best;}

  canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(targetZoom*(e.deltaY>0?.9:1.1));markUsed();},{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    if(!ready)return;canvas.focus();canvas.setPointerCapture(e.pointerId);const p=screenToWorld(e.clientX,e.clientY);editor.pointer=e.pointerId;editor.lastX=e.clientX;editor.lastY=e.clientY;
    if(!editor.open){const now=performance.now();if(now-lastTap<300){jump();lastTap=0;}else{lastTap=now;markUsed();/* Tap-to-move/pathfinding disabled for now. */}return;}
    if(editor.tool==='test'){markUsed();return;}
    if(editor.tool==='spawn'){if(physicsWorld.blocked(p.x,p.y)){toast('Choose a point outside the colliders.');return;}Object.assign(player,{x:p.x,y:p.y,vx:0,vy:0,z:0,vz:0});setTool('test');return;}
    if(editor.tool==='pan'){editor.panning=true;canvas.style.cursor='grabbing';return;}
    if(editor.tool==='draw'){ if(editor.draft.length>=3&&Math.hypot(p.x-editor.draft[0][0],p.y-editor.draft[0][1])<14/zoom){finishPolygon();return;}editor.draft.push([Math.round(p.x),Math.round(p.y)]);refreshUI();return;}
    const h=nearestHandle(p);if(h>=0){editor.dragPoint=h;return;}editor.selected=-1;for(let i=editor.polygons.length-1;i>=0;i--)if(inside(p.x,p.y,editor.polygons[i])){editor.selected=i;break;}refreshUI();
  });
  canvas.addEventListener('pointermove',e=>{if(editor.pointer!==e.pointerId)return;if(editor.open&&editor.dragPoint>=0&&editor.selected>=0){const p=screenToWorld(e.clientX,e.clientY);editor.polygons[editor.selected][editor.dragPoint]=[Math.round(p.x),Math.round(p.y)];refreshUI();}else if(editor.open&&editor.panning){camera.x-=(e.clientX-editor.lastX)/zoom;camera.y-=(e.clientY-editor.lastY)/zoom;clampCamera();editor.lastX=e.clientX;editor.lastY=e.clientY;}});
  function pointerUp(e){if(editor.pointer!==e.pointerId)return;editor.pointer=null;editor.dragPoint=-1;editor.panning=false;if(editor.open&&editor.tool==='pan')canvas.style.cursor='grab';}canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);

  const joystick=$('#joystick'),joystickStick=$('#joystickStick');
  function updateJoystick(e){const r=joystick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,max=r.width*.3;let dx=e.clientX-cx,dy=e.clientY-cy,d=Math.hypot(dx,dy);if(d>max){dx=dx/d*max;dy=dy/d*max;}touchMove.x=dx/max;touchMove.y=dy/max;joystickStick.style.transform=`translate(${dx}px,${dy}px)`;}
  joystick.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();touchMove.pointer=e.pointerId;moveTarget=null;joystick.setPointerCapture(e.pointerId);updateJoystick(e);markUsed();});
  joystick.addEventListener('pointermove',e=>{if(touchMove.pointer===e.pointerId)updateJoystick(e);});
  function releaseJoystick(e){if(touchMove.pointer!==e.pointerId)return;touchMove.pointer=null;touchMove.x=touchMove.y=0;joystickStick.style.transform='translate(0,0)';}
  joystick.addEventListener('pointerup',releaseJoystick);joystick.addEventListener('pointercancel',releaseJoystick);
  $('#jumpButton').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();jump();e.currentTarget.classList.add('pressed');});
  const releaseJump=e=>e.currentTarget.classList.remove('pressed');$('#jumpButton').addEventListener('pointerup',releaseJump);$('#jumpButton').addEventListener('pointercancel',releaseJump);

  addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName))return;if(editor.open&&e.code==='Enter'){finishPolygon();e.preventDefault();return;}if(editor.open&&e.code==='Escape'){editor.draft=[];setTool('select');refreshUI();return;}if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){keys.add(e.code);if(!editor.open||editor.tool==='test')moveTarget=null;markUsed();e.preventDefault();}if(e.code==='Space'){jump();e.preventDefault();}});addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());

  $('#editorToggle').onclick=openEditor;$('#closeEditor').onclick=closeEditor;$('#returnEditor').onclick=()=>setTool('select');$('#selectTool').onclick=()=>setTool('select');$('#drawTool').onclick=()=>setTool('draw');$('#panTool').onclick=()=>setTool('pan');$('#testTool').onclick=()=>setTool('test');$('#finishPolygon').onclick=finishPolygon;$('#undoPoint').onclick=()=>{editor.draft.pop();refreshUI();};$('#deleteSelected').onclick=()=>deletePolygon(editor.selected);$('#clearAll').onclick=()=>{editor.polygons=[];editor.draft=[];editor.selected=-1;refreshUI();};
  $('#editorArea').onchange=e=>{
    setTool('select');if(e.target.value==='world'){fitMap();return;}
    const area=TempleMaps[activeMap].areas.find(a=>a.id===e.target.value);if(!area)return;
    const side=W>760?400:0,bottom=W<=760?H*.45:0;
    setZoom(Math.min((W-side-36)/(area.size[0]*worldScale),(H-bottom-100)/(area.size[1]*worldScale)));zoom=targetZoom;
    camera.x=area.center[0]*worldScale+side/(2*zoom);camera.y=area.center[1]*worldScale+(bottom/2-30)/zoom;
  };
  $('#lobbyEditor').onclick=openEditor;$('#exitEditor').onclick=closeEditor;$('#fitMap').onclick=()=>{$('#editorArea').value='world';setTool('select');fitMap();};
  $('#placePlayer').onclick=()=>{rebuildPhysics();setTool('spawn');};
  $('#importJson').onclick=()=>$('#colliderFile').click();
  $('#colliderFile').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>2*1024*1024)throw new Error('JSON is too large (2 MB maximum).');
      const data=JSON.parse(await file.text());
      if((data.mapId&&data.mapId!==activeMap)||data.map?.image!==TempleMaps[activeMap].image||data.map?.worldWidth!==WORLD_W)throw new Error('This JSON belongs to a different map.');
      if(!Array.isArray(data.colliders)||data.colliders.length>300)throw new Error('Invalid collider list.');
      let vertices=0;
      const polygons=data.colliders.map(c=>{if(!Array.isArray(c.points)||c.points.length<3||c.points.length>500)throw new Error('Each collider needs 3–500 points.');vertices+=c.points.length;
        return c.points.map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(n=>Number.isFinite(n)&&Math.abs(n)<=WORLD_W*4))throw new Error('Invalid coordinates.');return [...p];});});
      if(vertices>10000)throw new Error('Too many vertices.');
      editor.polygons=polygons;editor.draft=[];editor.selected=-1;setTool('select');toast('Collider draft imported locally');
    }catch(error){toast(error.message);}finally{e.target.value='';}
  };
  function exportJson(){return JSON.stringify({version:1,mapId:activeMap,map:{image:TempleMaps[activeMap].image,worldWidth:WORLD_W,worldHeight:Math.round(worldH),sourceWidth:sourceW,sourceHeight:sourceH,spawn:TempleMaps[activeMap].spawn},coordinateSystem:'world pixels, origin at map top-left',colliders:editor.polygons.map((points,i)=>({id:`collider-${i+1}`,points:points.map(([x,y])=>[Math.round(x),Math.round(y)])}))},null,2);}
  function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('show');clearTimeout(el.timer);el.timer=setTimeout(()=>el.classList.remove('show'),2200);}
  $('#downloadJson').onclick=()=>{const blob=new Blob([exportJson()],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=TempleMaps[activeMap].colliders;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('Collider JSON downloaded');};
  $('#shareJson').onclick=async()=>{const text=TempleMaps[activeMap].name+' collider map:\n```json\n'+exportJson()+'\n```';try{if(window.bash){await window.bash.ready;const result=await window.bash.share({text});if(result&&result.shared){toast('JSON added to chat draft');return;}}await navigator.clipboard.writeText(exportJson());toast('JSON copied to clipboard');}catch(_){toast('Use Download JSON instead');}};
  function showJoinToast(text){const el=$('#joinToast');el.textContent=text;el.classList.add('show');clearTimeout(el.timer);el.timer=setTimeout(()=>el.classList.remove('show'),2600);}
  function clearInput(){keys.clear();touchMove.x=touchMove.y=0;touchMove.pointer=null;jumpRequested=false;joystickStick.style.transform='translate(0,0)';}
  function updateEnterButton(){const b=$('#enterWorld');if(net.requiresReload){b.disabled=false;b.textContent='RELOAD GAME';return;}b.disabled=!ready||!net.connected||!selectedCharacter||net.joining;b.textContent=net.joining?'ENTERING…':!ready?'LOADING…':'CONFIRM CHARACTER';}
  function selectCharacter(character){if(!Object.hasOwn(characters,character))return;const skin=characters[character];selectedCharacter=character;document.querySelectorAll('.character-option').forEach(c=>{const selected=c.dataset.character===character;c.classList.toggle('selected',selected);c.setAttribute('aria-pressed',String(selected));});$('#selectedPreview').src=skin.idleImage.src;$('#showcaseName').textContent=skin.name;$('#guardianRole').textContent=skin.role;updateEnterButton();}
  function openSelection(){selecting=true;clearInput();$('#serverGate').hidden=true;$('#joinFlow').classList.remove('hidden');$('#cancelSelection').textContent=hasEntered?'Cancel':'Back';$('#selectionStatus').textContent='';updateEnterButton();}
  function enterWorld(p){
    const returning=hasEntered;
    if(returning)Object.assign(player,{id:p.id,name:p.name,character:p.character});
    else{Object.assign(player,p);camera.x=p.x;camera.y=p.y;clearInput();clock=0;}
    PLAYER_NAME=p.name;selectedCharacter=p.character;
    hasEntered=true;joined=true;selecting=false;net.publish(player,true);
    $('#serverGate').hidden=true;$('#joinFlow').classList.add('hidden');
    $('#changeCharacter').classList.add('show');$('#roomHud').hidden=false;document.body.classList.add('in-world');
    $('#connectionStatus').textContent='Connected';$('#hint').classList.remove('hidden');used=false;canvas.focus();
    showJoinToast(`${returning?'Reconnected as':'You are'} ${p.name}`);setTimeout(()=>$('#hint').classList.add('hidden'),6500);updateEnterButton();
  }
  function leaveWorld(){
    hasEntered=false;joined=false;selecting=false;death=null;respawnFlash=0;clearInput();remoteRender=[];net.leave();
    document.body.classList.remove('in-world');$('#serverGate').hidden=false;$('#joinFlow').classList.add('hidden');
    $('#roomHud').hidden=true;$('#joinServer').disabled=false;$('#joinServer').textContent='Join server';
    $('#cancelConnection').hidden=true;$('#serverMessage').textContent='No account needed. You’ll receive a random traveler name.';
    refreshLobby();
  }
  async function refreshLobby(){try{const r=await fetch(window.TempleBackend?.statusURL||'/api/status',{cache:'no-store'});if(!r.ok)throw new Error();const s=await r.json();$('#lobbyCount').textContent=`${s.players} / ${s.capacity} online`;}catch{$('#lobbyCount').textContent='Server unavailable';}}
  $('#joinServer').onclick=async()=>{if(net.requiresReload){location.reload();return;}if(!ready&&!await initializeGame(true))return;if(net.connected){if(net.character){net.join(net.character);updateEnterButton();}else openSelection();}else net.connect();};
  $('#cancelConnection').onclick=leaveWorld;$('#leaveServer').onclick=leaveWorld;
  document.querySelectorAll('.character-option').forEach(card=>card.onclick=()=>selectCharacter(card.dataset.character));
  $('#enterWorld').onclick=()=>{if(net.requiresReload){location.reload();return;}if(!ready||!selectedCharacter)return;$('#selectionStatus').textContent='';net.join(selectedCharacter);updateEnterButton();};
  $('#changeCharacter').onclick=()=>{selectCharacter(player.character);openSelection();};
  $('#cancelSelection').onclick=()=>{if(hasEntered){selectCharacter(player.character);selecting=false;$('#joinFlow').classList.add('hidden');clearInput();canvas.focus();}else leaveWorld();};
  net.addEventListener('status',({detail:s})=>{
    if(editor.open)return;
    $('#connectionStatus').textContent=s.text;$('#serverMessage').textContent=s.text;
    if(net.requiresReload){
      joined=false;selecting=false;clearInput();remoteRender=[];document.body.classList.remove('in-world');
      $('#serverGate').hidden=false;$('#joinFlow').classList.add('hidden');$('#roomHud').hidden=true;
      $('#joinServer').disabled=false;$('#joinServer').textContent='Reload game';$('#cancelConnection').hidden=true;updateEnterButton();return;
    }
    if(s.state==='connected'){
      $('#joinServer').disabled=false;$('#joinServer').textContent='Join server';
      if(!net.character)openSelection();
    }else{
      remoteRender=[];$('#latency').textContent='';
      if(hasEntered&&net.wanted){
        // Transport loss must not pause the local game, clear held controls or teleport the player.
        $('#connectionStatus').textContent='Reconnecting · playing locally';$('#roomCount').textContent='Offline';
      }else{
        joined=false;clearInput();$('#serverGate').hidden=false;$('#joinFlow').classList.add('hidden');
        $('#joinServer').disabled=s.state==='connecting';$('#joinServer').textContent=s.state==='connecting'?'Connecting…':net.wanted?'Retry connection':'Join server';
        $('#cancelConnection').hidden=!net.wanted;
      }
    }
    updateEnterButton();
  });
  net.addEventListener('count',({detail:s})=>{$('#roomCount').textContent=`${s.count} online`;$('#lobbyCount').textContent=`${s.count} / ${s.capacity} online`;});
  net.addEventListener('latency',({detail:ms})=>$('#latency').textContent=`${ms} ms`);
  net.addEventListener('notice',({detail:text})=>showJoinToast(text));
  net.addEventListener('joined',({detail:p})=>enterWorld(p));
  net.addEventListener('skin',({detail:p})=>{player.character=p.character;selecting=false;$('#joinFlow').classList.add('hidden');clearInput();updateEnterButton();canvas.focus();showJoinToast('Guardian changed');});
  net.addEventListener('error',({detail:text})=>{$('#selectionStatus').textContent=text;$('#serverMessage').textContent=text;$('#joinServer').disabled=false;if(net.requiresReload)$('#joinServer').textContent='Reload game';showJoinToast(text);updateEnterButton();});
  addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{clearInput();if(document.hidden&&joined){player.vx=player.vy=player.vz=player.z=0;player.moving=false;if(!editor.open)net.publish(player,true);}});
  // Read-only diagnostics for checking two-browser synchronization; no privileged actions.
  window.templeDebug=()=>({mapId:activeMap,death:death?{...death}:null,deaths,hazards:hazards.map(h=>({id:h.id,x:h.x,y:h.y,width:h.width,height:h.height,frame:h.frame()})),assets:[...assetLoader.items.values()].map(item=>({...item})),editor:{enabled:EDITOR_ENABLED,open:editor.open,tool:editor.tool,polygons:editor.polygons.map(p=>p.map(v=>[...v])),draft:editor.draft.map(v=>[...v])},camera:{...camera,zoom},connected:net.connected,id:net.id,player:{...player},remotes:net.sample(),remoteTiming:net.diagnostics(),networkMode:'client-authoritative',lastClose:net.lastClose,joined,selecting});
  refreshUI();refreshLobby();updateEnterButton();
})();
