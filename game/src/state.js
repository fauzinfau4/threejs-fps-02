// state.js — one place for all game state and tuning constants.
// EMBERLINE YARD: an original round-based tactical FPS. No commercial map,
// character or name is copied here; the map, teams and weapons are invented.
export const ROUND_TIME = 100;      // seconds before defenders win on time
export const BUY_TIME = 9;          // freeze / buy phase at the start of a round
export const PLANT_TIME = 3.0;      // seconds holding E inside a site to plant
export const DEFUSE_TIME = 4.5;     // seconds a defender needs to defuse
export const BOMB_TIME = 35;        // seconds from plant to detonation
export const ROUNDS_TO_WIN = 5;     // first team to 5 rounds takes the match
export const MAX_ROUNDS = 9;
export const TICK = 1 / 60;         // fixed simulation step

// Money (credits). Kill $300, round win $3250, round loss $1900, plant $300.
export const ECON = { start: 800, kill: 300, win: 3250, loss: 1900, plant: 300 };

// Weapons: accuracy beats fire-rate. Damage falls off with range, headshots
// pay 2x (sniper 2.5x). Spread grows while moving / firing, shrinks standing still.
export const WEAPONS = {
  kestrel: { id: 'kestrel', name: 'Kestrel-9', kind: 'pistol', price: 0,
    damage: 26, headMult: 2.0, rof: 0.28, mag: 12, reserve: 48, reload: 1.5,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, auto: false, range: 34, kick: 0.6 },
  hornet: { id: 'hornet', name: 'Hornet-9', kind: 'smg', price: 1200,
    damage: 20, headMult: 2.0, rof: 0.085, mag: 28, reserve: 112, reload: 2.0,
    spread: 0.017, moveSpread: 0.042, recoil: 0.008, auto: true, range: 30, kick: 0.5 },
  longbow: { id: 'longbow', name: 'Longbow-7', kind: 'rifle', price: 2700,
    damage: 34, headMult: 2.0, rof: 0.115, mag: 25, reserve: 100, reload: 2.4,
    spread: 0.006, moveSpread: 0.038, recoil: 0.016, auto: true, range: 55, kick: 1.0 },
  breacher: { id: 'breacher', name: 'Breacher-12', kind: 'shotgun', price: 1500,
    damage: 11, headMult: 1.8, rof: 0.85, mag: 6, reserve: 24, reload: 2.8,
    spread: 0.045, moveSpread: 0.07, recoil: 0.045, auto: false, range: 16, kick: 2.2, pellets: 8 },
  needle: { id: 'needle', name: 'Needle-50', kind: 'sniper', price: 4000,
    damage: 88, headMult: 2.5, rof: 1.15, mag: 5, reserve: 15, reload: 3.2,
    spread: 0.0015, moveSpread: 0.09, recoil: 0.06, auto: false, range: 80, kick: 3.0, zoom: 2.4 },
};
export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
export const BUY_ORDER = ['kestrel', 'hornet', 'breacher', 'longbow', 'needle'];

export function makeState() {
  return {
    phase: 'menu',           // menu | buy | live | planted | roundEnd | matchEnd
    phaseT: 0,               // seconds left in the current phase
    round: 1,
    score: { ember: 0, ash: 0 },
    money: ECON.start,
    kills: 0, deaths: 0, plants: 0, defuses: 0,
    bomb: { state: 'carried', site: null, x: 0, z: 0, timer: 0, plantProgress: 0, defuseProgress: 0 },
    roundMsg: '',
    matchMsg: '',
    time: 0,                 // total sim seconds
    noise: [],               // recent gunshot noises {x,z,r,t} bots can hear
    feed: [],                // killfeed lines {text, cls, t}
    events: [],              // one-frame events consumed by main/audio {type,...}
    rngSeed: 1,
  };
}

// Deterministic RNG (mulberry32) so ?shot= modes stage identical frames.
export function mulberry32(initial) {
  let a = initial >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
