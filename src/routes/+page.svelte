<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { flip } from 'svelte/animate';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Board, Credentials, Entry, Habit, MarkValue } from '$lib/types';
  import {
    authHeaders,
    clearLocalBoard,
    compactQueue,
    createLocalBoardState,
    getCachedBoard,
    getCredentials,
    getHabitsDirty,
    getQueue,
    setCachedBoard,
    setCredentials,
    setHabitsDirty,
    setQueue,
    type PendingEntry
  } from '$lib/client';

  type DayColumn = { key: string; weekday: string; day: number; month: number; year: number };
  const CLIENT_RESET_VERSION = '2026-08-23-clean-slate-v1';
  if (browser && localStorage.getItem('3tap.client-reset') !== CLIENT_RESET_VERSION) {
    clearLocalBoard();
    localStorage.setItem('3tap.client-reset', CLIENT_RESET_VERSION);
  }

  let credentials: Credentials | null = browser ? getCredentials() : null;
  let board: Board | null = browser ? getCachedBoard() : null;
  if (browser && !credentials) {
    if (board) clearLocalBoard();
    const fresh = createLocalBoardState();
    credentials = fresh.credentials;
    board = fresh.board;
    setCredentials(credentials);
    setCachedBoard(board);
  }
  let online = true;
  let theme: 'light' | 'dark' = 'light';
  let navScrolled = false;
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
  let pendingHabitSave: Habit[] | null = browser && board && getHabitsDirty() ? board.habits : null;
  let scroller: HTMLDivElement;
  let currentDay = new Date();
  let windowEndOffset = 0;
  let displayMonthIndex = currentDay.getMonth();
  let displayYear = currentDay.getFullYear();
  let monthMenuOpen = false;
  let yearEditing = false;
  let yearDraft = String(currentDay.getFullYear());
  let yearInput: HTMLInputElement;
  const monthOptions = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let showTodayButton = false;
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
  let flushPromise: Promise<void> | null = null;
  let syncPromise: Promise<void> | null = null;
  let registrationPromise: Promise<boolean> | null = null;
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
  let dragRowsTop = 0;
  let dragMoveRaf = 0;
  let dragPendingY: number | null = null;
  let dragLastClientY: number | null = null;
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

  function datesForWindow(baseDay: Date, startOffset: number, endOffset: number): DayColumn[] {
    const days: DayColumn[] = [];
    for (let offset = startOffset; offset <= endOffset; offset += 1) {
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
  $: enrolledKey = enrollmentKey(board);

  function isPreEnrollment(date: string) {
    return Boolean(enrolledKey && date < enrolledKey);
  }

  function isEditableDate(date: string) {
    return Boolean(enrolledKey && date >= enrolledKey && date === todayKey);
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
    if (persistTimer || persistIdle !== undefined) return;
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
    if (queuePersistTimer) clearTimeout(queuePersistTimer);
    queuePersistTimer = setTimeout(() => {
      queuePersistTimer = undefined;
      setQueue(pendingChanges());
    }, 50);
  }

  function queueChange(change: PendingEntry) {
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

  function resetToFreshLocalBoard() {
    clearLocalBoard();
    pendingByCell.clear();
    localTapValues.clear();
    pendingHabitSave = null;
    setHabitsDirty(false);
    entries.clear();
    habitStartKeys.clear();
    const fresh = createLocalBoardState();
    credentials = fresh.credentials;
    board = fresh.board;
    setCredentials(credentials);
    setCachedBoard(board);
  }

  async function ensureBoardRegistered() {
    if (!credentials) return false;
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

  async function fetchBoard() {
    if (!credentials) return;
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
    if (remoteBoard.entriesDelta) {
      const validHabitIds = new Set([...remoteBoard.habits.map(h => h.id), ...archivedHabits.map(h => h.id), ...activeHabits.map(h => h.id)]);
      reconcileEntryDelta(remoteBoard.entries, validHabitIds);
    } else reconcileFullEntries(remoteBoard.entries);
    const changed = !board || !sameHabitSnapshot(board.habits, activeHabits) || !sameHabitSnapshot(board.archivedHabits ?? [], archivedHabits) || board.createdAt !== remoteBoard.createdAt;
    if (changed || !board) {
      habitStartKeys.clear();
      board = { createdAt: remoteBoard.createdAt, updatedAt: remoteBoard.updatedAt, habits: activeHabits, archivedHabits, entries: [] };
    } else board.updatedAt = remoteBoard.updatedAt;
    for (const [key] of localTapValues) if (!pendingByCell.has(key)) localTapValues.delete(key);
    schedulePersistence();
  }

  async function flushQueue(options: { keepalive?: boolean } = {}) {
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
    if (syncPromise) return syncPromise;
    if (!credentials || !navigator.onLine || document.visibilityState === 'hidden') {
      online = navigator.onLine;
      return;
    }

    syncPromise = (async () => {
      try {
        if (!(await ensureBoardRegistered())) return;
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
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor(scroller.scrollLeft / metrics.dayWidth)));
    const date = dates[index];
    setVisibleMonthState(date.year, date.month);

    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    showTodayButton = windowEndOffset < 0 || rightGap > 2;
  }

  async function prependTimelineDays(count: number, metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || count <= 0) return;
    const beforeScrollLeft = scroller.scrollLeft;
    windowStartOffset -= count;
    await tick();

    const compensation = count * metrics.dayWidth;
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

    if (scroller.scrollLeft < threshold && dates.length) {
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
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateTimelineStatus();
      void maintainTimelineWindow();
    });
  }

  function startTimelinePan(event: PointerEvent) {
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
    if (!scroller || event.touches.length !== 1 || dragActive) return;
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

  function visibleYear() {
    return displayYear;
  }

  function visibleMonth() {
    return displayMonthIndex + 1;
  }

  function toggleMonthMenu() {
    monthMenuOpen = !monthMenuOpen;
  }

  function chooseMonth(month: number) {
    if (!Number.isInteger(month) || month < 1 || month > 12) return;
    monthMenuOpen = false;

    const year = visibleYear();
    const currentYear = currentDay.getFullYear();
    const currentMonth = currentDay.getMonth() + 1;
    if (year > currentYear || (year === currentYear && month > currentMonth)) {
      void scrollToToday();
      return;
    }
    const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    setVisibleMonthState(year, month);
    yearDraft = String(year);
    void jumpToMonth(value);
  }

  async function beginYearEdit() {
    monthMenuOpen = false;
    yearDraft = String(visibleYear());
    yearEditing = true;
    await tick();
    yearInput?.focus();
    yearInput?.select();
  }

  function sanitizeYearInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    let digits = input.value.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 4 && Number(digits) > currentDay.getFullYear()) {
      digits = String(currentDay.getFullYear());
    }
    yearDraft = digits;
    if (input.value !== digits) input.value = digits;
  }

  function commitYearEdit() {
    if (!yearEditing) return;
    const originalYear = visibleYear();
    const year = Number(yearDraft);
    yearEditing = false;
    if (!Number.isInteger(year) || year < 1000 || year > currentDay.getFullYear()) {
      yearDraft = String(originalYear);
      return;
    }
    if (year === originalYear) {
      yearDraft = String(year);
      return;
    }

    const month = visibleMonth();
    if (year === currentDay.getFullYear() && month > currentDay.getMonth() + 1) {
      yearDraft = String(currentDay.getFullYear());
      void scrollToToday();
      return;
    }

    void jumpToMonth(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
  }

  function cancelYearEdit() {
    yearDraft = String(visibleYear());
    yearEditing = false;
  }

  async function jumpToMonth(value: string) {
    if (!scroller || !/^\d{4}-\d{2}$/.test(value)) return;
    const [yearText, monthText] = value.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return;

    const today = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 12);
    const target = new Date(year, month - 1, 1, 12);
    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    if (target > currentMonth) {
      await scrollToToday();
      return;
    }

    const metrics = timelineMetrics();
    if (!metrics || metrics.dayWidth <= 0) return;
    const timelineWidth = Math.max(metrics.dayWidth, scroller.clientWidth - metrics.habitWidth);
    const visibleDays = Math.max(1, Math.floor(timelineWidth / metrics.dayWidth));
    const targetOffset = calendarDayDistance(today, target);
    const requiredDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
    windowStartOffset = targetOffset - WINDOW_SHIFT;
    windowEndOffset = Math.min(0, Math.max(targetOffset + visibleDays + WINDOW_SHIFT - 1, windowStartOffset + requiredDays - 1));
    await tick();

    const targetKey = dateKey(target);
    const targetIndex = dates.findIndex((date) => date.key === targetKey);
    if (targetIndex >= 0) scroller.scrollLeft = targetIndex * metrics.dayWidth;
    else scroller.scrollLeft = 0;

    updateTimelineStatus();
    setVisibleMonthState(year, month);
    yearDraft = String(year);
  }

  async function scrollToToday() {
    windowEndOffset = 0;
    updateMinimumVisibleDays();
    windowStartOffset = -(Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT) - 1);
    await tick();
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
      updateTimelineStatus();
    }
  }

  function loadQrModule() { qrModulePromise ??= import('qrcode'); return qrModulePromise; }

  async function ensureRecoveryCode() {
    if (!credentials || credentials.recoveryCode || !navigator.onLine) return;
    if (credentials.pendingCreate && !(await ensureBoardRegistered())) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(credentials.boardId)}/recovery`, { method: 'POST', headers: authHeaders(credentials) });
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as { recoveryCode: string };
    credentials = { ...credentials, recoveryCode: data.recoveryCode };
    setCredentials(credentials);
  }

  function openAccess() {
    if (!credentials) return;
    pairingCopied = false; recoveryInput = credentials.recoveryCode ?? ''; restoreCodeInput = ''; recoveryError = '';
    recoveryCopied = false; recovering = false; deleteBoardError = ''; panel = 'access';
    const nextLink = `${location.origin}/pair#${credentials.boardId}.${credentials.secret}`;
    if (pairingLink !== nextLink) { pairingLink = nextLink; qrDataUrl = ''; }
    if (!qrDataUrl) void loadQrModule().then(({ toDataURL }) => toDataURL(pairingLink, { width: 280, margin: 1, color: { dark: '#11110f', light: '#f7f7f5' } })).then(url => { if (panel === 'access') qrDataUrl = url; }).catch(() => {});
    if (navigator.onLine) void (async () => {
      await flushHabitChanges(); await flushQueue();
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
    const name = editingHabitName.trim().slice(0, 60);
    editingHabitId = null;
    editingHabitName = '';
    if (!name) return;
    const current = board.habits.find((habit) => habit.id === id);
    if (!current || current.name === name) return;
    setLocalHabits(board.habits.map((habit) => (habit.id === id ? { ...habit, name } : habit)));
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
    const currentIndex = board.habits.findIndex((item) => item.id === habit.id);
    dragRowsTop = rect.top - Math.max(0, currentIndex) * rect.height;
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
    const rowHeight = dragPreviewHeight || DAY_SIZE;
    let targetIndex = currentIndex;
    if (movingUp) targetIndex = Math.max(0, Math.min(currentIndex, Math.floor((previewTop - dragRowsTop) / rowHeight)));
    else targetIndex = Math.max(currentIndex, Math.min(board.habits.length - 1, Math.ceil((previewBottom - dragRowsTop) / rowHeight) - 1));
    if (targetIndex === currentIndex) return;
    const next = [...board.habits];
    const [dragged] = next.splice(currentIndex, 1);
    next.splice(targetIndex, 0, dragged);
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
    dragRowsTop = 0;
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
      archiveError = error instanceof Error ? error.message : 'could not delete · retry';
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
    } catch (error) { archiveError = error instanceof Error ? error.message : 'could not clear archive · retry'; }
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
      setHabitsDirty(false);
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
    if (document.visibilityState !== 'visible') return;
    syncTimer = setTimeout(async () => { await sync(); scheduleSyncLoop(); }, 8000);
  }

  async function initialize() {
    online = navigator.onLine;
    if (!credentials) resetToFreshLocalBoard();
    if (!board && credentials && navigator.onLine) { try { await fetchBoard(); } catch { online = navigator.onLine; } }
    if (board) await scrollToToday();
    void sync();
  }

  onMount(() => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    void initialize();
    const prewarmQr = () => void loadQrModule();
    if ((window as any).requestIdleCallback) (window as any).requestIdleCallback(prewarmQr, { timeout: 2500 });
    else setTimeout(prewarmQr, 1200);

    const onFocus = () => void sync();
    const onOnline = () => credentials ? void sync() : void initialize();
    const onOffline = () => (online = false);
    const onVisibility = () => { if (document.visibilityState === 'visible') void sync(); scheduleSyncLoop(); };
    const onVerticalScroll = () => (navScrolled = window.scrollY > 1);
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (monthMenuOpen && !target?.closest('.month-slot')) monthMenuOpen = false;
    };
    const onResize = () => {
      const previousMinimum = minimumVisibleDays;
      updateMinimumVisibleDays();
      const requiredDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
      const currentDays = windowEndOffset - windowStartOffset + 1;
      if (minimumVisibleDays > previousMinimum && currentDays < requiredDays && scroller) {
        const add = requiredDays - currentDays;
        const beforeScrollLeft = scroller.scrollLeft;
        windowStartOffset -= add;
        void tick().then(() => {
          if (!scroller) return;
          scroller.scrollLeft = beforeScrollLeft + add * DAY_SIZE;
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
    window.addEventListener('scroll', onVerticalScroll, { passive: true });
    document.addEventListener('pointerdown', onDocumentPointerDown);
    onVerticalScroll();

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
      window.removeEventListener('scroll', onVerticalScroll);
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      if (syncTimer) clearTimeout(syncTimer);
      if (dayTimer) clearTimeout(dayTimer);
      if (flushTimer) clearTimeout(flushTimer);
      cancelScheduledPersistence();
      if (queuePersistTimer) clearTimeout(queuePersistTimer);
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
      <div class="brand-slot"><div class="brand">3tap</div></div>
      <div class="month-slot" aria-label={`Timeline month and year. Currently ${monthOptions[displayMonthIndex]} ${displayYear}`}>
        <div class="month-control">
          <button
            class="month-button"
            aria-label={`Change month. Currently ${monthOptions[displayMonthIndex]}`}
            aria-haspopup="true"
            aria-expanded={monthMenuOpen}
            onclick={toggleMonthMenu}
          >{monthOptions[displayMonthIndex]}</button>
          {#if monthMenuOpen}
            <div class="month-menu" aria-label="Choose month">
              {#each monthOptions as monthName, index}
                <button
                  class="month-option"
                  class:selected={displayMonthIndex === index}
                  aria-pressed={displayMonthIndex === index}
                  onclick={() => chooseMonth(index + 1)}
                >{monthName}</button>
              {/each}
            </div>
          {/if}
        </div>
        {#if yearEditing}
          <input
            class="year-input"
            bind:this={yearInput}
            value={yearDraft}
            aria-label="Jump to year"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="4"
            autocomplete="off"
            oninput={sanitizeYearInput}
            onblur={commitYearEdit}
            onkeydown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') cancelYearEdit();
            }}
          />
        {:else}
          <button class="year-button" aria-label={`Change year. Currently ${displayYear}`} onclick={beginYearEdit}>{displayYear}</button>
        {/if}
      </div>
      <div class="nav-fill">{#if !online}<span class="offline" aria-live="polite">offline</span>{/if}</div>
      <div class="today-slot">
        {#if showTodayButton}
          <button class="nav-today" aria-label="Jump to today" onclick={scrollToToday}>today →</button>
        {/if}
      </div>
    </div>
  </header>

  {#if board}
    <main>
      <div
        class="grid-scroll"
        role="region"
        aria-label="Habit timeline"
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
              <nav class="timeline-controls" aria-label="App controls">
                <button class="tool-icon device-tool" aria-label="Access and devices" title="Access" onclick={openAccess}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="2" width="14" height="20" rx="2.25" class="icon-fill" stroke="none"></rect>
                    <rect x="7" y="4" width="10" height="14" rx=".75" class="icon-cutout" stroke="none"></rect>
                    <circle cx="12" cy="20" r=".8" class="icon-cutout" stroke="none"></circle>
                  </svg>
                </button>
                <button class="tool-icon archive-tool" aria-label="Archive" title="Archive" onclick={openArchived}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="7" width="18" height="14" rx="2" class="icon-fill" stroke="none"></rect>
                    <rect x="2" y="3" width="20" height="5" rx="1.5" class="icon-fill" stroke="none"></rect>
                    <rect x="9" y="11" width="6" height="2" rx="1" class="icon-cutout" stroke="none"></rect>
                  </svg>
                </button>
                <button
                  class="tool-icon theme-toggle"
                  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                  title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
                  onclick={toggleTheme}
                >
                  {#if theme === 'dark'}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" class="icon-fill"></circle>
                      <path d="M12 2v2"></path>
                      <path d="M12 20v2"></path>
                      <path d="m4.93 4.93 1.41 1.41"></path>
                      <path d="m17.66 17.66 1.41 1.41"></path>
                      <path d="M2 12h2"></path>
                      <path d="M20 12h2"></path>
                      <path d="m6.34 17.66-1.41 1.41"></path>
                      <path d="m19.07 4.93-1.41 1.41"></path>
                    </svg>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 9 9 0 1 0 20.2 15.4Z" class="icon-fill" stroke="none"></path>
                    </svg>
                  {/if}
                </button>
              </nav>
            </div>
            <div class="day-head-strip">
              {#each dates as date (date.key)}
                <div
                  class="day-head"
                  class:today={date.key === todayKey}
                  class:enrolled={date.key === enrolledKey}
                  class:prestart={isPreEnrollment(date.key)}
                >
                  <span>{date.weekday}</span>
                  <strong>{date.day}</strong>
                </div>
              {/each}
            </div>
          </div>
          {#if board.habits.length === 0}
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
            </div>
          {:else}
          <table>
            <tbody>
            {#each board.habits as habit, habitIndex (habit.id)}
              <tr
                data-habit-id={habit.id}
                class:dragging={dragActive && draggingHabitId === habit.id}
                animate:flip={{ duration: dragActive ? 120 : 0 }}
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
                        ? `${habit.name}, ${date.key}: before this habit existed`
                        : `${habit.name}, ${date.key}: ${symbols[value]}${editable ? '' : ', locked'}`}
                      onpointerdown={(event) => {
                        if (event.button === 0) tapCell(habit.id, date.key, event.currentTarget);
                      }}
                      onclick={(event) => {
                        if (event.detail === 0) tapCell(habit.id, date.key, event.currentTarget);
                      }}>{prestart ? '·' : symbols[value]}</button>
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
              <td class="add-spacer" colspan={dates.length}>
                <div class="state-legend" aria-label="Habit mark legend">
                  <span><b>·</b> before</span>
                  <span><b>-</b> missed</span>
                  <span><b>|</b> done</span>
                  <span><b>+</b> great</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
          {/if}
        </div>
      </div>
      {#if board.habits.length === 0}
        <section class="zero-tutorial" aria-label="Getting started">
          <ul class="zero-tutorial-list">
            <li><strong>add a habit to start tracking</strong></li>
            <li>tap today to cycle between <b>-</b> missed · <b>|</b> done · <b>+</b> great</li>
            <li>past days stay locked</li>
          </ul>
        </section>
      {/if}
    </main>
  {:else}
    <main></main>
  {/if}

  {#if dragActive}
    <div
      class="habit-drag-preview"
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
        <p>This permanently deletes every habit and all history on every paired device. This device will start with a new empty board.</p>
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
    --today-accent: #168b92;
    --today-fill: rgba(22,139,146,.11);
    --press-fill: rgba(17,17,15,.13);
    --selection-bg: #b8d7ff;
    --selection-text: #0b1b2b;
    --backdrop: rgba(17,17,15,.18);
    --shadow: rgba(17,17,15,.16);
    --nav-shadow: rgba(17,17,15,.08);
    --icon-device: #225866;
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
    --press-fill: rgba(255,255,248,.16);
    --selection-bg: #315f8f;
    --selection-text: #ffffff;
    --backdrop: rgba(0,0,0,.5);
    --shadow: rgba(0,0,0,.42);
    --nav-shadow: rgba(0,0,0,.28);
    --icon-device: #225866;
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
  :global(html.habit-dragging-cursor),
  :global(html.habit-dragging-cursor *) { cursor: grabbing !important; }
  :global(html.timeline-panning-cursor),
  :global(html.timeline-panning-cursor *) { cursor: grabbing !important; }

  .shell {
    --day-size: 48px;
    --habit-width: calc(var(--day-size) * 3);
    --line: 1px;
    --grid: var(--grid-weak-theme);
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
    position: relative;
    height: calc(var(--day-size) + env(safe-area-inset-top));
    min-height: calc(var(--day-size) + env(safe-area-inset-top));
    display: grid;
    grid-template-columns: var(--habit-width) calc(var(--day-size) * 2) minmax(0, 1fr) calc(var(--day-size) * 2);
    align-items: stretch;
    width: 100%;
    padding-top: env(safe-area-inset-top);
    background: var(--bg);
    border-bottom: var(--line) solid var(--grid);
  }
  .navbar::after {
    content: '';
    position: absolute;
    z-index: 2;
    top: 0;
    bottom: 0;
    left: var(--habit-width);
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .brand-slot,
  .month-slot,
  .nav-fill,
  .today-slot {
    min-width: 0;
    height: var(--day-size);
    display: flex;
    align-items: center;
  }
  .brand-slot { padding-left: var(--page-inset); }
  .brand {
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: lowercase;
    opacity: .5;
  }
  .month-slot {
    position: relative;
    width: 100%;
    justify-content: center;
    gap: 6px;
    padding: 0;
    overflow: visible;
    color: var(--text);
    font-size: 10px;
    letter-spacing: 0;
    text-align: center;
    white-space: nowrap;
  }
  .nav-fill { justify-content: flex-end; padding-right: 8px; }
  .today-slot { justify-content: flex-end; padding-right: var(--page-inset); }
  .offline { font-size: 10px; opacity: .45; white-space: nowrap; }
  button { border: 0; background: none; padding: 0; cursor: pointer; }
  .month-button,
  .year-button,
  .nav-today {
    height: auto;
    min-height: 0;
    border: 0;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    padding: 2px 0 3px;
    background: transparent;
    color: var(--control-text);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    opacity: 1;
    white-space: nowrap;
  }
  .month-control {
    position: relative;
    width: 3.2em;
    flex: none;
  }
  .month-button { width: 100%; text-align: center; }
  .year-button { width: 4ch; text-align: center; }
  .nav-today { width: auto; text-align: right; }
  .year-input {
    width: 4ch;
    min-width: 4ch;
    height: auto;
    min-height: 0;
    margin: 0;
    border: 0;
    border-bottom: 1px solid var(--control-active);
    border-radius: 0;
    outline: none;
    box-shadow: none;
    appearance: none;
    -webkit-appearance: none;
    display: block;
    padding: 2px 0 3px;
    background: transparent;
    color: var(--control-active);
    font: inherit;
    font-size: 10px;
    line-height: 1;
    opacity: 1;
    text-align: center;
    caret-color: currentColor;
  }
  .month-menu {
    position: absolute;
    z-index: 80;
    top: 100%;
    left: 0;
    width: 100%;
    max-height: min(432px, calc(100dvh - (var(--day-size) * 2) - 12px));
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    -ms-overflow-style: none;
    background: var(--bg);
    border: var(--line) solid var(--grid);
  }
  .month-menu::-webkit-scrollbar { display: none; }
  .month-option {
    width: 100%;
    height: 36px;
    display: grid;
    place-items: center;
    border-bottom: var(--line) solid var(--grid);
    background: var(--bg);
    color: var(--control-text);
    font-size: 10px;
    line-height: 1;
    text-align: center;
  }
  .month-option:last-child { border-bottom: 0; }
  .month-option.selected {
    background: var(--today-fill);
    color: var(--control-active);
  }
  .month-option:focus-visible {
    outline: 1px solid var(--control-active);
    outline-offset: -2px;
    color: var(--control-active);
  }
  .month-button:focus-visible,
  .year-button:focus-visible,
  .nav-today:focus-visible {
    outline: none;
    color: var(--control-active);
    border-bottom-color: var(--control-active);
  }
  @media (hover: hover) and (pointer: fine) {
    :global(html:not(.habit-dragging-cursor)) .tool-icon:hover::before { opacity: .12; }
    :global(html:not(.habit-dragging-cursor)) .panel-button:not(:disabled):hover { background: var(--hover); border-color: var(--grid); }
    :global(html:not(.habit-dragging-cursor)) .panel-button-danger:not(:disabled):hover { color: var(--danger); }
    :global(html:not(.habit-dragging-cursor)) .close:hover { color: var(--text); background: var(--hover); border-color: var(--border); }
    :global(html:not(.habit-dragging-cursor)) .month-button:hover,
    :global(html:not(.habit-dragging-cursor)) .year-button:hover,
    :global(html:not(.habit-dragging-cursor)) .nav-today:hover {
      color: var(--control-active);
      border-bottom-color: var(--control-active);
    }
    :global(html:not(.habit-dragging-cursor)) .month-option:hover { background: var(--hover); color: var(--control-active); }
    :global(html:not(.habit-dragging-cursor)) .habit-controls button:not(:disabled):hover { opacity: 1; }
    :global(html:not(.habit-dragging-cursor)) .cell:not(:disabled):hover { background: var(--hover); }
    .grid-scroll { cursor: grab; }
    .habit-name { cursor: grab; }
  }

  main { width: 100%; padding-bottom: 24px; }
  .grid-scroll {
    position: relative;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    touch-action: pan-y;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: auto;
    scroll-behavior: auto;
  }
  .grid-scroll::-webkit-scrollbar { display: none; }
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
    right: calc(-1 * var(--line));
    width: var(--line);
    background: var(--grid);
    pointer-events: none;
  }
  .timeline-controls {
    width: 100%;
    height: var(--day-size);
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
  .device-tool { color: var(--icon-device); }
  .archive-tool { color: var(--icon-archive); }
  .theme-toggle { color: var(--icon-theme); }
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

  .day-head-strip {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: stretch;
    width: max-content;
  }
  .day-head {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
    height: var(--day-size);
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 2px;
    font-size: 10px;
    background: transparent;
  }
  .day-head span,
  .day-head strong {
    display: block;
    color: var(--timeline-text);
    font-weight: 400;
    line-height: 1.15;
    opacity: 1;
  }
  .day-head strong { font-size: 11px; }
  .day-head.today { background: var(--today-fill); }
  .day-head.today span,
  .day-head.today strong {
    color: var(--today-accent);
    opacity: 1;
  }
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
    right: calc(-1 * var(--line));
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
    grid-template-columns: 36px;
    align-items: center;
    justify-items: center;
    margin-left: auto;
  }
  .habit-controls button {
    width: 36px;
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
  .habit-controls .delete-habit { color: var(--control-text); }
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
    box-sizing: border-box;
    padding: 0 8px 0 var(--page-inset);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border), 0 10px 28px var(--shadow);
    font-size: 12px;
    font-weight: 500;
    pointer-events: none;
    will-change: top;
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
    width: 100%;
    height: var(--day-size);
    touch-action: pan-y;
    cursor: default;
  }
  .zero-add-row * { touch-action: pan-y; }
  .zero-add-row button { cursor: pointer; }
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
  .zero-tutorial-list {
    width: max-content;
    max-width: 100%;
    margin: 0 auto;
    padding-left: 18px;
    display: grid;
    gap: 7px;
    text-align: left;
  }
  .zero-tutorial-list li::marker { color: var(--muted); }
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
    height: var(--day-size);
    border: 0;
    background: transparent;
  }
  .add-row,
  .add-row * {
    touch-action: pan-y;
    cursor: default;
  }
  .add-row button { cursor: pointer; }
  .state-legend {
    position: sticky;
    right: 0;
    width: max-content;
    height: var(--day-size);
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    padding: 0 var(--page-inset) 0 12px;
    background: var(--bg);
    color: var(--muted);
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    opacity: .62;
    pointer-events: none;
  }
  .state-legend span {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-size: inherit;
  }
  .state-legend b {
    color: var(--timeline-mark);
    font-size: inherit;
    font-weight: 500;
  }
  .add-habit {
    width: 100%;
    height: 100%;
    font-size: 11px;
    opacity: .64;
    text-align: left;
  }
  .add-input { width: 100%; }
  td { text-align: center; background: transparent; }
  .today { background: var(--today-fill); }
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
  td.prestart .cell {
    font-size: 18px;
    line-height: 1;
  }
  .cell.plus { font-weight: 750; font-size: 17px; }
  .cell:disabled { pointer-events: none; }
  td.today .cell {
    color: var(--today-accent);
    opacity: 1;
  }
  .cell:not(:disabled):active { background: var(--press-fill); }

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
