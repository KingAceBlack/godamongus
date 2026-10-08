/* Public browser configuration: NEVER place secrets/API keys here.
   Empty string keeps frontend + backend on the same origin.
   Vercel builds generate dist/backend-config.js from the BACKEND_ORIGIN environment variable.
   Leave this source file unchanged for local development and the Render-hosted fallback.
   Keep the Bash.js script and other game assets as they are. */
(function(){
  const BACKEND_ORIGIN='';
  const base=new URL(BACKEND_ORIGIN||location.origin);
  if(!['http:','https:'].includes(base.protocol))throw new Error('Backend origin must be HTTP or HTTPS');
  const status=new URL('/api/status',base),socket=new URL('/ws',base);
  socket.protocol=base.protocol==='https:'?'wss:':'ws:';
  window.TempleBackend=Object.freeze({statusURL:status.href,socketURL:socket.href});
})();
