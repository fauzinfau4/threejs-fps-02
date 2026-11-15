// world.js — builds the Kestrel Yard scene from map.js data. Palette is a
// chosen dusk set: warm amber sun, teal-grey steel, rust containers, dark
// asphalt. All geometry is styled boxes/cylinders — original art, no assets.
import * as THREE from 'three';
import { COLLIDERS, MAP, SITES } from './map.js';

export const PALETTE = {
  sky: 0x2b3440, fog: 0x2b3440, ground: 0x3a3d40, groundLine: 0x4a4d4a,
  wall: 0x6b7280, wallDark: 0x4b5563, rust: 0xb4532a, blue: 0x2f6f8f,
  teal: 0x2f8f7a, amber: 0xf0a830, crate: 0x8a6d3b, silo: 0x9aa3ad,
  siteA: 0xf0a830, siteB: 0x38bdf8, ember: 0xf97316, ash: 0x67e8f9,
};

const _box = new THREE.BoxGeometry(1, 1, 1);
function boxAt(scene, mat, x, z, w, d, h, y = 0) {
  const m = new THREE.Mesh(_box, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = h > 1.4;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 30, 95);

  const hemi = new THREE.HemisphereLight(0xbfd4e6, 0x2a2118, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc37a, 1.6);
  sun.position.set(-30, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x7fb4d8, 0.35);
  fill.position.set(28, 20, -30);
  scene.add(fill);

  const mats = {
    ground: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    line: new THREE.MeshStandardMaterial({ color: PALETTE.groundLine, roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.85 }),
    wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.85 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.8, metalness: 0.25 }),
    blue: new THREE.MeshStandardMaterial({ color: PALETTE.blue, roughness: 0.8, metalness: 0.25 }),
    teal: new THREE.MeshStandardMaterial({ color: PALETTE.teal, roughness: 0.8, metalness: 0.25 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.95 }),
    silo: new THREE.MeshStandardMaterial({ color: PALETTE.silo, roughness: 0.55, metalness: 0.55 }),
    amber: new THREE.MeshStandardMaterial({ color: PALETTE.amber, roughness: 0.6, emissive: 0x664400, emissiveIntensity: 0.4 }),
    siteA: new THREE.MeshStandardMaterial({ color: PALETTE.siteA, roughness: 0.7, emissive: 0x664400, emissiveIntensity: 0.5 }),
    siteB: new THREE.MeshStandardMaterial({ color: PALETTE.siteB, roughness: 0.7, emissive: 0x0a3550, emissiveIntensity: 0.5 }),
  };

  // Ground + centre line + outer fence (visual only; movement clamps in map.js)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.half * 2 + 8, MAP.half * 2 + 8), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.35, MAP.half * 2), mats.line);
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.02, 0);
  scene.add(stripe);
  for (const [x, z, w, d] of [[0, -MAP.half - 1, MAP.half * 2 + 4, 2], [0, MAP.half + 1, MAP.half * 2 + 4, 2],
    [-MAP.half - 1, 0, 2, MAP.half * 2 + 4], [MAP.half + 1, 0, 2, MAP.half * 2 + 4]]) {
    boxAt(scene, mats.wallDark, x, z, w, d, 4.2);
  }

  // Colliders become visible geometry, coloured by height/use.
  const shootables = [];
  for (const c of COLLIDERS) {
    const w = c.x1 - c.x0, d = c.z1 - c.z0, cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    let mat = mats.wall;
    if (c.h <= 1.4) mat = mats.crate;
    else if (c.h <= 2.6 && w >= 3 && d <= 4) mat = (Math.abs(cx) % 2 < 1) ? mats.rust : mats.blue;
    else if (c.h <= 2.6) mat = mats.teal;
    else if (cz < -18 && cx > 10) mat = mats.silo;
    const m = boxAt(scene, mat, cx, cz, w, d, c.h);
    shootables.push(m);
    // rim light strip on tall walls so lanes read at a glance
    if (c.h >= 4.2) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.12, d + 0.06), mats.amber);
      rim.position.set(cx, c.h + 0.06, cz);
      scene.add(rim);
    }
  }

  // Crane gantry over mid: two legs (already colliders) + a beam + hook.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.9, 1.2), mats.wallDark);
  beam.position.set(0, 5.6, -7);
  beam.castShadow = true;
  scene.add(beam);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), mats.amber);
  hook.position.set(0, 4.6, -7);
  scene.add(hook);
  const lamp = new THREE.PointLight(0xffc37a, 30, 22, 1.8);
  lamp.position.set(0, 5.0, -7);
  scene.add(lamp);

  // Site markers: glowing floor rings + floating letter boards.
  function siteMarker(site, mat, letter) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.r - 0.5, site.r, 40),
      new THREE.MeshBasicMaterial({ color: mat.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.cx, 0.03, site.cz);
    scene.add(ring);
    const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 0.25), mat);
    board.position.set(site.cx, 4.6, site.cz);
    scene.add(board);
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#111827'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffffff'; g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 128, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.5),
      new THREE.MeshBasicMaterial({ map: tex }));
    face.position.set(site.cx, 4.6, site.cz + 0.14);
    scene.add(face);
    const face2 = face.clone();
    face2.rotation.y = Math.PI;
    face2.position.z = site.cz - 0.14;
    scene.add(face2);
  }
  siteMarker(SITES.A, mats.siteA, 'A');
  siteMarker(SITES.B, mats.siteB, 'B');

  // Silo tanks at Site B + a few distant skyline blocks for depth.
  for (const [x, z] of [[26, -28], [30, -28]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 6, 20), mats.silo);
    tank.position.set(x, 3, z);
    tank.castShadow = true;
    scene.add(tank);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.rust);
    cap.position.set(x, 6, z);
    scene.add(cap);
  }
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x1f2937 });
  for (const [x, z, h] of [[-52, -40, 26], [-38, -52, 34], [44, -46, 30], [56, -30, 22], [-56, 20, 20], [52, 34, 26]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), skyMat);
    b.position.set(x, h / 2, z);
    scene.add(b);
  }
  return { shootables, mats };
}
