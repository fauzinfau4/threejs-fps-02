// weapons.js — weapon runtime: one weapon instance per agent. Ammo, reload,
// recoil and spread live here; hit resolution lives in sim.js. Spread is
// computed from stance + speed + heat so stopping to aim always pays.
import { WEAPONS, clamp } from './state.js';

export function makeWeapon(id) {
  const def = WEAPONS[id];
  return {
    def, id,
    mag: def.mag, reserve: def.reserve,
    cooldown: 0, reloadT: 0, heat: 0, // heat 0..1, grows per shot, decays
    recoilPitch: 0,
  };
}
export function weaponSpread(w, speed, crouched, airborne) {
  const d = w.def;
  let s = d.spread + w.heat * 0.02;
  if (speed > 0.5) s += d.moveSpread * Math.min(1, speed / 5);
  if (crouched) s *= 0.75;
  if (airborne) s += 0.03;
  return s;
}
export function weaponStep(w, dt) {
  w.cooldown = Math.max(0, w.cooldown - dt);
  w.heat = Math.max(0, w.heat - dt * 0.55);
  if (w.reloadT > 0) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      const need = w.def.mag - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take; w.reserve -= take;
    }
  }
}
export function weaponCanFire(w) { return w.cooldown <= 0 && w.reloadT <= 0 && w.mag > 0; }
export function weaponFire(w) {
  if (!weaponCanFire(w)) return false;
  w.mag -= 1;
  w.cooldown = w.def.rof;
  w.heat = clamp(w.heat + (w.def.auto ? 0.09 : 0.16), 0, 1);
  w.recoilPitch += w.def.recoil;
  return true;
}
export function weaponReload(w) {
  if (w.reloadT > 0 || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloadT = w.def.reload;
  return true;
}
// Damage after range falloff: full inside half range, 55% at max range.
export function weaponDamage(w, dist, head) {
  const d = w.def;
  const fall = dist > d.range ? 0.55 : 1 - 0.45 * Math.max(0, (dist - d.range * 0.5) / (d.range * 0.5));
  return d.damage * fall * (head ? d.headMult : 1);
}
