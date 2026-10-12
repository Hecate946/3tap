<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { flip } from 'svelte/animate';
  import { SvelteMap } from 'svelte/reactivity';
  import type { Board, Entry, Habit, MarkValue, Thought } from '$lib/types';
  import { createDevFixture } from '$lib/dev/fixtures';
  import { loadBoard, saveBoard } from '$lib/storage';

  type DayColumn = { key: string; weekday: string; day: number; month: number; year: number };
  const requestedFixture = browser && import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get('fixture')
    : null;
  const fixtureBoard = requestedFixture ? createDevFixture(requestedFixture) : null;
  const fixtureMode = fixtureBoard !== null;

  let board: Board | null = fixtureBoard;
  let ready = fixtureMode;
  let theme: 'light' | 'dark' = 'light';
  let view: 'today' | 'habits' | 'thoughts' = 'today';
  const LAST_VIEW_KEY = '3tap.view';
  let editingHabitId: string | null = null;
  let editingHabitName = '';
  let addingHabit = false;
  let confirmingClearHistory = false;
  // History opens in read-only mode; entering edit mode is always intentional.
  let historyEditing = false;
  let newHabitName = '';
  let editHabitInput: HTMLInputElement;
  let newHabitInput: HTMLInputElement;
  let editingThoughtId: string | null = null;
  let editingThoughtText = '';
  let addingThought = false;
  let newThoughtText = '';
  let editThoughtInput: HTMLInputElement;
  let newThoughtInput: HTMLInputElement;
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
  const WINDOW_DAYS = 14;
  const WINDOW_SHIFT = 7;
  let viewportWidth = browser ? window.innerWidth : 1024;

  // The history sidebar only needs enough room for the heading or the longest habit
  // plus its reorder/delete controls. Keep at least two day cells visible on phones.
  function historySidebarWidth(habits: Habit[], width: number) {
    const measuringContext = browser ? document.createElement('canvas').getContext('2d') : null;
    if (measuringContext) measuringContext.font = '500 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
    const textWidth = (text: string) => measuringContext
      ? measuringContext.measureText(text).width
      : text.length * 7.25;
    const titleWidth = textWidth('HISTORY') + 32;
    const nameWidth = Math.max(0, ...habits.map((habit) => textWidth(habit.name)));
    const fullWidth = Math.ceil(Math.max(88, titleWidth, nameWidth + 91));
    return Math.min(fullWidth, Math.max(88, width - DAY_SIZE * 2));
  }
  let habitWidth = historySidebarWidth(board?.habits ?? [], viewportWidth);
  $: habitWidth = historySidebarWidth(board?.habits ?? [], viewportWidth);
  let minimumVisibleDays = browser
    ? Math.max(1, Math.ceil((viewportWidth - habitWidth) / DAY_SIZE) + 1)
    : 32;
  let windowStartOffset = -(Math.max(WINDOW_DAYS, minimumVisibleDays + WINDOW_SHIFT) - 1);
  let dayTimer: ReturnType<typeof setTimeout> | undefined;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistPromise = Promise.resolve();
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
  // Resolve a press at pointerup, before browsers dispatch their synthetic click.
  // This makes a single stationary press edit immediately, while a moving pointer
  // still pans the calendar without accidentally modifying a mark.
  const TIMELINE_DRAG_THRESHOLD = 7;
  let timelineGesture: {
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    startScrollLeft: number;
    pressedCell: HTMLButtonElement | null;
    moved: boolean;
  } | null = null;
  let timelinePanActive = false;
  let timelineTouchId: number | null = null;
  let timelineTouchStartX = 0;
  let timelineTouchStartY = 0;
  let timelineTouchStartScrollLeft = 0;
  let timelineTouchAxis: '' | 'x' | 'y' = '';

  const entries = new SvelteMap<string, Entry>();
  // Trigger legacy-component updates when a mark changes inside SvelteMap.
  let marksRevision = 0;
  $: historyMarkCount = (marksRevision, entries.size);
  const symbols: Record<MarkValue, string> = { 0: '-', 1: '|', 2: '+' };
  for (const entry of board?.entries ?? []) {
    if (entry.value !== 0) entries.set(cellKey(entry.habitId, entry.date), entry);
  }
  if (board) board.entries = [];

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
    const yesterday = shiftedDate(currentDay, -1);
    if (!board?.habits.length) return yesterday;

    const boardStart = enrollmentDate(board);
    let oldest: Date | null = null;
    for (const habit of board.habits) {
      const created = habit.createdAt ? new Date(habit.createdAt) : boardStart;
      if (!created || Number.isNaN(created.getTime())) continue;
      const start = new Date(created.getFullYear(), created.getMonth(), created.getDate(), 12);
      if (!oldest || start < oldest) oldest = start;
    }

    const activeStart = oldest ?? boardStart;
    return activeStart && activeStart < yesterday ? activeStart : yesterday;
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

  function canEditCell(date: string) {
    return view === 'habits'
      ? historyEditing && date <= todayKey
      : isEditableDate(date);
  }

  function hydrateEntries(source: Board | null) {
    entries.clear();
    for (const entry of source?.entries ?? []) {
      if (entry.value !== 0) entries.set(cellKey(entry.habitId, entry.date), entry);
    }
  }

  function valueFor(habitId: string, date: string, revision?: number): MarkValue {
    void revision;
    return (entries.get(cellKey(habitId, date))?.value ?? 0) as MarkValue;
  }

  function snapshotBoard(): Board | null {
    if (!board) return null;
    return {
      ...board,
      updatedAt: new Date().toISOString(),
      entries: [...entries.values()]
    };
  }

  function persistLocalStateNow() {
    if (fixtureMode) return persistPromise;
    const snapshot = snapshotBoard();
    if (!snapshot) return persistPromise;
    persistPromise = persistPromise
      .catch(() => undefined)
      .then(() => saveBoard(snapshot))
      .catch((error) => console.error('3tap could not save local data', error));
    return persistPromise;
  }

  function cancelScheduledPersistence() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
  }

  function schedulePersistence() {
    if (fixtureMode) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      void persistLocalStateNow();
    }, 40);
  }

  function tapCell(habitId: string, date: string, button?: HTMLButtonElement) {
    if (!canEditCell(date)) return;
    const current = valueFor(habitId, date);
    const next = ((current + 1) % 3) as MarkValue;
    const key = cellKey(habitId, date);
    if (next === 0) entries.delete(key);
    else entries.set(key, { habitId, date, value: next as 1 | 2 });
    marksRevision += 1;

    if (button) {
      button.textContent = symbols[next];
      button.classList.toggle('plus', next === 2);
      button.setAttribute('aria-label', `${date}: ${symbols[next]}`);
    }

    schedulePersistence();
  }

  function timelineMetrics() { return { dayWidth: DAY_SIZE, habitWidth }; }

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
    if (timelineGesture?.pointerType === 'mouse') timelineGesture.startScrollLeft += compensation;
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
    if (view !== 'habits' || !scroller || dragActive || !event.isPrimary ||
        (event.pointerType === 'mouse' && event.button !== 0)) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.habit-name, .timeline-side, input, textarea, button:not(.cell)')) return;

    // Track the exact cell where the press began. Do not call preventDefault,
    // since mouse, touch and assistive inputs must all remain accessible.
    timelinePanActive = false;
    timelineGesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller.scrollLeft,
      pressedCell: target?.closest<HTMLButtonElement>('button.cell:not(:disabled)') ?? null,
      moved: false
    };
  }

  function moveTimelinePan(event: PointerEvent) {
    const gesture = timelineGesture;
    if (!gesture || !scroller || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) < TIMELINE_DRAG_THRESHOLD && !gesture.moved) return;

    // Once the pointer moves past the threshold, this gesture can only scroll.
    // Never allow pointerup or the browser's subsequent click to edit the cell.
    gesture.moved = true;
    if (gesture.pointerType !== 'mouse') return; // the touch listeners scroll
    if (!timelinePanActive) {
      if (Math.abs(dx) <= Math.abs(dy)) return;
      timelinePanActive = true;
      document.documentElement.classList.add('timeline-panning-cursor');
      scroller.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    scroller.scrollLeft = gesture.startScrollLeft - dx;
  }

  function endTimelinePan(event: PointerEvent) {
    const gesture = timelineGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    // Keep the original pressed cell so an ordinary tap can finish even if
    // Svelte has re-rendered a neighboring cell while the pointer was down.
    const cell = gesture.pressedCell;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const isTap = event.type === 'pointerup' && !gesture.moved &&
      Math.hypot(dx, dy) < TIMELINE_DRAG_THRESHOLD && !timelinePanActive;

    if (scroller && timelinePanActive && scroller.hasPointerCapture?.(event.pointerId)) {
      scroller.releasePointerCapture(event.pointerId);
    }
    timelineGesture = null;
    timelinePanActive = false;
    document.documentElement.classList.remove('timeline-panning-cursor');

    // Do not depend on a synthetic click (which may be delayed or cancelled by
    // scrolling). Commit once, immediately on pointerup, and only on the cell
    // pressed originally. Keyboard activation is handled separately below.
    if (isTap && cell && !cell.disabled) {
      const bounds = cell.getBoundingClientRect();
      if (event.clientX >= bounds.left && event.clientX <= bounds.right &&
          event.clientY >= bounds.top && event.clientY <= bounds.bottom) {
        const { habitId, date } = cell.dataset;
        if (habitId && date) tapCell(habitId, date, cell);
      }
    }
  }

  function cleanupTimelinePan() {
    if (scroller && timelineGesture && scroller.hasPointerCapture?.(timelineGesture.pointerId)) {
      scroller.releasePointerCapture(timelineGesture.pointerId);
    }
    timelineGesture = null;
    timelinePanActive = false;
    document.documentElement.classList.remove('timeline-panning-cursor');
  }

  function onHistoryCellClick(event: MouseEvent, habitId: string, date: string) {
    // Pointer edits are committed immediately on pointerup, before click fires.
    // Native keyboard/assistive activation has detail=0 and must still work.
    if (event.detail === 0) tapCell(habitId, date, event.currentTarget as HTMLButtonElement);
  }

  function startTimelineTouch(event: TouchEvent) {
    if (view !== 'habits') return;
    if (!scroller || dragActive) return;
    if (event.touches.length !== 1) {
      endTimelineTouch();
      return;
    }
    const target = event.target as HTMLElement | null;
    // Touch swipes must also work when they begin on an editable date square.
    if (target?.closest('.habit-name, .timeline-side, input, textarea, button:not(.cell)')) return;
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

  async function switchView(next: 'today' | 'habits' | 'thoughts') {
    if (next === view) return;
    if (view === 'habits' && scroller) savedHabitScrollLeft = scroller.scrollLeft;
    // The timeline is unmounted on Today, so restore its mobile swipe listeners when reopened.
    scroller?.removeEventListener('touchstart', startTimelineTouch);
    scroller?.removeEventListener('touchmove', moveTimelineTouch);
    scroller?.removeEventListener('touchend', endTimelineTouch);
    scroller?.removeEventListener('touchcancel', endTimelineTouch);
    confirmingClearHistory = false;
    historyEditing = false;
    view = next;
    if (!fixtureMode) localStorage.setItem(LAST_VIEW_KEY, next);
    await tick();
    scroller?.addEventListener('touchstart', startTimelineTouch, { passive: true });
    scroller?.addEventListener('touchmove', moveTimelineTouch, { passive: false });
    scroller?.addEventListener('touchend', endTimelineTouch, { passive: true });
    scroller?.addEventListener('touchcancel', endTimelineTouch, { passive: true });
    if (next === 'habits' && scroller) {
      scroller.scrollLeft = savedHabitScrollLeft;
      if (savedHabitScrollLeft === 0) await scrollToToday();
      else updateTimelineStatus();
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

  function normalizeHabits(habits: Habit[]) {
    return habits.map((habit, position) => ({ ...habit, position }));
  }

  function setLocalHabits(habits: Habit[]) {
    if (!board) return;
    board = { ...board, habits: normalizeHabits(habits) };
    schedulePersistence();
  }

  function normalizeThoughts(thoughts: Thought[]) {
    return thoughts.map((thought, position) => ({ ...thought, position }));
  }

  function setLocalThoughts(thoughts: Thought[]) {
    if (!board) return;
    board = { ...board, thoughts: normalizeThoughts(thoughts) };
    schedulePersistence();
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
      ? document.querySelector<HTMLElement>(`[data-habit-id="${itemId}"]`)
      : document.querySelector<HTMLElement>(`.thought-row[data-thought-id="${itemId}"]`);
    const cell = row?.querySelector<HTMLElement>(kind === 'habit' ? '.habit-name, .today-habit' : '.thought-cell');
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
      if (distance > 8) {
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
    const handle = event.currentTarget as HTMLElement;
    const dragSurface = handle.closest<HTMLElement>(kind === 'habit' ? '.habit-name, .today-habit' : '.thought-cell') ?? handle;
    const rect = dragSurface.getBoundingClientRect();
    if (event.pointerType === 'mouse') event.preventDefault();
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
    dragHoldTimer = setTimeout(() => {
      dragHoldTimer = undefined;
      if (dragCandidate && dragPointerId === event.pointerId) activateItemDrag(dragCandidate.startY);
    }, 180);
  }

  function deleteHabit(id: string) {
    if (!board) return;
    if (editingHabitId === id) {
      editingHabitId = null;
      editingHabitName = '';
    }
    for (const [key, entry] of entries) {
      if (entry.habitId === id) entries.delete(key);
    }
    marksRevision += 1;
    setLocalHabits(board.habits.filter((habit) => habit.id !== id));
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

  function clearHistory() {
    if (!board || !confirmingClearHistory || entries.size === 0) return;
    entries.clear();
    marksRevision += 1;
    confirmingClearHistory = false;
    cancelScheduledPersistence();
    void persistLocalStateNow();
  }

  function emptyBoard(): Board {
    return {
      createdAt: new Date().toISOString(),
      habits: [],
      thoughts: [],
      entries: []
    };
  }

  async function initialize() {
    if (fixtureMode) {
      ready = true;
      if (board) await scrollToToday();
      return;
    }

    try {
      const stored = await loadBoard();
      const loaded = stored ?? emptyBoard();
      hydrateEntries(loaded);
      board = { ...loaded, entries: [] };
      if (!stored) await saveBoard(loaded);
    } catch (error) {
      console.error('3tap could not load local data', error);
      board = emptyBoard();
    } finally {
      ready = true;
      await tick();
      if (board) await scrollToToday();
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

  onMount(() => {
    theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    if (!fixtureMode) {
      const savedView = localStorage.getItem(LAST_VIEW_KEY);
      if (savedView === 'today' || savedView === 'thoughts' || savedView === 'habits') {
        view = savedView;
      }
    }

    const onResize = () => {
      viewportWidth = window.innerWidth;
      habitWidth = historySidebarWidth(board?.habits ?? [], viewportWidth);
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
      void persistLocalStateNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onPageHide();
    };

    void initialize();

    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);

    scheduleNextDay();

    return () => {
      scroller?.removeEventListener('touchstart', startTimelineTouch);
      scroller?.removeEventListener('touchmove', moveTimelineTouch);
      scroller?.removeEventListener('touchend', endTimelineTouch);
      scroller?.removeEventListener('touchcancel', endTimelineTouch);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      if (dayTimer) clearTimeout(dayTimer);
      cancelScheduledPersistence();
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

<div class="shell" style={`--habit-width: ${habitWidth}px`}>
  <header class="nav-shell">
    <div class="navbar">
      <div class="brand-slot">
        <button class="brand-button" aria-label="Today" onclick={() => void switchView('today')}>3tap</button>
      </div>
      <nav class="top-tools" aria-label="Pages">
        <button
          class="tool-icon today-tool"
          class:active={view === 'today'}
          aria-label="Today"
          aria-pressed={view === 'today'}
          title="Today"
          onclick={() => void switchView('today')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="5.5" width="17" height="15" rx="1"></rect>
            <path d="M7.5 3v5m9-5v5M3.5 10h17m-12 5.1 2.2 2.2 4.7-4.7"></path>
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
          class="tool-icon habits-tool"
          class:active={view === 'habits'}
          aria-label="Grid history"
          aria-pressed={view === 'habits'}
          title="Grid history"
          onclick={() => void switchView('habits')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6"></rect>
            <rect x="14" y="4" width="6" height="6"></rect>
            <rect x="4" y="14" width="6" height="6"></rect>
            <rect x="14" y="14" width="6" height="6"></rect>
          </svg>
        </button>
      </nav>
      <div class="theme-slot">
        <button
          class="tool-icon theme-tool"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          onclick={toggleTheme}
        >
          {#if theme === 'dark'}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" class="icon-fill"></circle>
              <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 9 9 0 1 0 20.2 15.4Z" class="icon-fill" stroke="none"></path>
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </header>

  {#if ready && board}
    <main>
      {#if view === 'today'}
        <section class="today-page" aria-label="Today habits">
          <h1 class="page-heading">today</h1>
          <div class="today-list">
            {#each board.habits as habit (habit.id)}
              {@const value = valueFor(habit.id, todayKey, marksRevision)}
              <div
                class="today-row"
                data-habit-id={habit.id}
                class:dragging={dragActive && draggingItemId === habit.id}
                animate:flip={{ duration: dragActive ? 120 : 0 }}
              >
                <div class="today-habit">
                  <button
                    class="today-drag"
                    aria-label={`Hold and drag to reorder ${habit.name}`}
                    title="Hold and drag to reorder"
                    onpointerdown={(event) => startItemDrag(event, habit.id, 'habit')}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="5" cy="4" r="1"></circle><circle cx="11" cy="4" r="1"></circle>
                      <circle cx="5" cy="8" r="1"></circle><circle cx="11" cy="8" r="1"></circle>
                      <circle cx="5" cy="12" r="1"></circle><circle cx="11" cy="12" r="1"></circle>
                    </svg>
                  </button>
                  {#if editingHabitId === habit.id}
                    <input
                      class="habit-inline-input today-edit-input"
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
                    <button class="today-name" onclick={() => beginRename(habit)}>{habit.name}</button>
                  {/if}
                </div>
                <button
                  class="today-delete item-delete"
                  aria-label={`Delete ${habit.name}`}
                  title="Delete"
                  onclick={() => deleteHabit(habit.id)}
                ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5 19 19 M19 5 5 19" /></svg></button>
                <div class="today-state-slot">
                  <button
                    class="today-state"
                    class:marked={value > 0}
                    class:great={value === 2}
                    aria-label={`${habit.name} today: ${value === 0 ? 'not marked' : value === 1 ? 'done' : 'great'}. Tap to cycle.`}
                    title={value === 0 ? 'Not marked' : value === 1 ? 'Done' : 'Great'}
                    onclick={() => tapCell(habit.id, todayKey)}
                  >{value === 0 ? '□' : symbols[value]}</button>
                </div>
              </div>
            {/each}
            <div class="today-add-row">
              {#if addingHabit}
                <input
                  class="habit-inline-input today-add-input"
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
                <button class="today-add" onclick={beginAddHabit}>+ habit</button>
              {/if}
            </div>
          </div>
          {#if board.habits.length === 0}
            <section class="zero-tutorial" aria-label="Getting started">
              <p class="zero-tutorial-start"><strong>+ habit</strong> to start</p>
              <ul class="zero-tutorial-list">
                <li>tap today or yesterday: <b>-</b> missed / <b>|</b> done / <b>+</b> great</li>
                <li>older days lock</li>
                <li>tap a habit name to rename; drag it to reorder</li>
              </ul>
            </section>
          {/if}
        </section>
      {:else}
        {#if view === 'thoughts'}
          <h1 class="page-heading">thoughts</h1>
        {/if}
      <div
        class="grid-scroll"
        class:thoughts-mode={view === 'thoughts'}
        class:history-editing={view === 'habits' && historyEditing}
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
          {#if view === 'habits'}
          <div class="timeline-header" aria-label="Timeline">
            <div class="timeline-side">
              <h1 class="page-heading history-heading">history</h1>
            </div>
            <div class="timeline-main-header">
              <div class="timeline-meta-row">
                <div class="start-slot">
                  {#if showStartButton}
                    <button class="nav-start" aria-label="Jump to start" onclick={scrollToStart}>← start</button>
                  {/if}
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
                    class:enrolled={date.key === enrolledKey}
                    class:prestart={isPreEnrollment(date.key)}
                  >
                    <span>{date.weekday}</span>
                    <strong>{date.day}</strong>
                  </div>
                {/each}
              </div>
            </div>
          </div>
          {/if}
          {#if view === 'thoughts'}
            <div class="thoughts-grid" aria-label="Thoughts">
              {#each board.thoughts ?? [] as thought (thought.id)}
                <div
                  class="thought-row"
                  class:dragging={dragActive && draggingItemId === thought.id}
                  data-thought-id={thought.id}
                  animate:flip={{ duration: dragActive ? 120 : 0 }}
                >
                  <div class="thought-cell">
                    <button
                      class="today-drag"
                      aria-label={`Hold and drag to reorder ${thought.text}`}
                      title="Hold and drag to reorder"
                      onpointerdown={(event) => startItemDrag(event, thought.id, 'thought')}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="5" cy="4" r="1"></circle><circle cx="11" cy="4" r="1"></circle>
                        <circle cx="5" cy="8" r="1"></circle><circle cx="11" cy="8" r="1"></circle>
                        <circle cx="5" cy="12" r="1"></circle><circle cx="11" cy="12" r="1"></circle>
                      </svg>
                    </button>
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
                      <button class="item-delete" aria-label={`Delete ${thought.text}`} title="Delete" onclick={() => deleteThought(thought.id)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5 19 19 M19 5 5 19" /></svg></button>
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
            <!-- No habit creation in History; use Today to add habits. -->
          {:else}
          <table>
            <tbody>
            {#each board.habits as habit (habit.id)}
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
                    {:else if historyEditing}
                      <button class="habit-label" onclick={() => beginRename(habit)}>{habit.name}</button>
                    {:else}
                      <span class="habit-label">{habit.name}</span>
                    {/if}
                    {#if historyEditing}
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
                        class="delete-habit item-delete"
                        aria-label={`Delete ${habit.name}`}
                        title="Delete"
                        onclick={() => deleteHabit(habit.id)}
                      ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 5 19 19 M19 5 5 19" /></svg></button>
                    </div>
                    {/if}
                  </div>
                </th>
                {#each dates as date (date.key)}
                  {@const value = valueFor(habit.id, date.key, marksRevision)}
                  {@const editable = canEditCell(date.key)}
                  <td
                    class:enrolled={date.key === enrolledKey}
                    class:locked={!editable}
                  >
                    <button
                      class:plus={value === 2}
                      class="cell"
                      disabled={!editable}
                      aria-label={`${habit.name}, ${date.key}: ${symbols[value]}${editable ? '' : ', view only'}`}
                      data-habit-id={habit.id}
                      data-date={date.key}
                      onclick={(event) => onHistoryCellClick(event, habit.id, date.key)}>{symbols[value]}</button>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
          {/if}
        </div>
      </div>
      {#if view === 'habits'}
        <div class="history-controls" aria-label="History controls">
          <button
            class="history-action mode-toggle"
            class:editing={historyEditing}
            aria-pressed={historyEditing}
            onclick={() => {
              historyEditing = !historyEditing;
              editingHabitId = null;
              editingHabitName = '';
            }}
          >{historyEditing ? 'view mode' : 'edit mode'}</button>
          {#if confirmingClearHistory}
            <span class="clear-explanation">clear all check-ins?</span>
            <button class="history-action" onclick={() => confirmingClearHistory = false}>cancel</button>
            <button class="history-action danger" onclick={clearHistory}>yes, clear</button>
          {:else}
            <button class="history-action danger" disabled={historyMarkCount === 0} onclick={() => confirmingClearHistory = true}>clear history</button>
          {/if}
        </div>
        {#if board.habits.length === 0}
          <section class="zero-history" aria-label="Empty history">
            <p class="zero-history-title">your history will appear here</p>
            <p class="zero-history-note">add a habit on today and check in each day to build your history.</p>
          </section>
        {/if}
      {/if}
      {/if}
    </main>
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
    --hover: #e7e7e1;
    --timeline-text: #62635d;
    --timeline-mark: #555650;
    --history-mode-accent: #875600;
    --press-fill: rgba(17,17,15,.13);
    --selection-bg: #b8d7ff;
    --selection-text: #0b1b2b;
    --shadow: rgba(17,17,15,.16);
    /* Same icon colors in light and dark mode. */
    --today-button-color: #206b36;
    --today-button-border: var(--today-button-color);
    --icon-today: var(--today-button-color);
    --icon-habits: #225866;
    --icon-thoughts: #af4b53;
    --delete-color: #af4b53;
    --icon-theme: #d3a000;
    --history-edit-surface: #fff2bf;
    --history-edit-border: #d8bf74;
    --history-edit-hover: rgba(138, 103, 25, .14);
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
    --hover: #1b2122;
    --timeline-text: #a7afae;
    --timeline-mark: #b2b9b8;
    --history-mode-accent: #efc95a;
    --history-edit-surface: #393013;
    --history-edit-border: #98803a;
    --history-edit-hover: rgba(253, 222, 122, .16);
    --press-fill: rgba(255,255,248,.16);
    --selection-bg: #315f8f;
    --selection-text: #ffffff;
    --shadow: rgba(0,0,0,.42);
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
    --nav-end-width: 64px;
    display: grid;
    grid-template-columns: var(--nav-end-width) minmax(0, 1fr) var(--nav-end-width);
    align-items: stretch;
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
    min-width: 0;
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
  .brand-button:focus-visible {
    outline: 1px solid var(--control-active);
    outline-offset: -2px;
  }
  .top-tools {
    min-width: 0;
    height: var(--day-size);
    display: flex;
    justify-content: space-evenly;
  }
  .theme-slot {
    min-width: 0;
    height: var(--day-size);
    border-left: var(--line) solid var(--grid);
  }
  .top-tools .tool-icon { flex: 0 0 var(--day-size); width: var(--day-size); height: var(--day-size); }
  .theme-slot .tool-icon { width: 100%; height: var(--day-size); }

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
    :global(html:not(.item-dragging-cursor)) .nav-start:hover,
    :global(html:not(.item-dragging-cursor)) .nav-today:hover {
      color: var(--control-active);
      border-bottom-color: transparent;
      text-decoration: underline;
    }
    :global(html:not(.item-dragging-cursor)) .habit-controls button:not(:disabled):hover,
    :global(html:not(.item-dragging-cursor)) .thought-controls button:not(:disabled):hover,
    :global(html:not(.item-dragging-cursor)) .today-delete:hover { opacity: 1; }
    :global(html:not(.item-dragging-cursor)) .cell:not(:disabled):hover { background: var(--hover); }
    .grid-scroll { cursor: grab; }
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
  .grid-scroll.thoughts-mode .grid-frame {
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
  .tool-icon:active::before { opacity: .18; }
  .tool-icon:focus-visible { outline: none; }
  .tool-icon:focus-visible::before { opacity: .12; }

  .timeline-main-header {
    position: relative;
    width: max-content;
    min-width: calc(100vw - var(--habit-width));
    height: var(--day-size);
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
  tbody tr > th,
  tbody tr > td {
    height: var(--day-size);
    border-bottom: var(--line) solid var(--grid);
  }
  td {
    width: var(--day-size);
    min-width: var(--day-size);
    max-width: var(--day-size);
  }
tbody tr td { position: relative; }
  tbody tr td::before {
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
tbody tr .habit-name + td::before { display: none; }

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
  tbody tr .habit-name::after {
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
    gap: 16px;
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
  .item-delete {
    display: grid;
    place-items: center;
    color: var(--delete-color);
    opacity: .72;
    transform: none;
    padding: 0;
    line-height: 0;
  }
  .item-delete svg {
    display: block;
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  .item-delete:hover,
  .item-delete:active,
  .item-delete:focus-visible { transform: none; }
  .thought-controls .item-delete { width: 36px; height: 36px; }
  .habit-controls .item-delete { color: var(--delete-color); opacity: .72; }
  .thought-add-row {
    padding: 0 8px 0 calc(var(--page-inset) + 40px);
    border-bottom: 0;
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
  .zero-history {
    width: min(460px, calc(100% - (var(--page-inset) * 2)));
    margin: 36px auto 0;
    padding: 0 0 24px;
    text-align: center;
  }
  .zero-history-title {
    margin: 0 0 10px;
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
  }
  .zero-history-note {
    margin: 0;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.65;
  }
  .history-controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px 26px;
    width: 100%;
    padding: 15px var(--page-inset) 4px;
  }
  .clear-explanation { color: var(--muted); font-size: 11px; }
  .history-action { color: var(--control-text); white-space: nowrap; font-size: 11px; }
  .history-action:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
  .history-action:focus-visible { outline: 1px solid var(--control-active); outline-offset: 4px; }
  .history-action.mode-toggle.editing { color: var(--history-mode-accent); }
  .history-action.danger { color: var(--delete-color); }
  .history-action:disabled { opacity: .32; cursor: default; }
  @media (max-width: 620px) {
    .history-controls { padding-left: 12px; padding-right: 12px; gap: 12px; }
  }
  /* Keep every square uniformly yellow in edit mode; a small inset ring and
     tint on hover identify the precise square that a click will change. */
  .grid-scroll.history-editing tbody td { background: var(--history-edit-surface); }
  .grid-scroll.history-editing .cell { background: transparent; opacity: 1; }
  @media (hover: hover) and (pointer: fine) {
    .grid-scroll.history-editing .cell:not(:disabled):hover {
      background: var(--history-edit-hover);
      box-shadow: inset 0 0 0 2px var(--history-edit-border);
    }
  }
  .grid-scroll.history-editing .cell:not(:disabled):active {
    background: var(--history-edit-hover);
    box-shadow: inset 0 0 0 2px var(--history-edit-border);
  }
  .grid-scroll.history-editing .cell:not(:disabled):focus-visible {
    outline: 2px solid var(--history-edit-border);
    outline-offset: -2px;
  }
  td { text-align: center; background: transparent; }
tbody tr td.enrolled::before { background: var(--grid); }
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
  .cell:not(:disabled):active { background: var(--press-fill); }

  @media (max-width: 767px) {
    input { font-size: 16px; }
  }

  .top-tools .tool-icon.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 50%;
    transform: translateX(-50%);
    width: 64px;
    max-width: 66%;
    height: 2px;
    background: currentColor;
  }
  .today-tool { color: var(--icon-today); }
  .today-tool.active::before { opacity: .10; }
  .today-page { width: 100%; }
  .page-heading {
    display: flex;
    align-items: center;
    height: var(--day-size);
    margin: 0;
    padding: 0 var(--page-inset);
    border-bottom: var(--line) solid var(--grid);
    font-family: inherit;
    font-size: 12px;
    font-weight: 400;
    line-height: 1;
    letter-spacing: .075em;
    text-transform: uppercase;
  }
  .history-heading {
    height: 100%;
    border-bottom: 0;
    white-space: nowrap;
  }
  .today-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 48px 118px;
    height: var(--day-size);
    border-bottom: var(--line) solid var(--grid);
    align-items: stretch;
  }
  .today-row.dragging { opacity: .08; }
  .today-habit {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    padding: 0 8px 0 var(--page-inset);
    user-select: none;
    -webkit-user-select: none;
  }
  .today-drag {
    flex: none;
    width: 24px;
    height: 36px;
    display: grid;
    place-items: center;
    cursor: grab;
    touch-action: pinch-zoom;
    color: var(--control-text);
  }
  .today-drag:active { cursor: grabbing; }
  .today-drag svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  .today-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 12px;
    font-weight: 500;
  }
  .today-edit-input { font-size: 12px; }
  .today-delete { width: 100%; height: 100%; }
  .today-state-slot {
    display: grid;
    place-items: center;
    padding: 0 16px 0 10px;
    border-left: var(--line) solid var(--grid);
  }
  .today-state {
    width: 100%;
    height: 31px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border);
    color: var(--timeline-text);
    line-height: 1;
    font-size: 19px;
    font-weight: 400;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }
  .today-state.marked {
    color: var(--today-button-color);
    border-color: var(--today-button-border);
  }
  .today-state.great { font-weight: 700; }
  .today-state:active { background: var(--press-fill); }
  .today-state:focus-visible,
  .today-drag:focus-visible,
  .today-delete:focus-visible,
  .today-name:focus-visible,
  .today-add:focus-visible { outline: 1px solid var(--control-active); outline-offset: -2px; }
  .today-add-row {
    height: var(--day-size);
    display: flex;
    align-items: center;
    padding: 0 8px 0 calc(var(--page-inset) + 40px);
  }
  .today-add { color: var(--muted); font-size: 11px; }
  .today-add-input { max-width: 340px; }
  @media (max-width: 620px) {
    .brand-slot { padding-left: 12px; }
    .page-heading { padding-left: 12px; }
    .today-row { grid-template-columns: minmax(0, 1fr) 38px 81px; }
    .today-habit, .thought-cell { gap: 10px; padding-left: 12px; padding-right: 4px; }
    .today-drag { width: 24px; }
    .today-state-slot { padding: 0 10px 0 5px; }
    .today-state { height: 30px; font-size: 17px; }
    .today-add-row, .thought-add-row { padding-left: 46px; }
  }
</style>
