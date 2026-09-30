import type { Board, Habit, MarkValue, Thought } from '$lib/types';

const DB_NAME = '3tap';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const BOARD_KEY = 'board';
const LEGACY_BOARD_KEY = '3tap.board.v1';
const LEGACY_KEYS = [
  LEGACY_BOARD_KEY,
  '3tap.queue.v1',
  '3tap.habits-dirty.v1',
  '3tap.thoughts-dirty.v1',
  '3tap.client-reset'
];

type CompactBoardV2 = {
  v: 2;
  c: string;
  u?: string;
  h: Habit[];
  a?: Habit[];
  e: [number, string, MarkValue][];
};

type CompactBoardV3 = {
  v: 3;
  c: string;
  u?: string;
  h: Habit[];
  a?: Habit[];
  t?: Thought[];
  e: [number, string, MarkValue][];
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open local database'));
  });
  return dbPromise;
}

function decodeLegacyBoard(raw: string): Board | null {
  try {
    const cached = JSON.parse(raw) as Board | CompactBoardV2 | CompactBoardV3;
    if (!cached || typeof cached !== 'object') return null;
    if (!('v' in cached)) return cached as Board;
    if (cached.v !== 2 && cached.v !== 3) return null;

    const habits = cached.h ?? [];
    const archivedHabits = cached.a ?? [];
    const allHabits = [...habits, ...archivedHabits];
    const entries = cached.e.flatMap(([index, date, value]) => {
      const habitId = allHabits[index]?.id;
      return habitId && value !== 0 ? [{ habitId, date, value }] : [];
    });

    return {
      createdAt: cached.c,
      updatedAt: cached.u,
      habits,
      archivedHabits,
      thoughts: cached.v === 3 ? (cached.t ?? []) : [],
      entries
    };
  } catch {
    return null;
  }
}

async function readBoardFromDb(): Promise<Board | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(BOARD_KEY);
    request.onsuccess = () => resolve((request.result as Board | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('could not read local data'));
  });
}

export async function loadBoard(): Promise<Board | null> {
  const stored = await readBoardFromDb();
  if (stored) return stored;

  let legacyRaw: string | null = null;
  try {
    legacyRaw = localStorage.getItem(LEGACY_BOARD_KEY);
  } catch {
    return null;
  }
  if (!legacyRaw) return null;
  const legacyBoard = decodeLegacyBoard(legacyRaw);
  if (!legacyBoard) return null;

  try {
    const queue = JSON.parse(localStorage.getItem('3tap.queue.v1') ?? '[]') as Array<{
      habitId: string;
      date: string;
      value: MarkValue;
    }>;
    const merged = new Map(legacyBoard.entries.map((entry) => [`${entry.habitId}\u0000${entry.date}`, entry]));
    for (const change of queue) {
      const key = `${change.habitId}\u0000${change.date}`;
      if (change.value === 0) merged.delete(key);
      else merged.set(key, change);
    }
    legacyBoard.entries = [...merged.values()];
  } catch {}

  await saveBoard(legacyBoard);
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {}
  return legacyBoard;
}

export async function saveBoard(board: Board): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(board, BOARD_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('could not save local data'));
    transaction.onabort = () => reject(transaction.error ?? new Error('could not save local data'));
  });
}
