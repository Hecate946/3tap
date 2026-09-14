<script lang="ts">
  import { browser } from '$app/environment';

  let password = '';
  let error = '';
  let done = false;
  let submitting = false;
  const token = browser ? new URLSearchParams(window.location.search).get('token') ?? '' : '';

  $: valid = password.length >= 8 && password.length <= 128;

  async function resetPassword() {
    if (submitting || !valid || !token) return;
    error = '';
    submitting = true;
    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      if (!response.ok) {
        try {
          const body = (await response.json()) as { message?: unknown };
          error = typeof body.message === 'string' ? body.message.toLowerCase() : 'could not reset password';
        } catch {
          error = 'could not reset password';
        }
        return;
      }
      password = '';
      done = true;
      history.replaceState(null, '', '/reset-password');
    } catch {
      error = 'could not reach the account service';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>reset password · 3tap</title>
  <meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="reset-page">
  <div class="reset-card">
    <div class="wordmark">3tap</div>
    {#if done}
      <p class="notice">password reset</p>
      <a class="submit" href="/">log in</a>
    {:else if !token}
      <p class="error">this reset link is invalid</p>
      <a class="switch" href="/">back to log in</a>
    {:else}
      <form onsubmit={(event) => { event.preventDefault(); void resetPassword(); }}>
        <input aria-label="New password" placeholder="new password" type="password" autocomplete="new-password" bind:value={password} oninput={() => (error = '')} />
        <ul class="rules" aria-label="Password requirements">
          <li class:valid={password.length >= 8}>{password.length >= 8 ? '✓' : '·'} 8+ characters</li>
          <li class:valid={password.length > 0 && password.length <= 128}>{password.length > 0 && password.length <= 128 ? '✓' : '·'} 128 characters max</li>
        </ul>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button class="submit" type="submit" disabled={!valid || submitting}>{submitting ? '...' : 'reset password'}</button>
      </form>
      <a class="switch" href="/">back to log in</a>
    {/if}
  </div>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html, body) { margin: 0; min-height: 100%; background: #fafaf8; color: #10252a; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  :global(button), :global(input) { font: inherit; }
  .reset-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .reset-card { width: min(280px, 100%); display: grid; gap: 10px; }
  .wordmark { margin-bottom: 16px; text-align: center; color: #586568; font-size: 12px; letter-spacing: .12em; }
  form { display: grid; gap: 10px; }
  input { width: 100%; height: 38px; padding: 0 10px; border: 1px solid #d8dcda; outline: 0; background: transparent; color: inherit; font-size: 11px; border-radius: 0; }
  input:focus { border-color: #0b6271; }
  .rules { list-style: none; margin: -2px 0 2px; padding: 0; color: #687477; font-size: 9px; line-height: 1.65; }
  .rules li.valid, .notice { color: #0b6271; }
  .error, .notice { min-height: 12px; margin: 0; font-size: 10px; line-height: 1.5; }
  .error { color: #b34949; }
  .submit { width: 100%; height: 38px; display: grid; place-items: center; border: 1px solid #d8dcda; background: transparent; color: #0b6271; font-size: 11px; text-decoration: none; }
  button.submit:disabled { opacity: .45; }
  .switch { justify-self: center; color: #687477; font-size: 10px; text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    :global(html, body) { background: #001417; color: #d5e2e2; }
    input, .submit { border-color: #264044; }
    .wordmark, .rules, .switch { color: #84999b; }
    .rules li.valid, .notice, .submit { color: #69cbd1; }
  }
</style>
