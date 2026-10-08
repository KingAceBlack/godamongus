// Rebuild the connected world from the original room images. Source images are never overwritten.
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {executablePath}=require('./browser-env.cjs');
const assets=path.join(__dirname,'../assets');
const layout=JSON.parse(fs.readFileSync(path.join(assets,'world-layout.json')));
const scale=2600/1585;
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
 let output;
 try{
  const page=await browser.newPage();const images={};
  for(const name of ['temple-map.webp','sun-hall.webp','corridor-front.webp','box-front.webp'])images[name]='data:image/webp;base64,'+fs.readFileSync(path.join(assets,name)).toString('base64');
  output=await page.evaluate(async({layout,images})=>{
   const loaded={};for(const [key,url] of Object.entries(images)){const i=new Image();i.src=url;await i.decode();loaded[key]=i;}
   const canvas=()=>{const c=document.createElement('canvas');c.width=layout.sourceWidth;c.height=layout.sourceHeight;return c;};
   const base=canvas(),front=canvas(),g=base.getContext('2d'),f=front.getContext('2d');
   for(const ctx of [g,f]){ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';}
   const drawRoom=(ctx,room,image)=>{const [sx,sy,w,h]=room.crop;ctx.drawImage(image,sx,sy,w,h,room.x+sx*room.scale,room.y+sy*room.scale,w*room.scale,h*room.scale);};
   for(const room of layout.rooms)drawRoom(g,room,loaded[room.image]);
   drawRoom(f,layout.rooms[0],loaded['corridor-front.webp']);drawRoom(f,layout.rooms[0],loaded['box-front.webp']);
   const c=layout.connector;
   // Vertical strips smoothly connect matching wall/floor bands; the room textures are not distorted.
   function bridge(ctx,frontOnly){
    for(let x=Math.ceil(c.x[0]);x<c.x[1];x++){
     const t=(x-c.x[0])/(c.x[1]-c.x[0]);
     const sx=c.sourceX[0]+t*(c.sourceX[1]-c.sourceX[0]),sw=(c.sourceX[1]-c.sourceX[0])/(c.x[1]-c.x[0]);
     for(let k=frontOnly?3:0;k<c.sourceY.length-1;k++){
      const top=c.leftY[k]+(c.rightY[k]-c.leftY[k])*t,bottom=c.leftY[k+1]+(c.rightY[k+1]-c.leftY[k+1])*t;
      ctx.drawImage(loaded[c.image],sx,c.sourceY[k],sw,c.sourceY[k+1]-c.sourceY[k],x,top,1,bottom-top);
     }
    }
   }
   bridge(g,false);bridge(f,true);
   // Foreground lower wall of the hall, plus pillar silhouettes above their ground-contact ellipses.
   const room=layout.rooms[1];f.save();f.translate(room.x,room.y);f.scale(room.scale,room.scale);
   f.beginPath();const lower=[[320,565],[375,565],[415,650],[590,835],[740,850],[790,890],[1050,890],[1100,850],[1280,835],[1500,655],[1585,600],[1585,992],[320,992]];
   lower.forEach(([x,y],i)=>i?f.lineTo(x,y):f.moveTo(x,y));f.closePath();f.clip();f.drawImage(loaded['sun-hall.webp'],0,0);f.restore();
   return {base:base.toDataURL('image/png').split(',')[1],front:front.toDataURL('image/png').split(',')[1]};
  },{layout,images});
 }finally{await browser.close();}
 for(const [key,name] of [['base','temple-world'],['front','temple-world-front']]){
  const tmp=path.join(require('node:os').tmpdir(),`${name}.png`);fs.writeFileSync(tmp,Buffer.from(output[key],'base64'));
  execFileSync('ffmpeg',['-y','-v','error','-i',tmp,'-c:v','libwebp','-lossless','1','-compression_level','6',path.join(assets,`${name}.webp`)]);
 }
 const original=JSON.parse(fs.readFileSync(path.join(assets,'solar-temple-colliders.json')));
 const old=original.colliders.filter(c=>c.id!=='collider-7').map(c=>({id:'entrance-'+c.id,points:c.points.map(([x,y])=>[x,y+140*scale])}));
 // Corridor walls end at the old image edge; truncate at the new, open seam.
 for(const c of old)for(const p of c.points)p[0]=Math.min(p[0],1450*scale);
 const polygon=(id,pts)=>({id,points:pts.map(([x,y])=>[x*scale,y*scale])});
 const roomPoly=(id,pts)=>polygon(id,pts.map(([x,y])=>[1320+x*1.3,y*1.3]));
 const colliders=[...old,
  polygon('connector-north',[[1450,510],[1736,481],[1736,634.4],[1450,642]]),
  polygon('connector-front',[[1450,690],[1736,734.5],[1736,850.2],[1450,794]]),
  roomPoly('hall-north-wall',[[320,0],[1585,0],[1585,495],[1520,495],[1510,370],[1430,310],[1360,245],[1290,220],[1160,200],[1050,200],[1010,180],[870,180],[830,200],[520,215],[440,290],[412,365],[395,405],[375,465],[320,488]]),
  roomPoly('hall-front-wall',[[320,565],[375,565],[415,650],[590,835],[740,850],[790,890],[1050,890],[1100,850],[1280,835],[1500,655],[1585,600],[1585,992],[320,992]]),
  roomPoly('hall-east-wall',[[1510,470],[1585,470],[1585,655],[1510,655]])
 ];
 for(const [i,[x,y]] of [[790,305],[1095,305],[575,475],[1315,475],[575,658],[1315,658],[790,798],[1095,798]].entries()){
  colliders.push(roomPoly(`hall-pillar-${i+1}`,Array.from({length:16},(_,j)=>[x+38*Math.cos(j*Math.PI/8),y+17*Math.sin(j*Math.PI/8)])));
 }
 const data={version:1,mapId:'solar-temple',map:{image:'temple-world.webp',worldWidth:layout.sourceWidth*scale,worldHeight:layout.sourceHeight*scale,sourceWidth:layout.sourceWidth,sourceHeight:layout.sourceHeight,spawn:[540,805]},coordinateSystem:'world pixels, origin at assembled world top-left',notes:'Entrance colliders translated from original; closed hallway end removed. Added editable connector, hall wall and pillar colliders.',colliders};
 const colliderPath=path.join(assets,'temple-world-colliders.json');
 if(!fs.existsSync(colliderPath)||process.argv.includes('--reset-colliders'))fs.writeFileSync(colliderPath,JSON.stringify(data,null,2));
 console.log('Built connected atlas and foreground. Existing collider edits preserved unless --reset-colliders is passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
