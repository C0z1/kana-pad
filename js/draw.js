// Drawing practice: compares the student's strokes with the KanjiVG model, stroke by stroke and
// in order, and gives a 0–100 score. Points are [x, y] in KanjiVG's 109×109 box.
export const SAMPLES = 16;
const TOLERANCE = 22; // mean distance (in the 109 box) at which a stroke scores 0

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Evenly spaced points along a polyline, so a slow and a fast stroke compare alike.
export function resample(pts, n = SAMPLES) {
  if (pts.length < 2) return Array(n).fill(pts[0] ?? [0, 0]);
  const segs = pts.slice(1).map((p, i) => dist(pts[i], p));
  const total = segs.reduce((s, d) => s + d, 0) || 1;
  const out = [];
  for (let k = 0, i = 0, acc = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (i < segs.length - 1 && acc + segs[i] < target) acc += segs[i++];
    const t = segs[i] ? Math.min(1, (target - acc) / segs[i]) : 0;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
  }
  return out;
}

function box(strokes) {
  const all = strokes.flat();
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, 1) };
}

// Moves and scales the drawing onto the model's box (same aspect), so size and position don't count.
export function fit(drawn, model) {
  const a = box(drawn), b = box(model), k = b.size / a.size;
  return drawn.map(s => s.map(([x, y]) => [b.cx + (x - a.cx) * k, b.cy + (y - a.cy) * k]));
}

const strokeScore = (a, b) => {
  const d = a.reduce((s, p, i) => s + dist(p, b[i]), 0) / a.length;
  return Math.max(0, 1 - d / TOLERANCE);
};

// Returns { score, strokes: [{ score, reversed }], count: [drawn, expected] }.
export function grade(drawn, model) {
  if (!drawn.length || !model.length) return { score: 0, strokes: [], count: [drawn.length, model.length] };
  const ref = model.map(s => resample(s));
  const mine = fit(drawn.map(s => resample(s)), ref);
  const strokes = ref.map((r, i) => {
    if (!mine[i]) return { score: 0, reversed: false };
    const fwd = strokeScore(mine[i], r), back = strokeScore([...mine[i]].reverse(), r);
    // A stroke drawn backwards counts half: the shape is right, the direction isn't.
    return back > fwd + 0.2 ? { score: back / 2, reversed: true } : { score: fwd, reversed: false };
  });
  const mean = strokes.reduce((s, x) => s + x.score, 0) / ref.length;
  const countPenalty = Math.min(drawn.length, ref.length) / Math.max(drawn.length, ref.length);
  return { score: Math.round(100 * mean * countPenalty), strokes, count: [drawn.length, ref.length] };
}

export const verdict = score => score >= 85 ? "Excelente" : score >= 65 ? "Bien" : score >= 40 ? "Regular" : "Inténtalo de nuevo";

// Points along SVG path data, using the browser's geometry (KanjiVG strokes are cubic Béziers).
export function pathPoints(d, n = 32) {
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  const len = p.getTotalLength();
  return Array.from({ length: n }, (_, i) => { const q = p.getPointAtLength((len * i) / (n - 1)); return [q.x, q.y]; });
}
