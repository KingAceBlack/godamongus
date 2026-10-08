'use strict';
// Static-only Vercel build. The persistent WebSocket process runs separately on Render.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),out=path.join(root,'dist');
const value=(process.env.BACKEND_ORIGIN||'').trim();
if(!value)throw new Error('Set BACKEND_ORIGIN to your Render HTTPS origin, e.g. https://solar-temple.onrender.com, then rebuild.');
const url=new URL(value);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('BACKEND_ORIGIN must be an HTTP(S) origin only: no credentials, path, query, /ws or /api/status.');
if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Use HTTPS for the public Render backend. HTTP is only allowed for localhost tests.');
const files=new Set(['index.html','game.js','assets.js','hazards.js','physics.js','remote-motion.js','multiplayer.js','multiplayer.css','maps.js','characters.js','editor.css','assets/showcase-bg.jpg']);
for(const m of Object.values(require('../maps.js')))for(const f of [m.image,m.colliders,...m.foreground,...(m.hazards||[]).map(h=>h.image)])files.add('assets/'+f);
for(const c of Object.values(require('../characters.js')))for(const f of [c.idle,c.walk,c.jump].filter(Boolean))files.add('assets/'+f);
for(const file of files)if(!/^(?:[a-zA-Z0-9._-]+|assets\/[a-zA-Z0-9._-]+)$/.test(file)||!fs.statSync(path.join(root,file)).isFile())throw new Error('Unsafe or missing public file: '+file);
fs.rmSync(out,{recursive:true,force:true});
for(const file of files){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
fs.writeFileSync(path.join(out,'backend-config.js'),`// Public backend address generated at build time; contains no secrets.\n(function(){\n const base=new URL(${JSON.stringify(url.origin)});\n const socket=new URL('/ws',base);socket.protocol=base.protocol==='https:'?'wss:':'ws:';\n window.TempleBackend=Object.freeze({statusURL:new URL('/api/status',base).href,socketURL:socket.href});\n})();\n`);
console.log('Built',files.size+1,'public files in dist/; backend:',url.origin);
console.log('Server source, private configuration, backups, old assets and archives are NOT published to Vercel.');
