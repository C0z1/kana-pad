// Numbers for the progress panel. Pure functions over cards, history and the day record.
const DAY_MS = 864e5;
export const MATURE_DAYS = 21; // like Anki: a card is mature once its interval reaches 3 weeks

// Retention of mature reviews over the last 3 study days, including today; null without data.
export function retention(history, today) {
  const recent = Object.entries(history).filter(([d]) => d <= today).sort().slice(-3).map(([, h]) => h);
  const reviews = recent.reduce((s, h) => s + (h.reviews ?? 0), 0);
  const correct = recent.reduce((s, h) => s + (h.correct ?? 0), 0);
  return reviews ? correct / reviews : null;
}

// Consecutive study days ending today (or yesterday, if today hasn't started yet).
export function streakDays(history, today) {
  const studied = new Set(Object.entries(history).filter(([, h]) => (h.answers ?? 0) > 0).map(([d]) => d));
  const back = (d, n) => new Date(Date.parse(d + "T12:00:00") - n * DAY_MS).toLocaleDateString("sv");
  let start = studied.has(today) ? 0 : 1, n = 0;
  while (studied.has(back(today, start + n))) n++;
  return n;
}

// Seen and mature cards per deck.
export function deckStats(decks, cards) {
  return decks.map(deck => {
    let seen = 0, mature = 0;
    for (const it of deck.items) {
      const c = cards[deck.id + ":" + it.q];
      if (!c) continue;
      seen++;
      if (c.state === 2 && c.scheduled_days >= MATURE_DAYS) mature++;
    }
    return { id: deck.id, name: deck.name, total: deck.items.length, seen, mature };
  });
}

// Cards due on each of the next `days` study days; day 0 includes everything overdue.
// `dayEnds[i]` is the end (4:00) of study day i.
export function forecast(cards, dayEnds) {
  const counts = dayEnds.map(() => 0);
  for (const c of Object.values(cards)) {
    const t = Date.parse(c.due);
    const i = dayEnds.findIndex(end => t <= end.getTime());
    if (i >= 0) counts[i]++;
  }
  return counts;
}

// Whole days since an ISO date (null = never); a backup or export is due after `days`.
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  return Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
}
export const backupDue = (iso, now = new Date(), days = 7) => iso === null || iso === undefined || daysSince(iso, now) > days;
