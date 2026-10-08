// Prepare collision/foreground layers for the supplied COMPLETE image. No joining, warping or resizing.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {executablePath}=require('./browser-env.cjs');
const assets=path.join(__dirname,'../assets');
const sourceScale=1906/1568,worldScale=5200/1568;
const outlines={
 'north-west-wall':[[0,0],[1136,0],[1136,121],[1096,148],[949,160],[890,224],[862,274],[831,334],[806,328],[520,328],[494,294],[464,276],[440,243],[397,237],[371,215],[151,214],[125,248],[80,281],[35,311],[0,311]],
 'north-east-wall':[[1235,0],[1568,0],[1568,415],[1535,415],[1534,260],[1506,241],[1495,207],[1462,183],[1435,158],[1270,148],[1235,121]],
 'west-wall':[[0,310],[35,310],[34,376],[0,390]],
 'front-walls':[[0,376],[37,414],[88,438],[104,462],[206,467],[207,550],[320,550],[320,467],[425,462],[440,435],[493,405],[520,374],[807,375],[846,427],[888,463],[961,530],[994,559],[1117,559],[1121,641],[1252,641],[1252,557],[1372,556],[1434,519],[1493,468],[1535,426],[1568,414],[1568,679],[0,679]]
};
const pillars=[[1088,208],[1288,208],[940,316],[1428,316],[940,427],[1428,427],[1088,526],[1288,526]];
const props=[[103,263,14,10],[125,246,16,10],[209,235,12,8],[314,235,12,8],[399,265,17,11],[465,308,18,11],[70,399,12,10],[125,445,16,9],[396,450,13,8],[449,410,16,10],[570,334,19,8],[799,334,19,8]];
const colliders=Object.entries(outlines).map(([id,points])=>({id,points:points.map(([x,y])=>[x*worldScale,y*worldScale])}));
for(const [i,[x,y]] of pillars.entries())props.push([x,y,23,11]);
props.forEach(([x,y,rx,ry],i)=>colliders.push({id:`column-or-prop-${i+1}`,points:Array.from({length:16},(_,n)=>[(x+rx*Math.cos(n*Math.PI/8))*worldScale,(y+ry*Math.sin(n*Math.PI/8))*worldScale])}));
const data={version:1,mapId:'solar-temple',map:{image:'twin-temple.webp',worldWidth:5200,worldHeight:825*5200/1906,sourceWidth:1906,sourceHeight:825,spawn:[316,525]},coordinateSystem:'world pixels, origin at supplied complete image top-left',notes:'Editable wall/column/prop colliders aligned to the supplied twin-chamber image. No stitched layers are used.',colliders};
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});let png;
 try{
  const page=await browser.newPage();
  png=await page.evaluate(async({url,points,scale})=>{
   const im=new Image();im.src=url;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const g=c.getContext('2d');
   // Binary, source-pixel-aligned mask. The foreground is copied from THIS artwork, not an old room.
   const p=new Path2D();points.forEach(([x,y],i)=>i?p.lineTo(x*scale,y*scale):p.moveTo(x*scale,y*scale));p.closePath();
   g.drawImage(im,0,0);const pixels=g.getImageData(0,0,c.width,c.height);
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(!g.isPointInPath(p,x+.5,y+.5))pixels.data[(y*c.width+x)*4+3]=0;
   g.putImageData(pixels,0,0);return c.toDataURL('image/png').split(',')[1];
  },{url:'data:image/webp;base64,'+fs.readFileSync(path.join(assets,'twin-temple.webp')).toString('base64'),points:outlines['front-walls'],scale:sourceScale});
 }finally{await browser.close();}
 const tmp=path.join(require('node:os').tmpdir(),'twin-temple-front.png');fs.writeFileSync(tmp,Buffer.from(png,'base64'));
 execFileSync('ffmpeg',['-y','-v','error','-i',tmp,'-c:v','libwebp','-lossless','1','-compression_level','6',path.join(assets,'twin-temple-front.webp')]);
 const file=path.join(assets,'twin-temple-colliders.json');if(!fs.existsSync(file)||process.argv.includes('--reset-colliders'))fs.writeFileSync(file,JSON.stringify(data,null,2));
 console.log('Prepared matching foreground and',colliders.length,'editable colliders. Existing collider edits preserved unless --reset-colliders is given.');
})().catch(e=>{console.error(e);process.exitCode=1;});
