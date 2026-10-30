// Stroke-order animation from KanjiVG files in content/kanjivg (CC BY-SA 3.0, Ulrich Apel).
const cache = new Map();

export const hexOf = ch => ch.codePointAt(0).toString(16).padStart(5, "0");

// KanjiVG lists <path> elements in stroke order.
export const parsePaths = svgText => [...svgText.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]);
// KanjiVG also places each stroke's number where that stroke starts: <text transform="matrix(1 0 0 1 x y)">n</text>.
export const parseNumbers = svgText =>
  [...svgText.matchAll(/<text[^>]*matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)"[^>]*>(\d+)<\/text>/g)].map(m => ({ n: +m[3], x: +m[1], y: +m[2] }));

// { paths, nums } for a character; empty when there is no KanjiVG file.
export function strokeData(ch) {
  const hex = hexOf(ch);
  if (!cache.has(hex)) {
    cache.set(hex, fetch(`content/kanjivg/${hex}.svg`)
      .then(r => (r.ok ? r.text() : ""))
      .then(t => ({ paths: parsePaths(t), nums: parseNumbers(t) }))
      .catch(() => ({ paths: [], nums: [] })));
  }
  return cache.get(hex);
}
export const strokePaths = ch => strokeData(ch).then(d => d.paths);

const NS = "http://www.w3.org/2000/svg";
export const STROKE_SECONDS = 0.35;

// The strokes drawn one after another. With `nums`, each stroke's number appears at its start as the stroke begins,
// like a calligraphy stroke-order chart.
export function strokeSvg(paths, nums = null) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 109 109");
  svg.setAttribute("class", nums ? "strokes numbered" : "strokes");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d, i) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("pathLength", "1");
    p.style.animationDelay = `${i * STROKE_SECONDS}s`;
    svg.append(p);
  });
  for (const { n, x, y } of nums ?? []) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", y);
    t.textContent = n;
    t.style.animationDelay = `${(n - 1) * STROKE_SECONDS}s`;
    svg.append(t);
  }
  return svg;
}
