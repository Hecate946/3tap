import { browser } from '$app/environment';
import type { Board, Credentials, Habit, MarkValue } from '$lib/types';

const CREDS_KEY = '3tap.credentials.v1';
const BOARD_KEY = '3tap.board.v1';
const QUEUE_KEY = '3tap.queue.v1';
const HABITS_DIRTY_KEY = '3tap.habits-dirty.v1';

type CompactBoard = {
  v: 2;
  c: string;
  u?: string;
  h: Habit[];
  a?: Habit[];
  e: [number, string, MarkValue][];
};

export type PendingEntry = { habitId: string; date: string; value: MarkValue };

function readJson<T>(key: string): T | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function createLocalBoardState() {
  if (!browser) throw new Error('Browser only');
  const credentials: Credentials = {
    boardId: crypto.randomUUID(),
    secret: randomSecret(),
    pendingCreate: true
  };
  const board: Board = { createdAt: new Date().toISOString(), habits: [], archivedHabits: [], entries: [] };
  return { credentials, board };
}

export function getCredentials() { return readJson<Credentials>(CREDS_KEY); }
export function setCredentials(credentials: Credentials) {
  if (browser) localStorage.setItem(CREDS_KEY, JSON.stringify(credentials));
}

export function getCachedBoard(): Board | null {
  const cached = readJson<Board | CompactBoard>(BOARD_KEY);
  if (!cached) return null;
  if (!('v' in cached) || cached.v !== 2) return cached as Board;
  const habits = cached.h ?? [];
  const archivedHabits = cached.a ?? [];
  const allHabits = [...habits, ...archivedHabits];
  const entries = cached.e.flatMap(([index, date, value]) => {
    const habitId = allHabits[index]?.id;
    return habitId && value !== 0 ? [{ habitId, date, value }] : [];
  });
  return { createdAt: cached.c, updatedAt: cached.u, habits, archivedHabits, entries };
}

export function setCachedBoard(board: Board) {
  if (!browser) return;
  const habits = board.habits ?? [];
  const archivedHabits = board.archivedHabits ?? [];
  const allHabits = [...habits, ...archivedHabits];
  const indexes = new Map(allHabits.map((habit, index) => [habit.id, index]));
  const entries: CompactBoard['e'] = [];
  for (const entry of board.entries ?? []) {
    const index = indexes.get(entry.habitId);
    if (index !== undefined && entry.value !== 0) entries.push([index, entry.date, entry.value]);
  }
  const compact: CompactBoard = {
    v: 2,
    c: board.createdAt,
    ...(board.updatedAt ? { u: board.updatedAt } : {}),
    h: habits,
    ...(archivedHabits.length ? { a: archivedHabits } : {}),
    e: entries
  };
  localStorage.setItem(BOARD_KEY, JSON.stringify(compact));
}

export function getHabitsDirty() { return browser && localStorage.getItem(HABITS_DIRTY_KEY) === '1'; }
export function setHabitsDirty(dirty: boolean) {
  if (!browser) return;
  if (dirty) localStorage.setItem(HABITS_DIRTY_KEY, '1');
  else localStorage.removeItem(HABITS_DIRTY_KEY);
}

export function getQueue() { return readJson<PendingEntry[]>(QUEUE_KEY) ?? []; }
export function setQueue(queue: PendingEntry[]) {
  if (!browser) return;
  if (queue.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  else localStorage.removeItem(QUEUE_KEY);
}
export function compactQueue(queue: PendingEntry[]) {
  const compacted = new Map<string, PendingEntry>();
  for (const change of queue) compacted.set(`${change.habitId}\u0000${change.date}`, change);
  return [...compacted.values()];
}

export function clearLocalBoard() {
  if (!browser) return;
  localStorage.removeItem(CREDS_KEY);
  localStorage.removeItem(BOARD_KEY);
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(HABITS_DIRTY_KEY);
}

export function authHeaders(credentials: Credentials) {
  return { authorization: `Bearer ${credentials.secret}`, 'content-type': 'application/json' };
}
