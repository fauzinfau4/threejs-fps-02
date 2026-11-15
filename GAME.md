# Emberline Yard — a three.js tactical FPS

An original round-based tactical shooter in the style Counter-Strike made
famous — with its own map, teams, weapons and art. No commercial map,
character or name is copied.

## The game

**Kestrel Yard** is a dusk-lit freight yard: two bomb sites (Site A —
Warehouse, Site B — Silo) joined by three lanes (A-Long, Mid under the crane
gantry, B-Tunnel). You play for **Ember** (orange) against the **Ash** crew
(teal): you plus 3 ally bots vs 5 enemy bots, first to 5 rounds.

- **Rounds:** 100-second rounds. Win by eliminating the Ash crew, or by
  planting the spike at a site and defending it until it detonates (35 s).
  If time expires without a plant, or the spike is defused, Ash wins the round.
- **Economy:** start with $800; $300 per kill, $3,250 per round win,
  $1,900 per round loss, $300 for planting. Spend it in the buy phase
  (9 s freeze at the start of every round).
- **Arsenal:** Kestrel-9 pistol (free), Hornet-9 SMG ($1,200),
  Breacher-12 shotgun ($1,500), Longbow-7 rifle ($2,700), Needle-50 sniper
  ($4,000, right-click scope), frag grenades ($300) and a plated vest ($650).
- **Gunplay:** hitscan with headshots (2× damage, 2.5× on the sniper),
  recoil and spread that grow while moving or spraying — stopping to aim
  always pays. Crouch to tighten your spread; sprint to rotate.
- **Bots:** follow waypoint routes through the lanes, hold corners and
  scan, engage on line of sight, react to gunshot noise, rotate to a
  planted spike and defuse when the coast is clear.

## How to play

Serve `game/` with any static server (`node serve.ts`, then open
http://localhost:8080) and click **Enter the yard**.

- **WASD** move · **mouse** aim · **click** fire · **R** reload
- **Shift** sprint · **Ctrl / C** crouch · **B** buy menu (keys 1–7 buy)
- **G** throw frag grenade · **E** hold to plant the spike inside a site
  (or pick up a dropped spike) · **right-click** scope (Needle-50 only)
- First to 5 rounds wins the match. Watch the minimap (top left) for
  your crew, the sites and the spike.

## Tech

Static ES modules, no build step, no network requests. three.js 0.187.0
vendored in `game/` (`three.module.min.js` + `three.core.min.js`).
Fixed 60 Hz simulation in `src/sim.js`, rendering in `src/main.js`,
bot AI in `src/agents.js`, map/collision in `src/map.js`. All sound is
synthesised with WebAudio — no audio files.
