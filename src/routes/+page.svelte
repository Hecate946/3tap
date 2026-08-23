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
    getCachedBoard,
    getCredentials,
    getQueue,
    setCachedBoard,
    setCredentials,
    setQueue,
    type PendingEntry
  } from '$lib/client';

  type DayColumn = { key: string; weekday: string; day: number; month: string; year: number };

  // One-time 2026-08-23 clean-slate reset. This mirrors the production DB
  // reset migration so stale anonymous-board credentials/habits cannot survive
  // in a returning browser after their server-side board has been removed.
  const CLIENT_RESET_VERSION = '2026-08-23-clean-slate-v1';
  if (browser && localStorage.getItem('3tap.client-reset') !== CLIENT_RESET_VERSION) {
    clearLocalBoard();
    localStorage.setItem('3tap.client-reset', CLIENT_RESET_VERSION);
  }

  let board: Board | null = browser ? getCachedBoard() : null;
  let credentials: Credentials | null = browser ? getCredentials() : null;
  let loading = !board;
  let online = true;
  let theme: 'light' | 'dark' = 'light';
  let navScrolled = false;
  let panel: 'none' | 'access' | 'archived' | 'delete' | 'clear' | 'delete-board' = 'none';
  let qrDataUrl = '';
  let pairingLink = '';
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
  let pendingHabitSave: Habit[] | null = null;
  let scroller: HTMLDivElement;
  let currentDay = new Date();
  let windowEndOffset = 0;
  let visibleMonthLabel = `${new Intl.DateTimeFormat(undefined, { month: 'short' }).format(currentDay).toUpperCase()} ${currentDay.getFullYear()}`;
  let displayMonthIndex = currentDay.getMonth();
  let displayYear = currentDay.getFullYear();
  let monthMenuOpen = false;
  let yearEditing = false;
  let yearDraft = String(currentDay.getFullYear());
  let yearInput: HTMLInputElement;
  const monthOptions = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  let showTodayButton = false;
  let shiftingWindow = false;
  let scrollRaf = 0;
  const WINDOW_DAYS = 84;
  const WINDOW_SHIFT = 7;
  let minimumVisibleDays = 32;
  // Pre-start calendar columns are visual scaffolding only. They are never
  // stored or editable, and the timeline may extend backward through them forever.
  let historyIntroWidth = 0;
  const pendingByCell = new Map<string, PendingEntry>();
  // Tap-local values deliberately stay outside Svelte reactivity. The tapped
  // cell is painted synchronously, while the habit-name column is left completely
  // untouched until a real background sync arrives.
  const localTapValues = new Map<string, PendingEntry>();
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
      const key = cellKey(change.habitId, change.date);
      pendingByCell.set(key, change);
      localTapValues.set(key, change);
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

  function datesForWindow(source: Board | null, endDay: Date, endOffset: number): DayColumn[] {
    if (!enrollmentDate(source)) return [];

    const end = shiftedDate(endDay, endOffset);
    // Keep a generously overlapping moving window. There is intentionally no
    // enrollment-date clamp: dates before signup are calendar scaffolding, so
    // the user can keep scrolling backward indefinitely.
    const windowDays = Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT);
    const start = shiftedDate(end, -(windowDays - 1));
    const days: DayColumn[] = [];
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
    const month = new Intl.DateTimeFormat(undefined, { month: 'short' });

    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      days.push({
        key: dateKey(cursor),
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

    localTapValues.set(cellKey(habitId, date), change);
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
      if (response.status === 404) {
        // A board deleted from another paired device should not leave this
        // device stranded on a stale local copy. Start a fresh blank board.
        clearLocalBoard();
        credentials = null;
        board = null;
        pendingByCell.clear();
        localTapValues.clear();
        pendingHabitSave = null;
        entries.clear();
        await createBoard();
        await tick();
        await scrollToToday();
        return;
      }
      if (response.status === 401) return;
      throw new Error(await response.text());
    }

    const remoteBoard: Board = await response.json();
    board = pendingHabitSave
      ? { ...remoteBoard, habits: pendingHabitSave, archivedHabits: board?.archivedHabits ?? remoteBoard.archivedHabits }
      : remoteBoard;
    hydrateEntries(board);
    for (const [key] of localTapValues) {
      if (!pendingByCell.has(key)) localTapValues.delete(key);
    }
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
    const dayHead = scroller.querySelector<HTMLElement>('.timeline-header .day-head');
    const habitHead = scroller.querySelector<HTMLElement>('.timeline-header .timeline-side');
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
    // Kept as a no-op so the existing scroll code stays simple. Empty timeline
    // space is now filled with muted pre-start date columns instead of a spacer.
    if (historyIntroWidth !== 0) {
      historyIntroWidth = 0;
      return true;
    }
    return false;
  }

  function setVisibleMonthState(year: number, month: number) {
    const safeMonth = Math.max(1, Math.min(12, month));
    displayYear = year;
    displayMonthIndex = safeMonth - 1;
    visibleMonthLabel = `${monthOptions[safeMonth - 1]} ${year}`;
  }

  function updateTimelineStatus() {
    if (!scroller || !dates.length) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    // The month label describes the first visible calendar column, which makes
    // its placement directly beside the habit/timeline divider feel literal.
    const index = Math.max(0, Math.min(dates.length - 1, Math.floor(scroller.scrollLeft / metrics.dayWidth)));
    const date = dates[index];
    setVisibleMonthState(date.year, Number(date.key.slice(5, 7)));

    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    showTodayButton = windowEndOffset < 0 || rightGap > 2;
  }

  async function shiftTimelineWindow(delta: number, metrics: { dayWidth: number; habitWidth: number }) {
    if (!scroller || delta === 0) return;

    // Recycle a fixed number of calendar columns and compensate by the exact
    // same pixel width. If a desktop pointer-drag is active, move its baseline
    // by the same amount; otherwise the next pointermove would undo the
    // compensation and trigger rapid repeated recycling (the apparent speed-up).
    windowEndOffset += delta;
    await tick();
    const beforeCompensation = scroller.scrollLeft;
    const compensation = -delta * metrics.dayWidth;
    scroller.scrollLeft = Math.max(0, beforeCompensation + compensation);
    const appliedCompensation = scroller.scrollLeft - beforeCompensation;
    if (timelinePanPointerId !== null) timelinePanStartScrollLeft += appliedCompensation;
  }

  async function maintainTimelineWindow() {
    if (!scroller || shiftingWindow) return;
    const metrics = timelineMetrics();
    if (!metrics) return;

    const threshold = metrics.dayWidth * 6;
    const rightGap = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;

    if (scroller.scrollLeft < threshold && dates.length) {
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
    if (target?.closest('.habit-name, .timeline-side, input, textarea, button:not(:disabled)')) return;

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

    // Update the control immediately. The timeline jump below will reconcile
    // the visible month from the actual scroller position once it finishes.
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

    // Merely leaving the year field must not move the timeline. This is
    // especially important when the next click is the month control.
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

    // End the moving window just far enough after the selected month start to
    // place that date at the left edge of the visible timeline.
    windowEndOffset = Math.min(0, targetOffset + visibleDays - 1);
    await tick();

    const targetKey = dateKey(target);
    const targetIndex = dates.findIndex((date) => date.key === targetKey);
    if (targetIndex >= 0) scroller.scrollLeft = targetIndex * metrics.dayWidth;
    else scroller.scrollLeft = 0;

    updateTimelineStatus();
    // Keep the picker synchronized with the month the user explicitly chose.
    // Manual scrolling will take over again on the next scroll event.
    setVisibleMonthState(year, month);
    yearDraft = String(year);
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

  async function openAccess() {
    if (!credentials) return;
    pairingCopied = false;
    recoveryInput = `${credentials.boardId}.${credentials.secret}`;
    restoreCodeInput = '';
    recoveryError = '';
    recoveryCopied = false;
    recovering = false;
    deleteBoardError = '';
    panel = 'access';

    // Give the new device the freshest server state we can before pairing.
    // The pairing link itself remains usable even if a background sync fails.
    if (navigator.onLine) {
      await flushHabitChanges();
      await flushQueue();
    }

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
      // Plain-text API errors are valid too.
    }
    return detail;
  }

  async function deleteHabitForever() {
    if (!credentials || !board || !deleteHabitTarget || deletingHabit) return;
    const target = deleteHabitTarget;
    deletingHabit = true;
    archiveError = '';

    try {
      const response = await fetch(`/api/boards/${credentials.boardId}/habits/${target.id}`, {
        method: 'DELETE',
        headers: authHeaders(credentials)
      });

      // A 404 means the server already removed it, so local state can safely
      // converge to the same result instead of trapping the confirmation UI.
      if (!response.ok && response.status !== 404) {
        throw new Error(await apiErrorMessage(response, `Delete failed (${response.status})`));
      }

      board = {
        ...board,
        archivedHabits: (board.archivedHabits ?? []).filter((habit) => habit.id !== target.id),
        entries: (board.entries ?? []).filter((entry) => entry.habitId !== target.id)
      };
      hydrateEntries(board);
      pendingHabitSave = null;
      deleteHabitTarget = null;
      persistLocalStateNow();
      panel = 'archived';

      // Reconcile quietly with the canonical board after the modal has already
      // returned to Archive. This keeps the UI responsive and avoids depending
      // on a particular DELETE response body shape.
      void fetchBoard(true).catch(() => {});
    } catch (error) {
      archiveError = error instanceof Error ? error.message : 'could not delete · retry';
    } finally {
      deletingHabit = false;
    }
  }

  async function clearArchive() {
    if (!credentials || !board || clearingArchive) return;
    const archived = [...(board.archivedHabits ?? [])];
    if (!archived.length) {
      panel = 'archived';
      return;
    }

    clearingArchive = true;
    archiveError = '';
    try {
      for (const habit of archived) {
        const response = await fetch(`/api/boards/${credentials.boardId}/habits/${habit.id}`, {
          method: 'DELETE',
          headers: authHeaders(credentials)
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(await apiErrorMessage(response, `Delete failed (${response.status})`));
        }
      }

      const archivedIds = new Set(archived.map((habit) => habit.id));
      board = {
        ...board,
        archivedHabits: [],
        entries: (board.entries ?? []).filter((entry) => !archivedIds.has(entry.habitId))
      };
      hydrateEntries(board);
      pendingHabitSave = null;
      persistLocalStateNow();
      panel = 'archived';
      void fetchBoard(true).catch(() => {});
    } catch (error) {
      archiveError = error instanceof Error ? error.message : 'could not clear archive · retry';
    } finally {
      clearingArchive = false;
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

  function parseRecoveryCode(raw: string): Credentials | null {
    const token = raw.trim().replace(/^.*#/, '');
    const separator = token.indexOf('.');
    if (separator < 1) return null;
    const boardId = token.slice(0, separator).trim();
    const secret = token.slice(separator + 1).trim();
    if (!boardId || secret.length < 20) return null;
    return { boardId, secret };
  }

  async function useRecoveryCode() {
    if (recovering) return;
    recoveryError = '';
    const next = parseRecoveryCode(restoreCodeInput);
    if (!next) {
      recoveryError = 'Enter a complete recovery code.';
      return;
    }
    if (!navigator.onLine) {
      recoveryError = 'Connect to the internet to verify this code.';
      return;
    }

    recovering = true;
    try {
      // Validate first. Never replace this device's current credentials with an
      // unverified code.
      const response = await fetch(`/api/boards/${encodeURIComponent(next.boardId)}`, {
        headers: authHeaders(next)
      });
      if (response.status === 401 || response.status === 404) {
        recoveryError = 'That recovery code is not valid.';
        return;
      }
      if (!response.ok) throw new Error(await response.text());

      const recoveredBoard: Board = await response.json();

      // Commit the board switch only after successful verification so a typo can
      // never strand the device on invalid credentials or stale cached data.
      credentials = next;
      board = recoveredBoard;
      setCredentials(next);
      setCachedBoard(recoveredBoard);
      setQueue([]);
      pendingByCell.clear();
      localTapValues.clear();
      pendingHabitSave = null;
      entries.clear();
      hydrateEntries(recoveredBoard);
      qrDataUrl = '';
      pairingLink = '';
      panel = 'none';
      await tick();
      await scrollToToday();
    } catch {
      recoveryError = 'Could not verify that code. Try again.';
    } finally {
      recovering = false;
    }
  }

  async function copyRecoveryCode() {
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
    deletingBoard = true;
    deleteBoardError = '';

    try {
      const response = await fetch(`/api/boards/${encodeURIComponent(credentials.boardId)}`, {
        method: 'DELETE',
        headers: authHeaders(credentials)
      });
      if (!response.ok) {
        const raw = await response.text();
        let message = raw;
        try {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.message === 'string') message = parsed.message;
        } catch {}
        throw new Error(message || 'Could not delete this board.');
      }

      // Remove every local reference before reloading. The normal bootstrap
      // will create a new empty anonymous board on this device.
      clearLocalBoard();
      pendingByCell.clear();
      localTapValues.clear();
      pendingHabitSave = null;
      entries.clear();
      location.reload();
    } catch (error) {
      deleteBoardError = error instanceof Error && error.message
        ? error.message
        : 'Could not delete this board. Try again.';
      deletingBoard = false;
    }
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

  async function initialize() {
    online = navigator.onLine;

    // Re-read only when the page did not already bootstrap from local storage.
    if (!credentials) credentials = getCredentials();
    if (!board) board = getCachedBoard();

    pendingByCell.clear();
    localTapValues.clear();
    for (const change of compactQueue(getQueue())) {
      const key = cellKey(change.habitId, change.date);
      pendingByCell.set(key, change);
      localTapValues.set(key, change);
    }
    if (!credentials) {
      pendingByCell.clear();
      localTapValues.clear();
    }
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
    theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    void initialize();

    const onFocus = () => void sync();
    const onOnline = () => credentials ? void sync() : void initialize();
    const onOffline = () => (online = false);
    const onVisibility = () => document.visibilityState === 'visible' && void sync();
    const onVerticalScroll = () => (navScrolled = window.scrollY > 1);
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (monthMenuOpen && !target?.closest('.month-slot')) monthMenuOpen = false;
    };
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
    document.addEventListener('pointerdown', onDocumentPointerDown);
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
      document.removeEventListener('pointerdown', onDocumentPointerDown);
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
      <div class="brand-slot"><div class="brand">3tap</div></div>
      <div class="month-slot" aria-label={`Timeline month and year. Currently ${visibleMonthLabel}`}>
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
                  <!-- Lucide-inspired filled Smartphone -->
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="2" width="14" height="20" rx="2.25" class="icon-fill" stroke="none"></rect>
                    <rect x="7" y="4" width="10" height="14" rx=".75" class="icon-cutout" stroke="none"></rect>
                    <circle cx="12" cy="20" r=".8" class="icon-cutout" stroke="none"></circle>
                  </svg>
                </button>
                <button class="tool-icon archive-tool" aria-label="Archive" title="Archive" onclick={openArchived}>
                  <!-- Lucide-inspired filled Archive -->
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
                    <!-- Lucide: Sun -->
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
                    <!-- Lucide-inspired filled Moon -->
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 9 9 0 1 0 20.2 15.4Z" class="icon-fill" stroke="none"></path>
                    </svg>
                  {/if}
                </button>
              </nav>
            </div>
            {#if historyIntroWidth > 0}
              <div
                class="history-head-spacer"
                style={`width:${historyIntroWidth}px; min-width:${historyIntroWidth}px; max-width:${historyIntroWidth}px`}
                aria-hidden="true"
              ></div>
            {/if}
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
              {#if historyIntroWidth > 0}
                <td
                  class="history-intro-add-spacer"
                  style={`width:${historyIntroWidth}px; min-width:${historyIntroWidth}px; max-width:${historyIntroWidth}px`}
                  aria-hidden="true"
                ></td>
              {/if}
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
          <strong>add a habit to start tracking</strong>
          <span>tap today to cycle between</span>
          <div class="zero-state-key" aria-label="Habit states">
            <span><b>-</b> missed</span>
            <span><b>|</b> done</span>
            <span><b>+</b> great</span>
          </div>
          <span>past days stay locked</span>
        </section>
      {/if}
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
          <div class="panel-label">your backup key</div>
          <p class="section-help">Keep this somewhere safe. If you lose every device, this little key brings your board back.</p>
          <div class="code-box">
            <code>{recoveryInput}</code>
          </div>
          <button class="panel-button" onclick={copyRecoveryCode}>{recoveryCopied ? 'copied ✓' : 'copy key'}</button>
        </div>

        <div class="panel-divider"></div>

        <div class="access-section">
          <label class="panel-label" for="restore-code">have another key?</label>
          <p class="section-help">Paste a backup key from another board. Only this device will switch.</p>
          <textarea
            id="restore-code"
            class="restore-code-input"
            bind:value={restoreCodeInput}
            rows="2"
            spellcheck="false"
            autocomplete="off"
            placeholder="paste backup key"
            oninput={() => (recoveryError = '')}
          ></textarea>
          {#if recoveryError}<p class="recovery-error" role="alert">{recoveryError}</p>{/if}
          <button class="panel-button panel-button-primary" disabled={recovering || !restoreCodeInput.trim()} onclick={useRecoveryCode}>
            {recovering ? 'checking…' : 'open board'}
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
    --grid-strong-theme: #a9aaa3;
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
    --icon-device: #4d7fa8;
    --icon-device-hover: #3e7099;
    --icon-archive: #c96f45;
    --icon-archive-hover: #c96f45;
    --icon-recovery: #805bb5;
    --icon-recovery-hover: #6f49a5;
    --icon-theme: #b18a22;
    --icon-theme-hover: #957317;
    --danger: #9b332b;
    background: var(--bg);
    color-scheme: light;
  }
  :global(html[data-theme='dark']) {
    --bg: #0e1112;
    --surface: #15191a;
    --text: #ecece6;
    --muted: #afb0a9;
    --control-text: #c8c9c2;
    --control-active: #f2f2ec;
    --grid-weak-theme: #293031;
    --grid-strong-theme: #505a5b;
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
    --icon-device: #79a5c8;
    --icon-device-hover: #91b8d7;
    --icon-archive: #dd8757;
    --icon-archive-hover: #dd8757;
    --icon-recovery: #ad83d7;
    --icon-recovery-hover: #c09be2;
    --icon-theme: #d7ba58;
    --icon-theme-hover: #e6cd76;
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
    --habit-width: calc(var(--day-size) * 4);
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
    .tool-icon:hover::before {
      border-color: var(--grid-strong);
      background: var(--hover);
    }
    .panel-button:not(:disabled):hover { background: var(--hover); border-color: var(--grid-strong); }
    .panel-button-danger:not(:disabled):hover { color: var(--danger); }
    .close:hover { color: var(--text); background: var(--hover); border-color: var(--border); }
    .month-button:hover,
    .year-button:hover,
    .nav-today:hover {
      color: var(--control-active);
      border-bottom-color: var(--control-active);
    }
    .month-option:hover { background: var(--hover); color: var(--control-active); }
    .habit-controls button:not(:disabled):hover { opacity: 1; }
    .cell:not(:disabled):hover { background: var(--hover); }
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
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
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
    transition: transform 110ms ease;
  }
  .tool-icon::before {
    content: '';
    position: absolute;
    width: 36px;
    height: 36px;
    border: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    pointer-events: none;
    transition: border-color 110ms ease, background-color 110ms ease;
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
  .tool-icon:active { transform: scale(.92); }

  .day-head-strip {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: stretch;
    width: max-content;
  }
  .history-head-spacer {
    height: var(--day-size);
    background: transparent;
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
  td:not(.history-intro-row):not(.history-intro-add-spacer) {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
  }
  .history-intro-row {
    position: relative;
    height: var(--day-size);
    padding: 0;
    background: var(--bg);
  }
  .history-intro-add-spacer {
    height: var(--day-size);
    padding: 0;
    border: 0;
    background: var(--bg);
  }
  /* Vertical rules begin at the first habit row and never enter the header band. */
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
  .zero-add-row {
    width: 100%;
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
    width: min(420px, calc(100% - (var(--page-inset) * 2)));
    margin: 28px auto 0;
    display: grid;
    justify-items: center;
    gap: 7px;
    padding: 8px 0 24px;
    color: var(--muted);
    text-align: center;
    font-size: 10px;
    line-height: 1.45;
  }
  .zero-tutorial strong {
    margin-bottom: 2px;
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }
  .zero-state-key {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 16px;
    min-height: 18px;
  }
  .zero-state-key span {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
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
  /* Every non-today timeline column uses the same color treatment. */
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
  .panel-button-primary { border-color: var(--grid-strong); }
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
  .restore-code-input:focus { border-color: var(--grid-strong); }
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
