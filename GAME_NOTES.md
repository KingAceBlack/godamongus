# Twin Sun Temple — one connected world

## Deploy to GitHub + Render

Start with **[DEPLOYMENT.md](DEPLOYMENT.md)** for step-by-step upload/deployment instructions,
a game-systems summary, limitations, and troubleshooting. `render.yaml` defines one Node
Web Service serving the game and multiplayer together. Extract the ZIP and commit its
contents to GitHub; do not commit just the ZIP.

Render build: `npm ci --omit=dev` · start: `npm start` · health check: `/api/status`.
Keep one instance. No database, API keys or separate frontend hosting are required.

## Run

Node.js 22.x (pinned by `package.json`):

```sh
npm ci
npm start
```

HTTP and WebSockets share port 4173 on 0.0.0.0; set `PORT` to override. Proxies must
forward WebSocket upgrades for `/ws`. Bash.js is loaded, but the direct game URL works
without a Bash account/context.

## Active artwork

The world now uses the supplied **Ornate Twin Sun Temple Chambers.png** as one complete
image. The earlier stitched-room atlas and connector are NOT used by the active game.

- `assets/twin-temple.webp`: original 1906×825 image, lossless WebP; no crop, warp,
  rescale, joins or painted changes. 1,903,308 → 1,448,914 bytes. Every visible RGB pixel
  and alpha value was verified against the uploaded PNG.
- `assets/twin-temple-front-v2.webp`: revised uploaded transparent front layer, 1906×825,
  rendered after characters. Lossless optimization: 533,965 → 331,480 bytes. Visible RGB
  pixels and the full alpha channel verified identical to the supplied PNG. A new filename
  avoids stale browser image caches; both uploaded revision images were byte-identical.
- `assets/twin-temple-colliders.json`: exact uploaded `twin-temple-colliders _2_.json`,
  containing 16 polygons and 211 vertices. No generated geometry is added back. The previous
  five-polygon version is saved in `backups/twin-temple-colliders-before-v3.json`.
- `maps.js`: the single world `solar-temple`, 5200 world units wide, with matching height,
  spawn and editor room-focus positions. Room aspect ratios are never stretched.

The old source images, generated atlas, collision JSON and `tools/build-world.cjs` remain
as historical files only. They are not active and must not be used to rebuild this map.
`tools/prepare-twin-map.cjs` and `twin-temple-front.webp` are also historical: the live
foreground now comes directly from the uploaded image. Do not run that helper with
`--reset-colliders`, as it would replace the user's approved collider values.

Both chambers share one camera, minimap, coordinate system and multiplayer space. Walk
through the existing corridor; there is no room selector, teleport, loading transition
or identity change. The minimap keeps the supplied image's aspect ratio. Rendering crops
image draws to the camera viewport before scaling.

## Gameplay and networking

Join server → choose guardian → confirm. One public server supports up to 32 guests.
Names, IDs and initial safe spawn positions are server assigned. Everyone shares both
chambers, regardless of where they stand.

- WASD/arrows move; Space jumps. Touch joystick and jump controls are provided.
- While airborne (`z > 0`), local and remote character sprites render above the foreground.
  Landing restores their normal ground-depth order automatically; shadows remain on the floor.
  This changes rendering only, not wall or hazard collision.
- Mouse wheel or the −/+ controls below the minimap zoom the camera.
- Change guardian preserves identity and position. Leave removes the avatar.

Movement, collisions, jumping, camera and animation run locally each render frame, with
physics substeps no longer than 1/60 second. Clients publish their latest state at up to
20 Hz. There is no authoritative server movement, input replay, acknowledgement queue,
or correction of the local character. Protocol 3 adds source-captured monotonic timestamps
and sequence numbers. The relay preserves them and rejects duplicate/backward poses.
Congested replaceable updates are skipped rather than enqueued or treated as a kick.

`remote-motion.js` handles only other players:
- Each avatar's source clock is anchored to the receiver's monotonic clock; original time
  differences survive delivery bursts even when browser clocks have different origins.
- An adaptive 150–300 ms target buffer responds to arrival jitter and update cadence.
  It is additional presentation delay, not a limit on network latency. Increasing the
  buffer may briefly hold motion; accumulated delay drains while stationary, not by racing.
- History is capped at 32 poses and pruned as it is consumed. Incoming batches are coalesced
  to the latest snapshot per render; old server frames and repeated sequences are ignored.
- Playback does not fast-forward. Ordinary presentation is capped at 300 world units/s
  (local movement remains 280), with no prediction beyond the latest known position.
- A gap over 500 ms, implausible position jump, or long rendering pause discards the old
  playback timeline and explicitly repositions to the newest safe pose. Missing packets
  freeze position/walking animation instead of extrapolating through unknown geometry.
- Swept-circle checks use the actual player radius against published colliders. A blocked
  interpolation chord holds at a safe endpoint then repositions; it never invents a route
  around a corner or animates through a wall. Poses inside colliders are not displayed.

Server frames also carry sequence/time metadata; ping/pong clock estimates help discard
old delivery backlogs. These changes improve presentation, not movement enforcement:
bad connections can still cause a brief pause or visible reposition, and cheating remains
possible because the server deliberately trusts local movement.

The server and client fingerprint the published collider data and physics revision.
Protocol/layout mismatches are refused before joining and show **Reload game**, without
an automatic reconnect loop. This is a compatibility checksum, not a security signature.
`templeDebug().remoteTiming` reports buffers, queue lengths, rejected updates and resyncs.
After deploying a protocol or collider change, reload existing game tabs.

Local play continues through outages. Automatic reconnection retains local position and
skin but assigns a fresh guest name/ID. Old avatars are removed. Server heartbeat allows
90 seconds of silence, while the client retries after 75 seconds with no received message.
The server validates finite numbers and broad bounds, not anti-cheat movement. There is
no account database, persistent progress, combat or player-to-player collision.

## World collider editor

**Temporarily disabled:** the lobby/gameplay buttons and editor panel are hidden, and
`openEditor()` is guarded. All editor code and collider data are preserved. To restore it,
set `EDITOR_ENABLED=true` near the top of `game.js` and reload; the same flag restores
visibility. `tests/editor-check.cjs` checks the disabled state while this flag is false
and runs the retained editor interaction tests when enabled.

When enabled, use **World editor** in the lobby or **Collider editor** during gameplay. It leaves the
server and edits locally, so neither test movement nor draft geometry affects others.

Draw/finish polygons, select/drag vertices, undo draft points, delete/clear, pan, zoom,
fit the whole world, place a test player and test the current collision draft. The Focus
selector pans to a chamber without swapping maps or replacing geometry. JSON import,
download and optional Bash chat sharing are available. Touch controls work in test mode.

Drafts remain in memory when closing and reopening the editor, but disappear on reload.
Export to keep them. Closing the editor restores published collision data for gameplay.
To publish approved changes, replace `assets/twin-temple-colliders.json`, restart the
server and reload clients. Public visitors cannot overwrite shared files.

## Sunblade hazard

The supplied `spin.png` is animated in the middle of the Sun Hall, over its central
sun medallion (source coordinates `[1440,426]`). `assets/sunblade-spin.webp` is lossless:
459,037 → 313,050 bytes, preserving 2048×256 dimensions, eight frames and transparency.
It renders at 320 world units, looping at 12 fps. `maps.js` contains its placement;
`hazards.js` tests the player's swept collision circle against the current frame's
opaque pixels, not its transparent rectangular bounds.

Contact triggers a short fade/red flash and a 0.65-second movement lock, then respawns
the player at the first chamber's safe entrance spawn. Velocity, jumping and held controls
are cleared; character, name and session identity remain intact. The camera relocates
immediately and the existing relay broadcasts the new position; other players see the
pause followed by a reposition, not a fast run through the corridor. Like wall collision,
the lethal footprint is 2D: jumping does not grant immunity. Death/respawn are client-owned
and continue offline; this is not server-side anti-cheat.

When re-enabled, the collider editor displays the blade but disables lethality, including local test mode.
The approved 16-polygon collider file is unchanged. The compatibility fingerprint now
includes a hazard revision; increment it in `physics.js` when changing hazard rules/layout
and restart/reload clients so old tabs cannot silently retain an obsolete lethal world.

## Character roster

`characters.js` is the shared catalog for client rendering, selection names/roles and
server-approved IDs: Sun Priestess, Solar Guardian, **Ember Warden**, **Dawn Sovereign**,
**Solstice Keeper**, **Crimson Sentinel** and **Golden Envoy**.
Sun Priestess's walk animation uses the supplied `media-7249d225.png`, losslessly
converted to `assets/priestess-walk-v2.webp` (543,948 → 384,484 bytes). Visible RGB pixels
and the full alpha channel match the source. Her idle sheet (`assets/priestess-idle-lossless.webp`)
is unchanged; the previous `assets/walk.webp` remains for reference but is no longer loaded.
Solar Guardian's walk animation uses the supplied `media-bbc56c5e.png`, losslessly
converted to `assets/guardian-walk-v2.webp` (578,878 → 414,058 bytes). Visible RGB pixels
and the full alpha channel match the source. Its idle sheet (`assets/guardian-idle.webp`)
is unchanged; the previous `assets/guardian-walk.webp` remains for reference but is no longer loaded.
Ember Warden uses `new2 idle.png`, losslessly converted to `assets/ember-idle.webp`
(728,124 → 501,562 bytes). Its walk animation was replaced with the supplied
`ember warden.png`, losslessly converted to `assets/ember-walk-v2.webp`
(726,397 → 497,224 bytes). Visible RGB pixels and all alpha values match the sources.
The idle animation is unchanged; the previous walk sheet remains as `assets/ember-walk.webp`
for reference but is no longer loaded.
Dawn Sovereign uses `new3 idle.png`, losslessly converted to `assets/dawn-idle.webp`
(638,421 → 476,968 bytes). Its walk animation was replaced with the supplied `dawn.png`,
losslessly converted to `assets/dawn-walk-v2.webp` (615,955 → 443,936 bytes).
Visible RGB pixels and the full alpha channel match the sources. The idle animation is
unchanged; the previous walk sheet remains as `assets/dawn-walk.webp` for reference
but is no longer loaded.
Solstice Keeper uses `new4 idle.png`, losslessly converted to `assets/solstice-idle.webp`
(598,323 → 426,160 bytes). Its walk animation was replaced with the supplied `solstice.png`,
losslessly converted to `assets/solstice-walk-v2.webp` (626,865 → 441,916 bytes).
Visible RGB pixels and the full alpha channel match the sources. The idle animation is
unchanged; the previous walk sheet remains as `assets/solstice-walk.webp` for reference
but is no longer loaded.
Crimson Sentinel uses `new5 idle.png`, losslessly converted to `assets/crimson-idle.webp`
(575,707 → 404,110 bytes). Its walk animation was replaced with the supplied `cratos.png`,
losslessly converted to `assets/crimson-walk-v2.webp` (527,011 → 367,104 bytes).
Visible RGB pixels and the full alpha channel match the sources. The idle animation is
unchanged; the previous walk sheet remains as `assets/crimson-walk.webp` for reference
but is no longer loaded.
Golden Envoy uses `idle wiz.png`, losslessly converted to `assets/envoy-idle.webp`
(469,276 → 326,674 bytes). Its walk animation was replaced with the supplied
`media-11b62dde.png`, losslessly converted to `assets/envoy-walk-v2.webp`
(438,193 → 309,028 bytes). Visible RGB pixels and the full alpha channel match the sources.
The idle animation is unchanged; the previous walk sheet remains as `assets/envoy-walk.webp`
for reference but is no longer loaded.
Golden Envoy also uses `JUMP.png`, losslessly converted to `assets/envoy-jump.webp`
(448,378 → 308,722 bytes), with matching visible RGB pixels and full alpha. This optional
`jump` catalog entry overrides idle/walk only while airborne. The eight-frame sequence
follows the rendered jump height and ascent/descent, plays once per jump, and returns to
idle or walking immediately upon landing. It works for local/remote players and touch input;
frontmost jump rendering and floor shadows are unchanged. Other characters keep their existing
jump appearance. Physics, jump height/duration, and hazard rules are unchanged.
All sheets stay 2048×256 with eight square 256×256 frames. Selection/platform alignment,
112-world-unit gameplay frame size and movement/collision behavior are unchanged.
The roster uses four columns on desktop and two columns on mobile, wrapping into a
scrollable grid as characters are added; the confirmation bar stays accessible. It uses square-framed,
unwarped thumbnails. The same decoded idle artwork is
reused by the cards, showcase and gameplay. All animations work for local/remote players;
switching character preserves identity and position.

## Tests

Jump animation tests verify ordered eight-frame playback at 30/60/144 fps, restarting on
repeat jumps, actual loaded/drawn jump-sheet hashes, local/remote foreground order, moving
jumps returning to walking, and touch controls. Run browser tests on an isolated test server
via `TEST_URL` when live users share the same character, to avoid ambiguous render assertions.

```sh
npm test
# With the main server running; install the optional browser first:
npx playwright install chromium
node tests/editor-check.cjs
node tests/browser-check.cjs
node tests/startup-check.cjs
node tests/roster-check.cjs
node tests/network-jitter-check.cjs
node tests/hazard-check.cjs
node tests/jump-layers-check.cjs
```

Server/physics tests run an isolated server on 4181 and verify file boundaries, safe
spawns, shared presence, relay validation, burst tolerance, 30/60/144-fps local collisions
and a continuous round-trip walk between chambers using the new image coordinates.
Hazard tests cover animated alpha masks, transparent corners, swept contact, real desktop/mobile
death/respawn, unchanged character/identity, remote repositioning and non-lethal editor isolation.
Editor checks cover drawing, dragging, focus, export/import, actual collision blocking,
draft isolation and mobile controls. Browser checks use independent clients to test
movement, jumping, skin changes, a nine-second state-channel stall, outage recovery,
position preservation, leaving, mobile controls and runtime errors.
Startup checks deliberately stall Bash.js and fail/hold foreground, character and collider
requests. The SDK is loaded after game scripts so it cannot block click-handler setup.
`assets.js` downloads at most two images at a time with fetch, shows per-image progress,
and decodes downloaded blobs rather than waiting on network Image load events. There is
no fixed 20-second image deadline: each received chunk resets a 45-second inactivity timer.
Stalled/failed image requests retry once automatically with fresh URLs; failures identify
the exact filename and expose Retry loading. Successful images and character portraits
share decoded blob URLs, avoiding duplicate transfers and repeat downloads after errors.
JSON requests retain their separate 20-second timeout. Tests cover progressing slow
streams, automatic retry, concurrency limits, decode errors and a 23-second browser image
request that completes successfully without retry. Original lossless asset bytes are unchanged.
Remote-motion tests cover distinct source clock origins, burst timing, speed limits,
duplicates, outage/resume, bounded history, thin-wall sweeps and collider fingerprints.
Browser jitter checks batch packets on both sender and receiver, replay duplicate packets,
hold delivery through an outage, verify safe/bounded remote motion, and test the stale-map
rejection and Reload game flow. Local controls and reconnect position remain regression-tested.
Roster checks verify desktop/mobile selection, the actual idle/walk image drawn on canvas,
remote rendering, and switching through every roster member without changing identity.
The default roster test targets Golden Envoy; `CHARACTER=ember-warden node tests/roster-check.cjs`
can verify another catalog entry. Mobile coverage includes 390×844 and 320×568 screens.
Browser checks use Playwright's installed Chromium by default. `CHROMIUM_PATH` can select
another executable; `TEST_URL` overrides the default http://localhost:4173 test target.
Screenshots are written to `test-artifacts/` (or `TEST_ARTIFACTS`), not a sandbox-specific path.
`window.templeDebug()` exposes read-only diagnostics, not server privileges.
