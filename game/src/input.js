// input.js — keyboard + pointer-lock mouse look. No state lives here except
// the live key set and the accumulated look delta (consumed once per frame).
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const look = { x: 0, y: 0 };
  let firing = false;
  let locked = false;

  function onKeyDown(e) {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyR') keys.add('__reload');
  }
  function onKeyUp(e) { keys.delete(e.code); }
  function onMouseMove(e) {
    if (!locked) return;
    look.x += e.movementX;
    look.y += e.movementY;
  }
  function onMouseDown(e) {
    if (!locked) return;
    if (e.button === 0) firing = true;
  }
  function onMouseUp(e) { if (e.button === 0) firing = false; }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) firing = false;
    onLockChange(locked);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  canvas.addEventListener('click', () => { if (!locked) canvas.requestPointerLock(); });

  return {
    keys,
    get firing() { return firing; },
    get locked() { return locked; },
    requestLock() { canvas.requestPointerLock(); },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    takeLook() { const l = { x: look.x, y: look.y }; look.x = 0; look.y = 0; return l; },
    consumeReload() {
      if (keys.has('__reload')) { keys.delete('__reload'); return true; }
      return false;
    },
  };
}
