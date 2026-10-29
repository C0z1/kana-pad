// Optional sound effects, synthesized with Web Audio (no files): right, wrong, record/achievement.
// Quiet on purpose (used during cardio with music) and skipped while the Japanese voice is talking.
let ctx = null;

function tone(freqs, { type = "triangle", step = 0.07, len = 0.12, gain = 0.06 } = {}) {
  if (globalThis.speechSynthesis?.speaking) return; // never over the voice; the clip just plays without it
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  const t0 = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator(), g = ctx.createGain(), t = t0 + i * step;
    osc.type = type; osc.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + len + 0.02);
  });
}

export const sfx = {
  right: () => tone([880, 1320]),
  wrong: () => tone([220, 165], { type: "square", gain: 0.035, len: 0.16, step: 0.09 }),
  win: () => tone([660, 880, 1100, 1320], { step: 0.08, len: 0.18 }),
};
