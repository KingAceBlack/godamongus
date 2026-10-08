'use strict';
// Bounded end-to-end test of the actual Vercel static artifact + a separate Render-style process.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process'),{once}=require('node:events'),{WebSocket}=require('ws');
const {chromium}=require('playwright'),{executablePath}=require('../tools/browser-env.cjs');
const root=path.join(__dirname,'..'),dist=path.join(root,'dist');
const backPort=process.env.SPLIT_BACKEND_PORT||4186,frontPort=process.env.SPLIT_FRONTEND_PORT||4187;
const back=`http://127.0.0.1:${backPort}`,front=`http://127.0.0.1:${frontPort}`;
(async()=>{
 let child,browser;const errors=[],sourceConfig=fs.readFileSync(path.join(root,'backend-config.js'));
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg'};
 const frontend=http.createServer((req,res)=>{
  const name=new URL(req.url,front).pathname.slice(1)||'index.html',file=path.resolve(dist,name);
  if(!file.startsWith(dist+path.sep)){res.writeHead(404);res.end();return;}
  fs.readFile(file,(e,data)=>{res.writeHead(e?404:200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(e?'Not found':data);});
 });
 try{
  for(const invalid of ['',back+'/ws','http://public.example.com','https://user:password@example.com']){
   const r=spawnSync(process.execPath,['tools/build-vercel.cjs'],{cwd:root,env:{...process.env,BACKEND_ORIGIN:invalid},encoding:'utf8'});assert.notEqual(r.status,0,'Reject invalid backend origin');
  }
  const build=spawnSync(process.execPath,['tools/build-vercel.cjs'],{cwd:root,env:{...process.env,BACKEND_ORIGIN:back},encoding:'utf8'});assert.equal(build.status,0,build.stderr);console.log(build.stdout.trim());
  assert.deepEqual(fs.readFileSync(path.join(root,'backend-config.js')),sourceConfig,'Build must not rewrite local configuration');
  const files=[];function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);entry.isDirectory()?scan(file):files.push(file);}}scan(dist);
  for(const file of files)if(path.basename(file)!=='backend-config.js')assert.deepEqual(fs.readFileSync(file),fs.readFileSync(path.join(root,path.relative(dist,file))),'Public bytes unchanged: '+file);
  for(const name of ['server.cjs','package.json','README.md','render.yaml','.env','tests','backups','tools'])assert(!fs.existsSync(path.join(dist,name)),name+' must not be published');
  child=spawn(process.execPath,['server.cjs'],{cwd:root,env:{...process.env,PORT:String(backPort),ALLOWED_ORIGINS:front},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
   let logs='';const timer=setTimeout(()=>finish(new Error('Server startup timeout: '+logs)),8000);
   const onData=d=>{logs+=d;if(logs.includes('Solar Temple listening'))finish();},onExit=()=>finish(new Error('Server exited: '+logs));
   function finish(e){clearTimeout(timer);child.stdout.off('data',onData);child.off('error',finish);child.off('exit',onExit);e?reject(e):resolve();}
   child.stdout.on('data',onData);child.stderr.on('data',d=>logs+=d);child.once('error',finish);child.once('exit',onExit);
  });
  await new Promise((resolve,reject)=>{frontend.once('error',reject);frontend.listen(Number(frontPort),'127.0.0.1',resolve);});
  const denied=await fetch(back+'/api/status',{headers:{Origin:'https://unlisted.example'}});assert.equal(denied.headers.get('access-control-allow-origin'),null);
  await new Promise((resolve,reject)=>{
   const ws=new WebSocket(back.replace('http:','ws:')+'/ws',{origin:'https://unlisted.example'});
   const timer=setTimeout(()=>{ws.terminate();reject(new Error('Expected rejected Origin'));},5000);
   ws.on('error',()=>{});ws.once('open',()=>{clearTimeout(timer);ws.terminate();reject(new Error('Unlisted browser Origin accepted'));});
   ws.once('unexpected-response',(_,res)=>{clearTimeout(timer);res.resume();ws.terminate();try{assert.equal(res.statusCode,403);resolve();}catch(e){reject(e);}});
  });
  browser=await chromium.launch({executablePath,args:['--no-sandbox']});
  async function join(skin){
   const p=await(await browser.newContext()).newPage();p.on('pageerror',e=>errors.push(e.message));
   await p.route('https://bash.tv/bash/v1.js',r=>r.abort()); // Must work as an independent website.
   await p.goto(front);await p.click('#joinServer');await p.click(`[data-character="${skin}"]`);await p.click('#enterWorld');await p.waitForFunction(()=>templeDebug().joined);return p;
  }
  const a=await join('golden-envoy'),b=await join('sun-priestess');
  assert.equal(await a.evaluate(()=>TempleBackend.socketURL),back.replace('http:','ws:')+'/ws');
  assert.equal(await a.evaluate(async()=>{const r=await fetch(TempleBackend.statusURL);return(await r.json()).players;}),2);
  const id=await a.evaluate(()=>templeDebug().id);await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id),id);
  const x=await a.evaluate(()=>templeDebug().player.x);await a.keyboard.down('d');await a.waitForTimeout(350);await a.keyboard.up('d');
  await b.waitForFunction(({id,x})=>templeDebug().remotes.some(p=>p.id===id&&p.x>x+25),{id,x});
  await a.keyboard.press('Space');await a.waitForFunction(()=>templeDebug().player.z>5);await b.waitForFunction(id=>templeDebug().remotes.some(p=>p.id===id&&p.z>5),id);
  assert.equal((await fetch(front+'/server.cjs')).status,404);assert.deepEqual(errors,[]);
  console.log('PASS split-host frontend/backend: unchanged artwork, safe static output, CORS, Origin rejection, two-player movement/jump, no required Bash context or runtime errors');
 }finally{
  await browser?.close();frontend.closeAllConnections();if(frontend.listening)await new Promise(r=>frontend.close(r));
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
