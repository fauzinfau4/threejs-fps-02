// main.js — boot, the render loop and the bridge between sim and screen.
// The simulation runs at a fixed 60 Hz (sim.js); this file renders at the
// display rate, resolves the player's shots with a raycast, draws tracers
// and the viewmodel gun, and drains sim events into sound + HUD.
// ?shot=start|play|end&seed=N stages a deterministic frame for a capture,
// renders it twice, freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { makeState, mulberry32, TICK, clamp } from './state.js';
import { createWorld } from './world.js';
import { createSim, stepSim, resetRound, startMatch, playerShoot, buyWeapon, buyItem } from './sim.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { buildAgentMesh, syncAgentMesh } from './agents.js';
import { weaponSpread, weaponCanFire, weaponReload } from './weapons.js';
import { SITES } from './map.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(seed);

const state = makeState();
state.rngSeed = seed;
const sim = createSim(rng);
const audio = createAudio();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, shot ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);
const world = createWorld(scene);

// Agent meshes: one Group per agent, rebuilt when the round resets.
const agentGroup = new THREE.Group();
scene.add(agentGroup);
function rebuildAgentMeshes() {
  agentGroup.clear();
  for (const a of sim.agents) agentGroup.add(buildAgentMesh(a));
}

// Viewmodel gun + muzzle flash, attached to the camera.
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.6 });
const gunAccent = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5, emissive: 0x903a00, emissiveIntensity: 0.5 });
const gun = new THREE.Group();
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), gunMat);
const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), gunMat);
gunBarrel.position.set(0, 0.02, -0.4);
const gunSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), gunAccent);
gunSight.position.set(0, 0.1, -0.1);
gun.add(gunBody, gunBarrel, gunSight);
gun.position.set(0.28, -0.24, -0.5);
camera.add(gun);
const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, side: THREE.DoubleSide }));
flash.position.set(0.28, -0.2, -0.85);
camera.add(flash);
const flashLight = new THREE.PointLight(0xffc37a, 0, 9, 2);
flashLight.position.set(0.28, -0.2, -0.8);
camera.add(flashLight);
let flashT = 0, recoilKick = 0, recoilOffset = 0, gunKick = 0;

// Tracer pool: 24 reusable lines, no allocation in the hot loop.
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, t: 0 });
}
let tracerIdx = 0;
function spawnTracer(ax, ay, az, bx, by, bz) {
  const tr = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = tr.line.geometry.attributes.position;
  pos.setXYZ(0, ax, ay, az); pos.setXYZ(1, bx, by, bz);
  pos.needsUpdate = true;
  tr.line.material.opacity = 0.9;
  tr.t = 0.09;
}
// Explosion flash pool (one reusable sphere + light).
const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0 }));
scene.add(boom);
let boomT = 0;

// Bomb spike mesh (carried / dropped / planted).
const spike = new THREE.Group();
const spikeBody = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.35),
  new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0x664400, emissiveIntensity: 0.8 }));
const spikeLight = new THREE.PointLight(0xff4444, 0, 10, 2);
spike.add(spikeBody, spikeLight);
scene.add(spike);

const hud = createHud({
  buy: (id) => buyWeapon(sim, state, id),
  buyItem: (what) => buyItem(sim, state, what),
});
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

let started = false;      // match started (start screen dismissed)
let frozen = false;       // shot mode freeze
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let deadShown = false;
let buyWasOpen = false;
let zoomed = false;

function eyeHeight() { return sim.player.crouched ? 1.05 : 1.62; }
function syncCamera() {
  const p = sim.player;
  camera.position.set(p.x, p.y + eyeHeight(), p.z);
  camera.rotation.set(p.pitch + recoilOffset, p.yaw, 0, 'YXZ');
  camera.fov = zoomed ? 74 / (p.weapon.def.zoom || 1) : 74;
  camera.updateProjectionMatrix();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) { audio.unlock(); hud.hideOverlay(); }
  else if (started && state.phase !== 'matchEnd' && sim.player.alive) {
    hud.showOverlay('paused', 'PAUSED — Kestrel Yard',
      'Click to re-enter the yard. WASD move · mouse aim · click fire · R reload · B buy · G grenade · E plant · Ctrl crouch.',
      'Resume');
  }
}

hud.showOverlay('start', 'EMBERLINE YARD',
  'Round-based tactical FPS. <b>Ember</b> attacks, <b>Ash</b> defends two sites. ' +
  'Plant the spike at <b>Site A</b> or <b>Site B</b> — or eliminate the Ash crew. ' +
  'Win rounds, earn credits, buy better guns between rounds. ' +
  'Stop to aim: moving and spraying punishes your spread.<br><br>' +
  'WASD move · Shift sprint · Ctrl crouch · click fire · R reload · B buy menu · G frag grenade · E plant/defuse · right-click scope (Needle-50).',
  'Enter the yard');
document.getElementById('overlay-btn').addEventListener('click', () => {
  audio.unlock();
  if (!started) {
    started = true;
    startMatch(sim, state);
    rebuildAgentMeshes();
    hud.showBuy(true);
  }
  if (state.phase === 'matchEnd') {
    startMatch(sim, state);
    rebuildAgentMeshes();
  }
  hud.hideOverlay();
  input.requestLock();
});
document.getElementById('buy-close').addEventListener('click', () => hud.showBuy(false));

// --- player shooting --------------------------------------------------------
function resolveShot() {
  const p = sim.player;
  camera.getWorldDirection(_dir);
  const spread = weaponSpread(p.weapon, sim.playerSpeed, p.crouched, false);
  _dir.x += (rng() * 2 - 1) * spread;
  _dir.y += (rng() * 2 - 1) * spread;
  _dir.z += (rng() * 2 - 1) * spread;
  _dir.normalize();
  _eye.copy(camera.position);
  raycaster.set(_eye, _dir);
  const targets = [];
  for (const a of sim.agents) {
    if (a.isPlayer || !a.alive) continue;
    targets.push(a.headMesh, a.bodyMesh);
  }
  const hits = raycaster.intersectObjects(targets.concat(world.shootables), false);
  const first = hits[0];
  let end;
  if (first && first.object.userData.agent) {
    const ag = first.object.userData.agent;
    end = first.point;
    spawnTracer(_eye.x, _eye.y, _eye.z, end.x, end.y, end.z);
    playerShoot(sim, state, { agent: ag, part: first.object.userData.part, dist: first.distance });
  } else if (first) {
    end = first.point;
    spawnTracer(_eye.x, _eye.y, _eye.z, end.x, end.y, end.z);
    playerShoot(sim, state, { world: true, dist: first.distance });
  } else {
    end = _eye.clone().addScaledVector(_dir, 60);
    spawnTracer(_eye.x, _eye.y, _eye.z, end.x, end.y, end.z);
    playerShoot(sim, state, null);
  }
  flashT = 0.05;
  gunKick = 1;
}

// --- events from the sim ------------------------------------------------------
function drainEvents() {
  for (const e of state.events) {
    switch (e.type) {
      case 'shot':
        audio.shot(e.kind, e.dist || 0);
        if (e.fromBot) {
          // bot muzzle is visible as a short tracer handled by botTracer
        }
        break;
      case 'botTracer':
        spawnTracer(e.from.x, e.from.y, e.from.z, e.to.x, e.to.y, e.to.z);
        break;
      case 'dry': audio.dry(); break;
      case 'hit': hud.hitMarker(e.kill); audio.hit(e.kill); break;
      case 'hurt': audio.hurt(); break;
      case 'recoil': recoilKick += e.amount; break;
      case 'reload': break;
      case 'grenade': audio.grenade(); break;
      case 'explosion':
        audio.explosion();
        boom.position.set(e.x, Math.max(0.6, e.y), e.z);
        boomT = 0.5;
        break;
      case 'plant': audio.plant(); break;
      case 'beep': audio.beep(); break;
      case 'buy': audio.buy(); break;
      case 'roundWin': audio.win(); break;
      case 'roundLose': audio.lose(); break;
      case 'matchWin': audio.win(); break;
      case 'matchLose': audio.lose(); break;
      case 'died':
        input.releaseLock();
        hud.showOverlay('dead', "YOU'RE DOWN",
          'Your crew fights on. Watch the round play out — the next round starts automatically.',
          'Keep watching');
        deadShown = true;
        break;
      default: break;
    }
  }
  state.events.length = 0;
}

// --- fixed-step frame ---------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) { renderer.render(scene, camera); return; }
  elapsed += dt;

  // look + zoom
  if (input.locked) {
    const look = input.takeLook();
    sim.player.yaw -= look.x * 0.0021;
    sim.player.pitch = clamp(sim.player.pitch - look.y * 0.0021, -1.45, 1.45);
  }

  // buy menu toggle
  if (started && state.phase === 'buy' && input.keys.has('KeyB')) {
    input.keys.delete('KeyB');
    hud.showBuy(!hud.isBuyOpen());
  }
  // number-key buys during the buy phase
  if (started && state.phase === 'buy') {
    const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
    buyKeys.forEach((code, i) => {
      if (input.keys.has(code)) { input.keys.delete(code); buyWeapon(sim, state, ['kestrel', 'hornet', 'breacher', 'longbow', 'needle'][i]); }
    });
    if (input.keys.has('Digit6')) { input.keys.delete('Digit6'); buyItem(sim, state, 'grenade'); }
    if (input.keys.has('Digit7')) { input.keys.delete('Digit7'); buyItem(sim, state, 'armor'); }
  }
  if (state.phase === 'buy' && !buyWasOpen) hud.showBuy(true);
  if (state.phase !== 'buy' && buyWasOpen) hud.showBuy(false);
  buyWasOpen = state.phase === 'buy';

  // firing (semi-auto weapons need a fresh click; input.firing is held-state
  // so semi-auto is gated by cooldown + a click flag in resolveShot caller)
  if (started && input.locked && sim.player.alive &&
    (state.phase === 'live' || state.phase === 'planted') && input.firing) {
    const w = sim.player.weapon;
    if (w.def.auto) { if (weaponCanFire(w)) resolveShot(); }
    else if (weaponCanFire(w) && !sim._semiHeld) { resolveShot(); sim._semiHeld = true; }
  }
  if (!input.firing) sim._semiHeld = false;
  if (started && input.consumeReload() && sim.player.alive) {
    if (weaponReload(sim.player.weapon)) audio.reload();
  }

  // fixed-step simulation
  accumulator += dt;
  let steps = 0;
  while (accumulator >= TICK && steps < 5) {
    stepSim(sim, state, input, TICK);
    accumulator -= TICK;
    steps += 1;
  }
  if (accumulator > TICK * 5) accumulator = 0;

  // round transitions: rebuild bot meshes, re-open buy, end-of-match overlay
  if (state.phase === 'buy' && sim._lastPhase !== 'buy' && started) {
    rebuildAgentMeshes();
    deadShown = false;
  }
  if (state.phase === 'matchEnd' && sim._lastPhase !== 'matchEnd') {
    input.releaseLock();
    hud.showOverlay('match', state.matchMsg, `Kills ${state.kills} · Deaths ${state.deaths} · Plants ${state.plants}`, 'Play again');
  }
  if (state.phase === 'roundEnd' && sim._lastPhase !== 'roundEnd') {
    hud.showOverlay('round', state.roundMsg, `Score Ember ${state.score.ember} — ${state.score.ash} Ash · next round in a moment…`, 'Continue');
    setTimeout(() => { if (state.phase === 'roundEnd') hud.hideOverlay(); }, 1800);
  }
  sim._lastPhase = state.phase;

  // recoil decay + gun kick
  recoilKick = Math.max(0, recoilKick - dt * 0.35);
  recoilOffset = recoilKick * 0.35;
  gunKick = Math.max(0, gunKick - dt * 6);
  gun.position.z = -0.5 + gunKick * 0.09;
  gun.position.y = -0.24 + Math.sin(elapsed * 1.8) * 0.004 * Math.min(1, sim.playerSpeed / 4);
  flash.material.opacity = flashT > 0 ? 0.95 : 0;
  flashLight.intensity = flashT > 0 ? 6 : 0;
  flashT = Math.max(0, flashT - dt);
  if (boomT > 0) {
    boomT -= dt;
    const k = 1 - boomT / 0.5;
    boom.scale.setScalar(0.5 + k * 6);
    boom.material.opacity = Math.max(0, 0.8 * (1 - k));
  }

  // tracers fade
  for (const tr of tracers) {
    if (tr.t > 0) { tr.t -= dt; tr.line.material.opacity = Math.max(0, tr.t / 0.09) * 0.9; }
  }
  // spike mesh follows the bomb state
  if (state.bomb.state === 'planted') {
    spike.visible = true;
    spike.position.set(state.bomb.x, 0.35, state.bomb.z);
    spikeLight.intensity = (Math.sin(elapsed * 8) > 0) ? 4 : 0.5;
  } else if (state.bomb.state === 'dropped') {
    spike.visible = true;
    spike.position.set(state.bomb.x, 0.35, state.bomb.z);
    spikeLight.intensity = 1;
  } else spike.visible = false;

  for (const a of sim.agents) syncAgentMesh(a);
  syncCamera();
  drainEvents();
  hud.update(sim, state, dt);
  renderer.render(scene, camera);
}

// --- deterministic screenshot staging -----------------------------------------
function stageShot(name) {
  hud.hideOverlay();
  started = true;
  startMatch(sim, state);
  rebuildAgentMeshes();
  const p = sim.player;
  if (name === 'start') {
    // buy phase: player at spawn looking up Mid, allies beside, buy menu open
    state.phase = 'buy'; state.phaseT = 8;
    p.x = -2; p.z = 30; p.yaw = 0.08; p.pitch = 0.02;
    sim.agents[1].x = -6; sim.agents[1].z = 27; sim.agents[1].yaw = 0.2;
    sim.agents[2].x = 2; sim.agents[2].z = 27; sim.agents[2].yaw = -0.15;
    hud.showBuy(true);
    state.roundMsg = 'ROUND 1 — buy up, then take a site.';
  } else if (name === 'play') {
    // live combat mid-map: enemy in the lane, tracer + hitmarker staged
    state.phase = 'live'; state.phaseT = 78;
    state.round = 3; state.score = { ember: 2, ash: 1 }; state.money = 2450;
    p.x = 0; p.z = 14; p.yaw = 0.05; p.pitch = 0.01;
    p.weapon = { ...p.weapon, mag: 21 };
    const enemy = sim.agents.find(a => a.team === 'ash');
    enemy.x = 0.5; enemy.z = -6; enemy.yaw = Math.PI; enemy.alive = true;
    const ally = sim.agents[1];
    ally.x = -5; ally.z = 10; ally.yaw = 0.3;
    for (let i = 0; i < 40; i++) stepSim(sim, state, { keys: new Set(), consumeReload: () => false }, TICK);
    // stage one visible shot at the enemy
    // aim the camera at the enemy: yaw = atan2(-dx, -dz) for (-sin, -cos) forward
    p.yaw = Math.atan2(-(enemy.x - p.x), -(enemy.z - p.z));
    syncCamera();
    resolveShot();
    hud.hitMarker(false);
    state.roundMsg = 'Mid control — Ash crew holding the gantry.';
  } else if (name === 'plant') {
    // spike plant at Site A: player inside the ring, progress bar mid-plant
    state.phase = 'live'; state.phaseT = 45;
    state.round = 2; state.score = { ember: 1, ash: 0 }; state.money = 1800;
    state.bomb.plantProgress = 2.1;
    state.bomb.site = 'A';
    p.x = -20; p.z = -18; p.yaw = 2.6; p.pitch = -0.05;
    const enemy = sim.agents.find(a => a.team === 'ash');
    enemy.x = -13; enemy.z = -22; enemy.yaw = Math.PI * 0.8; enemy.alive = true;
    const ally = sim.agents[1];
    ally.x = -26; ally.z = -14; ally.yaw = 0.8;
    for (let i = 0; i < 20; i++) stepSim(sim, state, { keys: new Set(), consumeReload: () => false }, TICK);
    state.bomb.plantProgress = 2.1; // keep the bar visible after the settle
    state.roundMsg = 'Site A — planting the spike. Cover the planter.';
  } else { // end
    state.phase = 'roundEnd'; state.phaseT = 3;
    state.round = 4; state.score = { ember: 3, ash: 1 }; state.money = 5100;
    state.roundMsg = 'ROUND WON — Ash team eliminated.';
    p.x = -4; p.z = 6; p.yaw = -0.5; p.pitch = 0;
    hud.showOverlay('round', state.roundMsg, 'Score Ember 3 — 1 Ash · next round in a moment…', 'Continue');
  }
  syncCamera();
  for (const a of sim.agents) syncAgentMesh(a);
  hud.update(sim, state, 0.016);
}

function paintTwiceThenReady() {
  let painted = 0;
  (function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) { window.__shotReady = true; frozen = true; }
  }());
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2 && sim.player.weapon.def.zoom) zoomed = !zoomed;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// test / automation hooks (no network, local only)
window.__game = { state, sim, startMatch: () => { started = true; startMatch(sim, state); rebuildAgentMeshes(); },
  buyWeapon: (id) => buyWeapon(sim, state, id), buyItem: (w) => buyItem(sim, state, w),
  // dev hook: advance the fixed-step sim without rendering (headless
  // SwiftShader renders far below 60 fps, so real time runs in slow motion)
  ff: (seconds, keys = []) => { const n = Math.round(seconds / TICK);
    const k = new Set(keys);
    for (let i = 0; i < n; i++) stepSim(sim, state, { keys: k, consumeReload: () => false }, TICK); },
  shootOnce: () => resolveShot(),
  input, };

syncCamera();
if (shot) {
  stageShot(shot);
  paintTwiceThenReady();
} else {
  requestAnimationFrame(frame);
}
