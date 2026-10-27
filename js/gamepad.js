// Polls the Gamepad API (standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT,
// 8 View, 9 Menu, 12-15 D-pad). Only the first controller that presses a button is
// listened to, so a second controller can stay with a game.
export function createPad(onPress) {
  let active = null;
  const prev = new Map();
  const pads = () => (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []);

  function frame() {
    for (const gp of pads()) {
      const was = prev.get(gp.index) || [];
      gp.buttons.forEach((b, i) => {
        if (!b.pressed || was[i]) return;
        if (active === null) active = gp.index;
        if (gp.index === active) onPress(i);
      });
      prev.set(gp.index, gp.buttons.map(b => b.pressed));
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
