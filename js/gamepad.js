// Polls the Gamepad API (standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT,
// 8 View, 9 Menu, 12-15 D-pad). Only the first controller that presses a button is
// listened to, so a second controller can stay with a game.
// The left stick acts as a D-pad (past 0.5), and in lists a held direction repeats:
// first after 400 ms, then every 180 ms. `canRepeat()` says whether repeating is wanted now
// (menus and the story reader, never during a question).
export const STICK = 0.5, REPEAT_FIRST = 400, REPEAT_EVERY = 180;
const DIRS = [12, 13, 14, 15];

// Which D-pad directions the left stick is pushing.
export function stickDirs(axes) {
  const [x = 0, y = 0] = axes ?? [];
  return { 12: y < -STICK, 13: y > STICK, 14: x < -STICK, 15: x > STICK };
}

export function createPad(onPress, canRepeat = () => false) {
  let active = null;
  const prev = new Map(), held = new Map(); // held: "pad:dir" -> next repeat time
  const pads = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []);

  function frame(now) {
    for (const gp of pads()) {
      const was = prev.get(gp.index) || [];
      const stick = stickDirs(gp.axes);
      const lists = canRepeat(); // the stick only navigates lists; it never answers a question
      const down = gp.buttons.map((b, i) => b.pressed || (lists && DIRS.includes(i) && stick[i]));
      down.forEach((on, i) => {
        const key = gp.index + ":" + i;
        if (!on) { held.delete(key); return; }
        if (active === null) active = gp.index;
        if (gp.index !== active) return;
        if (!was[i]) { onPress(i); if (DIRS.includes(i)) held.set(key, now + REPEAT_FIRST); return; }
        if (held.has(key) && now >= held.get(key) && canRepeat()) { onPress(i); held.set(key, now + REPEAT_EVERY); }
      });
      prev.set(gp.index, down);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const current = () => pads().find(gp => gp.index === active);
  return {
    status() {
      const gp = current();
      if (gp) return { on: true, text: `Mando ${gp.index + 1} conectado` };
      return { on: false, text: pads().length ? "Pulsa un botón en el mando que vas a usar" : "Sin mando: conéctalo y pulsa un botón" };
    },
    reset() { active = null; },
    rumble() {
      try { current()?.vibrationActuator?.playEffect("dual-rumble", { duration: 180, strongMagnitude: 0.6, weakMagnitude: 0.4 }); } catch {}
    },
  };
}
