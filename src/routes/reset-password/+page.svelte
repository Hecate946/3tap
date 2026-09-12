<script lang="ts">
  import { onMount } from 'svelte';

  let token = '';
  let password = '';
  let busy = false;
  let error = '';
  let complete = false;
  let invalid = false;

  const passwordChecks = [
    ['8+ characters', (v: string) => v.length >= 8]
  ] as const;
  $: passwordValid = password.length <= 128 && passwordChecks.every(([, test]) => test(password));

  onMount(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    token = hash.get('access_token') ?? query.get('access_token') ?? '';
    invalid = !token;
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  });

  async function resetPassword() {
    if (!passwordValid || !token || busy) return;
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!response.ok) {
        error = response.status === 401 ? 'this reset link is invalid or expired' : 'could not reset password';
        return;
      }
      complete = true;
      password = '';
      token = '';
    } catch {
      error = 'could not reset password';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>reset password · 3tap</title></svelte:head>

<main class="reset-page">
  <section class="reset-card">
    <div class="wordmark">3tap</div>
    {#if complete}
      <p class="message">password updated</p>
      <a href="/">log in</a>
    {:else if invalid}
      <p class="error">this reset link is invalid or expired</p>
      <a href="/">back to log in</a>
    {:else}
      <form onsubmit={(event) => { event.preventDefault(); void resetPassword(); }}>
        <input aria-label="New password" placeholder="new password" type="password" autocomplete="new-password" bind:value={password} oninput={() => (error = '')} />
        <ul class="rules" aria-label="Password requirements">
          {#each passwordChecks as [label, test]}
            <li class:valid={test(password)}>{test(password) ? '✓' : '·'} {label}</li>
          {/each}
          <li class:valid={password.length > 0 && password.length <= 128}>{password.length > 0 && password.length <= 128 ? '✓' : '·'} 128 characters max</li>
        </ul>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button type="submit" disabled={!passwordValid || busy}>{busy ? '...' : 'reset password'}</button>
      </form>
    {/if}
  </section>
</main>

<style>
  :global(html) { background: #fbfbf8; color: #16272b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  :global(body) { margin: 0; }
  .reset-page { min-height: 100dvh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
  .reset-card { width: min(280px, 100%); display: grid; gap: 12px; }
  .wordmark { text-align: center; margin-bottom: 16px; color: #718084; font-size: 12px; letter-spacing: .12em; }
  form { display: grid; gap: 10px; }
  input, button { width: 100%; height: 38px; box-sizing: border-box; border: 1px solid #d9deda; border-radius: 0; background: transparent; color: inherit; font: inherit; font-size: 11px; }
  input { padding: 0 10px; outline: 0; }
  input:focus { border-color: #1b6f82; }
  button { cursor: pointer; color: #1b6f82; }
  button:disabled { opacity: .4; cursor: default; }
  .rules { list-style: none; margin: 0; padding: 0; color: #8a9496; font-size: 9px; line-height: 1.7; }
  .rules li.valid { color: #1b6f82; }
  .error { margin: 0; color: #a44; font-size: 10px; }
  .message { text-align: center; font-size: 11px; }
  a { text-align: center; color: #1b6f82; font-size: 10px; }
</style>
