// Japanese voices that ship with Kana Pad: audio pre-generated offline with Kokoro-82M (Apache-2.0)
// by tools/voices/. They work everywhere, even where the system has no Japanese voice (Android, Linux).
export const BUILT_IN = [
  { id: "jf_alpha", name: "Kana Pad · Alpha (mujer)" },
  { id: "jm_kumo", name: "Kana Pad · Kumo (hombre)" },
  { id: "jf_gongitsune", name: "Kana Pad · Gongitsune (mujer)" },
].map(v => ({ ...v, voiceURI: `kp:${v.id}`, lang: "ja-JP", builtin: true }));

// FNV-1a over UTF-8: names each clip after the exact text it says.
export function clipHash(text) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export const clipPath = (voice, hash) => `audio/${voice.id}/${hash}.mp3`;
export const clipUrl = (voice, text) => clipPath(voice, clipHash(text));
