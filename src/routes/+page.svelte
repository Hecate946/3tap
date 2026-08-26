<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { flip } from 'svelte/animate';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Board, Credentials, Entry, Habit, MarkValue, Thought } from '$lib/types';
  import { createDevFixture } from '$lib/dev/fixtures';
  import {
    authHeaders,
    clearLocalBoard,
    compactQueue,
    createLocalBoardState,
    getCachedBoard,
    getCredentials,
    getHabitsDirty,
    getQueue,
    getThoughtsDirty,
    setCachedBoard,
    setCredentials,
    setHabitsDirty,
    setQueue,
    setThoughtsDirty,
    type PendingEntry
  } from '$lib/client';

  type DayColumn = { key: string; weekday: string; day: number; month: number; year: number };
  const requestedFixture = browser && import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('fixture')
    : null;
  const fixtureBoard = requestedFixture ? createDevFixture(requestedFixture) : null;
  const fixtureMode = fixtureBoard !== null;
  const CLIENT_RESET_VERSION = '2026-08-23-clean-slate-v1';
  if (browser && !fixtureMode && localStorage.getItem('3tap.client-reset') !== CLIENT_RESET_VERSION) {
    clearLocalBoard();
    localStorage.setItem('3tap.client-reset', CLIENT_RESET_VERSION);
  }

  let credentials: Credentials | null = fixtureMode ? null : (browser ? getCredentials() : null);
  let board: Board | null = fixtureBoard ?? (browser ? getCachedBoard() : null);
  if (browser && !fixtureMode && !credentials) {
    if (board) clearLocalBoard();
    const fresh = createLocalBoardState();
    credentials = fresh.credentials;
    board = fresh.board;
    setCredentials(credentials);
    setCachedBoard(board);
  }
  let online = true;
  let theme: 'light' | 'dark' = 'light';
  let view: 'habits' | 'thoughts' = 'habits';
  let navMenuOpen = false;
  let panel: 'none' | 'access' | 'archived' | 'delete' | 'clear' | 'delete-board' = 'none';
  let qrDataUrl = '';
  let pairingLink = '';
  let qrModulePromise: Promise<typeof import('qrcode')> | null = null;
  let recoveryInput = '';
  let restoreCodeInput = '';
  let recoveryError = '';
  let recovering = false;
  let recoveryCopied = false;
  let pairingCopied = false;
  let deletingBoard = false;
  let deleteBoardError = '';
  let archiveToast: { habit: Habit; index: number } | null = null;
  let archiveToastTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteHabitTarget: Habit | null = null;
  let deletingHabit = false;
  let archiveError = '';
  let clearingArchive = false;
  let editingHabitId: string | null = null;
  let editingHabitName = '';
  let addingHabit = false;
  let newHabitName = '';
  let editHabitInput: HTMLInputElement;
  let newHabitInput: HTMLInputElement;
  let editingThoughtId: string | null = null;
  let editingThoughtText = '';
  let addingThought = false;
  let newThoughtText = '';
  let editThoughtInput: HTMLInputElement;
  let newThoughtInput: HTMLInputElement;
  let pendingHabitSave: Habit[] | null = !fixtureMode && browser && board && getHabitsDirty() ? board.habits : null;
  let pendingThoughtSave: Thought[] | null = !fixtureMode && browser && board && getThoughtsDirty() ? (board.thoughts ?? []) : null;
  let scroller: HTMLDivElement;
  let currentDay = new Date();
  let windowEndOffset = 0;
  let displayMonthIndex = currentDay.getMonth();
  let displayYear = currentDay.getFullYear();
  let showStartButton = false;
  const monthOptions = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let showTodayButton = false;
  let savedHabitScrollLeft = 0;
  let shiftingWindow = false;
  let scrollRaf = 0;
  const DAY_SIZE = 48;
  const HABIT_WIDTH = DAY_SIZE * 3;
  const WINDOW_DAYS = 14;
  const WINDOW_SHIFT = 7;
  let minimumVisibleDays = browser
    ? Math.max(1, Math.ceil((window.innerWidth - HABIT_WIDTH) / DAY_SIZE) + 1)
    : 32;
  let windowStartOffset = -(Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT) - 1);
  const pendingByCell = new Map<string, PendingEntry>();
  const localTapValues = new Map<string, PendingEntry>();
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistIdle: number | undefined;
  let queuePersistTimer: ReturnType<typeof setTimeout> | undefined;
  let habitFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let thoughtFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let registrationPromise: Promise<boolean> | null = null;
  let habitFlushPromise: Promise<void> | null = null;
  let thoughtFlushPromise: Promise<void> | null = null;
  let draggingItemId: string | null = null;
  let dragPointerId: number | null = null;
  let dragCandidate: { itemId: string; kind: 'habit' | 'thought'; startX: number; startY: number; offsetY: number } | null = null;
  let dragActive = false;
  let dragOriginalHabits: Habit[] | null = null;
  let dragOriginalThoughts: Thought[] | null = null;
  let dragPreviewName = '';
  let dragPreviewLeft = 0;
  let dragPreviewTop = 0;
  let dragPreviewWidth = 0;
  let dragPreviewHeight = 0;
  let dragRowsTop = 0;
  let dragMoveRaf = 0;
  let dragPendingY: number | null = null;
  let dragLastClientY: number | null = null;
  let dragHoldTimer: ReturnType<typeof setTimeout> | undefined;
  const cellPresses = new Map<number, { habitId: string; date: string; button: HTMLButtonElement; startX: number; startY: number; moved: boolean }>();
  let timelinePanPointerId: number | null = null;
  let timelinePanStartX = 0;
  let timelinePanStartScrollLeft = 0;
  let timelinePanActive = false;
  let timelineTouchId: number | null = null;
  let timelineTouchStartX = 0;
  let timelineTouchStartY = 0;
  let timelineTouchStartScrollLeft = 0;
  let timelineTouchAxis: '' | 'x' | 'y' = '';

  const entries = new SvelteMap<string, Entry>();
  const habitStartKeys = new Map<string, string>();
  const symbols: Record<MarkValue, string> = { 0: '-', 1: '|', 2: '+' };
  for (const entry of board?.entries ?? []) {
    if (entry.value !== 0) entries.set(cellKey(entry.habitId, entry.date), entry);
  }
  if (board) board.entries = [];
  if (credentials) {
    for (const change of compactQueue(getQueue())) {
      const key = cellKey(change.habitId, change.date);
      pendingByCell.set(key, change);
      localTapValues.set(key, change);
      if (change.value === 0) entries.delete(key);
      else entries.set(key, { habitId: change.habitId, date: change.date, value: change.value as 1 | 2 });
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

  function timelineStartDate() {
    return enrollmentDate(board) ?? currentDay;
  }

  function earliestTimelineOffset() {
    return Math.min(0, calendarDayDistance(currentDay, timelineStartDate()));
  }

  function datesForWindow(baseDay: Date, startOffset: number, endOffset: number): DayColumn[] {
    const days: DayColumn[] = [];
    const firstOffset = Math.max(startOffset, earliestTimelineOffset());
    for (let offset = firstOffset; offset <= endOffset; offset += 1) {
      const cursor = shiftedDate(baseDay, offset);
      days.push({
        key: dateKey(cursor),
        weekday: WEEKDAY_LABELS[cursor.getDay()],
        day: cursor.getDate(),
        month: cursor.getMonth() + 1,
        year: cursor.getFullYear()
      });
    }
    return days;
  }

  $: dates = datesForWindow(currentDay, windowStartOffset, windowEndOffset);
  $: todayKey = dateKey(currentDay);
  $: yesterdayKey = dateKey(shiftedDate(currentDay, -1));
  $: enrolledKey = enrollmentKey(board);

  function isPreEnrollment(date: string) {
    return Boolean(enrolledKey && date < enrolledKey);
  }

  function isEditableDate(date: string) {
    return date === todayKey || date === yesterdayKey;
  }

  function habitStartKey(habit: Habit) {
    const cached = habitStartKeys.get(habit.id);
    if (cached) return cached;
    if (!habit.createdAt) return enrolledKey;
    const created = new Date(habit.createdAt);
    const key = dateKey(new Date(created.getFullYear(), created.getMonth(), created.getDate(), 12));
    habitStartKeys.set(habit.id, key);
    return key;
  }

  function isBeforeHabitStart(habit: Habit, date: string) {
    const start = habitStartKey(habit);
    return Boolean(start && date < start);
  }

  function reconcileFullEntries(source: Entry[]) {
    const next = new Map<string, Entry>();
    for (const entry of source) if (entry.value !== 0) next.set(cellKey(entry.habitId, entry.date), entry);
    for (const key of entries.keys()) if (!next.has(key)) entries.delete(key);
    for (const [key, entry] of next) if (entries.get(key)?.value !== entry.value) entries.set(key, entry);
  }

  function reconcileEntryDelta(source: Entry[], validHabitIds: Set<string>) {
    for (const [key, entry] of entries) if (!validHabitIds.has(entry.habitId)) entries.delete(key);
    for (const entry of source) {
      const key = cellKey(entry.habitId, entry.date);
      if (entry.value === 0) entries.delete(key);
      else if (entries.get(key)?.value !== entry.value) entries.set(key, entry);
    }
  }

  function hydrateEntries(source: Board | null) {
    reconcileFullEntries(source?.entries ?? []);
  }

  function valueFor(habitId: string, date: string): MarkValue {
    const key = cellKey(habitId, date);
    return (localTapValues.get(key)?.value ?? entries.get(key)?.value ?? 0) as MarkValue;
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
        value: change.value as 1 | 2
      });
    }
  }

  function pendingChanges() {
    return [...pendingByCell.values()];
  }

  function persistLocalStateNow() {
    if (fixtureMode) return;
    if (board) {
      const logicalEntries = new Map(entries);
      const localChanges = new Map<string, PendingEntry>();
      for (const change of localTapValues.values()) localChanges.set(cellKey(change.habitId, change.date), change);
      for (const change of pendingChanges()) localChanges.set(cellKey(change.habitId, change.date), change);
      for (const change of localChanges.values()) {
        const key = cellKey(change.habitId, change.date);
        if (change.value === 0) logicalEntries.delete(key);
        else {
          logicalEntries.set(key, {
            habitId: change.habitId,
            date: change.date,
            value: change.value as 1 | 2
          });
        }
      }
      setCachedBoard({ ...board, entries: [...logicalEntries.values()] });
    }
    setQueue(pendingChanges());
  }

  function cancelScheduledPersistence() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
    if (persistIdle !== undefined && browser) {
      (window as any).cancelIdleCallback?.(persistIdle);
      persistIdle = undefined;
    }
  }

  function schedulePersistence() {
    if (fixtureMode || persistTimer || persistIdle !== undefined) return;
    const commit = () => {
      persistTimer = undefined;
      persistIdle = undefined;
      persistLocalStateNow();
    };
    const requestIdle = browser ? (window as any).requestIdleCallback : undefined;
    if (requestIdle) persistIdle = requestIdle(commit, { timeout: 700 });
    else persistTimer = setTimeout(commit, 300);
  }

  function scheduleQueuePersistence() {
    if (fixtureMode) return;
    if (queuePersistTimer) clearTimeout(queuePersistTimer);
    queuePersistTimer = setTimeout(() => {
      queuePersistTimer = undefined;
      setQueue(pendingChanges());
    }, 50);
  }

  function queueChange(change: PendingEntry) {
    if (fixtureMode) return;
    pendingByCell.set(cellKey(change.habitId, change.date), change);
    scheduleQueuePersistence();

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
    if (button) {
      button.textContent = symbols[next];
      button.classList.toggle('plus', next === 2);
      button.setAttribute('aria-label', `${date}: ${symbols[next]}`);
    }

    localTapValues.set(cellKey(habitId, date), change);
    queueChange(change);
  }

  function startCellPress(event: PointerEvent, habitId: string, date: string) {
    if (event.button !== 0 || !isEditableDate(date)) return;
    cellPresses.set(event.pointerId, {
      habitId,
      date,
      button: event.currentTarget as HTMLButtonElement,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    });
  }

  function moveCellPress(event: PointerEvent) {
    const press = cellPresses.get(event.pointerId);
    if (!press || press.moved) return;
    if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 6) press.moved = true;
  }

  function endCellPress(event: PointerEvent) {
    const press = cellPresses.get(event.pointerId);
    cellPresses.delete(event.pointerId);
    if (press && !press.moved) tapCell(press.habitId, press.date, press.button);
  }

  function cancelCellPress(event: PointerEvent) {
    cellPresses.delete(event.pointerId);
  }

  function resetToFreshLocalBoard() {
    if (fixtureMode) return;
    clearLocalBoard();
    pendingByCell.clear();
    localTapValues.clear();
    pendingHabitSave = null;
    pendingThoughtSave = null;
    setHabitsDirty(false);
    setThoughtsDirty(false);
    entries.clear();
    habitStartKeys.clear();
    const fresh = createLocalBoardState();
    credentials = fresh.credentials;
    board = fresh.board;
    setCredentials(credentials);
    setCachedBoard(board);
  }

  async function ensureBoardRegistered() {
    if (fixtureMode || !credentials) return false;
    if (!credentials.pendingCreate) return true;
    if (!navigator.onLine) return false;
    if (registrationPromise) return registrationPromise;

    registrationPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!credentials || !board) return false;
        const response = await fetch('/api/boards', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ boardId: credentials.boardId, secret: credentials.secret, createdAt: board.createdAt })
        });
        if (response.status === 409) {
          const fresh = createLocalBoardState();
          credentials = fresh.credentials;
          setCredentials(credentials);
          continue;
        }
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as { credentials: Credentials; board: Board };
        credentials = { ...data.credentials, pendingCreate: false };
        board = { ...board, createdAt: data.board.createdAt || board.createdAt, updatedAt: data.board.updatedAt };
        setCredentials(credentials);
        schedulePersistence();
        online = true;
        return true;
      }
      return false;
    })().catch(() => { online = navigator.onLine; return false; }).finally(() => { registrationPromise = null; });
    return registrationPromise;
  }

  function sameHabitSnapshot(a: Habit[], b: Habit[]) {
    return a.length === b.length && a.every((habit, index) => {
      const other = b[index];
      return habit.id === other?.id && habit.name === other.name && habit.position === other.position
        && habit.createdAt === other.createdAt && habit.archivedAt === other.archivedAt;
    });
  }

  function sameThoughtSnapshot(a: Thought[], b: Thought[]) {
    return a.length === b.length && a.every((thought, index) => {
      const other = b[index];
      return thought.id === other?.id && thought.text === other.text && thought.position === other.position
        && thought.createdAt === other.createdAt;
    });
  }

  async function fetchBoard() {
    if (fixtureMode || !credentials) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;
    const headers: Record<string, string> = authHeaders(credentials);
    if (board?.updatedAt) headers['if-none-match'] = `"${board.updatedAt}"`;
    const since = board?.updatedAt ? `?since=${encodeURIComponent(board.updatedAt)}` : '';
    const response = await fetch(`/api/boards/${credentials.boardId}${since}`, { headers });
    if (response.status === 304) return;
    if (!response.ok) {
      if (response.status === 404) {
        resetToFreshLocalBoard();
        await tick();
        await scrollToToday();
        void ensureBoardRegistered();
        return;
      }
      if (response.status === 401) return;
      throw new Error(await response.text());
    }
    const remoteBoard = (await response.json()) as Board;
    const activeHabits = pendingHabitSave ?? remoteBoard.habits;
    const archivedHabits = pendingHabitSave ? (board?.archivedHabits ?? remoteBoard.archivedHabits ?? []) : (remoteBoard.archivedHabits ?? []);
    const thoughts = pendingThoughtSave ? (board?.thoughts ?? []) : (remoteBoard.thoughts ?? []);
    if (remoteBoard.entriesDelta) {
      const validHabitIds = new Set([...remoteBoard.habits.map(h => h.id), ...archivedHabits.map(h => h.id), ...activeHabits.map(h => h.id)]);
      reconcileEntryDelta(remoteBoard.entries, validHabitIds);
    } else reconcileFullEntries(remoteBoard.entries);
    const changed = !board || !sameHabitSnapshot(board.habits, activeHabits) || !sameHabitSnapshot(board.archivedHabits ?? [], archivedHabits) || !sameThoughtSnapshot(board.thoughts ?? [], thoughts) || board.createdAt !== remoteBoard.createdAt;
    if (changed || !board) {
      habitStartKeys.clear();
      board = { createdAt: remoteBoard.createdAt, updatedAt: remoteBoard.updatedAt, habits: activeHabits, archivedHabits, thoughts, entries: [] };
    } else board.updatedAt = remoteBoard.updatedAt;
    for (const [key] of localTapValues) if (!pendingByCell.has(key)) localTapValues.delete(key);
    schedulePersistence();
  }

  async function flushQueue(options: { keepalive?: boolean } = {}) {
    if (fixtureMode) return;
    if (flushPromise) return flushPromise;
    if (pendingHabitSave || habitFlushPromise) {
      await flushHabitChanges();
      if (pendingHabitSave) return;
    }
    if (!credentials || !navigator.onLine || pendingByCell.size === 0) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;

    flushPromise = (async () => {
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
    if (fixtureMode) return;
    if (syncPromise) return syncPromise;
    if (dragActive) return;
    if (!credentials || !navigator.onLine || document.visibilityState === 'hidden') {
      online = navigator.onLine;
      return;
    }

    syncPromise = (async () => {
      try {
        if (!(await ensureBoardRegistered())) return;
        await flushHabitChanges();
        await flushThoughtChanges();
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

  function timelineMetrics() { return { dayWidth: DAY_SIZE, habitWidth: HABIT_WIDTH }; }

  function updateMinimumVisibleDays() {
    if (!scroller) return false;
    const metrics = timelineMetrics();
    if (!metrics || metrics.dayWidth <= 0) return false;
    const timelineWidth = Math.max(0, scroller.clientWidth - metrics.habitWidth);
    const next = Math.max(1, Math.ceil(timelineWidth / metrics.dayWidth) + 1);
    if (next === minimumVisibleDays) return false;
    minimumVisibleDays = next;
    return true;
  }

  function setVisibleMonthState(year: number, month: number) {
    const safeMonth = Math.max(1, Math.min(12, month));
    displayYear = year;
    displayMonthIndex = safeMonth - 1;
  }

  function updateTimelineStatus() {
    if (!scroller || !dates.length) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const timelineWidth = Math.max(metrics.dayWidth, scroller.clientWidth - metrics.habitWidth);
    const latestVisibleIndex = Math.max(
      0,
      Math.min(dates.length - 1, Math.floor((scroller.scrollLeft + timelineWidth - 1) / metrics.dayWidth))
    );
    const latestVisibleDate = dates[latestVisibleIndex];
    setVisibleMonthState(latestVisibleDate.year, latestVisibleDate.month);

    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    showStartButton = windowStartOffset > earliestTimelineOffset() || scroller.scrollLeft > 2;
    showTodayButton = windowEndOffset < 0 || rightGap > 2;
  }

  async function prependTimelineDays(count: number, metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || count <= 0) return;
    const earliest = earliestTimelineOffset();
    const nextStart = Math.max(earliest, windowStartOffset - count);
    const inserted = windowStartOffset - nextStart;
    if (inserted <= 0) return;
    const beforeScrollLeft = scroller.scrollLeft;
    windowStartOffset = nextStart;
    await tick();

    const compensation = inserted * metrics.dayWidth;
    scroller.scrollLeft = beforeScrollLeft + compensation;
    if (timelinePanPointerId !== null) timelinePanStartScrollLeft += compensation;
    if (timelineTouchId !== null) timelineTouchStartScrollLeft += compensation;
  }

  async function appendTimelineDays(count: number) {
    if (count <= 0 || windowEndOffset >= 0) return;
    windowEndOffset = Math.min(0, windowEndOffset + count);
    await tick();
  }

  async function maintainTimelineWindow() {
    if (!scroller || shiftingWindow) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const threshold = metrics.dayWidth * 6;
    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;

    if (scroller.scrollLeft < threshold && dates.length && windowStartOffset > earliestTimelineOffset()) {
      shiftingWindow = true;
      try {
        await prependTimelineDays(WINDOW_SHIFT, metrics);
      } finally {
        shiftingWindow = false;
      }
      updateTimelineStatus();
      return;
    }

    if (rightGap < threshold && windowEndOffset < 0) {
      shiftingWindow = true;
      try {
        await appendTimelineDays(Math.min(WINDOW_SHIFT, -windowEndOffset));
      } finally {
        shiftingWindow = false;
      }
      updateTimelineStatus();
    }
  }

  function onTimelineScroll() {
    if (view !== 'habits' || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateTimelineStatus();
      void maintainTimelineWindow();
    });
  }

  function startTimelinePan(event: PointerEvent) {
    if (view !== 'habits') return;
    if (!scroller || event.button !== 0 || !event.isPrimary || dragActive) return;
    if (event.pointerType !== 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.habit-name, .timeline-side, .add-row, .zero-add-row, input, textarea, button:not(:disabled)')) return;

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
    const threshold = 2;
    if (!timelinePanActive && Math.abs(dx) < threshold) return;
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

  function startTimelineTouch(event: TouchEvent) {
    if (view !== 'habits') return;
    if (!scroller || dragActive) return;
    if (event.touches.length !== 1) {
      endTimelineTouch();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('.habit-name, .timeline-side, .add-row, .zero-add-row, input, textarea, button:not(:disabled)')) return;
    const touch = event.touches[0];
    timelineTouchId = touch.identifier;
    timelineTouchStartX = touch.clientX;
    timelineTouchStartY = touch.clientY;
    timelineTouchStartScrollLeft = scroller.scrollLeft;
    timelineTouchAxis = '';
  }

  function moveTimelineTouch(event: TouchEvent) {
    if (!scroller || timelineTouchId === null) return;
    if (event.touches.length !== 1) {
      endTimelineTouch();
      return;
    }
    const touch = Array.from(event.touches).find((item) => item.identifier === timelineTouchId);
    if (!touch) return;
    const dx = touch.clientX - timelineTouchStartX;
    const dy = touch.clientY - timelineTouchStartY;

    if (!timelineTouchAxis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
      timelineTouchAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (timelineTouchAxis !== 'x') return;

    event.preventDefault();
    scroller.scrollLeft = timelineTouchStartScrollLeft - dx;
  }

  function endTimelineTouch() {
    timelineTouchId = null;
    timelineTouchAxis = '';
  }

  async function switchView(next: 'habits' | 'thoughts') {
    if (next === view) return;
    if (view === 'habits' && scroller) savedHabitScrollLeft = scroller.scrollLeft;
    view = next;
    await tick();
    if (next === 'habits' && scroller) {
      scroller.scrollLeft = savedHabitScrollLeft;
      updateTimelineStatus();
    } else if (scroller) {
      scroller.scrollLeft = 0;
    }
  }

  async function scrollToStart() {
    const earliest = earliestTimelineOffset();
    const requiredDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
    windowStartOffset = earliest;
    windowEndOffset = Math.min(0, earliest + requiredDays - 1);
    await tick();
    if (scroller) {
      scroller.scrollLeft = 0;
      updateTimelineStatus();
    }
  }

  async function scrollToToday() {
    windowEndOffset = 0;
    updateMinimumVisibleDays();
    windowStartOffset = Math.max(
      earliestTimelineOffset(),
      -(Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT) - 1)
    );
    await tick();
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
      updateTimelineStatus();
      setVisibleMonthState(currentDay.getFullYear(), currentDay.getMonth() + 1);
    }
  }

  function loadQrModule() { qrModulePromise ??= import('qrcode'); return qrModulePromise; }

  async function ensureRecoveryCode() {
    if (fixtureMode || !credentials || credentials.recoveryCode || !navigator.onLine) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(credentials.boardId)}/recovery`, { method: 'POST', headers: authHeaders(credentials) });
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { recoveryCode: string };
    credentials = { ...credentials, recoveryCode: data.recoveryCode };
    setCredentials(credentials);
  }

  function openAccess() {
    navMenuOpen = false;
    if (!credentials) return;
    pairingCopied = false; recoveryInput = credentials.recoveryCode ?? ''; restoreCodeInput = ''; recoveryError = '';
    recoveryCopied = false; recovering = false; deleteBoardError = ''; panel = 'access';
    const nextLink = `${location.origin}/pair#${credentials.boardId}.${credentials.secret}`;
    if (pairingLink !== nextLink) { pairingLink = nextLink; qrDataUrl = ''; }
    if (!qrDataUrl) void loadQrModule().then(({ toDataURL }) => toDataURL(pairingLink, { width: 280, margin: 1, color: { dark: '#11110f', light: '#f7f7f5' } })).then(url => { if (panel === 'access') qrDataUrl = url; }).catch(() => {});
    if (navigator.onLine) void (async () => {
      await flushHabitChanges(); await flushThoughtChanges(); await flushQueue();
      try { await ensureRecoveryCode(); recoveryInput = credentials?.recoveryCode ?? ''; } catch { recoveryInput = ''; }
    })();
  }

  async function copyPairingLink() {
    await copyText(pairingLink);
    pairingCopied = true;
    setTimeout(() => (pairingCopied = false), 1400);
  }

  function normalizeHabits(habits: Habit[]) {
    return habits.map((habit, position) => ({ ...habit, position }));
  }

  function setLocalHabits(habits: Habit[]) {
    if (!board) return;
    const next = normalizeHabits(habits);
    board = { ...board, habits: next };
    if (fixtureMode) return;
    pendingHabitSave = next;
    setHabitsDirty(true);
    schedulePersistence();

    if (habitFlushTimer) clearTimeout(habitFlushTimer);
    habitFlushTimer = setTimeout(() => {
      habitFlushTimer = undefined;
      void flushHabitChanges();
    }, 80);
  }

  async function flushHabitChanges() {
    if (fixtureMode) return;
    if (habitFlushPromise) return habitFlushPromise;
    if (!credentials || !navigator.onLine || !pendingHabitSave) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;

    const sent = pendingHabitSave;
    habitFlushPromise = (async () => {
      try {
        const response = await fetch(`/api/boards/${credentials!.boardId}/habits`, {
          method: 'PUT',
          headers: authHeaders(credentials!),
          body: JSON.stringify({ habits: sent.map(({ id, name }) => ({ id, name })) })
        });
        if (!response.ok) throw new Error(await response.text());
        if (pendingHabitSave === sent) {
          pendingHabitSave = null;
          setHabitsDirty(false);
          schedulePersistence();
        }
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        habitFlushPromise = null;
        if (pendingHabitSave && navigator.onLine) {
          if (habitFlushTimer) clearTimeout(habitFlushTimer);
      if (thoughtFlushTimer) clearTimeout(thoughtFlushTimer);
          habitFlushTimer = setTimeout(() => {
            habitFlushTimer = undefined;
            void flushHabitChanges();
          }, 120);
        }
      }
    })();

    return habitFlushPromise;
  }

  function normalizeThoughts(thoughts: Thought[]) {
    return thoughts.map((thought, position) => ({ ...thought, position }));
  }

  function setLocalThoughts(thoughts: Thought[]) {
    if (!board) return;
    const next = normalizeThoughts(thoughts);
    board = { ...board, thoughts: next };
    if (fixtureMode) return;
    pendingThoughtSave = next;
    setThoughtsDirty(true);
    schedulePersistence();

    if (thoughtFlushTimer) clearTimeout(thoughtFlushTimer);
    thoughtFlushTimer = setTimeout(() => {
      thoughtFlushTimer = undefined;
      void flushThoughtChanges();
    }, 80);
  }

  async function flushThoughtChanges() {
    if (fixtureMode) return;
    if (thoughtFlushPromise) return thoughtFlushPromise;
    if (!credentials || !navigator.onLine || !pendingThoughtSave) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;

    const sent = pendingThoughtSave;
    thoughtFlushPromise = (async () => {
      try {
        const response = await fetch(`/api/boards/${credentials!.boardId}/thoughts`, {
          method: 'PUT',
          headers: authHeaders(credentials!),
          body: JSON.stringify({ thoughts: sent.map(({ id, text }) => ({ id, text })) })
        });
        if (!response.ok) throw new Error(await response.text());
        if (pendingThoughtSave === sent) {
          pendingThoughtSave = null;
          setThoughtsDirty(false);
          schedulePersistence();
        }
        online = true;
      } catch {
        online = navigator.onLine;
      } finally {
        thoughtFlushPromise = null;
        if (pendingThoughtSave && navigator.onLine) {
          if (thoughtFlushTimer) clearTimeout(thoughtFlushTimer);
          thoughtFlushTimer = setTimeout(() => {
            thoughtFlushTimer = undefined;
            void flushThoughtChanges();
          }, 120);
        }
      }
    })();

    return thoughtFlushPromise;
  }

  async function beginEditThought(thought: Thought) {
    editingThoughtId = thought.id;
    editingThoughtText = thought.text;
    await tick();
    editThoughtInput?.focus();
    editThoughtInput?.select();
  }

  function commitThoughtEdit() {
    if (!board || !editingThoughtId) return;
    const id = editingThoughtId;
    const text = editingThoughtText.trim().slice(0, 240);
    editingThoughtId = null;
    editingThoughtText = '';
    if (!text) {
      setLocalThoughts((board.thoughts ?? []).filter((thought) => thought.id !== id));
      return;
    }
    const current = (board.thoughts ?? []).find((thought) => thought.id === id);
    if (!current || current.text === text) return;
    setLocalThoughts((board.thoughts ?? []).map((thought) => thought.id === id ? { ...thought, text } : thought));
  }

  async function beginAddThought() {
    addingThought = true;
    newThoughtText = '';
    await tick();
    newThoughtInput?.focus();
  }

  function commitAddThought() {
    if (!board || !addingThought) return;
    const text = newThoughtText.trim().slice(0, 240);
    addingThought = false;
    newThoughtText = '';
    if (!text) return;
    const thoughts = board.thoughts ?? [];
    setLocalThoughts([
      ...thoughts,
      { id: crypto.randomUUID(), text, position: thoughts.length, createdAt: new Date().toISOString() }
    ]);
  }

  function cancelAddThought() {
    addingThought = false;
    newThoughtText = '';
  }

  function deleteThought(id: string) {
    if (!board) return;
    setLocalThoughts((board.thoughts ?? []).filter((thought) => thought.id !== id));
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
    const name = editingHabitName.trim().slice(0, 60);
    editingHabitId = null;
    editingHabitName = '';
    if (!name) return;
    const current = board.habits.find((habit) => habit.id === id);
    if (!current || current.name === name) return;
    setLocalHabits(board.habits.map((habit) => (habit.id === id ? { ...habit, name } : habit)));
  }

  function resetViewportZoom() {
    if (!browser) return;
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const original = viewport.content;
    viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewport.content = original;
      });
    });
  }

  function finishInlineEditFromKeyboard(input: HTMLInputElement) {
    input.blur();
    setTimeout(resetViewportZoom, 60);
  }

  function blockDragClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function activateItemDrag(clientY: number) {
    if (!board || !dragCandidate || dragActive) return;
    const { kind, itemId } = dragCandidate;
    const item = kind === 'habit'
      ? board.habits.find((candidate) => candidate.id === itemId)
      : (board.thoughts ?? []).find((candidate) => candidate.id === itemId);
    const row = kind === 'habit'
      ? document.querySelector<HTMLElement>(`tr[data-habit-id="${itemId}"]`)
      : document.querySelector<HTMLElement>(`.thought-row[data-thought-id="${itemId}"]`);
    const cell = row?.querySelector<HTMLElement>(kind === 'habit' ? '.habit-name' : '.thought-cell');
    if (!item || !cell) return;

    const rect = cell.getBoundingClientRect();
    const currentIndex = kind === 'habit'
      ? board.habits.findIndex((candidate) => candidate.id === itemId)
      : (board.thoughts ?? []).findIndex((candidate) => candidate.id === itemId);
    dragRowsTop = rect.top - Math.max(0, currentIndex) * rect.height;
    dragActive = true;
    draggingItemId = itemId;
    if (kind === 'habit') dragOriginalHabits = [...board.habits];
    else dragOriginalThoughts = [...(board.thoughts ?? [])];
    dragPreviewName = kind === 'habit' ? (item as Habit).name : (item as Thought).text;
    dragPreviewLeft = rect.left;
    dragPreviewWidth = rect.width;
    dragPreviewHeight = rect.height;
    dragPreviewTop = clientY - dragCandidate.offsetY;
    dragLastClientY = dragCandidate.startY;
    document.documentElement.classList.add('item-dragging-cursor');
    window.addEventListener('click', blockDragClick, true);
  }

  function updateLiveItemOrder(clientY: number) {
    if (!board || !draggingItemId || !dragCandidate) return;
    const { kind } = dragCandidate;
    const items = kind === 'habit' ? board.habits : (board.thoughts ?? []);
    const currentIndex = items.findIndex((item) => item.id === draggingItemId);
    if (currentIndex < 0) return;
    const previousY = dragLastClientY ?? clientY;
    const movingUp = clientY < previousY;
    const movingDown = clientY > previousY;
    dragLastClientY = clientY;
    if (!movingUp && !movingDown) return;
    const previewTop = clientY - dragCandidate.offsetY;
    const previewBottom = previewTop + dragPreviewHeight;
    const rowHeight = dragPreviewHeight || DAY_SIZE;
    let targetIndex = currentIndex;
    if (movingUp) targetIndex = Math.max(0, Math.min(currentIndex, Math.floor((previewTop - dragRowsTop) / rowHeight)));
    else targetIndex = Math.max(currentIndex, Math.min(items.length - 1, Math.ceil((previewBottom - dragRowsTop) / rowHeight) - 1));
    if (targetIndex === currentIndex) return;

    if (kind === 'habit') {
      const next = [...board.habits];
      const [dragged] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, dragged);
      board = { ...board, habits: normalizeHabits(next) };
    } else {
      const next = [...(board.thoughts ?? [])];
      const [dragged] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, dragged);
      board = { ...board, thoughts: normalizeThoughts(next) };
    }
  }

  function sameItemOrder(a: { id: string }[], b: { id: string }[]) {
    return a.length === b.length && a.every((item, index) => item.id === b[index]?.id);
  }

  function cleanupItemDrag(commit = false) {
    const kind = dragCandidate?.kind;
    const finalHabits = board?.habits ? [...board.habits] : null;
    const finalThoughts = board ? [...(board.thoughts ?? [])] : null;
    const originalHabits = dragOriginalHabits;
    const originalThoughts = dragOriginalThoughts;

    window.removeEventListener('pointermove', onItemDragMove);
    window.removeEventListener('pointerup', onItemDragEnd);
    window.removeEventListener('pointercancel', onItemDragCancel);
    if (dragHoldTimer) clearTimeout(dragHoldTimer);
    dragHoldTimer = undefined;
    document.documentElement.classList.remove('item-dragging-cursor');
    if (dragMoveRaf) cancelAnimationFrame(dragMoveRaf);
    dragMoveRaf = 0;
    dragPendingY = null;
    dragLastClientY = null;
    if (dragActive) setTimeout(() => window.removeEventListener('click', blockDragClick, true), 0);
    else window.removeEventListener('click', blockDragClick, true);

    if (board && kind === 'habit' && originalHabits) {
      if (commit && finalHabits && !sameItemOrder(originalHabits, finalHabits)) setLocalHabits(finalHabits);
      else if (!commit) board = { ...board, habits: normalizeHabits(originalHabits) };
    }
    if (board && kind === 'thought' && originalThoughts) {
      if (commit && finalThoughts && !sameItemOrder(originalThoughts, finalThoughts)) setLocalThoughts(finalThoughts);
      else if (!commit) board = { ...board, thoughts: normalizeThoughts(originalThoughts) };
    }

    draggingItemId = null;
    dragPointerId = null;
    dragCandidate = null;
    dragActive = false;
    dragOriginalHabits = null;
    dragOriginalThoughts = null;
    dragPreviewName = '';
    dragRowsTop = 0;
  }

  function onItemDragMove(event: PointerEvent) {
    if (!dragCandidate || event.pointerId !== dragPointerId) return;
    const dx = event.clientX - dragCandidate.startX;
    const dy = event.clientY - dragCandidate.startY;
    if (!dragActive) {
      const distance = Math.hypot(dx, dy);
      if (dragCandidate.kind === 'thought' && distance >= 5) activateItemDrag(event.clientY);
      else if (dragCandidate.kind === 'habit' && distance > 8) {
        cleanupItemDrag(false);
        return;
      }
    }
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
      updateLiveItemOrder(clientY);
    });
  }

  function onItemDragEnd(event: PointerEvent) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    if (dragActive && dragCandidate && dragPendingY !== null) {
      if (dragMoveRaf) cancelAnimationFrame(dragMoveRaf);
      dragMoveRaf = 0;
      const clientY = dragPendingY;
      dragPendingY = null;
      dragPreviewTop = clientY - dragCandidate.offsetY;
      updateLiveItemOrder(clientY);
    }
    cleanupItemDrag(true);
  }

  function onItemDragCancel(event: PointerEvent) {
    if (dragPointerId !== null && event.pointerId !== dragPointerId) return;
    cleanupItemDrag(false);
  }

  function startItemDrag(event: PointerEvent, itemId: string, kind: 'habit' | 'thought') {
    if (!board || event.button !== 0 || !event.isPrimary) return;
    if (kind === 'habit' && editingHabitId === itemId) return;
    if (kind === 'thought' && editingThoughtId === itemId) return;
    const target = event.target as HTMLElement;
    if (kind === 'thought' && target.closest('.thought-controls, input')) return;
    const handle = event.currentTarget as HTMLElement;
    const dragSurface = handle.closest<HTMLElement>(kind === 'habit' ? '.habit-name' : '.thought-cell') ?? handle;
    const rect = dragSurface.getBoundingClientRect();
    if (kind === 'habit' && event.pointerType === 'mouse') event.preventDefault();
    dragPointerId = event.pointerId;
    dragCandidate = {
      itemId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      offsetY: event.clientY - rect.top
    };
    window.addEventListener('pointermove', onItemDragMove, { passive: false });
    window.addEventListener('pointerup', onItemDragEnd);
    window.addEventListener('pointercancel', onItemDragCancel);
    if (kind === 'habit') {
      dragHoldTimer = setTimeout(() => {
        dragHoldTimer = undefined;
        if (dragCandidate && dragPointerId === event.pointerId) activateItemDrag(dragCandidate.startY);
      }, 180);
    }
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
    navMenuOpen = false;
    panel = 'archived';
  }

  function confirmPermanentDelete(habit: Habit) {
    archiveError = '';
    deleteHabitTarget = habit;
    panel = 'delete';
  }

  function confirmClearArchive() {
    if (!board?.archivedHabits?.length) return;
    archiveError = '';
    panel = 'clear';
  }

  function archivedHistoryDays(habit: Habit) {
    if (!habit.createdAt) return 0;
    const start = new Date(habit.createdAt);
    const end = habit.archivedAt ? new Date(habit.archivedAt) : new Date();
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12);
    return Math.max(1, calendarDayDistance(startDay, endDay) + 1);
  }

  async function apiErrorMessage(response: Response, fallback: string) {
    const detail = (await response.text()).trim();
    if (!detail) return fallback;
    try {
      const parsed = JSON.parse(detail) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
    } catch {
    }
    return detail;
  }

  async function deleteHabitForever() {
    if (!credentials || !board || !deleteHabitTarget || deletingHabit) return;
    const target = deleteHabitTarget;
    deletingHabit = true;
    archiveError = '';

    try {
      if (credentials.pendingCreate && !(await ensureBoardRegistered())) throw new Error('Connect to the internet to delete this habit.');
      await flushHabitChanges();
      if (pendingHabitSave) throw new Error('Could not sync changes yet. Try again.');
      const response = await fetch(`/api/boards/${credentials.boardId}/habits/${target.id}`, {
        method: 'DELETE',
        headers: authHeaders(credentials)
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(await apiErrorMessage(response, `Delete failed (${response.status})`));
      }

      for (const [key, entry] of entries) if (entry.habitId === target.id) entries.delete(key);
      board = { ...board, archivedHabits: (board.archivedHabits ?? []).filter((habit) => habit.id !== target.id), entries: [] };
      deleteHabitTarget = null;
      schedulePersistence();
      panel = 'archived';
      void fetchBoard().catch(() => {});
    } catch (error) {
      archiveError = error instanceof Error ? error.message : 'could not delete; retry';
    } finally {
      deletingHabit = false;
    }
  }

  async function clearArchive() {
    if (!credentials || !board || clearingArchive) return;
    const archived = [...(board.archivedHabits ?? [])];
    if (!archived.length) { panel = 'archived'; return; }
    clearingArchive = true; archiveError = '';
    try {
      if (credentials.pendingCreate && !(await ensureBoardRegistered())) throw new Error('Connect to the internet to clear the archive.');
      await flushHabitChanges();
      if (pendingHabitSave) throw new Error('Could not sync changes yet. Try again.');
      const response = await fetch(`/api/boards/${credentials.boardId}/habits`, { method: 'DELETE', headers: authHeaders(credentials) });
      if (!response.ok) throw new Error(await apiErrorMessage(response, `Delete failed (${response.status})`));
      const archivedIds = new Set(archived.map(h => h.id));
      for (const [key, entry] of entries) if (archivedIds.has(entry.habitId)) entries.delete(key);
      board = { ...board, archivedHabits: [], entries: [] };
      schedulePersistence(); panel = 'archived'; void fetchBoard().catch(() => {});
    } catch (error) { archiveError = error instanceof Error ? error.message : 'could not clear archive; retry'; }
    finally { clearingArchive = false; }
  }

  async function beginAddHabit() {
    addingHabit = true;
    newHabitName = '';
    await tick();
    newHabitInput?.focus();
  }

  function commitAddHabit() {
    if (!board || !addingHabit) return;
    const name = newHabitName.trim().slice(0, 60);
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

  function normalizeRecoveryEntry(raw: string) {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  async function useRecoveryCode() {
    if (recovering) return;
    recoveryError = '';
    const code = normalizeRecoveryEntry(restoreCodeInput);
    if (!code) {
      recoveryError = 'Enter your recovery code.';
      return;
    }
    if (!navigator.onLine) {
      recoveryError = 'Connect to the internet to recover this board.';
      return;
    }

    recovering = true;
    try {
      const response = await fetch('/api/recover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      });
      if (response.status === 404) {
        recoveryError = 'That recovery code was not found.';
        return;
      }
      if (!response.ok) throw new Error(await response.text());

      const recovered = (await response.json()) as { credentials: Credentials; board: Board };
      credentials = recovered.credentials;
      board = recovered.board;
      setCredentials(recovered.credentials);
      setCachedBoard(recovered.board);
      setQueue([]);
      pendingByCell.clear();
      localTapValues.clear();
      pendingHabitSave = null;
      pendingThoughtSave = null;
      setHabitsDirty(false);
      setThoughtsDirty(false);
      entries.clear();
      hydrateEntries(recovered.board);
      qrDataUrl = '';
      pairingLink = '';
      panel = 'none';
      await tick();
      await scrollToToday();
    } catch {
      recoveryError = 'Could not recover this board. Try again.';
    } finally {
      recovering = false;
    }
  }

  async function copyRecoveryCode() {
    if (!recoveryInput) return;
    await copyText(recoveryInput);
    recoveryCopied = true;
    setTimeout(() => (recoveryCopied = false), 1400);
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function confirmDeleteBoard() {
    deleteBoardError = '';
    panel = 'delete-board';
  }

  async function deleteBoardForever() {
    if (!credentials || deletingBoard) return;
    deletingBoard = true; deleteBoardError = '';
    try {
      if (!credentials.pendingCreate) {
        const response = await fetch(`/api/boards/${encodeURIComponent(credentials.boardId)}`, { method: 'DELETE', headers: authHeaders(credentials) });
        if (!response.ok && response.status !== 404) throw new Error(await apiErrorMessage(response, 'Could not delete this board.'));
      }
      resetToFreshLocalBoard(); panel = 'none'; deletingBoard = false;
      await tick(); await scrollToToday(); void ensureBoardRegistered();
    } catch (error) { deleteBoardError = error instanceof Error && error.message ? error.message : 'Could not delete this board. Try again.'; deletingBoard = false; }
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
      next === 'dark' ? '#0e1112' : '#f7f7f5'
    );
  }

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  }

  function scheduleSyncLoop() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = undefined;
    if (fixtureMode || document.visibilityState !== 'visible') return;
    syncTimer = setTimeout(async () => { await sync(); scheduleSyncLoop(); }, 8000);
  }

  async function initialize() {
    if (fixtureMode) {
      online = true;
      if (board) await scrollToToday();
      return;
    }
    online = navigator.onLine;
    if (!credentials) resetToFreshLocalBoard();
    if (!board && credentials && navigator.onLine) { try { await fetchBoard(); } catch { online = navigator.onLine; } }
    if (board) await scrollToToday();
    void sync();
  }

  onMount(() => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    void initialize();
    if (!fixtureMode) {
      const prewarmQr = () => void loadQrModule();
      if ((window as any).requestIdleCallback) (window as any).requestIdleCallback(prewarmQr, { timeout: 2500 });
      else setTimeout(prewarmQr, 1200);
    }

    const onFocus = () => void sync();
    const onOnline = () => credentials ? void sync() : void initialize();
    const onOffline = () => (online = false);
    const onVisibility = () => { if (document.visibilityState === 'visible') void sync(); scheduleSyncLoop(); };
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (navMenuOpen && !target?.closest('.nav-actions')) navMenuOpen = false;
    };
    const onResize = () => {
      const previousMinimum = minimumVisibleDays;
      updateMinimumVisibleDays();
      const requiredDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
      const currentDays = windowEndOffset - windowStartOffset + 1;
      if (minimumVisibleDays > previousMinimum && currentDays < requiredDays && scroller) {
        const add = requiredDays - currentDays;
        const beforeScrollLeft = scroller.scrollLeft;
        const nextStart = Math.max(earliestTimelineOffset(), windowStartOffset - add);
        const inserted = windowStartOffset - nextStart;
        windowStartOffset = nextStart;
        void tick().then(() => {
          if (!scroller) return;
          scroller.scrollLeft = beforeScrollLeft + inserted * DAY_SIZE;
          updateTimelineStatus();
        });
        return;
      }
      updateTimelineStatus();
    };
    const onPageHide = () => {
      cancelScheduledPersistence();
      persistLocalStateNow();
      void flushHabitChanges();
      void flushThoughtChanges();
      void flushQueue({ keepalive: true });
    };

    scroller?.addEventListener('touchstart', startTimelineTouch, { passive: true });
    scroller?.addEventListener('touchmove', moveTimelineTouch, { passive: false });
    scroller?.addEventListener('touchend', endTimelineTouch, { passive: true });
    scroller?.addEventListener('touchcancel', endTimelineTouch, { passive: true });

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onDocumentPointerDown);

    scheduleSyncLoop();
    scheduleNextDay();

    return () => {
      scroller?.removeEventListener('touchstart', startTimelineTouch);
      scroller?.removeEventListener('touchmove', moveTimelineTouch);
      scroller?.removeEventListener('touchend', endTimelineTouch);
      scroller?.removeEventListener('touchcancel', endTimelineTouch);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      if (syncTimer) clearTimeout(syncTimer);
      if (dayTimer) clearTimeout(dayTimer);
      if (flushTimer) clearTimeout(flushTimer);
      cancelScheduledPersistence();
      if (queuePersistTimer) clearTimeout(queuePersistTimer);
      if (habitFlushTimer) clearTimeout(habitFlushTimer);
      if (thoughtFlushTimer) clearTimeout(thoughtFlushTimer);
      if (archiveToastTimer) clearTimeout(archiveToastTimer);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      cleanupItemDrag(false);
      cleanupTimelinePan();
    };
  });
</script>

<svelte:head>
  <title>{fixtureMode && requestedFixture ? `3tap · ${requestedFixture} fixture` : '3tap'}</title>
  <meta name="description" content="A tiny three-state daily habit grid." />
</svelte:head>

<div class="shell">
  <header class="nav-shell">
    <div class="navbar">
      <div class="brand-slot">
        <button class="brand-button" aria-label="Habits" onclick={() => void switchView('habits')}>3tap</button>
      </div>
      <div class="nav-actions">
        <button
          class="nav-more"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={navMenuOpen}
          onclick={() => (navMenuOpen = !navMenuOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="12" r="1.35"></circle>
            <circle cx="12" cy="12" r="1.35"></circle>
            <circle cx="18" cy="12" r="1.35"></circle>
          </svg>
        </button>
        {#if navMenuOpen}
          <div class="nav-menu" role="menu" aria-label="More">
            <button role="menuitem" onclick={openAccess}>access</button>
            <button role="menuitem" onclick={openArchived}>archive</button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  {#if board}
    <main>
      <div
        class="grid-scroll"
        class:thoughts-mode={view === 'thoughts'}
        role="region"
        aria-label={view === 'habits' ? 'Habit timeline' : 'Thoughts'}
        bind:this={scroller}
        onscroll={onTimelineScroll}
        onpointerdown={startTimelinePan}
        onpointermove={moveTimelinePan}
        onpointerup={endTimelinePan}
        onpointercancel={endTimelinePan}
      >
        <div class="grid-frame">
          <div class="timeline-header" aria-label="Timeline">
            <div class="timeline-side">
              <nav class="timeline-controls" aria-label="Pages">
                <button
                  class="tool-icon habits-tool"
                  class:active={view === 'habits'}
                  aria-label="Habits"
                  aria-pressed={view === 'habits'}
                  title="Habits"
                  onclick={() => void switchView('habits')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="4" width="6" height="6"></rect>
                    <rect x="14" y="4" width="6" height="6"></rect>
                    <rect x="4" y="14" width="6" height="6"></rect>
                    <rect x="14" y="14" width="6" height="6"></rect>
                  </svg>
                </button>
                <button
                  class="tool-icon thoughts-tool"
                  class:active={view === 'thoughts'}
                  aria-label="Thoughts"
                  aria-pressed={view === 'thoughts'}
                  title="Thoughts"
                  onclick={() => void switchView('thoughts')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10.25H9.25L5 19.25V5.5Z"></path></svg>
                </button>
                <button
                  class="tool-icon theme-tool"
                  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
                  onclick={toggleTheme}
                >
                  {#if theme === 'dark'}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" class="icon-fill"></circle>
                      <path d="M12 2v2"></path><path d="M12 20v2"></path>
                      <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
                      <path d="M2 12h2"></path><path d="M20 12h2"></path>
                      <path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>
                    </svg>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 9 9 0 1 0 20.2 15.4Z" class="icon-fill" stroke="none"></path>
                    </svg>
                  {/if}
                </button>
              </nav>
            </div>
            {#if view === 'habits'}
            <div class="timeline-main-header">
              <div class="timeline-meta-row">
                <div class="start-slot">
                  {#if showStartButton}
                    <button class="nav-start" aria-label="Jump to start" onclick={scrollToStart}>← start</button>
                  {/if}
                  {#if !online}<span class="offline" aria-live="polite">offline</span>{/if}
                </div>
                <div class="month-nav" aria-label={`Timeline month and year. Currently ${monthOptions[displayMonthIndex]} ${displayYear}`}>
                  <div class="month-slot" aria-hidden="true">
                    <span class="month-label">{monthOptions[displayMonthIndex]}</span>
                    <span class="year-label">{displayYear}</span>
                  </div>
                </div>
                <div class="today-slot">
                  {#if showTodayButton}
                    <button class="nav-today" aria-label="Jump to today" onclick={scrollToToday}>today →</button>
                  {/if}
                </div>
              </div>
              <div class="day-head-strip">
                {#each dates as date (date.key)}
                  <div
                    class="day-head"
                    class:today={date.key === todayKey}
                    class:yesterday={date.key === yesterdayKey}
                    class:enrolled={date.key === enrolledKey}
                    class:prestart={isPreEnrollment(date.key)}
                  >
                    <span>{date.weekday}</span>
                    <strong>{date.day}</strong>
                  </div>
                {/each}
              </div>
            </div>
            {:else if view === 'thoughts'}
              <div class="thoughts-header">
                {#if !online}<span class="offline" aria-live="polite">offline</span>{/if}
              </div>
            {/if}
          </div>
          {#if view === 'thoughts'}
            <div class="thoughts-grid" aria-label="Thoughts">
              {#each board.thoughts ?? [] as thought (thought.id)}
                <div
                  class="thought-row"
                  class:dragging={dragActive && draggingItemId === thought.id}
                  data-thought-id={thought.id}
                  animate:flip={{ duration: dragActive ? 120 : 0 }}
                >
                  <div
                    class="thought-cell"
                    aria-label={`Drag ${thought.text} to reorder`}
                    onpointerdown={(event) => startItemDrag(event, thought.id, 'thought')}
                  >
                    {#if editingThoughtId === thought.id}
                      <input
                        class="thought-input"
                        bind:this={editThoughtInput}
                        bind:value={editingThoughtText}
                        maxlength="240"
                        aria-label="Edit thought"
                        onblur={commitThoughtEdit}
                        enterkeyhint="done"
                        onkeydown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            finishInlineEditFromKeyboard(event.currentTarget);
                          }
                          if (event.key === 'Escape') {
                            editingThoughtId = null;
                            editingThoughtText = '';
                          }
                        }}
                      />
                    {:else}
                      <button class="thought-label" onclick={() => beginEditThought(thought)}>{thought.text}</button>
                    {/if}
                    <div class="thought-controls">
                      <button aria-label={`Delete ${thought.text}`} title="Delete" onclick={() => deleteThought(thought.id)}>×</button>
                    </div>
                  </div>
                </div>
              {/each}
              <div class="thought-add-row">
                {#if addingThought}
                  <input
                    class="thought-input"
                    bind:this={newThoughtInput}
                    bind:value={newThoughtText}
                    maxlength="240"
                    placeholder="idea or todo"
                    aria-label="New thought"
                    onblur={commitAddThought}
                    onkeydown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') cancelAddThought();
                    }}
                  />
                {:else}
                  <button class="add-thought" onclick={beginAddThought}>+ thought</button>
                {/if}
              </div>
            </div>
          {:else if board.habits.length === 0}
            <div class="zero-add-row">
              <div class="zero-add-cell">
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
              </div>
              <div class="zero-add-days" aria-hidden="true">
                {#each dates as date (date.key)}
                  <div class="zero-add-day"></div>
                {/each}
              </div>
            </div>
          {:else}
          <table>
            <tbody>
            {#each board.habits as habit, habitIndex (habit.id)}
              <tr
                data-habit-id={habit.id}
                class:dragging={dragActive && draggingItemId === habit.id}
                animate:flip={{ duration: dragActive ? 120 : 0 }}
              >
                <th
                  class="habit-name"
                >
                  <div class="habit-line">
                    {#if editingHabitId === habit.id}
                      <input
                        class="habit-inline-input"
                        bind:this={editHabitInput}
                        bind:value={editingHabitName}
                        aria-label={`Rename ${habit.name}`}
                        onblur={commitRename}
                        enterkeyhint="done"
                        onkeydown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            finishInlineEditFromKeyboard(event.currentTarget);
                          }
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
                      <button
                        class="drag-habit"
                        aria-label={`Hold and drag to reorder ${habit.name}`}
                        title="Hold and drag to reorder"
                        onpointerdown={(event) => startItemDrag(event, habit.id, 'habit')}
                      >
                        <svg class="row-drag-icon" viewBox="0 0 16 16" aria-hidden="true">
                          <circle cx="5" cy="4" r="1" />
                          <circle cx="11" cy="4" r="1" />
                          <circle cx="5" cy="8" r="1" />
                          <circle cx="11" cy="8" r="1" />
                          <circle cx="5" cy="12" r="1" />
                          <circle cx="11" cy="12" r="1" />
                        </svg>
                      </button>
                      <button
                        class="delete-habit"
                        aria-label={`Archive ${habit.name}`}
                        title="Archive"
                        onclick={() => archiveHabit(habitIndex)}
                      >
                        <svg class="row-archive-icon" viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M4.25 5.25h7.5v7.25h-7.5z" />
                          <path d="M5.25 3.25h5.5" />
                          <path d="M8 7v3.25" />
                          <path d="m6.5 8.75 1.5 1.5 1.5-1.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </th>
                {#each dates as date (date.key)}
                  {@const value = valueFor(habit.id, date.key)}
                  {@const prestart = date.key === yesterdayKey ? false : isPreEnrollment(date.key) || isBeforeHabitStart(habit, date.key)}
                  {@const editable = isEditableDate(date.key) && !prestart}
                  <td
                    class:today={date.key === todayKey}
                    class:yesterday={date.key === yesterdayKey}
                    class:enrolled={date.key === enrolledKey}
                    class:prestart={prestart}
                    class:locked={!editable && !prestart}
                  >
                    <button
                      class:plus={value === 2}
                      class="cell"
                      disabled={!editable}
                      aria-label={prestart
                        ? `${habit.name}, ${date.key}: unavailable`
                        : `${habit.name}, ${date.key}: ${symbols[value]}${editable ? '' : ', locked'}`}
                      onpointerdown={(event) => startCellPress(event, habit.id, date.key)}
                      onpointermove={moveCellPress}
                      onpointerup={endCellPress}
                      onpointercancel={cancelCellPress}
                      onclick={(event) => {
                        if (event.detail === 0) tapCell(habit.id, date.key, event.currentTarget);
                      }}>{prestart ? '' : symbols[value]}</button>
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
              {#each dates as date (date.key)}
                <td class="add-spacer"></td>
              {/each}
            </tr>
          </tbody>
        </table>
          {/if}
        </div>
      </div>
      {#if view === 'habits' && board.habits.length === 0}
        <section class="zero-tutorial" aria-label="Getting started">
          <p class="zero-tutorial-start"><strong>+ habit</strong> to start</p>
          <ul class="zero-tutorial-list">
            <li>tap today or yesterday: <b>-</b> missed / <b>|</b> done / <b>+</b> great</li>
            <li>older days lock</li>
            <li>tap a habit name to rename; drag it to reorder</li>
          </ul>
        </section>
      {/if}
    </main>
  {:else}
    <main></main>
  {/if}

  {#if dragActive}
    <div
      class="item-drag-preview"
      style={`left:${dragPreviewLeft}px; top:${dragPreviewTop}px; width:${dragPreviewWidth}px; height:${dragPreviewHeight}px`}
      aria-hidden="true"
    >
      <span>{dragPreviewName}</span>
    </div>
  {/if}
</div>

{#if panel !== 'none'}
  <div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (panel = 'none')}>
    <section class="panel" aria-modal="true" role="dialog">
      <button class="close" aria-label="Close" onclick={() => (panel = 'none')}>×</button>

      {#if panel === 'access'}
        <div class="panel-heading">
          <h2>access</h2>
          <p>Take this board with you, keep a backup, or open another one.</p>
        </div>

        <div class="access-section">
          <div class="panel-label">add device</div>
          <p class="section-help">Scan this on another device to bring this board with you. Both devices stay in sync.</p>
          {#if qrDataUrl}<img class="qr pair-qr" src={qrDataUrl} alt="QR code for pairing another device" />{/if}
          <button class="panel-button panel-button-primary" disabled={!pairingLink} onclick={copyPairingLink}>
            {pairingCopied ? 'link copied' : pairingLink ? 'copy pairing link' : 'preparing…'}
          </button>
          <p class="privacy-note">Treat the QR like a key — anyone with it can open this board.</p>
        </div>

        <div class="panel-divider"></div>

        <div class="access-section">
          <div class="panel-label">recovery code</div>
          <p class="section-help">Save this somewhere safe. Use it if you lose access to all of your devices.</p>
          <div class="code-box recovery-code-box">
            <code>{recoveryInput || 'connect to load recovery code'}</code>
          </div>
          <button class="panel-button" disabled={!recoveryInput} onclick={copyRecoveryCode}>{recoveryCopied ? 'copied ✓' : 'copy recovery code'}</button>
        </div>

        <div class="panel-divider"></div>

        <div class="access-section">
          <label class="panel-label" for="restore-code">recover a board</label>
          <p class="section-help">Paste its recovery code here. Recovery creates a fresh device key, so previously paired devices will need to be added again.</p>
          <textarea
            id="restore-code"
            class="restore-code-input"
            bind:value={restoreCodeInput}
            rows="2"
            spellcheck="false"
            autocomplete="off"
            autocapitalize="none"
            placeholder="winter_donkey_maple_cloud..."
            oninput={() => (recoveryError = '')}
          ></textarea>
          {#if recoveryError}<p class="recovery-error" role="alert">{recoveryError}</p>{/if}
          <button class="panel-button panel-button-primary" disabled={recovering || !restoreCodeInput.trim()} onclick={useRecoveryCode}>
            {recovering ? 'recovering…' : 'recover board'}
          </button>
        </div>

        <div class="panel-divider"></div>

        <div class="access-section access-danger-section">
          <div class="panel-label">delete board</div>
          <p class="section-help">Permanently delete this board, every habit, and all history from 3tap.</p>
          <button class="panel-button panel-button-danger" onclick={confirmDeleteBoard}>delete board</button>
        </div>
      {:else if panel === 'archived'}
        <div class="panel-heading">
          <h2>archive</h2>
          <p>Archived habits keep their history. Restore one anytime, or delete it permanently.</p>
        </div>

        {#if (board?.archivedHabits?.length ?? 0) === 0}
          <div class="archive-empty-state">
            <div class="panel-label">archived habits</div>
            <p class="section-help">Nothing is archived right now.</p>
          </div>
        {:else}
          <div class="archive-section">
            <div class="panel-label">archived habits</div>
            <div class="archived-list">
              {#each board?.archivedHabits ?? [] as habit (habit.id)}
                {@const historyDays = archivedHistoryDays(habit)}
                <div class="archived-item">
                  <div class="archived-copy">
                    <strong>{habit.name}</strong>
                    <span>history: {historyDays} {historyDays === 1 ? 'day' : 'days'}</span>
                  </div>
                  <div class="archived-actions">
                    <button class="panel-button" onclick={() => restoreArchivedHabit(habit, habit.position)}>restore</button>
                    <button class="panel-button panel-button-danger" onclick={() => confirmPermanentDelete(habit)}>delete</button>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="panel-divider"></div>

          <div class="archive-danger-section">
            <div class="panel-label">clear archive</div>
            <p class="section-help">Permanently delete every archived habit and all of their history.</p>
            <button class="panel-button panel-button-danger" onclick={confirmClearArchive}>clear all</button>
          </div>
        {/if}
      {:else if panel === 'delete' && deleteHabitTarget}
        {@const historyDays = archivedHistoryDays(deleteHabitTarget)}
        <h2>delete {deleteHabitTarget.name}?</h2>
        <p>permanently delete this habit and its {historyDays} {historyDays === 1 ? 'day' : 'days'} of history?</p>
        {#if archiveError}<p class="archive-error" role="alert">{archiveError}</p>{/if}
        <div class="panel-confirm-actions">
          <button class="panel-button" onclick={() => (panel = 'archived')}>cancel</button>
          <button class="panel-button panel-button-danger" disabled={deletingHabit} onclick={deleteHabitForever}>
            {deletingHabit ? 'deleting…' : 'delete'}
          </button>
        </div>
      {:else if panel === 'clear'}
        <h2>clear archive?</h2>
        <p>permanently delete all {board?.archivedHabits?.length ?? 0} archived habits and their history?</p>
        {#if archiveError}<p class="archive-error" role="alert">{archiveError}</p>{/if}
        <div class="panel-confirm-actions">
          <button class="panel-button" onclick={() => (panel = 'archived')}>cancel</button>
          <button class="panel-button panel-button-danger" disabled={clearingArchive} onclick={clearArchive}>
            {clearingArchive ? 'clearing…' : 'clear all'}
          </button>
        </div>
      {:else if panel === 'delete-board'}
        <h2>delete this board?</h2>
        <p>This permanently deletes every habit, thought, and all history on every paired device. This device will start with a new empty board.</p>
        {#if deleteBoardError}<p class="archive-error" role="alert">{deleteBoardError}</p>{/if}
        <div class="panel-confirm-actions">
          <button class="panel-button" onclick={() => (panel = 'access')}>cancel</button>
          <button class="panel-button panel-button-danger" disabled={deletingBoard} onclick={deleteBoardForever}>
            {deletingBoard ? 'deleting…' : 'delete board'}
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
    --muted: #5f605a;
    --control-text: #44453f;
    --control-active: #11110f;
    --grid-weak-theme: #deded8;
    --border: #d3d3cd;
    --panel-border: #cecec8;
    --hover: #e7e7e1;
    --timeline-text: #62635d;
    --timeline-mark: #555650;
    --today-accent: #075f67;
    --today-fill: rgba(7,95,103,.18);
    --yesterday-accent: #875600;
    --yesterday-fill: rgba(180,118,0,.17);
    --press-fill: rgba(17,17,15,.13);
    --selection-bg: #b8d7ff;
    --selection-text: #0b1b2b;
    --backdrop: rgba(17,17,15,.18);
    --shadow: rgba(17,17,15,.16);
    --nav-shadow: rgba(17,17,15,.08);
    --icon-habits: #225866;
    --icon-thoughts: #af4b53;
        --icon-archive: #af4b53;
    --icon-theme: #ca9503;
    --danger: #9b332b;
    background: var(--bg);
    color-scheme: light;
  }
  :global(html[data-theme='dark']) {
    --bg: #041318;
    --surface: #071a20;
    --text: #ecece6;
    --muted: #afb0a9;
    --control-text: #c8c9c2;
    --control-active: #f2f2ec;
    --grid-weak-theme: #293031;
    --border: #343c3d;
    --panel-border: #414a4b;
    --hover: #1b2122;
    --timeline-text: #a7afae;
    --timeline-mark: #b2b9b8;
    --today-accent: #5ecbd0;
    --today-fill: rgba(94,203,208,.14);
    --yesterday-accent: #efc95a;
    --yesterday-fill: rgba(239,201,90,.15);
    --press-fill: rgba(255,255,248,.16);
    --selection-bg: #315f8f;
    --selection-text: #ffffff;
    --backdrop: rgba(0,0,0,.5);
    --shadow: rgba(0,0,0,.42);
    --nav-shadow: rgba(0,0,0,.28);
    --icon-habits: #225866;
    --icon-thoughts: #af4b53;
        --icon-archive: #af4b53;
    --icon-theme: #ca9503;
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
  :global(button), :global(input), :global(textarea), :global(select) { font: inherit; }
  :global(::selection) { background: var(--selection-bg); color: var(--selection-text); }
  :global(::-moz-selection) { background: var(--selection-bg); color: var(--selection-text); }
  :global(button) { color: inherit; }
  :global(html.item-dragging-cursor),
  :global(html.item-dragging-cursor *) { cursor: grabbing !important; }
  :global(html.timeline-panning-cursor),
  :global(html.timeline-panning-cursor *) { cursor: grabbing !important; }

  .shell {
    --day-size: 48px;
    --timeline-meta-height: 22px;
    --habit-width: calc(var(--day-size) * 3);
    --line: 1px;
    --grid: var(--grid-weak-theme);
    --page-inset: 16px;
    min-height: 100dvh;
    padding: 0;
  }
  .nav-shell {
    position: relative;
    width: 100%;
    background: var(--bg);
  }
  .navbar {
    position: relative;
    height: calc(var(--day-size) + env(safe-area-inset-top));
    min-height: calc(var(--day-size) + env(safe-area-inset-top));
    width: 100%;
    padding-top: env(safe-area-inset-top);
    box-sizing: border-box;
    background: var(--bg);
    border-bottom: var(--line) solid var(--grid);
  }
  .brand-slot {
    position: relative;
    width: var(--habit-width);
    height: var(--day-size);
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 8px 0 var(--page-inset);
    color: var(--muted);
    font-size: 11px;
    letter-spacing: .08em;
  }
  .brand-slot::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .brand-button {
    color: inherit;
    font-size: inherit;
    letter-spacing: inherit;
  }
  .brand-button:focus-visible,
  .nav-more:focus-visible,
  .nav-menu button:focus-visible {
    outline: 1px solid var(--control-active);
    outline-offset: -2px;
  }
  .nav-actions {
    position: absolute;
    top: env(safe-area-inset-top);
    right: 0;
    width: var(--day-size);
    height: var(--day-size);
  }
  .nav-more {
    width: var(--day-size);
    height: var(--day-size);
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .nav-more svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .nav-menu {
    position: absolute;
    z-index: 90;
    top: var(--day-size);
    right: 8px;
    width: 88px;
    background: var(--bg);
    border: var(--line) solid var(--grid);
  }
  .nav-menu button {
    width: 100%;
    height: 30px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    border-bottom: var(--line) solid var(--grid);
    color: var(--control-text);
    font-size: 10px;
    text-align: left;
  }
  .nav-menu button:last-child { border-bottom: 0; }
  .start-slot,
  .month-nav,
  .month-slot,
  .today-slot {
    min-width: 0;
    height: var(--timeline-meta-height);
    display: flex;
    align-items: center;
  }
  .start-slot {
    justify-content: flex-start;
    gap: 8px;
    padding-left: 8px;
  }
  .today-slot { justify-content: flex-end; padding-right: 8px; }
  .month-nav {
    justify-content: center;
    color: var(--text);
    font-size: 11px;
    white-space: nowrap;
  }
  .month-slot {
    position: relative;
    justify-content: center;
    gap: 0;
    overflow: visible;
    letter-spacing: 0;
  }
  .offline { font-size: 9px; opacity: .45; white-space: nowrap; }
  button { border: 0; background: none; padding: 0; cursor: pointer; }
  .nav-start,
  .nav-today {
    height: auto;
    min-height: 0;
    border: 0;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--control-text);
    font: inherit;
    font-size: 11px;
    line-height: 1;
    opacity: 1;
    white-space: nowrap;
  }
  .nav-start,
  .nav-today { padding: 2px 0 3px; }
  .month-label,
  .year-label {
    display: inline-block;
    color: var(--control-text);
    font-size: 11px;
    line-height: 1;
    text-align: center;
  }
  .month-label { width: 26px; }
  .year-label { width: 32px; }
  .nav-start { text-align: left; }
  .nav-today { text-align: right; }
  .nav-start:focus-visible,
  .nav-today:focus-visible {
    outline: none;
    color: var(--control-active);
    border-bottom-color: var(--control-active);
  }
  @media (hover: hover) and (pointer: fine) {
    :global(html:not(.item-dragging-cursor)) .tool-icon:hover::before { opacity: .12; }
    :global(html:not(.item-dragging-cursor)) .nav-more:hover { color: var(--text); }
    :global(html:not(.item-dragging-cursor)) .nav-menu button:hover { background: var(--hover); color: var(--control-active); }
    :global(html:not(.item-dragging-cursor)) .panel-button:not(:disabled):hover { background: var(--hover); border-color: var(--grid); }
    :global(html:not(.item-dragging-cursor)) .panel-button-danger:not(:disabled):hover { color: var(--danger); }
    :global(html:not(.item-dragging-cursor)) .close:hover { color: var(--text); background: var(--hover); border-color: var(--border); }
    :global(html:not(.item-dragging-cursor)) .nav-start:hover,
    :global(html:not(.item-dragging-cursor)) .nav-today:hover {
      color: var(--control-active);
      border-bottom-color: transparent;
      text-decoration: underline;
    }
    :global(html:not(.item-dragging-cursor)) .habit-controls button:not(:disabled):hover,
    :global(html:not(.item-dragging-cursor)) .thought-controls button:not(:disabled):hover { opacity: 1; }
    :global(html:not(.item-dragging-cursor)) .cell:not(:disabled):hover { background: var(--hover); }
    .grid-scroll { cursor: grab; }
    .thought-cell { cursor: grab; }
  }

  main { width: 100%; padding-bottom: 24px; }
  .grid-scroll {
    position: relative;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    touch-action: pan-y pinch-zoom;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: auto;
    scroll-behavior: auto;
  }
  .grid-scroll::-webkit-scrollbar { display: none; }
  .grid-scroll.thoughts-mode {
    overflow-x: hidden;
    cursor: default;
  }
  .grid-scroll.thoughts-mode .grid-frame,
  .grid-scroll.thoughts-mode .timeline-header {
    width: 100%;
    min-width: 100%;
  }
  .grid-frame {
    position: relative;
    width: max-content;
    min-width: 100%;
  }
  .timeline-header {
    display: flex;
    align-items: stretch;
    width: max-content;
    min-width: 100%;
    height: var(--day-size);
    border-bottom: var(--line) solid var(--grid);
    background: var(--bg);
  }
  .timeline-side {
    position: sticky;
    left: 0;
    z-index: 8;
    width: var(--habit-width);
    min-width: var(--habit-width);
    max-width: var(--habit-width);
    background: var(--bg);
  }
  .timeline-side::after {
    content: '';
    position: absolute;
    z-index: 9;
    top: 0;
    bottom: 0;
    right: 0;
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .timeline-controls {
    width: 100%;
    height: var(--day-size);
    margin-top: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
  }
  .tool-icon {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    opacity: 1;
    background: transparent;
    -webkit-tap-highlight-color: transparent;
  }
  .tool-icon::before {
    content: '';
    position: absolute;
    width: 36px;
    height: 36px;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity 110ms ease;
  }
  .habits-tool { color: var(--icon-habits); }
  .habits-tool.active::before { opacity: .10; }
  .thoughts-tool { color: var(--icon-thoughts); }
  .thoughts-tool.active::before { opacity: .10; }
  .theme-tool { color: var(--icon-theme); }
  .tool-icon svg {
    position: relative;
    z-index: 1;
    width: 24px;
    height: 24px;
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
  }
  .tool-icon .icon-fill { fill: currentColor; }
  .tool-icon .icon-cutout { fill: var(--bg); }
  .tool-icon:active::before { opacity: .18; }
  .tool-icon:focus-visible { outline: none; }
  .tool-icon:focus-visible::before { opacity: .12; }

  .timeline-main-header {
    position: relative;
    width: max-content;
    height: var(--day-size);
  }
  .thoughts-header {
    flex: 1;
    min-width: 0;
    height: var(--day-size);
    padding: 0 var(--page-inset);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    color: var(--control-text);
    font-size: 11px;
  }
  .timeline-meta-row {
    position: sticky;
    left: var(--habit-width);
    z-index: 20;
    width: calc(100vw - var(--habit-width));
    height: var(--timeline-meta-height);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    box-sizing: border-box;
    margin-bottom: calc(-1 * var(--timeline-meta-height));
    background: transparent;
    pointer-events: none;
  }
  .start-slot,
  .month-nav,
  .today-slot { pointer-events: auto; }

  .day-head-strip {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: stretch;
    width: max-content;
  }
  .day-head {
    position: relative;
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
    height: var(--day-size);
    box-sizing: border-box;
    padding-top: var(--timeline-meta-height);
    padding-bottom: 2px;
    display: grid;
    align-content: end;
    justify-items: center;
    gap: 0;
    font-size: 9px;
    background: transparent;
  }
  .day-head::before {
    content: '';
    position: absolute;
    top: var(--timeline-meta-height);
    bottom: 0;
    left: 0;
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .day-head:first-child::before { display: none; }
  .day-head span,
  .day-head strong {
    display: block;
    color: var(--timeline-text);
    font-weight: 400;
    line-height: 1;
    opacity: 1;
  }
  .day-head strong { font-size: 10px; }
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
  td {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
  }
tbody tr:not(.add-row) td { position: relative; }
  tbody tr:not(.add-row) td::before {
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
tbody tr:not(.add-row) .habit-name + td::before { display: none; }

  .habit-name {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--habit-width);
    min-width: var(--habit-width);
    max-width: var(--habit-width);
    padding: 0 8px 0 var(--page-inset);
    text-align: left;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
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
    display: grid;
    grid-template-columns: repeat(2, 30px);
    align-items: center;
    justify-items: center;
    margin-left: auto;
  }
  .habit-controls button {
    width: 30px;
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--control-text);
    opacity: .86;
    -webkit-tap-highlight-color: transparent;
  }
  .habit-controls svg {
    width: 16px;
    height: 16px;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .habit-controls .row-archive-icon {
    width: 18px;
    height: 18px;
    stroke-width: 1.5;
  }
  .habit-controls .row-drag-icon {
    width: 16px;
    height: 16px;
    fill: currentColor;
    stroke: none;
  }
  .habit-controls .drag-habit {
    cursor: grab;
    touch-action: pinch-zoom;
  }
  .habit-controls .drag-habit:active { cursor: grabbing; }
  .habit-controls .delete-habit { color: var(--control-text); }
  .habit-name {
    user-select: none;
    -webkit-user-select: none;
  }
  tr.dragging > th,
  tr.dragging > td,
  .thought-row.dragging { opacity: .08; }
  .item-drag-preview {
    position: fixed;
    z-index: 250;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    padding: 0 8px 0 var(--page-inset);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border), 0 10px 28px var(--shadow);
    font-size: 12px;
    font-weight: 500;
    pointer-events: none;
    will-change: top;
  }
  .thoughts-grid {
    width: 100%;
    background: var(--bg);
  }
  .thought-row,
  .thought-add-row {
    width: 100%;
    height: var(--day-size);
    border-bottom: var(--line) solid var(--grid);
  }
  .thought-cell {
    width: 100%;
    height: 100%;
    padding: 0 8px 0 var(--page-inset);
    display: flex;
    align-items: center;
    gap: 8px;
    touch-action: pinch-zoom;
    user-select: none;
    -webkit-user-select: none;
  }
  .thought-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 12px;
    font-weight: 500;
  }
  .thought-input {
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
  .thought-controls {
    flex: none;
    width: 36px;
    height: 36px;
  }
  .thought-controls button {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    color: var(--icon-archive);
    font-size: 17px;
    line-height: 1;
    opacity: .72;
  }
  .thought-add-row {
    padding: 0 var(--page-inset);
    display: flex;
    align-items: center;
  }
  .add-thought {
    color: var(--muted);
    font-size: 11px;
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
  .zero-add-row {
    width: max-content;
    min-width: 100%;
    height: var(--day-size);
    display: flex;
    align-items: stretch;
    touch-action: pan-y pinch-zoom;
    cursor: default;
  }
  .zero-add-row * { touch-action: pan-y pinch-zoom; }
  .zero-add-row button { cursor: pointer; }
  .zero-add-days {
    display: flex;
    width: max-content;
    height: var(--day-size);
  }
  .zero-add-day {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
    height: var(--day-size);
  }
  .zero-add-cell {
    position: sticky;
    left: 0;
    z-index: 5;
    width: var(--habit-width);
    min-width: var(--habit-width);
    max-width: var(--habit-width);
    height: var(--day-size);
    padding: 0 8px 0 var(--page-inset);
    display: flex;
    align-items: center;
    background: var(--bg);
  }
  .zero-tutorial {
    width: min(460px, calc(100% - (var(--page-inset) * 2)));
    margin: 28px auto 0;
    padding: 8px 0 24px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.55;
  }
  .zero-tutorial-start {
    width: max-content;
    max-width: 100%;
    margin: 0 auto 8px;
  }
  .zero-tutorial-list {
    width: max-content;
    max-width: 100%;
    margin: 0 auto;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 7px;
    text-align: left;
  }
  .zero-tutorial-list li {
    position: relative;
    padding-left: 14px;
  }
  .zero-tutorial-list li::before {
    content: '–';
    position: absolute;
    left: 0;
    color: var(--muted);
  }
  .zero-tutorial strong {
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }
  .zero-tutorial b {
    color: var(--timeline-mark);
    font: inherit;
    font-weight: 600;
  }
  .add-habit-cell {
    height: var(--day-size);
    border: 0;
    background: var(--bg);
  }
  .add-row .add-spacer {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
    height: var(--day-size);
    border: 0;
    background: transparent;
    vertical-align: top;
  }
  .add-row,
  .add-row * {
    touch-action: pan-y pinch-zoom;
    cursor: default;
  }
  .add-row button { cursor: pointer; }
  .add-habit {
    width: 100%;
    height: 100%;
    font-size: 11px;
    opacity: .64;
    text-align: left;
  }
  .add-input { width: 100%; }
  td { text-align: center; background: transparent; }
  td.today { background: var(--today-fill); }
  td.yesterday { background: var(--yesterday-fill); }
tbody tr:not(.add-row) td.enrolled::before { background: var(--grid); }
  td.prestart { background: transparent; }
  td.locked .cell,
  td.prestart .cell { cursor: default; }
  .cell {
    width: 100%;
    height: 100%;
    color: var(--timeline-mark);
    font-size: 16px;
    font-weight: 400;
    opacity: .78;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .cell.plus { font-weight: 750; font-size: 17px; }
  .cell:disabled { pointer-events: none; }
  td.today .cell {
    color: var(--today-accent);
    opacity: 1;
  }
  td.yesterday .cell {
    color: var(--yesterday-accent);
    opacity: 1;
  }
  .cell:not(:disabled):active { background: var(--press-fill); }

  @media (max-width: 767px) {
    input,
    textarea { font-size: 16px; }
  }

  .backdrop { position: fixed; z-index: 100; inset: 0; background: var(--backdrop); display: grid; place-items: center; padding: 18px; }
  .panel { position: relative; width: min(420px, 100%); max-height: min(720px, 88dvh); overflow: auto; background: var(--bg); border: 1px solid var(--panel-border); padding: 22px; scrollbar-width: none; }
  .panel::-webkit-scrollbar { display: none; }
  .panel h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: lowercase; }
  .panel p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
  .close { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; display: grid; place-items: center; font-size: 18px; opacity: .68; }
  .panel-heading { padding-right: 34px; margin-bottom: 18px; }
  .panel-heading h2 { margin-bottom: 7px; }
  .panel-label {
    display: block;
    margin-bottom: 5px;
    color: var(--text);
    font-size: 10px;
    font-weight: 600;
    text-transform: lowercase;
  }
  .section-help { margin-bottom: 10px !important; }
  .panel-divider { height: 1px; margin: 20px 0; background: var(--border); }
  .panel-button {
    min-height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 10px;
    line-height: 1;
    transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
  }
  .panel-button-primary { border-color: var(--grid); }
  .panel-button:disabled { opacity: .38; cursor: default; }
  .panel-button:not(:disabled):active { background: var(--press-fill); }
  .qr { display: block; width: min(250px, 76vw); margin: 10px auto 18px; image-rendering: pixelated; }
  .pair-qr { border: 1px solid var(--border); }
  .privacy-note { margin-top: 10px !important; font-size: 10px !important; }
  .access-section { display: grid; justify-items: start; }
  .access-danger-section { padding-bottom: 1px; }
  .code-box {
    width: 100%;
    min-height: 54px;
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .code-box code {
    min-width: 0;
    color: var(--control-text);
    font: inherit;
    font-size: 10px;
    line-height: 1.45;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .restore-code-input {
    width: 100%;
    min-height: 54px;
    resize: none;
    margin: 0 0 8px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 0;
    outline: none;
    background: var(--surface);
    color: var(--text);
    font-size: 10px;
    line-height: 1.45;
  }
  .restore-code-input::placeholder { color: var(--muted); opacity: .7; }
  .restore-code-input:focus { border-color: var(--grid); }
  .recovery-code-box code {
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.55;
  }
  .recovery-error { margin: 0 0 8px !important; color: var(--danger) !important; font-size: 10px !important; }
  .archive-section,
  .archive-empty-state,
  .archive-danger-section {
    display: grid;
    justify-items: start;
  }
  .archive-empty-state { padding-top: 2px; }
  .archived-list {
    width: 100%;
    display: grid;
    margin-top: 2px;
  }
  .archived-item {
    min-width: 0;
    display: grid;
    gap: 9px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .archived-item:first-child { border-top: 1px solid var(--border); }
  .archived-copy {
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .archived-copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
  }
  .archived-copy span { color: var(--muted); font-size: 10px; }
  .archived-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .panel-button-danger { color: var(--danger); }
  .archive-error { margin: -6px 0 14px !important; color: var(--danger) !important; }
  .panel-confirm-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 18px;
  }
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
