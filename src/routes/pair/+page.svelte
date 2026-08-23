<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { Board, Credentials } from '$lib/types';
  import {
    authHeaders,
    clearLocalBoard,
    getCredentials,
    setCachedBoard,
    setCredentials
  } from '$lib/client';

  let message = 'pairing…';
  let errorMessage = '';
  let needsReplaceConfirmation = false;
  let targetCredentials: Credentials | null = null;
  let targetBoard: Board | null = null;

  function parsePairToken(raw: string): Credentials | null {
    const token = raw.trim();
    const [boardId = '', secret = '', recoveryCode = ''] = token.split('.');
    if (!boardId.trim() || secret.trim().length < 20) return null;
    return {
      boardId: boardId.trim(),
      secret: secret.trim(),
      ...(recoveryCode.trim() ? { recoveryCode: recoveryCode.trim() } : {})
    };
  }

  async function commitPair() {
    if (!targetCredentials || !targetBoard) return;

    const existing = getCredentials();
    if (!existing || existing.boardId !== targetCredentials.boardId) {
      clearLocalBoard();
    }
    setCredentials(targetCredentials);
    setCachedBoard(targetBoard);
    await goto('/', { replaceState: true });
  }

  onMount(async () => {
    const rawToken = location.hash.slice(1);
    history.replaceState(null, '', '/pair');

    const parsed = parsePairToken(rawToken);
    if (!parsed) {
      message = '';
      errorMessage = 'invalid pairing link';
      return;
    }

    try {
      const response = await fetch(`/api/boards/${encodeURIComponent(parsed.boardId)}`, {
        headers: authHeaders(parsed)
      });
      if (response.status === 401 || response.status === 404) {
        message = '';
        errorMessage = 'this pairing link is not valid';
        return;
      }
      if (!response.ok) throw new Error(await response.text());

      targetCredentials = parsed;
      targetBoard = (await response.json()) as Board;

      const existing = getCredentials();
      if (existing && existing.boardId !== parsed.boardId) {
        message = '';
        needsReplaceConfirmation = true;
        return;
      }

      await commitPair();
    } catch {
      message = '';
      errorMessage = 'could not pair this device';
    }
  });
</script>

<svelte:head><title>3tap</title></svelte:head>

<main>
  {#if needsReplaceConfirmation}
    <section>
      <strong>pair this device?</strong>
      <p>This device already has a different 3tap board. Pairing replaces the board stored on this device.</p>
      <div class="actions">
        <a href="/">cancel</a>
        <button onclick={commitPair}>pair device</button>
      </div>
    </section>
  {:else if errorMessage}
    <section>
      <strong>{errorMessage}</strong>
      <a href="/">back to 3tap</a>
    </section>
  {:else}
    <span>{message}</span>
  {/if}
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { color-scheme: light dark; }
  :global(html, body) { margin: 0; min-height: 100%; }
  :global(body) {
    background: light-dark(#f7f7f5, #0e1112);
    color: light-dark(#11110f, #ecece6);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  }
  main {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    font-size: 11px;
  }
  section {
    width: min(360px, 100%);
    display: grid;
    gap: 12px;
    padding: 18px;
    border: 1px solid light-dark(#d3d3cd, #40413c);
  }
  strong { font-size: 12px; font-weight: 600; }
  p { margin: 0; line-height: 1.55; opacity: .72; }
  a, button {
    color: inherit;
    font: inherit;
  }
  a { text-underline-offset: 3px; }
  button {
    min-height: 32px;
    padding: 0 9px;
    border: 1px solid currentColor;
    border-radius: 0;
    background: transparent;
    cursor: pointer;
  }
  .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
</style>
