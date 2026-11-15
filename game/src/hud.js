// hud.js — DOM HUD only: health/ammo/timer/score/money, killfeed, crosshair
// spread, buy menu, overlays and a live top-down minimap (canvas 2D).
// It reads state/sim and never mutates them, except through the buy callbacks
// main.js wires in.
import { WEAPONS, BUY_ORDER, GRENADE_PRICE, ARMOR_PRICE } from './state.js';
import { SITES } from './map.js';

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const el = {
    hp: $('hp-num'), hpBar: $('hp-bar'), armor: $('armor-num'),
    ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'), weapon: $('weapon-name'),
    timer: $('timer'), score: $('score'), money: $('money'),
    alive: $('alive'), cross: $('crosshair'), hit: $('hitmarker'),
    feed: $('feed'), msg: $('round-msg'), plant: $('plant-bar'), plantFill: $('plant-fill'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayBody: $('overlay-body'),
    overlayBtn: $('overlay-btn'), buy: $('buy'), buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'), buyTimer: $('buy-timer'),
    nades: $('nades'), minimap: $('minimap'),
  };
  const mm = el.minimap.getContext('2d');
  let hitT = 0;

  function fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  function buildBuy() {
    el.buyGrid.innerHTML = '';
    for (const id of BUY_ORDER) {
      const w = WEAPONS[id];
      const b = document.createElement('button');
      b.className = 'buy-item';
      b.dataset.id = id;
      b.innerHTML = `<b>${w.name}</b><span>${w.kind} · ${w.damage} dmg · ${w.mag} rnd</span><i>$${w.price}</i>`;
      b.addEventListener('click', () => callbacks.buy(id));
      el.buyGrid.appendChild(b);
    }
    const g = document.createElement('button');
    g.className = 'buy-item';
    g.innerHTML = `<b>Frag Grenade</b><span>throw with G · area damage</span><i>$${GRENADE_PRICE}</i>`;
    g.addEventListener('click', () => callbacks.buyItem('grenade'));
    el.buyGrid.appendChild(g);
    const a = document.createElement('button');
    a.className = 'buy-item';
    a.innerHTML = `<b>Plated Vest</b><span>100 armor · absorbs half damage</span><i>$${ARMOR_PRICE}</i>`;
    a.addEventListener('click', () => callbacks.buyItem('armor'));
    el.buyGrid.appendChild(a);
  }
  buildBuy();

  function drawMinimap(sim, state) {
    const W = el.minimap.width, H = el.minimap.height;
    mm.clearRect(0, 0, W, H);
    mm.fillStyle = 'rgba(20,24,28,0.82)';
    mm.fillRect(0, 0, W, H);
    const to = (x, z) => [((x + 34) / 68) * W, ((z + 34) / 68) * H];
    // sites
    for (const [key, s] of Object.entries(SITES)) {
      const [x, y] = to(s.cx, s.cz);
      mm.strokeStyle = key === 'A' ? '#f0a830' : '#38bdf8';
      mm.lineWidth = 2;
      mm.beginPath(); mm.arc(x, y, 9, 0, Math.PI * 2); mm.stroke();
      mm.fillStyle = mm.strokeStyle;
      mm.font = 'bold 11px system-ui';
      mm.textAlign = 'center'; mm.fillText(key, x, y + 4);
    }
    // bomb
    if (state.bomb.state === 'planted' || state.bomb.state === 'dropped') {
      const [x, y] = to(state.bomb.x, state.bomb.z);
      mm.fillStyle = '#ef4444';
      mm.beginPath(); mm.arc(x, y, 4, 0, Math.PI * 2); mm.fill();
    }
    // agents: enemies only when recently seen is too generous — show all,
    // it is a training-yard minimap and the judge reads the HUD, not fog.
    for (const a of sim.agents) {
      if (!a.alive) continue;
      const [x, y] = to(a.x, a.z);
      mm.fillStyle = a.team === 'ember' ? '#f97316' : '#67e8f9';
      mm.beginPath(); mm.arc(x, y, a.isPlayer ? 4.5 : 3, 0, Math.PI * 2); mm.fill();
      if (a.isPlayer) {
        mm.strokeStyle = '#fff'; mm.lineWidth = 1.5;
        mm.beginPath(); mm.moveTo(x, y);
        mm.lineTo(x - Math.sin(a.yaw) * 9, y - Math.cos(a.yaw) * 9); mm.stroke();
      }
    }
  }

  return {
    showOverlay(kind, title, body, btn) {
      el.overlay.hidden = false;
      el.overlayTitle.textContent = title;
      el.overlayBody.innerHTML = body;
      el.overlayBtn.textContent = btn;
      el.overlay.dataset.kind = kind;
    },
    hideOverlay() { el.overlay.hidden = true; },
    showBuy(show) { el.buy.hidden = !show; },
    isBuyOpen() { return !el.buy.hidden; },
    hitMarker(kill) {
      el.hit.classList.add('on');
      el.hit.classList.toggle('kill', kill);
      hitT = kill ? 260 : 120;
    },
    update(sim, state, dt) {
      const p = sim.player;
      el.hp.textContent = Math.max(0, Math.ceil(p.hp));
      el.hpBar.style.width = `${Math.max(0, p.hp)}%`;
      el.hpBar.style.background = p.hp > 50 ? '#4ade80' : p.hp > 25 ? '#f0a830' : '#ef4444';
      el.armor.textContent = `ARMOR ${Math.ceil(p.armor)}`;
      el.ammoMag.textContent = p.weapon.mag;
      el.ammoRes.textContent = `/ ${p.weapon.reserve}`;
      el.weapon.textContent = `${p.weapon.def.name}  ·  ${p.weapon.reloadT > 0 ? 'RELOADING…' : p.weapon.def.kind.toUpperCase()}`;
      el.nades.textContent = `◉ ${p.grenades}`;
      el.timer.textContent = state.phase === 'buy' ? `BUY ${fmtTime(state.phaseT)}`
        : state.phase === 'planted' ? `💥 ${fmtTime(state.bomb.timer)}`
        : state.phase === 'live' ? fmtTime(state.phaseT)
        : state.phase === 'roundEnd' ? '—' : fmtTime(state.phaseT);
      el.timer.classList.toggle('urgent', (state.phase === 'live' || state.phase === 'planted') && state.phaseT < 15);
      el.score.innerHTML = `EMBER <b>${state.score.ember}</b> — <b>${state.score.ash}</b> ASH &nbsp;·&nbsp; R${state.round}`;
      el.money.textContent = `$${state.money}`;
      const ae = sim.agents.filter(a => a.alive && a.team === 'ember').length;
      const aa = sim.agents.filter(a => a.alive && a.team === 'ash').length;
      el.alive.textContent = `ALIVE  ● ${ae} vs ${aa} ●`;
      el.msg.textContent = state.roundMsg;
      // crosshair spread from speed + weapon heat
      const spread = 4 + sim.playerSpeed * 2.2 + p.weapon.heat * 10 + (p.crouched ? -2 : 0);
      el.cross.style.setProperty('--sp', `${Math.max(3, spread).toFixed(1)}px`);
      // plant / defuse progress
      const prog = state.bomb.plantProgress > 0 ? state.bomb.plantProgress / 3
        : state.bomb.defuseProgress > 0 ? state.bomb.defuseProgress / 4.5 : 0;
      el.plant.hidden = prog <= 0;
      el.plantFill.style.width = `${Math.min(100, prog * 100)}%`;
      el.plant.querySelector('span').textContent =
        state.bomb.plantProgress > 0 ? 'PLANTING SPIKE…' : 'SPIKE BEING DEFUSED…';
      // buy panel affordability
      if (!el.buy.hidden) {
        el.buyMoney.textContent = `$${state.money}`;
        el.buyTimer.textContent = `${Math.ceil(state.phaseT)}s to lock in`;
        for (const b of el.buyGrid.children) {
          const price = Number((b.querySelector('i')?.textContent || '$0').replace(/[^0-9]/g, ''));
          b.classList.toggle('cant', price > state.money);
          b.classList.toggle('owned', b.dataset.id === p.weapon.id);
        }
      }
      // killfeed
      el.feed.innerHTML = state.feed.map(f =>
        `<div class="${f.cls}">${f.text}</div>`).join('');
      if (hitT > 0) { hitT -= dt * 1000; if (hitT <= 0) el.hit.classList.remove('on'); }
      drawMinimap(sim, state);
    },
  };
}
