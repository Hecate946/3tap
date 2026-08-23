<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
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

  let board: Board | null = browser ? getCachedBoard() : null;
  let credentials: Credentials | null = browser ? getCredentials() : null;
  let loading = !board;
  let startupError = '';
  let online = true;
  let menuOpen = false;
  let theme: 'light' | 'dark' = 'light';
  let navScrolled = false;
  let panel: 'none' | 'pair' | 'recovery' | 'archived' | 'delete' = 'none';
  let qrDataUrl = '';
  let pairingLink = '';
  let recoveryInput = '';
  let archiveToast: { habit: Habit; index: number } | null = null;
  let archiveToastTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteHabitTarget: Habit | null = null;
  let deletingHabit = false;
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
  let visibleMonthLabel = `${new Intl.DateTimeFormat(undefined, { month: 'short' }).format(currentDay).toUpperCase()} ${currentDay.getFullYear()}`;
  let showTodayButton = false;
  let shiftingWindow = false;
  let scrollRaf = 0;
  const WINDOW_DAYS = 84;
  const WINDOW_SHIFT = 28;
  let minimumVisibleDays = 32;
  // Fixed 48px day cells + fixed 5-column label area let us calculate the
  // default tutorial space before the first paint. DOM measurement refines it later.
  let historyIntroWidth = browser && board
    ? Math.max(0, window.innerWidth - 240 - realHistoryDays(board) * 48)
    : 0;
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
  let timelinePanPointerId: number | null = null;
  let timelinePanStartX = 0;
  let timelinePanStartScrollLeft = 0;
  let timelinePanActive = false;

  const entries = new SvelteMap<string, Entry>();
  const symbols: Record<MarkValue, string> = { 0: '-', 1: '|', 2: '+' };

  // Bootstrap the visible grid synchronously from local storage. Network sync is
  // strictly background work, so returning users never wait on Supabase to paint.
  for (const entry of board?.entries ?? []) {
    entries.set(cellKey(entry.habitId, entry.date), entry);
  }
  if (credentials) {
    for (const change of compactQueue(getQueue())) {
      pendingByCell.set(cellKey(change.habitId, change.date), change);
      const key = cellKey(change.habitId, change.date);
      if (change.value === 0) entries.delete(key);
      else entries.set(key, { habitId: change.habitId, date: change.date, value: change.value as 1 | 2, updatedAt: '' });
    }
  }

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

  function calendarDayDistance(from: Date, to: Date) {
    const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.floor((toUtc - fromUtc) / 86_400_000);
  }

  function realHistoryDays(source: Board | null) {
    const start = enrollmentDate(source);
    if (!start) return 0;
    const today = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 12);
    return Math.max(1, calendarDayDistance(start, today) + 1);
  }

  function earliestTimelineKey(source: Board | null) {
    return enrollmentKey(source);
  }

  function datesForWindow(source: Board | null, endDay: Date, endOffset: number): DayColumn[] {
    const end = shiftedDate(endDay, endOffset);
    const windowDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
    const start = shiftedDate(end, -(windowDays - 1));
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
    board = pendingHabitSave
      ? { ...remoteBoard, habits: pendingHabitSave, archivedHabits: board?.archivedHabits ?? remoteBoard.archivedHabits }
      : remoteBoard;
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

  function updateMinimumVisibleDays() {
    if (!scroller) return false;
    const metrics = timelineMetrics();
    if (!metrics || metrics.dayWidth <= 0) return false;
    const timelineWidth = Math.max(0, scroller.clientWidth - metrics.habitWidth);
    // One extra column absorbs fractional pixels/borders so the grid can never
    // end before the right edge of the viewport.
    const next = Math.max(1, Math.ceil(timelineWidth / metrics.dayWidth) + 1);
    if (next === minimumVisibleDays) return false;
    minimumVisibleDays = next;
    return true;
  }

  function updateHistoryIntroWidth() {
    if (!scroller || !board || windowEndOffset !== 0) {
      historyIntroWidth = 0;
      return false;
    }
    const metrics = timelineMetrics();
    if (!metrics || metrics.dayWidth <= 0) return false;
    const timelineWidth = Math.max(0, scroller.clientWidth - metrics.habitWidth);
    const historyWidth = realHistoryDays(board) * metrics.dayWidth;
    const next = Math.max(0, Math.round(timelineWidth - historyWidth));
    if (Math.abs(next - historyIntroWidth) < 1) return false;
    historyIntroWidth = next;
    return true;
  }

  function updateTimelineStatus() {
    if (!scroller || !dates.length) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const timelineWidth = Math.max(0, scroller.clientWidth - metrics.habitWidth);
    const centerInTimeline = scroller.scrollLeft + timelineWidth / 2 - historyIntroWidth;
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor(centerInTimeline / metrics.dayWidth)));
    const date = dates[index];
    visibleMonthLabel = `${date.month} ${date.year}`;

    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    showTodayButton = windowEndOffset < 0 || rightGap > metrics.dayWidth * 1.25;
  }

  function scrollAnchor(metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || !dates.length) return null;
    const timelineLeft = Math.max(0, scroller.scrollLeft - metrics.habitWidth - historyIntroWidth);
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
        scroller.scrollLeft = metrics.habitWidth + historyIntroWidth + nextIndex * metrics.dayWidth + anchor.offset;
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

  function startTimelinePan(event: PointerEvent) {
    if (!scroller || event.button !== 0 || event.pointerType !== 'mouse' || dragActive) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.habit-name, .habit-head, input, textarea, button:not(:disabled)')) return;

    event.preventDefault();
    timelinePanPointerId = event.pointerId;
    timelinePanStartX = event.clientX;
    timelinePanStartScrollLeft = scroller.scrollLeft;
    timelinePanActive = false;
    scroller.setPointerCapture?.(event.pointerId);
  }

  function moveTimelinePan(event: PointerEvent) {
    if (!scroller || event.pointerId !== timelinePanPointerId) return;
    const dx = event.clientX - timelinePanStartX;
    if (!timelinePanActive && Math.abs(dx) < 2) return;
    if (!timelinePanActive) {
      timelinePanActive = true;
      document.documentElement.classList.add('timeline-panning-cursor');
    }
    event.preventDefault();
    scroller.scrollLeft = timelinePanStartScrollLeft - dx;
  }

  function endTimelinePan(event: PointerEvent) {
    if (!scroller || event.pointerId !== timelinePanPointerId) return;
    if (scroller.hasPointerCapture?.(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    timelinePanPointerId = null;
    timelinePanActive = false;
    document.documentElement.classList.remove('timeline-panning-cursor');
  }

  function cleanupTimelinePan() {
    timelinePanPointerId = null;
    timelinePanActive = false;
    document.documentElement.classList.remove('timeline-panning-cursor');
  }

  async function scrollToToday() {
    windowEndOffset = 0;
    await tick();
    if (updateMinimumVisibleDays()) await tick();
    if (updateHistoryIntroWidth()) await tick();
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
          if (board) {
            board = {
              ...board,
              habits: saved.habits,
              archivedHabits: saved.archivedHabits ?? [],
              updatedAt: saved.updatedAt
            };
          }
          schedulePersistence();
        }
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        habitFlushPromise = null;
        if (pendingHabitSave && navigator.onLine) {
          if (habitFlushTimer) clearTimeout(habitFlushTimer);
      if (archiveToastTimer) clearTimeout(archiveToastTimer);
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

  function undoArchiveToast() {
    if (!archiveToast) return;
    restoreArchivedHabit(archiveToast.habit, archiveToast.index);
  }

  function showArchiveToast(habit: Habit, index: number) {
    if (archiveToastTimer) clearTimeout(archiveToastTimer);
    archiveToast = { habit, index };
    archiveToastTimer = setTimeout(() => {
      archiveToast = null;
      archiveToastTimer = undefined;
    }, 8000);
  }

  function archiveHabit(index: number) {
    if (!board) return;
    const removed = board.habits[index];
    if (!removed) return;

    const archived = { ...removed, archivedAt: new Date().toISOString() };
    board = {
      ...board,
      archivedHabits: [archived, ...(board.archivedHabits ?? []).filter((habit) => habit.id !== removed.id)]
    };
    setLocalHabits(board.habits.filter((_, i) => i !== index));
    showArchiveToast(archived, index);
  }

  function restoreArchivedHabit(habit: Habit, preferredIndex?: number) {
    if (!board) return;
    const archivedHabits = (board.archivedHabits ?? []).filter((item) => item.id !== habit.id);
    const restored = { ...habit, archivedAt: undefined };
    const active = [...board.habits];
    const index = Math.max(0, Math.min(preferredIndex ?? active.length, active.length));
    active.splice(index, 0, restored);
    board = { ...board, archivedHabits };
    setLocalHabits(active);

    if (archiveToast?.habit.id === habit.id) {
      archiveToast = null;
      if (archiveToastTimer) clearTimeout(archiveToastTimer);
      archiveToastTimer = undefined;
    }
  }

  function openArchived() {
    menuOpen = false;
    panel = 'archived';
  }

  function confirmPermanentDelete(habit: Habit) {
    deleteHabitTarget = habit;
    panel = 'delete';
  }

  function archivedHistoryDays(habit: Habit) {
    if (!habit.createdAt) return 0;
    const start = new Date(habit.createdAt);
    const end = habit.archivedAt ? new Date(habit.archivedAt) : new Date();
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
    return Math.max(1, calendarDayDistance(startDay, endDay) + 1);
  }

  async function deleteHabitForever() {
    if (!credentials || !board || !deleteHabitTarget || deletingHabit) return;
    deletingHabit = true;
    try {
      const response = await fetch(`/api/boards/${credentials.boardId}/habits/${deleteHabitTarget.id}`, {
        method: 'DELETE',
        headers: authHeaders(credentials)
      });
      if (!response.ok) throw new Error(await response.text());
      const saved: Board = await response.json();
      board = saved;
      hydrateEntries(board);
      pendingHabitSave = null;
      deleteHabitTarget = null;
      panel = 'archived';
      persistLocalStateNow();
    } finally {
      deletingHabit = false;
    }
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

  function applyTheme(next: 'light' | 'dark') {
    theme = next;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('3tap.theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      next === 'dark' ? '#111210' : '#f7f7f5'
    );
  }

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  async function initialize() {
    online = navigator.onLine;

    // Re-read only when the page did not already bootstrap from local storage.
    if (!credentials) credentials = getCredentials();
    if (!board) board = getCachedBoard();

    pendingByCell.clear();
    for (const change of compactQueue(getQueue())) {
      pendingByCell.set(cellKey(change.habitId, change.date), change);
    }
    if (!credentials) pendingByCell.clear();
    hydrateEntries(board);
    for (const change of pendingChanges()) applyLocalEntry(change);

    // If we have local state, paint/position it now and sync in the background.
    if (board && credentials) {
      loading = false;
      await scrollToToday();
      void sync();
      return;
    }

    try {
      startupError = '';
      if (!credentials) await createBoard();
      else await sync();
    } catch (error) {
      online = navigator.onLine;
      startupError = error instanceof Error ? error.message : 'Could not connect to the database';
    } finally {
      loading = false;
      await scrollToToday();
    }
  }

  onMount(() => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    void initialize();

    const onFocus = () => void sync();
    const onOnline = () => credentials ? void sync() : void initialize();
    const onOffline = () => (online = false);
    const onVisibility = () => document.visibilityState === 'visible' && void sync();
    const onVerticalScroll = () => (navScrolled = window.scrollY > 1);
    const onResize = () => {
      updateMinimumVisibleDays();
      updateHistoryIntroWidth();
      updateTimelineStatus();
    };
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
    window.addEventListener('scroll', onVerticalScroll, { passive: true });
    onVerticalScroll();

    syncTimer = setInterval(() => void sync(), 8000);
    scheduleNextDay();

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onVerticalScroll);
      if (syncTimer) clearInterval(syncTimer);
      if (dayTimer) clearTimeout(dayTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (persistTimer) clearTimeout(persistTimer);
      if (habitFlushTimer) clearTimeout(habitFlushTimer);
      if (archiveToastTimer) clearTimeout(archiveToastTimer);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      cleanupHabitDrag(false);
      cleanupTimelinePan();
    };
  });
</script>

<svelte:head>
  <title>3tap</title>
  <meta name="description" content="A tiny three-state daily habit grid." />
</svelte:head>

<div class="shell">
  <header class="nav-shell" class:scrolled={navScrolled}>
    <div class="navbar">
      <div class="brand">3tap</div>
      <nav class="nav-actions" aria-label="App controls">
        {#if !online}<span class="offline" aria-live="polite">offline</span>{/if}
        <button
          class="hamburger-button"
          class:open={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </nav>
    </div>
    {#if menuOpen}
      <div class="nav-drawer" transition:slide={{ duration: 240 }}>
        <button
          class="drawer-theme"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onclick={toggleTheme}
        >
          {#if theme === 'dark'}
            <svg class="theme-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="2.75"></circle>
              <path d="M8 1.25v1.5M8 13.25v1.5M1.25 8h1.5M13.25 8h1.5M3.23 3.23l1.06 1.06M11.71 11.71l1.06 1.06M12.77 3.23l-1.06 1.06M4.29 11.71l-1.06 1.06"></path>
            </svg>
          {:else}
            <svg class="theme-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M12.85 10.45A5.75 5.75 0 0 1 5.55 3.15 5.75 5.75 0 1 0 12.85 10.45Z"></path>
            </svg>
          {/if}
        </button>
        <div class="drawer-list">
          <button class="drawer-item" onclick={openPair}>add device</button>
          <button class="drawer-item" onclick={openArchived}>
            archived{#if (board?.archivedHabits?.length ?? 0) > 0}<span class="drawer-count">{board?.archivedHabits?.length ?? 0}</span>{/if}
          </button>
          <button class="drawer-item" onclick={openRecovery}>recovery</button>
          <button class="drawer-item" onclick={exportData}>export</button>
          <div class="drawer-status" aria-live="polite">{online ? 'synced' : 'offline'}</div>
        </div>
      </div>
    {/if}
  </header>

  {#if board}
    <main>
      <div class="timeline-toolbar" aria-label="Timeline context">
        <div class="timeline-toolbar-spacer"></div>
        <div class="timeline-toolbar-meta">
          <span class="month-label">{visibleMonthLabel}</span>
          {#if showTodayButton}
            <button class="today-button" aria-label="Jump to today" onclick={scrollToToday}>today →</button>
          {/if}
        </div>
      </div>
      <div
        class="grid-scroll"
        bind:this={scroller}
        onscroll={onTimelineScroll}
        onpointerdown={startTimelinePan}
        onpointermove={moveTimelinePan}
        onpointerup={endTimelinePan}
        onpointercancel={endTimelinePan}
      >
        <table>
          <thead>
            <tr>
              <th class="habit-head"></th>
              {#if historyIntroWidth > 0}
                <th
                  class="history-intro-head"
                  style={`width:${historyIntroWidth}px; min-width:${historyIntroWidth}px; max-width:${historyIntroWidth}px`}
                  aria-hidden="true"
                ></th>
              {/if}
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
                      <button
                        class="delete-habit"
                        aria-label={`Archive ${habit.name}`}
                        title="Archive"
                        onclick={() => archiveHabit(habitIndex)}
                      >×</button>
                    </div>
                  </div>
                </th>
                {#if historyIntroWidth > 0}
                  <td
                    class="history-intro-row"
                    style={`width:${historyIntroWidth}px; min-width:${historyIntroWidth}px; max-width:${historyIntroWidth}px`}
                    aria-hidden="true"
                  >

                  </td>
                {/if}
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
              {#if historyIntroWidth > 0}
                <td
                  class="history-intro-add-spacer"
                  style={`width:${historyIntroWidth}px; min-width:${historyIntroWidth}px; max-width:${historyIntroWidth}px`}
                  aria-hidden="true"
                ></td>
              {/if}
              <td class="add-spacer" colspan={dates.length}></td>
            </tr>
          </tbody>
        </table>
        {#if historyIntroWidth > 0}
          <div
            class="history-intro-overlay"
            style={`left:var(--habit-width); width:${historyIntroWidth}px; height:max(calc(var(--day-size) * ${Math.max(board.habits.length, 3)}), calc(var(--day-size) * 3))`}
            aria-hidden="true"
          >
            <div class="history-tutorial">
              <strong>Your history will appear here over time.</strong>
              <span>tap today · - → | → +</span>
              <span>drag habits to reorder</span>
              <span>past days stay locked</span>
            </div>
          </div>
          {#if board.habits.length > 0}
            <div
              class="history-bottom-rule"
              style={`left:var(--habit-width); width:${historyIntroWidth}px; top:${30 + board.habits.length * 48 - 1}px`}
              aria-hidden="true"
            ></div>
          {/if}
        {/if}
      </div>
    </main>
  {:else}
    <main aria-busy={loading}>
      {#if startupError}
        <div class="startup-error" role="alert">
          <span>couldn’t load 3tap</span>
          <button onclick={() => { startupError = ''; loading = true; void initialize(); }}>retry</button>
        </div>
      {/if}
    </main>
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
      {:else if panel === 'archived'}
        <h2>archived</h2>
        {#if (board?.archivedHabits?.length ?? 0) === 0}
          <p>no archived habits.</p>
        {:else}
          <div class="archived-list">
            {#each board?.archivedHabits ?? [] as habit (habit.id)}
              <div class="archived-item">
                <div class="archived-copy">
                  <strong>{habit.name}</strong>
                  <span>{archivedHistoryDays(habit)} days of history</span>
                </div>
                <div class="archived-actions">
                  <button class="text-button" onclick={() => restoreArchivedHabit(habit, habit.position)}>restore</button>
                  <button class="danger-button" onclick={() => confirmPermanentDelete(habit)}>delete forever</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {:else if panel === 'delete' && deleteHabitTarget}
        <h2>delete {deleteHabitTarget.name} forever?</h2>
        <p>this permanently deletes all {archivedHistoryDays(deleteHabitTarget)} days of history for this habit.</p>
        <div class="panel-actions">
          <button class="text-button" onclick={() => (panel = 'archived')}>cancel</button>
          <button class="danger-button danger-confirm" disabled={deletingHabit} onclick={deleteHabitForever}>
            {deletingHabit ? 'deleting…' : 'delete forever'}
          </button>
        </div>
      {/if}
    </section>
  </div>
{/if}

{#if archiveToast}
  <div class="archive-toast" role="status" aria-live="polite">
    <span><strong>{archiveToast.habit.name}</strong> archived</span>
    <button onclick={undoArchiveToast}>undo</button>
  </div>
{/if}

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) {
    --bg: #f7f7f5;
    --surface: #fffffc;
    --text: #11110f;
    --muted: #6e6e68;
    --grid-weak-theme: #e2e2dd;
    --grid-strong-theme: #b0b0a9;
    --border: #d8d8d2;
    --panel-border: #d6d6d0;
    --hover: #ecece7;
    --today-fill: rgba(17,17,15,.05);
    --prestart-fill: rgba(17,17,15,.012);
    --press-fill: rgba(17,17,15,.07);
    --backdrop: rgba(17,17,15,.18);
    --shadow: rgba(17,17,15,.16);
    --nav-shadow: rgba(17,17,15,.08);
    --danger: #9b332b;
    background: var(--bg);
    color-scheme: light;
  }
  :global(html[data-theme='dark']) {
    --bg: #111210;
    --surface: #181916;
    --text: #ecece6;
    --muted: #969790;
    --grid-weak-theme: #2b2c29;
    --grid-strong-theme: #585953;
    --border: #393a36;
    --panel-border: #444540;
    --hover: #20211e;
    --today-fill: rgba(255,255,248,.07);
    --prestart-fill: rgba(255,255,248,.018);
    --press-fill: rgba(255,255,248,.09);
    --backdrop: rgba(0,0,0,.5);
    --shadow: rgba(0,0,0,.42);
    --nav-shadow: rgba(0,0,0,.28);
    --danger: #e58d82;
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    -webkit-font-smoothing: antialiased;
  }
  :global(button), :global(input), :global(textarea) { font: inherit; }
  :global(button) { color: inherit; }
  :global(html.habit-dragging-cursor),
  :global(html.habit-dragging-cursor *) { cursor: grabbing !important; }
  :global(html.timeline-panning-cursor),
  :global(html.timeline-panning-cursor *) { cursor: grabbing !important; }

  .shell {
    --day-size: 48px;
    --habit-width: calc(var(--day-size) * 5);
    --line: 1px;
    --grid: var(--grid-weak-theme);
    --grid-weak: var(--grid);
    --grid-strong: var(--grid);
    --page-inset: 16px;
    min-height: 100dvh;
    padding: 0;
  }
  .nav-shell {
    position: sticky;
    top: 0;
    z-index: 40;
    width: 100%;
    background: var(--bg);
    box-shadow: 0 0 0 transparent;
    transition: box-shadow 90ms linear;
  }
  .nav-shell.scrolled { box-shadow: 0 2px 4px var(--nav-shadow); }
  .navbar {
    height: calc(var(--day-size) + env(safe-area-inset-top));
    min-height: calc(var(--day-size) + env(safe-area-inset-top));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: env(safe-area-inset-top) var(--page-inset) 0;
    background: var(--bg);
    border-bottom: var(--line) solid var(--grid);
  }
  .brand {
    flex: none;
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: lowercase;
    opacity: .5;
  }
  .nav-actions {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .offline { font-size: 10px; opacity: .45; white-space: nowrap; }
  button { border: 0; background: none; padding: 0; cursor: pointer; }
  .hamburger-button {
    position: relative;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    color: var(--text);
    opacity: .62;
    -webkit-tap-highlight-color: transparent;
  }
  .hamburger-button span {
    position: absolute;
    width: 15px;
    height: 1px;
    background: currentColor;
    transition: transform 220ms ease, opacity 140ms linear, top 220ms ease;
  }
  .hamburger-button span:nth-child(1) { top: 11px; }
  .hamburger-button span:nth-child(2) { top: 16px; }
  .hamburger-button span:nth-child(3) { top: 21px; }
  .hamburger-button.open span:nth-child(1) { top: 16px; transform: rotate(45deg); }
  .hamburger-button.open span:nth-child(2) { opacity: 0; }
  .hamburger-button.open span:nth-child(3) { top: 16px; transform: rotate(-45deg); }
  .nav-drawer {
    position: relative;
    width: 100%;
    background: var(--bg);
    border-bottom: var(--line) solid var(--grid);
    overflow: hidden;
    padding: 10px var(--page-inset) 12px;
  }
  .drawer-list {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: min(240px, calc(100% - 44px));
  }
  .drawer-item {
    min-width: 0;
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    color: var(--text);
    text-align: left;
    font-size: 11px;
    opacity: .72;
  }
  .drawer-count {
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .drawer-status {
    min-height: 28px;
    display: flex;
    align-items: center;
    color: var(--muted);
    font-size: 10px;
    cursor: default;
  }
  .drawer-theme {
    position: absolute;
    top: 7px;
    right: var(--page-inset);
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    color: var(--text);
    opacity: .62;
    transition: opacity 140ms linear;
    -webkit-tap-highlight-color: transparent;
  }
  .theme-icon {
    width: 15px;
    height: 15px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  @media (hover: hover) and (pointer: fine) {
    .hamburger-button:hover,
    .drawer-theme:hover { opacity: .92; }
    .drawer-item:hover { opacity: 1; }
    .habit-controls button:not(:disabled):hover { opacity: .9; }
    .cell:not(:disabled):hover { background: var(--hover); }
    .today-button:hover { opacity: .9; }
    .grid-scroll { cursor: grab; }
    .habit-name { cursor: grab; }
  }

  .startup-error {
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 var(--page-inset);
    color: var(--muted);
    font-size: 11px;
  }
  .startup-error button { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }

  main { width: 100%; }
  .center { min-height: 60dvh; display: grid; place-items: center; font-size: 12px; opacity: .55; }
  .timeline-toolbar {
    display: grid;
    grid-template-columns: var(--habit-width) minmax(0, 1fr);
    align-items: center;
    height: 18px;
    min-height: 18px;
    width: 100%;
  }
  .timeline-toolbar-spacer { min-width: 0; }
  .timeline-toolbar-meta {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 18px;
    padding: 0 var(--page-inset) 0 8px;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: .04em;
  }
  .month-label { white-space: nowrap; opacity: .78; }
  .today-button {
    height: 18px;
    min-height: 18px;
    padding: 0;
    color: var(--text);
    font-size: 10px;
    opacity: .52;
    white-space: nowrap;
  }
  .grid-scroll {
    position: relative;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
  }
  .grid-scroll::-webkit-scrollbar { display: none; }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: max-content;
    min-width: 0;
    table-layout: fixed;
    background: transparent;
  }
  th, td {
    padding: 0;
  }
  tbody tr:not(.add-row) > th,
  tbody tr:not(.add-row) > td {
    height: var(--day-size);
    border-bottom: var(--line) solid var(--grid);
  }
  thead th {
    height: 30px;
    vertical-align: bottom;
    font-weight: 400;
    font-size: 10px;
    text-align: center;
    background: transparent;
    border-bottom: var(--line) solid var(--grid);
  }
  thead th.day-head,
  td:not(.history-intro-row):not(.history-intro-add-spacer) {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
  }
  .history-intro-head {
    position: relative;
    padding: 0;
    background: var(--bg);
  }
  .history-intro-row {
    position: relative;
    height: var(--day-size);
    padding: 0;
    background: var(--bg);
    border-bottom-color: transparent !important;
  }
  .history-intro-add-spacer {
    height: var(--day-size);
    padding: 0;
    border: 0;
    background: var(--bg);
  }
  .history-intro-overlay {
    position: absolute;
    z-index: 4;
    top: 30px;
    display: grid;
    place-items: center;
    min-height: calc(var(--day-size) * 3);
    padding: 18px;
    background: var(--bg);
    pointer-events: none;
  }
  .history-bottom-rule {
    position: absolute;
    z-index: 8;
    height: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .history-tutorial {
    display: grid;
    justify-items: center;
    gap: 7px;
    max-width: 340px;
    color: var(--muted);
    text-align: center;
    font-size: 10px;
    line-height: 1.45;
    letter-spacing: .01em;
  }
  .history-tutorial strong {
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }
  .history-tutorial span { opacity: .7; }
  /* Vertical rules begin at the first habit row—never in the date/header band.
     Every visible grid boundary uses exactly the same 1px/color token. */
  tbody tr:not(.add-row) td:not(.history-intro-row):not(.history-intro-add-spacer) { position: relative; }
  tbody tr:not(.add-row) td:not(.history-intro-row):not(.history-intro-add-spacer)::before {
    content: '';
    position: absolute;
    z-index: 3;
    top: 0;
    bottom: -1px;
    left: 0;
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }

  /* The sticky habit/timeline divider owns the first body vertical boundary. */
  tbody tr:not(.add-row) .habit-name + td::before { display: none; }
  thead th span,
  thead th strong {
    display: block;
    font-weight: 400;
    line-height: 1.2;
    opacity: .5;
  }
  thead th strong { font-size: 11px; }
  thead th.today span,
  thead th.today strong { opacity: .8; }

  .habit-head,
  .habit-name {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--habit-width);
    min-width: var(--habit-width);
    max-width: var(--habit-width);
    background: var(--bg);
  }
  tbody tr:not(.add-row) .habit-name::after {
    content: '';
    position: absolute;
    z-index: 9;
    top: 0;
    bottom: -1px;
    right: 0;
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .habit-head { z-index: 8; }
  .habit-name {
    padding: 0 8px 0 var(--page-inset);
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
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: 0 10px 28px var(--shadow);
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
    border-bottom: var(--line) solid var(--border);
    border-radius: 0;
    outline: none;
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: 12px;
  }
  .add-habit-cell {
    height: var(--day-size);
    border: 0;
    background: var(--bg);
  }
  .add-row .add-spacer {
    height: var(--day-size);
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
  .today { background: var(--today-fill); }
  /* Tracking start keeps the same 1px grid color as every other boundary. */
  thead th.day-head.enrolled::before,
  tbody tr:not(.add-row) td.enrolled::before { background: var(--grid); }
  td.prestart { background: var(--prestart-fill); }
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
  .cell:disabled { color: inherit; pointer-events: none; }
  td.locked .cell { opacity: .58; }
  td.prestart .cell { opacity: .26; }
  td.today .cell { opacity: 1; }
  td:not(.locked):not(.prestart) .cell[aria-label$=': -'] { opacity: .42; }
  .cell:not(:disabled):active { background: var(--press-fill); }

  .backdrop { position: fixed; z-index: 100; inset: 0; background: var(--backdrop); display: grid; place-items: center; padding: 18px; }
  .panel { position: relative; width: min(390px, 100%); max-height: min(720px, 88dvh); overflow: auto; background: var(--bg); border: 1px solid var(--panel-border); padding: 24px; }
  .panel h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: lowercase; }
  .panel p { margin: 0 0 18px; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .close { position: absolute; top: 12px; right: 14px; font-size: 18px; opacity: .5; }
  .qr { display: block; width: min(280px, 100%); margin: 16px auto 20px; image-rendering: pixelated; }
  .action { border: 1px solid var(--text); padding: 9px 12px; font-size: 11px; }
  .text-button { font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
  textarea { resize: vertical; padding: 9px; font-size: 10px; line-height: 1.4; margin-bottom: 14px; }
  .panel-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; }
  .archived-list { display: grid; gap: 0; margin-top: 8px; border-top: 1px solid var(--border); }
  .archived-item { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 52px; border-bottom: 1px solid var(--border); }
  .archived-copy { min-width: 0; display: grid; gap: 3px; }
  .archived-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
  .archived-copy span { color: var(--muted); font-size: 10px; }
  .archived-actions { flex: none; display: flex; align-items: center; gap: 14px; }
  .danger-button { color: var(--danger); font-size: 11px; }
  .danger-button:disabled { opacity: .45; cursor: default; }
  .danger-confirm { border: 1px solid currentColor; padding: 9px 12px; }
  .archive-toast {
    position: fixed;
    z-index: 120;
    top: calc(var(--day-size) + env(safe-area-inset-top) + 8px);
    right: 12px;
    display: flex;
    align-items: center;
    gap: 18px;
    max-width: calc(100vw - 24px);
    min-height: 34px;
    padding: 0 11px;
    background: var(--text);
    color: var(--bg);
    border: 1px solid var(--text);
    font-size: 11px;
    white-space: nowrap;
    box-shadow: 0 3px 10px var(--nav-shadow);
  }
  .archive-toast span { overflow: hidden; text-overflow: ellipsis; }
  .archive-toast strong { font-weight: 600; }
  .archive-toast button { flex: none; color: inherit; text-decoration: underline; text-underline-offset: 3px; }


</style>
