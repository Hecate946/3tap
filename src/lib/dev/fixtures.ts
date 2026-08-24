import type { Board, Entry, Habit, Thought } from '$lib/types';

export const DEV_FIXTURE_NAMES = ['empty', '1d', '2d', '7d', '31d', '6mo', 'late', 'sparse'] as const;
export type DevFixtureName = (typeof DEV_FIXTURE_NAMES)[number];

function atNoon(base: Date, offset: number) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
  date.setDate(date.getDate() + offset);
  return date;
}

function dateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fakeThoughts(now: Date): Thought[] {
  return [
    { id: 'fixture-thought-1', text: 'email professor', position: 0, createdAt: atNoon(now, -2).toISOString() },
    { id: 'fixture-thought-2', text: 'try smaller practice blocks', position: 1, createdAt: atNoon(now, -1).toISOString() },
    { id: 'fixture-thought-3', text: 'buy groceries', position: 2, createdAt: atNoon(now, 0).toISOString() }
  ];
}

function historyFixture(days: number, now: Date, sparse = false): Board {
  const startOffset = -(days - 1);
  const createdAt = atNoon(now, startOffset).toISOString();
  const names = ['clarinet', 'piano', 'gym', 'run'];
  const habits: Habit[] = names.map((name, position) => ({
    id: `fixture-habit-${position + 1}`,
    name,
    position,
    createdAt
  }));
  const entries: Entry[] = [];

  for (let offset = startOffset; offset <= 0; offset += 1) {
    const date = dateKey(atNoon(now, offset));
    const dayIndex = offset - startOffset;
    for (let habitIndex = 0; habitIndex < habits.length; habitIndex += 1) {
      const score = (dayIndex * 7 + habitIndex * 5 + 3) % (sparse ? 13 : 10);
      if (score < (sparse ? 7 : 3)) continue;
      entries.push({
        habitId: habits[habitIndex].id,
        date,
        value: score >= (sparse ? 11 : 8) ? 2 : 1
      });
    }
  }

  return { createdAt, habits, archivedHabits: [], thoughts: fakeThoughts(now), entries };
}

function lateFixture(now: Date): Board {
  const boardStart = -44;
  const starts = [boardStart, -29, -14, -4];
  const names = ['clarinet', 'gym', 'read', 'run'];
  const habits: Habit[] = names.map((name, position) => ({
    id: `fixture-late-${position + 1}`,
    name,
    position,
    createdAt: atNoon(now, starts[position]).toISOString()
  }));
  const entries: Entry[] = [];

  for (let offset = boardStart; offset <= 0; offset += 1) {
    const date = dateKey(atNoon(now, offset));
    for (let habitIndex = 0; habitIndex < habits.length; habitIndex += 1) {
      if (offset < starts[habitIndex]) continue;
      const score = ((offset - starts[habitIndex]) * 5 + habitIndex * 3 + 2) % 9;
      if (score < 3) continue;
      entries.push({ habitId: habits[habitIndex].id, date, value: score >= 7 ? 2 : 1 });
    }
  }

  return {
    createdAt: atNoon(now, boardStart).toISOString(),
    habits,
    archivedHabits: [],
    thoughts: fakeThoughts(now),
    entries
  };
}

export function createDevFixture(name: string, now = new Date()): Board | null {
  switch (name) {
    case 'empty':
      return { createdAt: atNoon(now, 0).toISOString(), habits: [], archivedHabits: [], thoughts: [], entries: [] };
    case '1d': return historyFixture(1, now);
    case '2d': return historyFixture(2, now);
    case '7d': return historyFixture(7, now);
    case '31d': return historyFixture(31, now);
    case '6mo': return historyFixture(183, now);
    case 'late': return lateFixture(now);
    case 'sparse': return historyFixture(45, now, true);
    default: return null;
  }
}
