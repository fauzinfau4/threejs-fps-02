// agents.js — bot brains + their 3D bodies. One module, two jobs kept apart:
// `createAgent` builds state; `stepBot` decides; `buildAgentMesh` /
// `syncAgentMesh` render. Bots follow waypoint routes, hold at corners,
// scan, engage on line of sight, react to gunshot noise, and — on defence —
// hold sites, rotate to a plant, and defuse when the coast is clear.
// Allies do the same on attack, covering the other site.
import * as THREE from 'three';
import { NODES, ROUTES, HOLD_NODES, segmentBlocked, collide, inSite, SITES } from './map.js';
import { makeWeapon, weaponStep, weaponCanFire, weaponFire, weaponDamage, weaponSpread } from './weapons.js';
import { clamp, lerp } from './state.js';

export const BOT_NAMES = {
  ember: ['Rook', 'Vega', 'Iris'],
  ash: ['Bram', 'Koda', 'Nyx', 'Sable', 'Fenn'],
};
const SKINS = { ember: 0xf97316, ash: 0x38bdf8 };

export function createAgent(team, name, isPlayer, x, z, yaw) {
  return {
    team, name, isPlayer,
    x, z, y: 0, yaw, pitch: 0,
    vx: 0, vz: 0, speed: 0,
    crouched: false, alive: true,
    hp: 100, armor: 0,
    weapon: makeWeapon(isPlayer ? 'kestrel' : 'longbow'),
    grenades: isPlayer ? 0 : 0,
    // bot brain
    route: [], routeIdx: 0, holdT: 0, scanYaw: 0, reactT: 0,
    target: null, lastSeen: null, alert: null, alertT: 0,
    burstLeft: 0, burstPause: 0, strafeDir: 1, strafeT: 0,
    plantT: 0, defuseT: 0, thinkT: Math.random() * 0.2,
    mesh: null, headMesh: null, bodyMesh: null,
    flashT: 0, stepT: 0,
  };
}

export function buildAgentMesh(agent) {
  const g = new THREE.Group();
  const col = SKINS[agent.team];
  const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.05, 10), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), darkMat);
  head.position.y = 1.72;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1),
    new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8 }));
  visor.position.set(0, 1.74, 0.2);
  g.add(visor);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), darkMat);
  gun.position.set(0.28, 1.25, 0.35);
  g.add(gun);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.3), darkMat);
  legs.position.y = 0.22;
  g.add(legs);
  g.position.set(agent.x, 0, agent.z);
  agent.mesh = g; agent.headMesh = head; agent.bodyMesh = body;
  agent.mesh.userData.agent = agent;
  head.userData.agent = agent; head.userData.part = 'head';
  body.userData.agent = agent; body.userData.part = 'body';
  return g;
}

export function syncAgentMesh(a) {
  if (!a.mesh) return;
  a.mesh.visible = a.alive;
  if (!a.alive) return;
  a.mesh.position.set(a.x, a.y, a.z);
  a.mesh.rotation.y = a.yaw;
  const bob = Math.sin(a.stepT * 10) * 0.03 * Math.min(1, a.speed / 4);
  a.mesh.position.y = a.y + Math.abs(bob);
  a.mesh.scale.y = a.crouched ? 0.78 : 1;
  const flash = a.flashT > 0 ? 1 : 0.25;
  a.bodyMesh.material.emissive.setHex(flash > 0.5 ? 0xffffff : 0x000000);
  a.bodyMesh.material.emissiveIntensity = flash > 0.5 ? 0.5 : 0;
}

// --- bot setup -------------------------------------------------------------
export function assignRoute(agent, rng, site) {
  const keys = site === 'A' ? ['A', 'mid'] : site === 'B' ? ['B', 'midB'] : ['A', 'mid', 'B', 'midB'];
  const key = keys[Math.floor(rng() * keys.length)];
  agent.route = ROUTES[key].slice();
  agent.routeIdx = 0;
  agent.holdT = 0;
}
export function assignDefence(agent, rng) {
  // defenders walk to a site and hold a node near it
  const site = rng() < 0.5 ? 'A' : 'B';
  agent.route = site === 'A' ? [9, 12, 10] : [9, 13, 11];
  agent.routeIdx = 0;
  agent.defSite = site;
  agent.holdT = 0;
}

// --- bot perception --------------------------------------------------------
function canSee(a, b, eyeH = 1.55) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d > 42) return 0;
  if (segmentBlocked(a.x, a.z, b.x, b.z, eyeH)) return 0;
  return d;
}
function nearestEnemy(agent, agents) {
  let best = null, bestD = 1e9;
  for (const o of agents) {
    if (!o.alive || o.team === agent.team) continue;
    const d = canSee(agent, o);
    if (d > 0 && d < bestD) { bestD = d; best = o; }
  }
  return best ? { agent: best, dist: bestD } : null;
}

// --- bot decision + movement (called from sim at fixed step) ---------------
export function stepBot(a, dt, ctx) {
  const { agents, state, rng } = ctx;
  if (!a.alive) return;
  a.thinkT -= dt;
  a.flashT = Math.max(0, a.flashT - dt);
  weaponStep(a.weapon, dt);

  // hearing: a recent loud noise pulls the bot toward it for a few seconds
  if (a.alertT <= 0) {
    for (const n of state.noise) {
      if (state.time - n.t < 1.2 && Math.hypot(n.x - a.x, n.z - a.z) < n.r) {
        a.alert = { x: n.x, z: n.z }; a.alertT = 3.5;
        break;
      }
    }
  } else a.alertT -= dt;

  const seen = nearestEnemy(a, agents);
  if (seen) {
    a.target = seen.agent;
    a.lastSeen = { x: seen.agent.x, z: seen.agent.z, t: state.time };
    a.reactT = Math.max(a.reactT, 0.25 + rng() * 0.25); // reaction delay
  } else if (a.lastSeen && state.time - a.lastSeen.t > 2.5) {
    a.target = null;
  }

  let mx = 0, mz = 0, wantSpeed = 3.6;
  const bomb = state.bomb;

  if (a.target && a.reactT <= 0) {
    // combat: face the enemy, strafe, fire in bursts
    const t = a.target;
    const dx = t.x - a.x, dz = t.z - a.z;
    const d = Math.hypot(dx, dz) || 1;
    a.yaw = Math.atan2(dx, dz);
    a.strafeT -= dt;
    if (a.strafeT <= 0) { a.strafeDir = rng() < 0.5 ? -1 : 1; a.strafeT = 0.7 + rng() * 0.9; }
    const px = -dz / d * a.strafeDir, pz = dx / d * a.strafeDir;
    const close = d < 7 ? -0.8 : d > 22 ? 0.5 : 0;
    mx = px * 0.7 + (dx / d) * close;
    mz = pz * 0.7 + (dz / d) * close;
    wantSpeed = 2.2;
    if (a.burstPause > 0) a.burstPause -= dt;
    else {
      if (a.burstLeft <= 0) { a.burstLeft = 2 + Math.floor(rng() * 3); a.burstPause = 0; }
      if (weaponCanFire(a.weapon) && a.burstLeft > 0) {
        ctx.fireBot(a, t, d);
        a.burstLeft -= 1;
        if (a.burstLeft <= 0) a.burstPause = 0.45 + rng() * 0.5;
      }
    }
  } else {
    a.reactT = Math.max(0, a.reactT - dt);
    // bomb logic for defenders after a plant
    if (a.team === 'ash' && bomb.state === 'planted') {
      const dSite = Math.hypot(bomb.x - a.x, bomb.z - a.z);
      if (dSite < 1.6) {
        // defuse only when no living attacker is near the site
        const near = agents.some(o => o.alive && o.team === 'ember' &&
          Math.hypot(o.x - bomb.x, o.z - bomb.z) < 12);
        if (!near) {
          a.defuseT += dt;
          ctx.onDefuseProgress(a, dt);
          if (a.defuseT > 0.2) { mx = 0; mz = 0; wantSpeed = 0; }
        }
      } else { mx = (bomb.x - a.x) / (dSite || 1); mz = (bomb.z - a.z) / (dSite || 1); wantSpeed = 4.4; }
    } else if (a.team === 'ash' && bomb.state === 'dropped') {
      // a defender guards the dropped spike
      const dSite = Math.hypot(bomb.x - a.x, bomb.z - a.z);
      if (dSite > 6) { mx = (bomb.x - a.x) / (dSite || 1); mz = (bomb.z - a.z) / (dSite || 1); wantSpeed = 3.8; }
      else { a.scanYaw += dt * 0.7; a.yaw = a.scanYaw; }
    } else if (a.alert && !a.target) {
      // investigate the noise, then resume the route
      const dA = Math.hypot(a.alert.x - a.x, a.alert.z - a.z);
      if (dA > 1.2) { mx = (a.alert.x - a.x) / dA; mz = (a.alert.z - a.z) / dA; wantSpeed = 4.2; }
      else a.alert = null;
    } else if (a.routeIdx < a.route.length) {
      const node = NODES[a.route[a.routeIdx]];
      const dx = node.x - a.x, dz = node.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.9) {
        a.routeIdx += 1;
        if (HOLD_NODES.has(node.id)) { a.holdT = 1.2 + rng() * 1.4; a.scanYaw = a.yaw; }
      } else if (a.holdT > 0) {
        a.holdT -= dt;
        a.scanYaw += dt * 0.9;
        a.yaw = a.scanYaw;
        wantSpeed = 0;
      } else {
        mx = dx / d; mz = dz / d;
        a.yaw = Math.atan2(dx, dz);
      }
    } else {
      // at destination: hold and scan
      a.scanYaw += dt * 0.55;
      a.yaw = a.scanYaw;
      wantSpeed = 0;
    }
  }

  // acceleration + friction, then collide (shared with the player in sim.js
  // via ctx.moveAgent)
  ctx.moveAgent(a, mx, mz, wantSpeed, dt);
  a.stepT += dt * Math.min(1, a.speed / 3);
}

// Bot shot: accuracy falls with distance, target speed and own movement.
export function botShotAccuracy(a, target, dist) {
  const base = 0.30 + 0.35 * Math.max(0, 1 - dist / 42);
  const movePen = 0.55 + 0.45 * Math.max(0, 1 - target.speed / 5);
  return base * movePen;
}
export { weaponDamage, weaponSpread };
