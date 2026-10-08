# Solar Temple — Complete Game: GitHub + Vercel + Render

**This is the entire game**, including its original-resolution lossless artwork, all seven characters, current animations, world/colliders, gameplay source, multiplayer server, and tests. It is not the small server-only kit.

Use **one GitHub repository** for both deployments:

```text
GitHub repository
  ├── Vercel → game page, scripts, artwork and collider files
  └── Render → persistent multiplayer server, /api/status and /ws

Players open your Vercel URL.
The browser connects directly to your Render server over HTTPS/WSS.
```

There is no need to write a new server, add Vercel Functions, configure a WebSocket proxy, or install a database. The backend is already included. This package does not create accounts or deploy to either platform for you.

## 1. Deploy the multiplayer server on Render first

In Render, create **New → Web Service**, connect your GitHub repository, and use:

| Setting | Value |
|---|---|
| Service type | Web Service, **not Static Site** |
| Runtime | Node |
| Root Directory | Blank if `package.json` is at repository root |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/status` |
| Instances | **1** |
| Node version | 22.x, as declared in `package.json` |

Add `NODE_ENV=production`. The server automatically listens on Render's `PORT` at `0.0.0.0`; you do not need to set PORT yourself.

For now, leave `ALLOWED_ORIGINS` unset if you do not yet know your Vercel URL. You will set it in step 4. The server can become healthy before the frontend is connected.

Deploy. Copy the resulting origin, for example:

```text
https://solar-temple-server-abc.onrender.com
```

Open its `/api/status` endpoint. A healthy response looks like:

```json
{"name":"Solar Temple","players":0,"capacity":32}
```

Use your actual Render hostname—not the example above.

**Plan choice:** Render's free service can sleep and take time to wake. An always-on paid plan is recommended for reliable multiplayer. Review pricing before choosing it. The included Blueprint defaults to free to avoid assuming a paid plan.

**Optional Blueprint route:** `render.yaml` is included if you prefer Render's Blueprint workflow. It applies the same commands and prompts for `ALLOWED_ORIGINS`. The manual Web Service steps above are the simplest first setup when you do not yet know the Vercel URL.

## 2. Deploy the complete frontend on Vercel

In Vercel, choose **Add New → Project**, import the **same GitHub repository**, and use:

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | Blank if `package.json` is at repository root |
| Install Command | `npm ci --omit=dev` |
| Build Command | `npm run build` |
| Output Directory | **`dist`** |
| Node version | 22.x |

`vercel.json` already supplies these build/output settings. Do not set the output directory to the repository root or deploy `server.cjs` as a Vercel Function.

**Before clicking Deploy**, add this Vercel environment variable:

| Name | Value |
|---|---|
| `BACKEND_ORIGIN` | Your Render origin, e.g. `https://solar-temple-server-abc.onrender.com` |

Set it for **Production**, and for **Preview** too if you intend to use preview deployments. This URL is public configuration, not a secret.

Use only the origin: no `/ws`, `/api/status`, credentials, query string or path. HTTPS is required for public deployment. The build fails clearly if this value is missing or invalid, rather than shipping a game that silently connects to the wrong host.

Deploy. The build copies all **active** game assets losslessly into `dist` and generates `dist/backend-config.js` with your Render address. It does not publish backend source, tests, backups, historical unused assets or ZIP archives. The complete source/artwork remains in GitHub.

Copy the stable production frontend origin, for example:

```text
https://your-solar-temple.vercel.app
```

The lobby may say **Server unavailable** until you finish step 4. That is expected while cross-origin access is not yet configured.

## 3. Allow the Vercel frontend on Render

Go back to the Render service's **Environment** settings and add:

```text
ALLOWED_ORIGINS=https://your-solar-temple.vercel.app
```

Save and redeploy/restart the Render service. Use your exact production origin with **no trailing slash or path**.

For multiple trusted domains, use a comma-separated list:

```text
https://your-solar-temple.vercel.app,https://play.yourdomain.com
```

This one setting controls:

- HTTP CORS for the lobby's `GET /api/status` request.
- Which browser Origins may open the `/ws` WebSocket.

CORS and WebSocket Origin policy are separate checks; the supplied backend implements both. Origin checks are not authentication or anti-cheat.

**Preview deployments:** Vercel preview URLs can differ from the production URL. Add each intended exact preview origin to Render's list, or test with the stable production URL. Do not allow every `*.vercel.app` tenant. A preview using the same Render backend joins the same shared world as production; use a separate Render service for isolated staging.

**Optional Render-hosted fallback:** the backend also retains the original ability to serve the game. If you want to play at the Render URL too, include that Render origin in `ALLOWED_ORIGINS`. Normal players should use the Vercel URL.

## 4. Verify the complete deployment

1. Wait until Render reports healthy.
2. Reload the Vercel game. The lobby should show an online count.
3. Join with a character in one browser and a second guest in another browser/incognito window.
4. Confirm both players see one another, can move/jump and switch characters.
5. Confirm the Sunblade triggers local death/respawn, keeping the same identity.
6. Try a phone or touch viewport.

The browser should request artwork from **Vercel**, status from **Render `/api/status`**, and connect to **Render `wss://…/ws`**. No multiplayer connection should target Vercel's `/ws`.

If Vercel displays its own sign-in/protection screen to visitors, review deployment-protection settings for the deployment you intend to make public.

## Updating the game

Commit changes to the connected GitHub branch. Vercel rebuilds the frontend and Render redeploys the backend according to your auto-deploy settings. Changes to a Vercel environment variable require a **new Vercel deployment** because the backend URL is embedded at build time. Changes to Render environment variables require restarting/redeploying that service.

After collider/protocol compatibility changes, deploy matching frontend and backend revisions. The game requests a reload for incompatible clients. A server restart clears guest presence and clients reconnect; sessions and progress are not persistent. Rolling replacements can briefly split membership between old and new processes, so this is not a seamless multi-instance system.

Do not modify generated `dist/backend-config.js` manually or commit it. Leave the root `backend-config.js` in its same-origin default for local development; Vercel generates its own configured copy during the build.

## Local development and tests

Use Node 22:

```sh
npm ci
npm start
```

Open `http://localhost:4173`. Locally the full Node service serves both frontend and backend without environment configuration.

```sh
npm test
npm run test:deploy
```

These check unit behavior and an isolated production server. To verify the split-host build and real browser networking locally:

```sh
# Install a supported Chromium if you do not already have one:
npx playwright install chromium
npm run test:split
```

`CHROMIUM_PATH` optionally selects an existing Chromium executable. The split-host test builds the actual `dist` artifact, starts temporary frontend/backend servers, verifies CORS and WebSocket Origin handling, and checks two-player movement/jumps. It shuts its servers down when finished. Default test ports are 4186/4187, configurable with `SPLIT_BACKEND_PORT` and `SPLIT_FRONTEND_PORT`.

For a manual static build:

```sh
BACKEND_ORIGIN=https://YOUR-SERVER.onrender.com npm run build
```

On PowerShell: `$env:BACKEND_ORIGIN='https://YOUR-SERVER.onrender.com'; npm run build`.

## Included gameplay and limits

- One continuous Twin Sun Temple world with two connected chambers.
- Seven characters with all current walk replacements; Golden Envoy has a dedicated jump animation.
- Lossless original-resolution world, foreground and sprite artwork.
- Approved collider geometry unchanged.
- Client-owned movement/collision/jumping, with remote-only smoothing.
- Sunblade hazard, death freeze/fade and safe entrance respawn.
- Airborne bodies above foreground; floor shadows and normal landing depth.
- Desktop/mobile controls, character switching, minimap and zoom.
- Collider editor code retained but temporarily disabled.
- One anonymous public room, up to 32 players / 64 connections in the reference implementation.

There is no database, account system, saved progression, private-room implementation or authoritative anti-cheat. Keep **one Render instance**: independent replicas do not share in-memory membership. Client-owned movement is intentional; do not replace it with server corrections as a deployment workaround.

`GAME_NOTES.md` contains the earlier detailed game/asset notes. For hosting, follow **this README**, not its older single-host deployment references. Historical tools/backups are retained; do not run collider-regeneration tools on the approved map.

## Troubleshooting

| Problem | Check |
|---|---|
| Vercel build says BACKEND_ORIGIN is missing | Add it to the deployment's environment scope and redeploy |
| Vercel says output directory is missing | Use `npm run build` and output `dist`; do not skip the build |
| Page works but lobby says Server unavailable | Render health, sleep/cold start, BACKEND_ORIGIN, exact ALLOWED_ORIGINS |
| Status works but joining fails | WebSocket Origin allowlist, WSS URL and matching world/protocol |
| Browser requests Vercel `/ws` | Wrong/stale build or output folder; inspect generated backend-config.js and redeploy |
| Production works but a preview fails | Add that exact preview origin and set BACKEND_ORIGIN for Preview |
| Works locally but not over HTTPS | Use an HTTPS Render origin, which generates WSS automatically |
| New domain fails | Add the new frontend origin to Render and redeploy its service |
| Wrong-world/reload message | Ensure frontend and backend use the same game revision; reload |
| Players appear in separate worlds | Multiple independent server instances or different Render endpoints |
| Server wakes slowly after inactivity | Free-tier sleep; choose an always-on plan for reliable play |
| Server source appears in public files | Incorrect Vercel output setting; deploy only `dist` |

No external deployment has been performed by this ZIP. Local tests validate the package and split-host behavior, not your account settings or cloud provisioning.

References: [Vercel build settings](https://vercel.com/docs/builds/configure-a-build), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Render Web Services](https://render.com/docs/web-services), [Render WebSockets](https://render.com/docs/websocket), [Render free-service limits](https://render.com/docs/free).
