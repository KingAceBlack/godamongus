# Deployment guide

The current deployment guide is in **[README.md](README.md)**.

This release uses one GitHub repository, a **Vercel static frontend**, and a **Render Node Web Service** for multiplayer.

- Vercel: `npm run build`, output `dist`, environment `BACKEND_ORIGIN=https://YOUR-SERVER.onrender.com`.
- Render: `npm ci --omit=dev`, then `npm start`, health `/api/status`, environment `ALLOWED_ORIGINS=https://YOUR-GAME.vercel.app`.
- See README for the full setup order, environment settings, preview URLs, troubleshooting and local tests.
