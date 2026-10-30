// Visual mnemonics for the pictographic N5 kanji: a flat shape of what the character depicts, drawn under its
// KanjiVG strokes in black, with the meaning below. Shapes sit on KanjiVG's 109×109 grid so the strokes land on top.
// The card is Kana Pad's own: the answer bars' light ground, shapes in the app's palette (the Xbox face-button colours,
// the slab blue, the muted grey), strokes in the bars' ink. Cut-outs (pupil, petals' centre) use --mbg, the ground.
import { STROKE_SECONDS } from "./strokes.js";
const rays = Array.from({ length: 8 }, (_, i) => `<rect x="51.5" y="4" width="6" height="15" rx="3" transform="rotate(${i * 45} 54.5 54.5)"/>`).join("");
const petals = Array.from({ length: 5 }, (_, i) => {
  const a = (i * 72 - 90) * Math.PI / 180;
  return `<circle cx="${(54.5 + 24 * Math.cos(a)).toFixed(1)}" cy="${(54.5 + 24 * Math.sin(a)).toFixed(1)}" r="19"/>`;
}).join("");
const CLOUD = "M27 66a17 17 0 0 1 3-33a24 24 0 0 1 45-6a19 19 0 0 1 9 39z";

export const SHAPES = {
  flame: '<path d="M54.5 8C66 24 86 38 86 66c0 19-14 33-31.5 33S23 85 23 66c0-13 7-22 14-30 1 10 5 17 12 20-3-16 0-32 5.5-48z"/>',
  tree: '<circle cx="54.5" cy="40" r="31"/><rect x="47.5" y="58" width="14" height="44" rx="3"/>',
  sun: `<circle cx="54.5" cy="54.5" r="25"/>${rays}`,
  drop: '<path d="M54.5 8C66 28 84 46 84 68a29.5 29.5 0 0 1-59 0c0-22 18-40 29.5-60z"/>',
  mountain: '<path d="M6 98L38 30l16 26 14-20 35 62z"/>',
  river: '<path d="M10 30q12-10 24 0t24 0t24 0t24 0M10 56q12-10 24 0t24 0t24 0t24 0M10 82q12-10 24 0t24 0t24 0t24 0" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>',
  moon: '<circle cx="50" cy="56" r="41"/><circle cx="70" cy="42" r="34" style="fill:var(--mbg)"/>', // a crescent: the ground bites the disc
  rain: `<path d="${CLOUD}"/><path d="M36 76l-6 14M56 76l-6 14M76 76l-6 14" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`,
  cloud: `<path d="${CLOUD}" transform="translate(-6 8) scale(1.1)"/>`,
  person: '<circle cx="54.5" cy="25" r="15"/><path d="M28 102c0-32 11-54 26.5-54S81 70 81 102z"/>',
  mouth: '<ellipse cx="54.5" cy="56" rx="42" ry="27"/>',
  eye: '<path d="M5 54.5Q54.5 4 104 54.5Q54.5 105 5 54.5z"/><circle cx="54.5" cy="54.5" r="16" style="fill:var(--mbg)"/>',
  coin: '<circle cx="54.5" cy="54.5" r="43"/><circle cx="54.5" cy="54.5" r="33" fill="none" stroke-width="4" style="stroke:var(--mbg)"/>',
  flower: `${petals}<circle cx="54.5" cy="54.5" r="13" style="fill:var(--mbg)"/>`,
  fish: '<ellipse cx="47" cy="54.5" rx="36" ry="23"/><path d="M76 54.5l27-21v42z"/>',
  bolt: '<path d="M64 5L21 62h27l-9 42 48-62H59z"/>',
  book: '<path d="M7 25q24-10 46.5 4v72Q30 87 7 97zM102 25q-24-10-46.5 4v72Q79 87 102 97z"/>',
};

// kanji → [shape, its colour as one of the app's tokens (css/styles.css)]
export const MNEMONICS = {
  "火": ["flame", "--bad"], "木": ["tree", "--btn-a"], "日": ["sun", "--btn-y"], "水": ["drop", "--btn-x"],
  "山": ["mountain", "--muted"], "川": ["river", "--slab"], "月": ["moon", "--btn-y"], "雨": ["rain", "--btn-x"],
  "空": ["cloud", "--slab"], "電": ["bolt", "--btn-y"], "人": ["person", "--slab"], "口": ["mouth", "--bad"],
  "目": ["eye", "--btn-x"], "金": ["coin", "--btn-y"], "花": ["flower", "--bad"], "魚": ["fish", "--btn-x"], "本": ["book", "--btn-a"],
};

// The card's SVG: the shape, then the character's strokes in black on top, drawn one after another in stroke order.
export function mnemonicSvg(ch, paths) {
  const [shape] = MNEMONICS[ch];
  return `<svg viewBox="0 0 109 109" aria-hidden="true"><g class="mshape">${SHAPES[shape]}</g><g class="mstrokes">` +
    paths.map((d, i) => `<path d="${d}" pathLength="1" style="animation-delay:${(i * STROKE_SECONDS).toFixed(2)}s"/>`).join("") + "</g></svg>";
}
