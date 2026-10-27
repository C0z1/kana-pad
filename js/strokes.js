// Stroke-order animation from KanjiVG files in content/kanjivg (CC BY-SA 3.0, Ulrich Apel).
const cache = new Map();

export const hexOf = ch => ch.codePointAt(0).toString(16).padStart(5, "0");

// KanjiVG lists <path> elements in stroke order.
export const parsePaths = svgText => [...svgText.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(m => m[1]);

export function strokePaths(ch) {
  const hex = hexOf(ch);
  if (!cache.has(hex)) {
    cache.set(hex, fetch(`content/kanjivg/${hex}.svg`)
      .then(r => (r.ok ? r.text() : ""))
      .then(parsePaths)
      .catch(() => []));
  }
  return cache.get(hex);
}

const NS = "http://www.w3.org/2000/svg";
export const STROKE_SECONDS = 0.35;

export function strokeSvg(paths) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 109 109");
  svg.setAttribute("class", "strokes");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d, i) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("pathLength", "1");
    p.style.animationDelay = `${i * STROKE_SECONDS}s`;
    svg.append(p);
  });
  return svg;
}
