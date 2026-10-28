// Listening exercise: a Japanese voice says a word or sentence and the student picks its meaning.
// Each question uses one of the enabled Japanese voices at random, so the ear gets used to several.
import { shuffle, senses } from "./srs.js";

// Japanese voices offered by the system (speechSynthesis.getVoices()).
export const japaneseVoices = voices => voices.filter(v => v.lang?.toLowerCase().startsWith("ja"));

// `enabled` holds voiceURIs chosen in Settings; empty or stale means "all of them".
export function activeVoices(voices, enabled = []) {
  const ja = japaneseVoices(voices);
  const chosen = ja.filter(v => enabled.includes(v.voiceURI));
  return chosen.length ? chosen : ja;
}

export function pickVoice(voices, rng = Math.random) {
  return voices.length ? voices[Math.floor(rng() * voices.length)] : null;
}

// With a single voice, vary pitch and rate a little so it doesn't always sound the same.
export function voiceVariation(voiceCount, rng = Math.random) {
  if (voiceCount > 1) return { pitch: 1, rate: 0.9 };
  return { pitch: 0.85 + rng() * 0.3, rate: 0.8 + rng() * 0.2 };
}

// Questions from content that is already reviewed: grammar sentences (meaning = translation)
// and vocabulary (meaning = Spanish gloss). Distractors come from the same kind of item.
export function buildListening(vocab, grammar, n = 10, rng = Math.random) {
  const fromVocab = shuffle(vocab, rng).slice(0, Math.ceil(n / 2)).map(it => ({
    say: it.r || it.q, shown: it.q, answer: it.a,
    opts: shuffle([it.a, ...shuffle(vocab.filter(o => !senses(o.a).some(x => senses(it.a).includes(x))), rng).slice(0, 3).map(o => o.a)], rng),
  }));
  const fromGrammar = shuffle(grammar, rng).slice(0, Math.floor(n / 2)).map(it => ({
    say: it.r, shown: it.r, answer: it.t,
    opts: shuffle([it.t, ...shuffle(grammar.filter(o => o.t !== it.t), rng).slice(0, 3).map(o => o.t)], rng),
  }));
  return shuffle([...fromVocab, ...fromGrammar], rng);
}
