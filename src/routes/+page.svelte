<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Board, Credentials, Entry, Habit, MarkValue } from '$lib/types';
  import {
    authHeaders,
    compactQueue,
    getCachedBoard,
    getCredentials,
    getQueue,
    setCachedBoard,
    setCredentials,
    setQueue,
    type PendingEntry
  } from '$lib/client';

  type DayColumn = { key: string; weekday: string; day: number; month: string; year: number };

  let board: Board | null = null;
  let credentials: Credentials | null = null;
  let loading = true;
  let online = true;
  let menuOpen = false;
  let panel: 'none' | 'pair' | 'recovery' = 'none';
  let qrDataUrl = '';
  let pairingLink = '';
  let recoveryInput = '';
  let editingHabitId: string | null = null;
  let editingHabitName = '';
  let addingHabit = false;
  let newHabitName = '';
  let editHabitInput: HTMLInputElement;
  let newHabitInput: HTMLInputElement;
  let pendingHabitSave: Habit[] | null = null;
  let scroller: HTMLDivElement;
  let currentDay = new Date();
  let windowEndOffset = 0;
  let visibleMonthLabel = '';
  let showTodayButton = false;
  let shiftingWindow = false;
  let scrollRaf = 0;
  const WINDOW_DAYS = 84;
  const WINDOW_SHIFT = 28;
  const PRE_START_CONTEXT_DAYS = 14;
  const pendingByCell = new Map<string, PendingEntry>();
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let habitFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let habitFlushPromise: Promise<void> | null = null;
  let draggingHabitId: string | null = null;
  let dragPointerId: number | null = null;
  let dragCandidate: { habitId: string; startX: number; startY: number; offsetY: number } | null = null;
  let dragActive = false;
  let dragOriginalHabits: Habit[] | null = null;
  let dragPreviewName = '';
  let dragPreviewLeft = 0;
  let dragPreviewTop = 0;
  let dragPreviewWidth = 0;
  let dragPreviewHeight = 0;
  let dragMoveRaf = 0;
  let dragPendingY: number | null = null;
  let dragLastClientY: number | null = null;

  const entries = new SvelteMap<string, Entry>();
  const symbols: Record<MarkValue, string> = { 0: '-', 1: '|', 2: '+' };

  function dateKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function cellKey(habitId: string, date: string) {
    return `${habitId}\u0000${date}`;
  }

  function shiftedDate(base: Date, offset: number) {
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
    next.setDate(next.getDate() + offset);
    return next;
  }

  function enrollmentDate(source: Board | null) {
    if (!source) return null;
    const created = new Date(source.createdAt);
    return new Date(created.getFullYear(), created.getMonth(), created.getDate(), 12);
  }

  function enrollmentKey(source: Board | null) {
    const start = enrollmentDate(source);
    return start ? dateKey(start) : '';
  }

  function earliestTimelineKey(source: Board | null) {
    const start = enrollmentDate(source);
    return start ? dateKey(shiftedDate(start, -PRE_START_CONTEXT_DAYS)) : '';
  }

  function datesForWindow(source: Board | null, endDay: Date, endOffset: number): DayColumn[] {
    const end = shiftedDate(endDay, endOffset);
    const start = shiftedDate(end, -(WINDOW_DAYS - 1));
    const earliest = earliestTimelineKey(source);
    const days: DayColumn[] = [];
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
    const month = new Intl.DateTimeFormat(undefined, { month: 'short' });

    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = dateKey(cursor);
      if (earliest && key < earliest) continue;
      days.push({
        key,
        weekday: weekday.format(cursor),
        day: cursor.getDate(),
        month: month.format(cursor).toUpperCase(),
        year: cursor.getFullYear()
      });
    }
    return days;
  }

  $: dates = datesForWindow(board, currentDay, windowEndOffset);
  $: todayKey = dateKey(currentDay);
  $: enrolledKey = enrollmentKey(board);
  $: earliestKey = earliestTimelineKey(board);

  function isPreEnrollment(date: string) {
    return Boolean(enrolledKey && date < enrolledKey);
  }

  function isEditableDate(date: string) {
    return Boolean(enrolledKey && date >= enrolledKey && date === todayKey);
  }

  function habitStartKey(habit: Habit) {
    if (!habit.createdAt) return enrolledKey;
    const created = new Date(habit.createdAt);
    return dateKey(new Date(created.getFullYear(), created.getMonth(), created.getDate(), 12));
  }

  function isBeforeHabitStart(habit: Habit, date: string) {
    const start = habitStartKey(habit);
    return Boolean(start && date < start);
  }

  function hydrateEntries(source: Board | null) {
    entries.clear();
    for (const entry of source?.entries ?? []) entries.set(cellKey(entry.habitId, entry.date), entry);
  }

  function valueFor(habitId: string, date: string): MarkValue {
    return (entries.get(cellKey(habitId, date))?.value ?? 0) as MarkValue;
  }

  function applyLocalEntry(change: PendingEntry) {
    if (!board) return;
    const key = cellKey(change.habitId, change.date);
    if (change.value === 0) {
      entries.delete(key);
    } else {
      entries.set(key, {
        habitId: change.habitId,
        date: change.date,
        value: change.value as 1 | 2,
        updatedAt: ''
      });
    }
  }

  function pendingChanges() {
    return [...pendingByCell.values()];
  }

  function persistLocalStateNow() {
    if (board) {
      const logicalEntries = new Map(entries);
      for (const change of pendingChanges()) {
        const key = cellKey(change.habitId, change.date);
        if (change.value === 0) logicalEntries.delete(key);
        else {
          logicalEntries.set(key, {
            habitId: change.habitId,
            date: change.date,
            value: change.value as 1 | 2,
            updatedAt: ''
          });
        }
      }
      board.entries = [...logicalEntries.values()];
      setCachedBoard(board);
    }
    setQueue(pendingChanges());
  }

  function schedulePersistence() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      persistLocalStateNow();
    }, 300);
  }

  function queueChange(change: PendingEntry) {
    pendingByCell.set(cellKey(change.habitId, change.date), change);
    schedulePersistence();

    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flushQueue();
    }, 120);
  }

  function tapCell(habitId: string, date: string, button?: HTMLButtonElement) {
    if (!isEditableDate(date)) return;
    const current = valueFor(habitId, date);
    const next = ((current + 1) % 3) as MarkValue;
    const change = { habitId, date, value: next };

    // Update the actual DOM node first. This is the shortest possible visual path:
    // pointer event -> text mutation. Svelte state, persistence and network syncing
    // all happen afterward and never gate what the user sees.
    if (button) {
      button.textContent = symbols[next];
      button.classList.toggle('plus', next === 2);
      button.setAttribute('aria-label', `${date}: ${symbols[next]}`);
    }

    applyLocalEntry(change);
    queueChange(change);
  }

  async function createBoard() {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    credentials = data.credentials;
    board = data.board;
    setCredentials(credentials!);
    hydrateEntries(board);
    setCachedBoard(board!);
  }

  async function fetchBoard(force = false) {
    if (!credentials) return;
    const headers: Record<string, string> = authHeaders(credentials);
    if (!force && board?.updatedAt) headers['if-none-match'] = `"${board.updatedAt}"`;

    const response = await fetch(`/api/boards/${credentials.boardId}`, { headers });
    if (response.status === 304) return;
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) return;
      throw new Error(await response.text());
    }

    const remoteBoard: Board = await response.json();
    board = pendingHabitSave ? { ...remoteBoard, habits: pendingHabitSave } : remoteBoard;
    hydrateEntries(board);
    for (const change of pendingChanges()) applyLocalEntry(change);
    persistLocalStateNow();
  }

  async function flushQueue(options: { keepalive?: boolean } = {}) {
    if (flushPromise) return flushPromise;
    if (pendingHabitSave || habitFlushPromise) {
      await flushHabitChanges();
      if (pendingHabitSave) return;
    }
    if (!credentials || !navigator.onLine || pendingByCell.size === 0) return;

    flushPromise = (async () => {
      // Keep object identity so an older request can never delete a newer tap.
      const sent = new Map(pendingByCell);
      try {
        const response = await fetch(`/api/boards/${credentials!.boardId}/entries`, {
          method: 'PUT',
          headers: authHeaders(credentials!),
          body: JSON.stringify({ changes: [...sent.values()] }),
          keepalive: options.keepalive ?? false
        });
        if (!response.ok) throw new Error(await response.text());

        for (const [key, change] of sent) {
          if (pendingByCell.get(key) === change) pendingByCell.delete(key);
        }
        schedulePersistence();
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        flushPromise = null;
        // If taps landed during the request, send the newest state next.
        if (pendingByCell.size && navigator.onLine) {
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = setTimeout(() => {
            flushTimer = undefined;
            void flushQueue();
          }, 40);
        }
      }
    })();

    return flushPromise;
  }

  async function sync() {
    if (syncPromise) return syncPromise;
    if (!credentials || !navigator.onLine || document.visibilityState === 'hidden') {
      online = navigator.onLine;
      return;
    }

    syncPromise = (async () => {
      try {
        await flushHabitChanges();
        await flushQueue();
        await fetchBoard();
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        syncPromise = null;
      }
    })();

    return syncPromise;
  }

  function timelineMetrics() {
    if (!scroller) return null;
    const dayHead = scroller.querySelector<HTMLTableCellElement>('thead th.day-head');
    const habitHead = scroller.querySelector<HTMLTableCellElement>('thead th.habit-head');
    if (!dayHead || !habitHead) return null;
    return {
      dayWidth: dayHead.getBoundingClientRect().width,
      habitWidth: habitHead.getBoundingClientRect().width
    };
  }

  function updateTimelineStatus() {
    if (!scroller || !dates.length) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const timelineWidth = Math.max(0, scroller.clientWidth - metrics.habitWidth);
    const centerInTimeline = scroller.scrollLeft + timelineWidth / 2;
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor(centerInTimeline / metrics.dayWidth)));
    const date = dates[index];
    visibleMonthLabel = `${date.month} ${date.year}`;

    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    showTodayButton = windowEndOffset < 0 || rightGap > metrics.dayWidth * 1.25;
  }

  function scrollAnchor(metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || !dates.length) return null;
    const timelineLeft = Math.max(0, scroller.scrollLeft - metrics.habitWidth);
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor(timelineLeft / metrics.dayWidth)));
    return {
      key: dates[index].key,
      offset: timelineLeft - index * metrics.dayWidth
    };
  }

  async function shiftTimelineWindow(delta: number, metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || delta === 0) return;
    const anchor = scrollAnchor(metrics);
    windowEndOffset += delta;
    await tick();

    if (anchor) {
      const nextIndex = dates.findIndex((date) => date.key === anchor.key);
      if (nextIndex >= 0) {
        scroller.scrollLeft = metrics.habitWidth + nextIndex * metrics.dayWidth + anchor.offset;
      }
    }
  }

  async function maintainTimelineWindow() {
    if (!scroller || shiftingWindow) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const threshold = metrics.dayWidth * 7;
    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;

    if (scroller.scrollLeft < threshold && dates[0]?.key > earliestKey) {
      shiftingWindow = true;
      await shiftTimelineWindow(-WINDOW_SHIFT, metrics);
      shiftingWindow = false;
      updateTimelineStatus();
      return;
    }

    if (rightGap < threshold && windowEndOffset < 0) {
      shiftingWindow = true;
      const shift = Math.min(WINDOW_SHIFT, -windowEndOffset);
      await shiftTimelineWindow(shift, metrics);
      shiftingWindow = false;
      updateTimelineStatus();
    }
  }

  function onTimelineScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateTimelineStatus();
      void maintainTimelineWindow();
    });
  }

  async function scrollToToday() {
    windowEndOffset = 0;
    await tick();
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
      updateTimelineStatus();
    }
  }

  async function openPair() {
    if (!credentials) return;
    menuOpen = false;
    panel = 'pair';
    const nextLink = `${location.origin}/pair#${credentials.boardId}.${credentials.secret}`;
    if (pairingLink !== nextLink) {
      pairingLink = nextLink;
      qrDataUrl = '';
    }
    if (!qrDataUrl) {
      const { toDataURL } = await import('qrcode');
      qrDataUrl = await toDataURL(pairingLink, {
        width: 280,
        margin: 1,
        color: { dark: '#11110f', light: '#f7f7f5' }
      });
    }
  }

  function normalizeHabits(habits: Habit[]) {
    return habits.map((habit, position) => ({ ...habit, position }));
  }

  function setLocalHabits(habits: Habit[]) {
    if (!board) return;
    const next = normalizeHabits(habits);
    board = { ...board, habits: next };
    pendingHabitSave = next;
    schedulePersistence();

    if (habitFlushTimer) clearTimeout(habitFlushTimer);
    habitFlushTimer = setTimeout(() => {
      habitFlushTimer = undefined;
      void flushHabitChanges();
    }, 80);
  }

  async function flushHabitChanges() {
    if (habitFlushPromise) return habitFlushPromise;
    if (!credentials || !navigator.onLine || !pendingHabitSave) return;

    const sent = pendingHabitSave;
    habitFlushPromise = (async () => {
      try {
        const response = await fetch(`/api/boards/${credentials!.boardId}/habits`, {
          method: 'PUT',
          headers: authHeaders(credentials!),
          body: JSON.stringify({ habits: sent.map(({ id, name }) => ({ id, name })) })
        });
        if (!response.ok) throw new Error(await response.text());
        const saved: Board = await response.json();

        if (pendingHabitSave === sent) {
          pendingHabitSave = null;
          if (board) board = { ...board, habits: saved.habits, updatedAt: saved.updatedAt };
          schedulePersistence();
        }
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        habitFlushPromise = null;
        if (pendingHabitSave && navigator.onLine) {
          if (habitFlushTimer) clearTimeout(habitFlushTimer);
          habitFlushTimer = setTimeout(() => {
            habitFlushTimer = undefined;
            void flushHabitChanges();
          }, 120);
        }
      }
    })();

    return habitFlushPromise;
  }

  async function beginRename(habit: Habit) {
    editingHabitId = habit.id;
    editingHabitName = habit.name;
    await tick();
    editHabitInput?.focus();
    editHabitInput?.select();
  }

  function commitRename() {
    if (!board || !editingHabitId) return;
    const id = editingHabitId;
    const name = editingHabitName.trim();
    editingHabitId = null;
    editingHabitName = '';
    if (!name) return;
    const current = board.habits.find((habit) => habit.id === id);
    if (!current || current.name === name) return;
    setLocalHabits(board.habits.map((habit) => (habit.id === id ? { ...habit, name } : habit)));
  }

  function moveHabit(index: number, direction: -1 | 1) {
    if (!board) return;
    const next = index + direction;
    if (next < 0 || next >= board.habits.length) return;
    const copy = [...board.habits];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    setLocalHabits(copy);
  }

  function blockDragClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function activateHabitDrag(event: PointerEvent) {
    if (!board || !dragCandidate || dragActive) return;
    const habit = board.habits.find((item) => item.id === dragCandidate!.habitId);
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-habit-id="${dragCandidate.habitId}"]`);
    const cell = row?.querySelector<HTMLElement>('.habit-name');
    if (!habit || !cell) return;

    const rect = cell.getBoundingClientRect();
    dragActive = true;
    draggingHabitId = habit.id;
    dragOriginalHabits = [...board.habits];
    dragPreviewName = habit.name;
    dragPreviewLeft = rect.left;
    dragPreviewWidth = rect.width;
    dragPreviewHeight = rect.height;
    dragPreviewTop = event.clientY - dragCandidate.offsetY;
    dragLastClientY = dragCandidate.startY;
    document.documentElement.classList.add('habit-dragging-cursor');
    window.addEventListener('click', blockDragClick, true);
  }

  function updateLiveHabitOrder(clientY: number) {
    if (!board || !draggingHabitId || !dragCandidate) return;

    const currentIndex = board.habits.findIndex((habit) => habit.id === draggingHabitId);
    if (currentIndex < 0) return;

    const previousY = dragLastClientY ?? clientY;
    const movingUp = clientY < previousY;
    const movingDown = clientY > previousY;
    dragLastClientY = clientY;
    if (!movingUp && !movingDown) return;

    const previewTop = clientY - dragCandidate.offsetY;
    const previewBottom = previewTop + dragPreviewHeight;
    let targetIndex = currentIndex;

    // Edge-crossing reorder: there is deliberately no 50%/center threshold.
    // Moving up: the instant the floating row's top edge overlaps the row above,
    // that slot opens. Moving down: same rule using the bottom edge.
    if (movingUp) {
      for (let index = currentIndex - 1; index >= 0; index -= 1) {
        const habit = board.habits[index];
        const row = document.querySelector<HTMLTableRowElement>(`tr[data-habit-id="${habit.id}"]`);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (previewTop < rect.bottom) targetIndex = index;
        else break;
      }
    } else if (movingDown) {
      for (let index = currentIndex + 1; index < board.habits.length; index += 1) {
        const habit = board.habits[index];
        const row = document.querySelector<HTMLTableRowElement>(`tr[data-habit-id="${habit.id}"]`);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (previewBottom > rect.top) targetIndex = index;
        else break;
      }
    }

    if (targetIndex === currentIndex) return;

    const next = [...board.habits];
    const [dragged] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, dragged);

    // Reorder locally only. The server is updated once, on release.
    board = { ...board, habits: normalizeHabits(next) };
  }

  function sameHabitOrder(a: Habit[], b: Habit[]) {
    return a.length === b.length && a.every((habit, index) => habit.id === b[index]?.id);
  }

  function cleanupHabitDrag(commit = false) {
    const finalHabits = board?.habits ? [...board.habits] : null;
    const originalHabits = dragOriginalHabits;

    window.removeEventListener('pointermove', onHabitDragMove);
    window.removeEventListener('pointerup', onHabitDragEnd);
    window.removeEventListener('pointercancel', onHabitDragCancel);
    document.documentElement.classList.remove('habit-dragging-cursor');
    if (dragMoveRaf) cancelAnimationFrame(dragMoveRaf);
    dragMoveRaf = 0;
    dragPendingY = null;
    dragLastClientY = null;
    if (dragActive) setTimeout(() => window.removeEventListener('click', blockDragClick, true), 0);
    else window.removeEventListener('click', blockDragClick, true);

    if (board && originalHabits) {
      if (commit && finalHabits && !sameHabitOrder(originalHabits, finalHabits)) {
        setLocalHabits(finalHabits);
      } else if (!commit) {
        board = { ...board, habits: normalizeHabits(originalHabits) };
      }
    }

    draggingHabitId = null;
    dragPointerId = null;
    dragCandidate = null;
    dragActive = false;
    dragOriginalHabits = null;
    dragPreviewName = '';
  }

  function onHabitDragMove(event: PointerEvent) {
    if (!dragCandidate || event.pointerId !== dragPointerId) return;
    const dx = event.clientX - dragCandidate.startX;
    const dy = event.clientY - dragCandidate.startY;
    if (!dragActive && Math.hypot(dx, dy) >= 5) activateHabitDrag(event);
    if (!dragActive) return;

    event.preventDefault();
    dragPendingY = event.clientY;
    if (dragMoveRaf) return;

    dragMoveRaf = requestAnimationFrame(() => {
      dragMoveRaf = 0;
      if (!dragActive || !dragCandidate || dragPendingY === null) return;
      const clientY = dragPendingY;
      dragPendingY = null;
      dragPreviewTop = clientY - dragCandidate.offsetY;
      updateLiveHabitOrder(clientY);
    });
  }

  function onHabitDragEnd(event: PointerEvent) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;

    // Apply the latest pointer position before committing, even if the browser
    // has not painted the queued animation frame yet.
    if (dragActive && dragCandidate && dragPendingY !== null) {
      if (dragMoveRaf) cancelAnimationFrame(dragMoveRaf);
      dragMoveRaf = 0;
      const clientY = dragPendingY;
      dragPendingY = null;
      dragPreviewTop = clientY - dragCandidate.offsetY;
      updateLiveHabitOrder(clientY);
    }

    cleanupHabitDrag(true);
  }

  function onHabitDragCancel(event: PointerEvent) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    cleanupHabitDrag(false);
  }

  function startHabitDrag(event: PointerEvent, habitId: string) {
    if (!board || event.button !== 0 || editingHabitId === habitId) return;
    const target = event.target as HTMLElement;
    if (target.closest('.habit-controls, input')) return;

    const cell = event.currentTarget as HTMLElement;
    const rect = cell.getBoundingClientRect();
    dragPointerId = event.pointerId;
    dragCandidate = {
      habitId,
      startX: event.clientX,
      startY: event.clientY,
      offsetY: event.clientY - rect.top
    };
    window.addEventListener('pointermove', onHabitDragMove, { passive: false });
    window.addEventListener('pointerup', onHabitDragEnd);
    window.addEventListener('pointercancel', onHabitDragCancel);
  }

  function removeHabit(index: number) {
    if (!board || board.habits.length <= 1) return;
    const removed = board.habits[index];
    if (!removed) return;
    const prefix = `${removed.id}\u0000`;
    for (const key of pendingByCell.keys()) if (key.startsWith(prefix)) pendingByCell.delete(key);
    for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
    setLocalHabits(board.habits.filter((_, i) => i !== index));
  }

  async function beginAddHabit() {
    addingHabit = true;
    newHabitName = '';
    await tick();
    newHabitInput?.focus();
  }

  function commitAddHabit() {
    if (!board || !addingHabit) return;
    const name = newHabitName.trim();
    addingHabit = false;
    newHabitName = '';
    if (!name) return;
    setLocalHabits([
      ...board.habits,
      { id: crypto.randomUUID(), name, position: board.habits.length, createdAt: new Date().toISOString() }
    ]);
  }

  function cancelAddHabit() {
    addingHabit = false;
    newHabitName = '';
  }

  function openRecovery() {
    menuOpen = false;
    recoveryInput = credentials ? `${credentials.boardId}.${credentials.secret}` : '';
    panel = 'recovery';
  }

  async function useRecoveryCode() {
    const token = recoveryInput.trim().replace(/^.*#/, '');
    const separator = token.indexOf('.');
    if (separator < 1) return;
    const next = { boardId: token.slice(0, separator), secret: token.slice(separator + 1) };
    if (!next.boardId || !next.secret) return;

    setCredentials(next);
    credentials = next;
    board = null;
    entries.clear();
    qrDataUrl = '';
    pairingLink = '';
    pendingByCell.clear();
    setQueue([]);
    await fetchBoard(true);
    panel = 'none';
    await scrollToToday();
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function exportData() {
    if (!board) return;
    persistLocalStateNow();
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `3tap-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    menuOpen = false;
  }

  function scheduleNextDay() {
    if (dayTimer) clearTimeout(dayTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    dayTimer = setTimeout(() => {
      currentDay = new Date();
      void scrollToToday();
      scheduleNextDay();
    }, next.getTime() - now.getTime());
  }

  async function initialize() {
    online = navigator.onLine;
    credentials = getCredentials();
    board = getCachedBoard();
    pendingByCell.clear();
    for (const change of compactQueue(getQueue())) {
      pendingByCell.set(cellKey(change.habitId, change.date), change);
    }
    if (!credentials) pendingByCell.clear();
    hydrateEntries(board);
    for (const change of pendingChanges()) applyLocalEntry(change);

    try {
      if (!credentials) await createBoard();
      else await sync();
    } catch {
      online = navigator.onLine;
    } finally {
      loading = false;
      await scrollToToday();
    }
  }

  onMount(() => {
    void initialize();

    const onFocus = () => void sync();
    const onOnline = () => credentials ? void sync() : void initialize();
    const onOffline = () => (online = false);
    const onVisibility = () => document.visibilityState === 'visible' && void sync();
    const onResize = () => windowEndOffset === 0 ? void scrollToToday() : updateTimelineStatus();
    const onPageHide = () => {
      persistLocalStateNow();
      void flushHabitChanges();
      void flushQueue({ keepalive: true });
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    syncTimer = setInterval(() => void sync(), 8000);
    scheduleNextDay();

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      if (syncTimer) clearInterval(syncTimer);
      if (dayTimer) clearTimeout(dayTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (persistTimer) clearTimeout(persistTimer);
      if (habitFlushTimer) clearTimeout(habitFlushTimer);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      cleanupHabitDrag(false);
    };
  });
</script>

<svelte:head>
  <title>3tap</title>
  <meta name="description" content="A tiny three-state daily habit grid." />
</svelte:head>

<div class="shell">
  <header>
    <div class="brand">3tap</div>
    <div class="header-right">
      {#if !online}<span class="offline">offline</span>{/if}
      <button class="menu-button" aria-label="Menu" onclick={() => (menuOpen = !menuOpen)}>···</button>
      {#if menuOpen}
        <div class="menu">
          <button onclick={openPair}>add device</button>
          <button onclick={openRecovery}>recovery</button>
          <button onclick={exportData}>export</button>
        </div>
      {/if}
    </div>
  </header>

  {#if board}
    <main>
      <div class="timeline-toolbar">
        <div class="timeline-toolbar-spacer"></div>
        <div class="timeline-toolbar-meta">
          <span>{visibleMonthLabel}</span>
          {#if showTodayButton}
            <button class="today-button" aria-label="Jump to today" onclick={scrollToToday}>today →</button>
          {/if}
        </div>
      </div>
      <div class="grid-scroll" bind:this={scroller} onscroll={onTimelineScroll}>
        <table>
          <thead>
            <tr>
              <th class="habit-head"></th>
              {#each dates as date (date.key)}
                <th
                  class="day-head"
                  class:today={date.key === todayKey}
                  class:enrolled={date.key === enrolledKey}
                  class:prestart={isPreEnrollment(date.key)}
                >
                  <span>{date.weekday}</span>
                  <strong>{date.day}</strong>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each board.habits as habit, habitIndex (habit.id)}
              <tr
                data-habit-id={habit.id}
                class:dragging={dragActive && draggingHabitId === habit.id}
                animate:flip={{ duration: 120 }}
              >
                <th
                  class="habit-name"
                  aria-label={`Drag ${habit.name} to reorder`}
                  onpointerdown={(event) => startHabitDrag(event, habit.id)}
                >
                  <div class="habit-line">
                    {#if editingHabitId === habit.id}
                      <input
                        class="habit-inline-input"
                        bind:this={editHabitInput}
                        bind:value={editingHabitName}
                        aria-label={`Rename ${habit.name}`}
                        onblur={commitRename}
                        onkeydown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            editingHabitId = null;
                            editingHabitName = '';
                          }
                        }}
                      />
                    {:else}
                      <button class="habit-label" onclick={() => beginRename(habit)}>{habit.name}</button>
                    {/if}
                    <div class="habit-controls">
                      <button disabled={habitIndex === 0} aria-label={`Move ${habit.name} up`} onclick={() => moveHabit(habitIndex, -1)}>↑</button>
                      <button disabled={habitIndex === board.habits.length - 1} aria-label={`Move ${habit.name} down`} onclick={() => moveHabit(habitIndex, 1)}>↓</button>
                      <button class="delete-habit" disabled={board.habits.length <= 1} aria-label={`Remove ${habit.name}`} onclick={() => removeHabit(habitIndex)}>×</button>
                    </div>
                  </div>
                </th>
                {#each dates as date (date.key)}
                  {@const value = valueFor(habit.id, date.key)}
                  {@const prestart = isPreEnrollment(date.key) || isBeforeHabitStart(habit, date.key)}
                  {@const editable = isEditableDate(date.key)}
                  <td
                    class:today={date.key === todayKey}
                    class:enrolled={date.key === enrolledKey}
                    class:prestart={prestart}
                    class:locked={!editable && !prestart}
                  >
                    <button
                      class:plus={value === 2}
                      class="cell"
                      disabled={!editable}
                      aria-label={prestart
                        ? `${habit.name}, ${date.key}: before tracking began`
                        : `${habit.name}, ${date.key}: ${symbols[value]}${editable ? '' : ', locked'}`}
                      onpointerdown={(event) => {
                        if (event.button === 0) tapCell(habit.id, date.key, event.currentTarget);
                      }}
                      onclick={(event) => {
                        if (event.detail === 0) tapCell(habit.id, date.key, event.currentTarget);
                      }}>{symbols[value]}</button>
                  </td>
                {/each}
              </tr>
            {/each}
            <tr class="add-row">
              <th class="habit-name add-habit-cell">
                {#if addingHabit}
                  <input
                    class="habit-inline-input add-input"
                    bind:this={newHabitInput}
                    bind:value={newHabitName}
                    placeholder="habit"
                    aria-label="New habit"
                    onblur={commitAddHabit}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') cancelAddHabit();
                    }}
                  />
                {:else}
                  <button class="add-habit" onclick={beginAddHabit}>+ habit</button>
                {/if}
              </th>
              <td class="add-spacer" colspan={dates.length}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  {:else}
    <main aria-busy={loading}></main>
  {/if}
</div>

{#if dragActive}
  <div
    class="habit-drag-preview"
    style={`left:${dragPreviewLeft}px; top:${dragPreviewTop}px; width:${dragPreviewWidth}px; height:${dragPreviewHeight}px`}
    aria-hidden="true"
  >
    <span>{dragPreviewName}</span>
  </div>
{/if}

{#if panel !== 'none'}
  <div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (panel = 'none')}>
    <section class="panel" aria-modal="true" role="dialog">
      <button class="close" aria-label="Close" onclick={() => (panel = 'none')}>×</button>

      {#if panel === 'pair'}
        <h2>add device</h2>
        <p>scan this on the other device.</p>
        {#if qrDataUrl}<img class="qr" src={qrDataUrl} alt="Pairing QR code" />{/if}
        <button class="action" onclick={() => copyText(pairingLink)}>copy sync link</button>
      {:else if panel === 'recovery'}
        <h2>recovery</h2>
        <p>save this code somewhere private. anyone with it can open this board.</p>
        <textarea bind:value={recoveryInput} rows="4" spellcheck="false"></textarea>
        <div class="panel-actions">
          <button class="text-button" onclick={() => copyText(recoveryInput)}>copy</button>
          <button class="action" onclick={useRecoveryCode}>use code</button>
        </div>
      {/if}
    </section>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { background: #f7f7f5; color-scheme: light; }
  :global(body) {
    margin: 0;
    background: #f7f7f5;
    color: #11110f;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    -webkit-font-smoothing: antialiased;
  }
  :global(button), :global(input), :global(textarea) { font: inherit; }
  :global(button) { color: inherit; }
  :global(html.habit-dragging-cursor),
  :global(html.habit-dragging-cursor *) { cursor: grabbing !important; }

  .shell {
    --habit-width: 224px;
    --day-size: 48px;
    --grid-weak: #e3e3de;
    --grid-strong: #aaa9a2;
    min-height: 100dvh;
    padding: max(14px, env(safe-area-inset-top)) 0 max(18px, env(safe-area-inset-bottom));
  }
  header {
    height: 28px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    max-width: 100%;
    margin-bottom: 4px;
    padding: 0 16px;
  }
  .brand { font-size: 12px; letter-spacing: .08em; text-transform: lowercase; opacity: .48; }
  .header-right { position: relative; display: flex; align-items: center; gap: 10px; }
  .offline { font-size: 10px; opacity: .4; }
  button { border: 0; background: none; padding: 0; cursor: pointer; }
  .menu-button { width: 36px; height: 28px; font-size: 17px; line-height: 1; text-align: right; }
  .menu {
    position: absolute; z-index: 20; top: 30px; right: 0; min-width: 132px;
    background: #f7f7f5; border: 1px solid #d8d8d2; padding: 5px;
    box-shadow: 0 8px 24px rgba(0,0,0,.06);
  }
  .menu button { display: block; width: 100%; padding: 8px 9px; text-align: left; font-size: 12px; }
  @media (hover: hover) and (pointer: fine) {
    .menu button:hover { background: #ecece7; }
    .habit-controls button:not(:disabled):hover { opacity: .9; }
    .cell:not(:disabled):hover { background: rgba(17,17,15,.03); }
    .today-button:hover { opacity: .9; }
  }

  main { width: 100%; }
  .center { min-height: 60dvh; display: grid; place-items: center; font-size: 12px; opacity: .55; }
  .timeline-toolbar {
    display: grid;
    grid-template-columns: var(--habit-width) minmax(0, 1fr);
    align-items: center;
    min-height: 24px;
    width: 100%;
  }
  .timeline-toolbar-spacer { min-width: 0; }
  .timeline-toolbar-meta {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 4px 0 10px;
    color: #6e6e68;
    font-size: 10px;
    letter-spacing: .06em;
  }
  .timeline-toolbar-meta > span { white-space: nowrap; }
  .today-button {
    min-height: 24px;
    padding: 0 2px;
    color: #11110f;
    font-size: 10px;
    opacity: .52;
    white-space: nowrap;
  }
  .grid-scroll {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: max-content;
    table-layout: fixed;
    background: transparent;
  }
  th, td {
    padding: 0;
  }
  tbody tr:not(.add-row) > th,
  tbody tr:not(.add-row) > td {
    height: var(--day-size);
    border-bottom: 1px solid var(--grid-weak);
  }
  thead th {
    height: 34px;
    vertical-align: bottom;
    font-weight: 400;
    font-size: 10px;
    opacity: .5;
    text-align: center;
    background: transparent;
    border-bottom: 1px solid var(--grid-strong);
  }
  thead th.day-head,
  td {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
  }
  /* One owner per vertical boundary: day cells draw their left separator. */
  thead th.day-head,
  tbody td { border-left: 1px solid var(--grid-weak); }

  /* The sticky habit/timeline split owns this boundary, so suppress the
     adjacent first date separator to avoid a doubled line. */
  thead .habit-head + .day-head,
  tbody .habit-name + td { border-left-color: transparent; }
  thead th span,
  thead th strong { display: block; font-weight: 400; line-height: 1.2; }
  thead th strong { font-size: 11px; }
  thead th.today { opacity: .8; }

  .habit-head,
  .habit-name {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--habit-width);
    min-width: var(--habit-width);
    max-width: var(--habit-width);
    background: #f7f7f5;
    border-right: 1px solid var(--grid-strong);
  }
  .habit-head { z-index: 8; }
  .habit-name {
    padding: 0 8px 0 16px;
    text-align: left;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
  }
  .habit-line {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 100%;
    gap: 5px;
  }
  .habit-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 12px;
    font-weight: 500;
  }
  .habit-controls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0;
    margin-left: auto;
  }
  .habit-controls button {
    width: 30px;
    height: 42px;
    display: grid;
    place-items: center;
    font-size: 18px;
    font-weight: 650;
    line-height: 1;
    opacity: .72;
    -webkit-tap-highlight-color: transparent;
  }
  .habit-controls .delete-habit { font-size: 21px; }
  .habit-controls button:disabled { opacity: .18; cursor: default; }
  .habit-name {
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .habit-name:active { cursor: grabbing; }
  tr.dragging > th,
  tr.dragging > td { opacity: .08; }
  .habit-drag-preview {
    position: fixed;
    z-index: 250;
    display: flex;
    align-items: center;
    padding: 0 10px 0 var(--page-inset);
    background: #fffffc;
    border: 1px solid #c8c8c1;
    box-shadow: 0 10px 28px rgba(17,17,15,.16);
    font-size: 12px;
    font-weight: 550;
    pointer-events: none;
    transform: scale(1.015);
    transform-origin: center;
    will-change: top, transform;
  }
  .habit-inline-input {
    flex: 1;
    min-width: 0;
    height: 30px;
    border: 0;
    border-bottom: 1px solid #aaa9a2;
    border-radius: 0;
    outline: none;
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: 12px;
  }
  .add-habit-cell {
    height: 38px;
    border: 0;
    background: #f7f7f5;
  }
  .add-row .add-spacer {
    height: 38px;
    border: 0;
    background: transparent;
  }
  .add-habit {
    width: 100%;
    height: 100%;
    font-size: 11px;
    opacity: .54;
    text-align: left;
  }
  .add-input { width: 100%; }
  td { text-align: center; background: transparent; }
  .today { background: rgba(17,17,15,.05); }
  /* The only strong date divider: when tracking began. */
  .enrolled { border-left-color: var(--grid-strong); }
  td.prestart { background: rgba(17,17,15,.012); }
  td.locked .cell { cursor: default; }
  td.prestart .cell { cursor: default; }
  thead th.prestart { opacity: .26; }
  .cell {
    width: 100%;
    height: 100%;
    font-size: 16px;
    font-weight: 400;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .cell.plus { font-weight: 750; font-size: 17px; }
  .cell:disabled { color: inherit; }
  td.locked .cell { opacity: .58; }
  td.prestart .cell { opacity: .26; }
  td.today .cell { opacity: 1; }
  td:not(.locked):not(.prestart) .cell[aria-label$=': -'] { opacity: .42; }
  .cell:not(:disabled):active { background: rgba(17,17,15,.07); }

  .backdrop { position: fixed; z-index: 100; inset: 0; background: rgba(17,17,15,.18); display: grid; place-items: center; padding: 18px; }
  .panel { position: relative; width: min(390px, 100%); max-height: min(720px, 88dvh); overflow: auto; background: #f7f7f5; border: 1px solid #d6d6d0; padding: 24px; }
  .panel h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: lowercase; }
  .panel p { margin: 0 0 18px; color: #686862; font-size: 11px; line-height: 1.5; }
  .close { position: absolute; top: 12px; right: 14px; font-size: 18px; opacity: .5; }
  .qr { display: block; width: min(280px, 100%); margin: 16px auto 20px; image-rendering: pixelated; }
  .action { border: 1px solid #11110f; padding: 9px 12px; font-size: 11px; }
  .text-button { font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
  textarea { resize: vertical; padding: 9px; font-size: 10px; line-height: 1.4; margin-bottom: 14px; }
  .panel-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; }

  @media (max-width: 520px) {
    .shell {
      --habit-width: 190px;
      --day-size: 48px;
    }
    header { margin-bottom: 2px; padding: 0 10px; }
    .timeline-toolbar { min-height: 22px; }
    .timeline-toolbar-meta { padding-left: 7px; }
    .habit-name { padding-left: 10px; padding-right: 2px; }
    .habit-controls button { width: 27px; height: 42px; font-size: 17px; }
    .habit-controls .delete-habit { font-size: 20px; }
    thead th { height: 34px; }
    .panel { padding: 22px 18px; }
  }
</style>
