// sim.js — the fixed-step simulation, kept apart from rendering.
// Owns: player movement (acceleration, crouch, collision), shooting
// resolution (raycast vs agent hit meshes + world), grenades, the bomb,
// round flow and the economy. main.js only renders this state and feeds
// it input; hud.js only reads it.
import { collide, inSite, SITES, segmentBlocked } from './map.js';
import { WEAPONS, ECON, ROUND_TIME, BUY_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_TIME,
  ROUNDS_TO_WIN, MAX_ROUNDS, clamp } from './state.js';
import { makeWeapon, weaponStep, weaponCanFire, weaponFire, weaponReload,
  weaponDamage, weaponSpread } from './weapons.js';
import { createAgent, stepBot, botShotAccuracy, assignRoute, assignDefence, BOT_NAMES } from './agents.js';

const EYE_STAND = 1.62, EYE_CROUCH = 1.05, RADIUS = 0.36;
const WALK = 4.6, CROUCH_SPEED = 2.3, SPRINT = 5.6, ACCEL = 34;

export function createSim(rng) {
  const sim = {
    rng,
    player: createAgent('ember', 'You', true, -2, 31, Math.PI),
    agents: [],
    grenades: [],   // {x,y,z,vx,vy,vz,t,owner}
    tracers: [],    // {ax,ay,az,bx,by,bz,t} rendered by main.js, pooled there
    playerSpeed: 0,
    firingHeld: false,
  };
  sim.agents.push(sim.player);
  return sim;
}

export function resetRound(sim, state, site) {
  const rng = sim.rng;
  // keep the player object, rebuild the bots fresh each round
  sim.agents.length = 0;
  sim.agents.push(sim.player);
  sim.grenades.length = 0;
  sim.tracers.length = 0;
  const p = sim.player;
  const spawn = { x: -2 + (rng() - 0.5) * 3, z: 31 };
  p.x = spawn.x; p.z = spawn.z; p.y = 0; p.yaw = 0; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.hp = 100; p.alive = true; p.crouched = false;
  p.weapon = makeWeapon(p.weapon.id); // keep bought weapon, refill ammo
  p.grenades = p.grenades; // kept across rounds
  // allies: 3 bots attacking the other site / mid
  for (let i = 0; i < 3; i++) {
    const b = createAgent('ember', BOT_NAMES.ember[i], false, -6 + i * 4, 30, 0);
    b.weapon = makeWeapon(['longbow', 'hornet', 'longbow'][i]);
    assignRoute(b, rng, site === 'A' ? 'B' : 'A');
    sim.agents.push(b);
  }
  // defenders: 5 bots holding the sites
  for (let i = 0; i < 5; i++) {
    const spawnD = [{ x: -22, z: -16 }, { x: -14, z: -14 }, { x: 0, z: -16 }, { x: 18, z: -14 }, { x: 24, z: -16 }][i];
    const b = createAgent('ash', BOT_NAMES.ash[i], false, spawnD.x, spawnD.z, Math.PI);
    b.weapon = makeWeapon(i === 4 ? 'needle' : 'longbow');
    assignDefence(b, rng);
    sim.agents.push(b);
  }
  state.bomb = { state: 'carried', site: null, x: 0, z: 0, timer: 0, plantProgress: 0, defuseProgress: 0 };
  state.phase = 'buy';
  state.phaseT = BUY_TIME;
  state.roundMsg = `ROUND ${state.round} — ${site === 'A' ? 'Site A' : 'Site B'} is the call. Buy up, then go.`;
}

export function startMatch(sim, state) {
  state.score = { ember: 0, ash: 0 };
  state.round = 1;
  state.money = ECON.start;
  state.kills = 0; state.deaths = 0; state.plants = 0; state.defuses = 0;
  sim.player.weapon = makeWeapon('kestrel');
  sim.player.grenades = 0;
  sim.player.armor = 0;
  state.phase = 'buy';
  resetRound(sim, state, sim.rng() < 0.5 ? 'A' : 'B');
}

// --- movement shared by player and bots -----------------------------------
export function moveAgent(sim, a, mx, mz, wantSpeed, dt) {
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    const nx = mx / len, nz = mz / len;
    a.vx += nx * ACCEL * dt;
    a.vz += nz * ACCEL * dt;
  }
  // friction
  const fr = Math.exp(-8 * dt);
  a.vx *= fr; a.vz *= fr;
  const sp = Math.hypot(a.vx, a.vz);
  const cap = wantSpeed;
  if (sp > cap && sp > 0.01) { a.vx *= cap / sp; a.vz *= cap / sp; }
  a.x += a.vx * dt;
  a.z += a.vz * dt;
  collide(a, RADIUS);
  a.speed = Math.hypot(a.vx, a.vz);
}

function playerEye(p) { return p.crouched ? EYE_CROUCH : EYE_STAND; }

// --- damage -----------------------------------------------------------------
export function damageAgent(sim, state, victim, dmg, attacker, head, silent) {
  if (!victim.alive) return;
  let d = dmg;
  if (victim.armor > 0) { const absorbed = Math.min(victim.armor, d * 0.5); victim.armor -= absorbed; d -= absorbed; }
  victim.hp -= d;
  victim.flashT = 0.12;
  if (victim.isPlayer) state.events.push({ type: 'hurt' });
  else if (attacker && attacker.isPlayer) state.events.push({ type: 'hit', kill: false });
  if (victim.hp <= 0) killAgent(sim, state, victim, attacker, head, silent);
}
function killAgent(sim, state, victim, attacker, head, silent) {
  victim.alive = false;
  victim.hp = 0;
  if (victim.isPlayer) {
    state.deaths += 1;
    state.events.push({ type: 'died' });
    if (state.bomb.state === 'carried') {
      state.bomb.state = 'dropped';
      state.bomb.x = victim.x; state.bomb.z = victim.z;
      state.events.push({ type: 'bombDropped' });
    }
  } else if (attacker && attacker.isPlayer) {
    state.kills += 1;
    state.money += ECON.kill;
    state.events.push({ type: 'hit', kill: true });
  }
  const who = attacker ? attacker.name : 'the yard';
  state.feed.unshift({ text: `${who} ▸ ${victim.name}${head ? '  [headshot]' : ''}`, cls: victim.team, t: state.time });
  if (state.feed.length > 5) state.feed.pop();
  checkRoundEnd(sim, state);
}

// --- round flow --------------------------------------------------------------
function aliveCount(sim, team) { return sim.agents.filter(a => a.alive && a.team === team).length; }
function checkRoundEnd(sim, state) {
  if (state.phase !== 'live' && state.phase !== 'planted') return;
  const ember = aliveCount(sim, 'ember');
  const ash = aliveCount(sim, 'ash');
  if (state.phase === 'planted') {
    if (ember === 0) { /* defenders may still defuse; wait for timer/defuse */ return; }
    if (ash === 0) return; // bomb still ticks — attackers win on detonation
    return;
  }
  if (ember === 0) endRound(sim, state, 'ash', 'Ember team eliminated.');
  else if (ash === 0) endRound(sim, state, 'ember', 'Ash team eliminated.');
}
export function endRound(sim, state, winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.phaseT = 4.5;
  const won = winner === 'ember';
  state.score[winner] += 1;
  state.money += won ? ECON.win : ECON.loss;
  state.roundMsg = won ? `ROUND WON — ${reason}` : `ROUND LOST — ${reason}`;
  state.events.push({ type: won ? 'roundWin' : 'roundLose' });
  if (state.score[winner] >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) {
    state.phase = 'matchEnd';
    state.phaseT = 999;
    const matchWon = state.score.ember > state.score.ash;
    state.matchMsg = matchWon
      ? `MATCH WON ${state.score.ember}–${state.score.ash}. Kestrel Yard is yours.`
      : `MATCH LOST ${state.score.ember}–${state.score.ash}. The Ash crew holds the yard.`;
    state.events.push({ type: matchWon ? 'matchWin' : 'matchLose' });
  }
}
function nextRound(sim, state) {
  state.round += 1;
  resetRound(sim, state, sim.rng() < 0.5 ? 'A' : 'B');
}

// --- player shooting (raycast supplied by main.js) ---------------------------
export function playerShoot(sim, state, hit) {
  // hit: {agent, part, dist} | {world:true, dist} | null — from main.js raycast
  const p = sim.player;
  if (!weaponFire(p.weapon)) { state.events.push({ type: 'dry' }); return; }
  const w = p.weapon;
  state.noise.push({ x: p.x, z: p.z, r: 26, t: state.time });
  state.events.push({ type: 'shot', kind: w.def.kind, dist: 0 });
  // recoil is a transient camera kick applied by main.js, not a permanent
  // change to aim — the player pulls back down, the gun does not climb away.
  state.events.push({ type: 'recoil', amount: w.def.recoil });
  if (!hit) return;
  if (hit.agent) {
    const pellets = w.def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      if (sim.rng() < (hit.part === 'head' ? 0.9 : 0.85)) {
        damageAgent(sim, state, hit.agent, weaponDamage(w, hit.dist, hit.part === 'head') / pellets,
          p, hit.part === 'head');
      }
    }
  }
}

// --- grenade ------------------------------------------------------------------
export function throwGrenade(sim, state) {
  const p = sim.player;
  if (p.grenades <= 0 || !p.alive) return false;
  p.grenades -= 1;
  const dir = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch) + 0.25, z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
  sim.grenades.push({ x: p.x, y: playerEye(p), z: p.z, vx: dir.x * 15, vy: dir.y * 15 + 2, vz: dir.z * 15, t: 1.6, owner: p });
  state.events.push({ type: 'grenade' });
  return true;
}
function stepGrenades(sim, state, dt) {
  for (let i = sim.grenades.length - 1; i >= 0; i--) {
    const g = sim.grenades[i];
    g.vy -= 14 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.1) { g.y = 0.1; g.vy *= -0.35; g.vx *= 0.6; g.vz *= 0.6; }
    const tmp = { x: g.x, z: g.z }; collide(tmp, 0.15); g.x = tmp.x; g.z = tmp.z;
    g.t -= dt;
    if (g.t <= 0) {
      state.events.push({ type: 'explosion', x: g.x, y: g.y, z: g.z });
      state.noise.push({ x: g.x, z: g.z, r: 34, t: state.time });
      for (const a of sim.agents) {
        if (!a.alive) continue;
        const d = Math.hypot(a.x - g.x, a.z - g.z);
        if (d < 7) damageAgent(sim, state, a, 95 * (1 - d / 7) + 20, g.owner, false);
      }
      sim.grenades.splice(i, 1);
    }
  }
}

// --- buying -------------------------------------------------------------------
export function buyWeapon(sim, state, id) {
  const def = WEAPONS[id];
  if (!def || state.phase !== 'buy') return false;
  if (id !== 'kestrel' && sim.player.weapon.id === id) return false;
  if (state.money < def.price) return false;
  state.money -= def.price;
  sim.player.weapon = makeWeapon(id);
  state.events.push({ type: 'buy' });
  return true;
}
export function buyItem(sim, state, what) {
  if (state.phase !== 'buy') return false;
  if (what === 'grenade') {
    if (state.money < 300 || sim.player.grenades >= 2) return false;
    state.money -= 300; sim.player.grenades += 1;
  } else if (what === 'armor') {
    if (state.money < 650 || sim.player.armor >= 100) return false;
    state.money -= 650; sim.player.armor = 100;
  } else return false;
  state.events.push({ type: 'buy' });
  return true;
}

// --- main fixed step -----------------------------------------------------------
export function stepSim(sim, state, input, dt) {
  state.time += dt;
  const p = sim.player;
  weaponStep(p.weapon, dt);
  if (state.phase === 'menu' || state.phase === 'matchEnd') return;

  if (state.phase === 'buy') {
    state.phaseT -= dt;
    if (state.phaseT <= 0) { state.phase = 'live'; state.phaseT = ROUND_TIME; }
    return;
  }
  if (state.phase === 'roundEnd') {
    state.phaseT -= dt;
    // bots idle; player can look around
    if (state.phaseT <= 0) nextRound(sim, state);
    return;
  }

  // live / planted timer
  state.phaseT -= dt;
  if (state.phase === 'live' && state.phaseT <= 0) {
    endRound(sim, state, 'ash', 'Time expired — the spike was never planted.');
    return;
  }
  if (state.phase === 'planted') {
    state.bomb.timer -= dt;
    if (Math.floor(state.bomb.timer * 2) !== Math.floor((state.bomb.timer + dt) * 2)) {
      state.events.push({ type: 'beep' });
    }
    if (state.bomb.timer <= 0) {
      state.events.push({ type: 'explosion', x: state.bomb.x, y: 0.5, z: state.bomb.z });
      endRound(sim, state, 'ember', 'The spike detonated at the site.');
      return;
    }
  }

  // --- player movement ---
  if (p.alive) {
    const k = input.keys;
    let fx = 0, fz = 0;
    if (k.has('KeyW')) fz -= 1;
    if (k.has('KeyS')) fz += 1;
    if (k.has('KeyA')) fx -= 1;
    if (k.has('KeyD')) fx += 1;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    // forward = (-sin, -cos), right = (cos, -sin); W (fz=-1) moves +forward
    const mx = fz * sin + fx * cos;
    const mz = fz * cos - fx * sin;
    p.crouched = k.has('ControlLeft') || k.has('KeyC');
    const sprint = k.has('ShiftLeft') && !p.crouched && fz < 0;
    const want = p.crouched ? CROUCH_SPEED : sprint ? SPRINT : WALK;
    moveAgent(sim, p, mx, mz, (fx || fz) ? want : 0, dt);
    sim.playerSpeed = p.speed;

    // plant / defuse progress (hold E)
    const site = inSite(p.x, p.z, SITES.A) ? SITES.A : inSite(p.x, p.z, SITES.B) ? SITES.B : null;
    if (k.has('KeyE') && state.phase === 'live' && state.bomb.state === 'carried' && site) {
      state.bomb.plantProgress += dt;
      state.bomb.site = site === SITES.A ? 'A' : 'B';
      if (state.bomb.plantProgress >= PLANT_TIME) {
        state.bomb.state = 'planted';
        state.bomb.x = site.cx; state.bomb.z = site.cz;
        state.bomb.timer = BOMB_TIME;
        state.phase = 'planted';
        state.phaseT = BOMB_TIME;
        state.money += ECON.plant;
        state.plants += 1;
        state.events.push({ type: 'plant' });
        state.roundMsg = `SPIKE PLANTED at Site ${state.bomb.site} — hold it until it blows.`;
      }
    } else if (state.bomb.state === 'carried') {
      state.bomb.plantProgress = Math.max(0, state.bomb.plantProgress - dt * 2);
    }
    // pick up a dropped spike
    if (state.bomb.state === 'dropped' && Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z) < 1.2) {
      state.bomb.state = 'carried';
      state.events.push({ type: 'buy' });
    }
    // grenade throw
    if (k.has('KeyG')) { k.delete('KeyG'); throwGrenade(sim, state); }
    if (input.consumeReload()) weaponReload(p.weapon);
  }

  // --- bots ---
  const ctx = {
    agents: sim.agents, state, rng: sim.rng,
    moveAgent: (a, mx, mz, sp, d) => moveAgent(sim, a, mx, mz, sp, d),
    fireBot(a, target, dist) {
      if (!weaponFire(a.weapon)) return;
      state.noise.push({ x: a.x, z: a.z, r: 24, t: state.time });
      const dCam = Math.hypot(a.x - p.x, a.z - p.z);
      state.events.push({ type: 'shot', kind: a.weapon.def.kind, dist: dCam, fromBot: true, x: a.x, z: a.z });
      const acc = botShotAccuracy(a, target, dist);
      const hitChance = acc * (target.crouched ? 0.8 : 1);
      if (sim.rng() < hitChance) {
        const head = sim.rng() < 0.14;
        // tracer for the bot shot is drawn by main.js from the event
        damageAgent(sim, state, target, weaponDamage(a.weapon, dist, head), a, head);
      }
      // tracer endpoint (hit or miss): main.js resolves it from the event
      state.events.push({ type: 'botTracer', from: { x: a.x, y: 1.45, z: a.z },
        to: { x: target.x, y: target.crouched ? 1.0 : 1.45, z: target.z }, hit: sim.rng() < hitChance });
    },
    onDefuseProgress(a, dt) {
      state.bomb.defuseProgress += dt;
      if (state.bomb.defuseProgress >= DEFUSE_TIME) {
        state.bomb.state = 'defused';
        state.defuses += 1;
        endRound(sim, state, 'ash', 'The spike was defused.');
      }
    },
  };
  for (const a of sim.agents) {
    if (!a.isPlayer) stepBot(a, dt, ctx);
    else a.flashT = Math.max(0, a.flashT - dt);
  }
  // bots standing on a dropped spike pick it up (attackers only, simplified: allies)
  if (state.bomb.state === 'dropped') {
    for (const a of sim.agents) {
      if (a.alive && a.team === 'ember' && !a.isPlayer &&
        Math.hypot(a.x - state.bomb.x, a.z - state.bomb.z) < 1.2) {
        state.bomb.state = 'carried';
        break;
      }
    }
  }
  stepGrenades(sim, state, dt);
  // decay old noises
  while (state.noise.length && state.time - state.noise[0].t > 2) state.noise.shift();
  checkRoundEnd(sim, state);
}
