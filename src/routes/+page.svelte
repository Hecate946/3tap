<script lang="ts">
  import { onMount, tick } from 'svelte';
  import QRCode from 'qrcode';
  import type { Board, Credentials, Habit, MarkValue } from '$lib/types';
  import {
    authHeaders,
    clearLocalBoard,
    getCachedBoard,
    getCredentials,
    getQueue,
    setCachedBoard,
    setCredentials,
    setQueue,
    type PendingEntry
  } from '$lib/client';

  let board: Board | null = null;
  let credentials: Credentials | null = null;
  let loading = true;
  let online = true;
  let menuOpen = false;
  let panel: 'none' | 'pair' | 'habits' | 'recovery' = 'none';
  let qrDataUrl = '';
  let pairingLink = '';
  let recoveryInput = '';
  let habitDrafts: Habit[] = [];
  let scroller: HTMLDivElement;
  let currentDay = new Date();
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  let dayTimer: ReturnType<typeof setInterval> | undefined;

  const symbols: Record<MarkValue, string> = { 0: '-', 1: '|', 2: '+' };

  function dateKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function datesForBoard(source: Board | null) {
    if (!source) return [];
    const created = new Date(source.createdAt);
    const start = new Date(created.getFullYear(), created.getMonth(), created.getDate(), 12);
    const end = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate(), 12);
    const dates: Date[] = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      dates.push(new Date(cursor));
    }
    return dates;
  }

  $: dates = datesForBoard(board);
  $: todayKey = dateKey(currentDay);

  function valueFor(habitId: string, date: string): MarkValue {
    const entry = board?.entries.find((item) => item.habitId === habitId && item.date === date);
    return (entry?.value ?? 0) as MarkValue;
  }

  function applyLocalEntry(change: PendingEntry) {
    if (!board) return;
    const rest = board.entries.filter(
      (entry) => !(entry.habitId === change.habitId && entry.date === change.date)
    );
    board = {
      ...board,
      entries:
        change.value === 0
          ? rest
          : [
              ...rest,
              {
                habitId: change.habitId,
                date: change.date,
                value: change.value as 1 | 2,
                updatedAt: new Date().toISOString()
              }
            ]
    };
    setCachedBoard(board);
  }

  async function tapCell(habitId: string, date: string) {
    const current = valueFor(habitId, date);
    const next = ((current + 1) % 3) as MarkValue;
    const change = { habitId, date, value: next };
    applyLocalEntry(change);

    const queue = getQueue();
    queue.push(change);
    setQueue(queue);
    await flushQueue();
  }

  async function createBoard() {
    const response = await fetch('/api/boards', { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    credentials = data.credentials;
    board = data.board;
    setCredentials(credentials!);
    setCachedBoard(board!);
  }

  async function fetchBoard() {
    if (!credentials) return;
    const response = await fetch(`/api/boards/${credentials.boardId}`, {
      headers: authHeaders(credentials)
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 404) return;
      throw new Error(await response.text());
    }
    board = await response.json();
    setCachedBoard(board!);
  }

  async function flushQueue() {
    if (!credentials || !navigator.onLine) return;
    let queue = getQueue();
    while (queue.length) {
      const change = queue[0];
      try {
        const response = await fetch(`/api/boards/${credentials.boardId}/entries`, {
          method: 'PUT',
          headers: authHeaders(credentials),
          body: JSON.stringify(change)
        });
        if (!response.ok) throw new Error(await response.text());
        queue = queue.slice(1);
        setQueue(queue);
      } catch {
        online = false;
        return;
      }
    }
    online = true;
  }

  async function sync() {
    if (!credentials || !navigator.onLine) {
      online = navigator.onLine;
      return;
    }
    await flushQueue();
    if (getQueue().length === 0) await fetchBoard();
    online = true;
  }

  async function scrollToToday() {
    await tick();
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }

  async function openPair() {
    if (!credentials) return;
    menuOpen = false;
    panel = 'pair';
    pairingLink = `${location.origin}/pair#${credentials.boardId}.${credentials.secret}`;
    qrDataUrl = await QRCode.toDataURL(pairingLink, {
      width: 280,
      margin: 1,
      color: { dark: '#11110f', light: '#f7f7f5' }
    });
  }

  function openHabits() {
    if (!board) return;
    menuOpen = false;
    habitDrafts = board.habits.map((habit) => ({ ...habit }));
    panel = 'habits';
  }

  function addHabit() {
    habitDrafts = [...habitDrafts, { id: '', name: '', position: habitDrafts.length }];
  }

  function removeHabit(index: number) {
    if (habitDrafts.length <= 1) return;
    habitDrafts = habitDrafts.filter((_, i) => i !== index);
  }

  function moveHabit(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= habitDrafts.length) return;
    const copy = [...habitDrafts];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    habitDrafts = copy;
  }

  async function saveHabits() {
    if (!credentials) return;
    const habits = habitDrafts
      .map((habit) => ({ id: habit.id || undefined, name: habit.name.trim() }))
      .filter((habit) => habit.name);
    if (!habits.length) return;

    const response = await fetch(`/api/boards/${credentials.boardId}/habits`, {
      method: 'PUT',
      headers: authHeaders(credentials),
      body: JSON.stringify({ habits })
    });
    if (!response.ok) return;
    board = await response.json();
    setCachedBoard(board!);
    panel = 'none';
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
    setQueue([]);
    await fetchBoard();
    panel = 'none';
    await scrollToToday();
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function exportData() {
    if (!board) return;
    const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `3tap-${todayKey}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    menuOpen = false;
  }

  async function startFresh() {
    clearLocalBoard();
    credentials = null;
    board = null;
    panel = 'none';
    menuOpen = false;
    loading = true;
    await createBoard();
    loading = false;
    await scrollToToday();
  }

  onMount(async () => {
    online = navigator.onLine;
    credentials = getCredentials();
    board = getCachedBoard();

    try {
      if (!credentials) await createBoard();
      else await sync();
    } catch {
      online = false;
    } finally {
      loading = false;
      await scrollToToday();
    }

    const onFocus = () => sync();
    const onOnline = () => sync();
    const onOffline = () => (online = false);
    const onVisibility = () => document.visibilityState === 'visible' && sync();

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);

    syncTimer = setInterval(sync, 3000);
    dayTimer = setInterval(async () => {
      const before = dateKey(currentDay);
      currentDay = new Date();
      if (dateKey(currentDay) !== before) await scrollToToday();
    }, 30000);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
      if (syncTimer) clearInterval(syncTimer);
      if (dayTimer) clearInterval(dayTimer);
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
          <button onclick={openHabits}>edit habits</button>
          <button onclick={openRecovery}>recovery</button>
          <button onclick={exportData}>export</button>
        </div>
      {/if}
    </div>
  </header>

  {#if loading && !board}
    <main class="center">creating board…</main>
  {:else if board}
    <main>
      <div class="grid-scroll" bind:this={scroller}>
        <table>
          <thead>
            <tr>
              <th class="habit-head"></th>
              {#each dates as date}
                {@const key = dateKey(date)}
                <th class:today={key === todayKey}>
                  <span>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                  <strong>{date.getDate()}</strong>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each board.habits as habit}
              <tr>
                <th class="habit-name">{habit.name}</th>
                {#each dates as date}
                  {@const key = dateKey(date)}
                  {@const value = valueFor(habit.id, key)}
                  <td class:today={key === todayKey}>
                    <button
                      class:plus={value === 2}
                      class="cell"
                      aria-label={`${habit.name}, ${key}: ${symbols[value]}`}
                      onclick={() => tapCell(habit.id, key)}>{symbols[value]}</button>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </main>
  {:else}
    <main class="center">
      <button class="text-button" onclick={startFresh}>start fresh</button>
    </main>
  {/if}
</div>

{#if panel !== 'none'}
  <div class="backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (panel = 'none')}>
    <section class="panel" aria-modal="true" role="dialog">
      <button class="close" aria-label="Close" onclick={() => (panel = 'none')}>×</button>

      {#if panel === 'pair'}
        <h2>add device</h2>
        <p>scan this on the other device.</p>
        {#if qrDataUrl}<img class="qr" src={qrDataUrl} alt="Pairing QR code" />{/if}
        <button class="action" onclick={() => copyText(pairingLink)}>copy sync link</button>
      {:else if panel === 'habits'}
        <h2>habits</h2>
        <div class="habit-editor">
          {#each habitDrafts as habit, index}
            <div class="habit-edit-row">
              <input bind:value={habit.name} aria-label={`Habit ${index + 1}`} />
              <button aria-label="Move up" onclick={() => moveHabit(index, -1)}>↑</button>
              <button aria-label="Move down" onclick={() => moveHabit(index, 1)}>↓</button>
              <button aria-label="Remove" onclick={() => removeHabit(index)}>×</button>
            </div>
          {/each}
        </div>
        <div class="panel-actions">
          <button class="text-button" onclick={addHabit}>+ add</button>
          <button class="action" onclick={saveHabits}>save</button>
        </div>
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

  .shell { min-height: 100dvh; padding: max(18px, env(safe-area-inset-top)) 16px max(18px, env(safe-area-inset-bottom)); }
  header { height: 38px; display: flex; align-items: flex-start; justify-content: space-between; max-width: 100%; }
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
  .menu button:hover { background: #ecece7; }

  main { width: 100%; }
  .center { min-height: 60dvh; display: grid; place-items: center; font-size: 12px; opacity: .55; }
  .grid-scroll { overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; padding-bottom: 8px; }
  table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; }
  th, td { padding: 0; height: 48px; border-bottom: 1px solid #deded8; }
  thead th { height: 42px; vertical-align: bottom; font-weight: 400; font-size: 10px; opacity: .46; min-width: 46px; text-align: center; }
  thead th span, thead th strong { display: block; font-weight: 400; line-height: 1.25; }
  thead th strong { font-size: 11px; }
  .habit-head, .habit-name { position: sticky; left: 0; z-index: 5; background: #f7f7f5; }
  .habit-head { z-index: 8; min-width: 126px; width: 126px; }
  .habit-name { min-width: 126px; width: 126px; padding-right: 16px; text-align: left; font-size: 12px; font-weight: 400; white-space: nowrap; }
  td { width: 46px; min-width: 46px; text-align: center; }
  .today { background: rgba(17,17,15,.035); }
  .cell { width: 100%; height: 100%; font-size: 16px; font-weight: 400; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .cell.plus { font-weight: 750; font-size: 17px; }
  .cell:active { background: rgba(17,17,15,.07); }

  .backdrop { position: fixed; z-index: 100; inset: 0; background: rgba(17,17,15,.18); display: grid; place-items: center; padding: 18px; }
  .panel { position: relative; width: min(390px, 100%); max-height: min(720px, 88dvh); overflow: auto; background: #f7f7f5; border: 1px solid #d6d6d0; padding: 24px; }
  .panel h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; text-transform: lowercase; }
  .panel p { margin: 0 0 18px; color: #686862; font-size: 11px; line-height: 1.5; }
  .close { position: absolute; top: 12px; right: 14px; font-size: 18px; opacity: .5; }
  .qr { display: block; width: min(280px, 100%); margin: 16px auto 20px; image-rendering: pixelated; }
  .action { border: 1px solid #11110f; padding: 9px 12px; font-size: 11px; }
  .text-button { font-size: 11px; text-decoration: underline; text-underline-offset: 3px; }
  .habit-editor { display: grid; gap: 6px; margin: 18px 0; }
  .habit-edit-row { display: grid; grid-template-columns: 1fr 28px 28px 28px; gap: 4px; }
  .habit-edit-row input, textarea { width: 100%; border: 1px solid #d6d6d0; background: transparent; color: inherit; border-radius: 0; outline: none; }
  .habit-edit-row input { height: 34px; padding: 0 9px; font-size: 12px; }
  .habit-edit-row button { border: 1px solid #d6d6d0; font-size: 11px; }
  textarea { resize: vertical; padding: 9px; font-size: 10px; line-height: 1.4; margin-bottom: 14px; }
  .panel-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; }

  @media (max-width: 520px) {
    .shell { padding-left: 10px; padding-right: 10px; }
    .habit-head, .habit-name { min-width: 116px; width: 116px; }
    .habit-name { padding-left: 2px; padding-right: 10px; }
    td, thead th { min-width: 44px; width: 44px; }
    .panel { padding: 22px 18px; }
  }
</style>
