// Puente con Anki: reads decks through the AnkiConnect add-on while Anki is open. It only reads; nothing is
// written back to Anki. An imported deck becomes a free-practice deck (it never enters Repaso de hoy).
export const ANKI_URL = "http://127.0.0.1:8765";

export async function ankiCall(action, params = {}, fetchFn = fetch) {
  const res = await fetchFn(ANKI_URL, { method: "POST", body: JSON.stringify({ action, version: 6, params }) });
  const { result, error } = await res.json();
  if (error) throw new Error(error);
  return result;
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
// Anki field HTML → plain text: line breaks become ", ", tags and [sound:…] go, common entities decode.
export const plain = html => String(html)
  .replace(/\[sound:[^\]]*\]/g, "")
  .replace(/<br\s*\/?>|<\/div>\s*<div[^>]*>/gi, ", ")
  .replace(/<[^>]*>/g, "")
  .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e])
  .replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");

// AnkiConnect notesInfo → deck items { q, a }: the first field is the question and the second the answer.
// Notes with an empty side, or a question already taken, are skipped (the question is the card's key).
export function notesToItems(notes) {
  const seen = new Set(), items = [];
  for (const n of notes) {
    const [q, a] = Object.values(n.fields ?? {}).sort((x, y) => x.order - y.order).map(f => plain(f.value));
    if (!q || !a || seen.has(q)) continue;
    seen.add(q); items.push({ q, a });
  }
  return items;
}

// A stable deck id from the Anki deck name (names may hold "::" and spaces; ids end up in card keys).
export const ankiId = name => "anki-" + [...name].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7).toString(36);

export async function readDeck(name, fetchFn = fetch) {
  const ids = await ankiCall("findNotes", { query: `deck:"${name.replace(/"/g, '\\"')}"` }, fetchFn);
  const notes = await ankiCall("notesInfo", { notes: ids }, fetchFn);
  return { id: ankiId(name), name, kind: "vocab", anki: true, items: notesToItems(notes) };
}
