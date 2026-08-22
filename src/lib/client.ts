import { browser } from '$app/environment';
import type { Board, Credentials, MarkValue } from '$lib/types';

const CREDS_KEY = '3tap.credentials.v1';
const BOARD_KEY = '3tap.board.v1';
const QUEUE_KEY = '3tap.queue.v1';

export type PendingEntry = {
  habitId: string;
  date: string;
  value: MarkValue;
};

function readJson<T>(key: string): T | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getCredentials() {
  return readJson<Credentials>(CREDS_KEY);
}

export function setCredentials(credentials: Credentials) {
  if (!browser) return;
  localStorage.setItem(CREDS_KEY, JSON.stringify(credentials));
}

export function getCachedBoard() {
  return readJson<Board>(BOARD_KEY);
}

export function setCachedBoard(board: Board) {
  if (!browser) return;
  localStorage.setItem(BOARD_KEY, JSON.stringify(board));
}

export function getQueue() {
  return readJson<PendingEntry[]>(QUEUE_KEY) ?? [];
}

export function setQueue(queue: PendingEntry[]) {
  if (!browser) return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearLocalBoard() {
  if (!browser) return;
  localStorage.removeItem(CREDS_KEY);
  localStorage.removeItem(BOARD_KEY);
  localStorage.removeItem(QUEUE_KEY);
}

export function authHeaders(credentials: Credentials) {
  return {
    authorization: `Bearer ${credentials.secret}`,
    'content-type': 'application/json'
  };
}
