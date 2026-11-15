// map.js — "Kestrel Yard": an original freight-yard map, invented for this game.
// Layout (x east, z south, metres, origin at mid): attackers (Ember) spawn
// south, defenders (Ash) spawn north. Site A = north-west warehouse yard,
// Site B = north-east silo yard. Three lanes: A-Long (west), Mid (centre,
// through the crane gantry), B-Tunnel (east, under the silo pipes).
// Colliders are axis-aligned boxes {x0,z0,x1,z1,h} — cheap, exact, shared by
// movement, line-of-sight and bot navigation.
export const MAP = { half: 34, wallH: 4.2 };

export const SITES = {
  A: { name: 'Site A — Warehouse', cx: -20, cz: -20, r: 6.5 },
  B: { name: 'Site B — Silo', cx: 20, cz: -20, r: 6.5 },
};

// Static solid boxes. The outer fence is handled by clamping to MAP.half.
export const COLLIDERS = [
  // --- Site A warehouse (north-west block) ---
  { x0: -32, z0: -32, x1: -24, z1: -26, h: 4.2 },   // A warehouse west wall block
  { x0: -24, z0: -32, x1: -12, z1: -30, h: 4.2 },   // A warehouse north wall
  { x0: -14, z0: -28, x1: -12, z1: -18, h: 4.2 },   // A warehouse east wall
  { x0: -26, z0: -24, x1: -20, z1: -21, h: 2.6 },   // A crate stack
  { x0: -18, z0: -26, x1: -15, z1: -23, h: 1.4 },   // A low crate
  // --- Site B silo (north-east block) ---
  { x0: 12, z0: -32, x1: 14, z1: -18, h: 4.2 },     // B silo west wall
  { x0: 14, z0: -32, x1: 26, z1: -30, h: 4.2 },     // B silo north wall
  { x0: 24, z0: -30, x1: 32, z1: -26, h: 4.2 },     // B tank block
  { x0: 17, z0: -25, x1: 21, z1: -21, h: 2.6 },     // B crate stack
  { x0: 24, z0: -22, x1: 27, z1: -19, h: 1.4 },     // B low crate
  // --- Mid: crane gantry pillars + containers ---
  { x0: -2, z0: -8, x1: -0.6, z1: -6, h: 5.0 },     // gantry pillar west
  { x0: 0.6, z0: -8, x1: 2, z1: -6, h: 5.0 },       // gantry pillar east
  { x0: -8, z0: -2, x1: -4, z1: 1, h: 2.6 },        // mid container blue
  { x0: 4, z0: 2, x1: 8, z1: 5, h: 2.6 },           // mid container rust
  { x0: -6, z0: 10, x1: -3, z1: 13, h: 1.4 },       // mid low crate
  // --- A-Long (west lane) ---
  { x0: -30, z0: -12, x1: -27, z1: -8, h: 2.6 },    // A-long container
  { x0: -28, z0: 2, x1: -25, z1: 6, h: 1.4 },       // A-long crate
  { x0: -30, z0: 14, x1: -26, z1: 17, h: 2.6 },     // A-long south stack
  // --- B-Tunnel (east lane) ---
  { x0: 25, z0: -12, x1: 28, z1: -8, h: 2.6 },      // B-tunnel container
  { x0: 24, z0: 2, x1: 27, z1: 6, h: 1.4 },         // B-tunnel crate
  { x0: 26, z0: 14, x1: 30, z1: 17, h: 2.6 },       // B-tunnel south stack
  // --- Attacker spawn cover (south) ---
  { x0: -10, z0: 24, x1: -6, z1: 27, h: 2.6 },
  { x0: 6, z0: 24, x1: 10, z1: 27, h: 2.6 },
  { x0: -2, z0: 18, x1: 2, z1: 20, h: 1.4 },
  // --- Defender spawn cover (north centre) ---
  { x0: -4, z0: -14, x1: 4, z1: -12, h: 2.6 },
];

export const SPAWNS = {
  ember: [ // attackers, south edge, facing north (-z)
    { x: -6, z: 30 }, { x: -2, z: 31 }, { x: 2, z: 31 }, { x: 6, z: 30 },
  ],
  ash: [   // defenders, spread across the two sites
    { x: -22, z: -16 }, { x: -14, z: -14 }, { x: 0, z: -16 },
    { x: 18, z: -14 }, { x: 24, z: -16 },
  ],
};

// Waypoint graph for bots. Nodes are open ground; edges are walkable lanes.
// Bots pick a route (A-long / mid / B-tunnel) and walk node to node, pausing
// at "hold" nodes to scan corners.
export const NODES = [
  { id: 0, x: 0, z: 28, links: [1, 2, 3] },        // attacker spawn centre
  { id: 1, x: -24, z: 22, links: [0, 4] },         // A-long south
  { id: 2, x: 0, z: 16, links: [0, 5, 6] },        // mid south
  { id: 3, x: 24, z: 22, links: [0, 7] },          // B-tunnel south
  { id: 4, x: -27, z: 0, links: [1, 8] },          // A-long mid (hold)
  { id: 5, x: 0, z: 4, links: [2, 9] },            // mid gantry (hold)
  { id: 6, x: 12, z: 12, links: [2, 7] },          // mid-east cut
  { id: 7, x: 26, z: 0, links: [3, 6, 11] },       // B-tunnel mid (hold)
  { id: 8, x: -22, z: -12, links: [4, 10] },       // A approach
  { id: 9, x: 0, z: -8, links: [5, 10, 11] },      // mid north (hold)
  { id: 10, x: -20, z: -20, links: [8, 9] },       // Site A
  { id: 11, x: 20, z: -20, links: [7, 9] },        // Site B
  { id: 12, x: -8, z: -16, links: [9, 10] },       // A connector
  { id: 13, x: 8, z: -16, links: [9, 11] },        // B connector
];
export const ROUTES = {
  A: [0, 1, 4, 8, 10],
  mid: [0, 2, 5, 9, 10],
  B: [0, 3, 7, 11],
  midB: [0, 2, 6, 7, 11],
};
export const HOLD_NODES = new Set([4, 5, 7, 9]);

// 2D segment-vs-AABB test used for line of sight (ignores low crates h<2
// when both endpoints' eye height clears them — handled by caller's h test).
export function segmentBlocked(x0, z0, x1, z1, eyeH = 1.5) {
  for (const c of COLLIDERS) {
    if (c.h < eyeH) continue; // can see over low crates
    if (segHitsBox(x0, z0, x1, z1, c)) return true;
  }
  return false;
}
function segHitsBox(x0, z0, x1, z1, b) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) return false; }
  else {
    let t1 = (b.x0 - x0) / dx, t2 = (b.x1 - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 || z0 > b.z1) return false; }
  else {
    let t1 = (b.z0 - z0) / dz, t2 = (b.z1 - z0) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Circle (agent radius r) vs colliders + outer fence. Mutates pos in place,
// returns true when a collision pushed the agent.
export function collide(pos, r) {
  let hit = false;
  const H = MAP.half - 0.6;
  if (pos.x < -H) { pos.x = -H; hit = true; }
  if (pos.x > H) { pos.x = H; hit = true; }
  if (pos.z < -H) { pos.z = -H; hit = true; }
  if (pos.z > H) { pos.z = H; hit = true; }
  for (const c of COLLIDERS) {
    const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
    const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r; pos.z = nz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = pos.x - c.x0 + r, pr = c.x1 - pos.x + r;
        const pt = pos.z - c.z0 + r, pb = c.z1 - pos.z + r;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.x0 - r; else if (m === pr) pos.x = c.x1 + r;
        else if (m === pt) pos.z = c.z0 - r; else pos.z = c.z1 + r;
      }
      hit = true;
    }
  }
  return hit;
}

export function inSite(x, z, site) {
  const dx = x - site.cx, dz = z - site.cz;
  return dx * dx + dz * dz < site.r * site.r;
}
