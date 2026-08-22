<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { setCredentials } from '$lib/client';

  let message = 'pairing…';

  onMount(async () => {
    const token = location.hash.slice(1);
    const separator = token.indexOf('.');
    if (separator < 1) {
      message = 'invalid pairing link';
      return;
    }

    const boardId = token.slice(0, separator);
    const secret = token.slice(separator + 1);
    if (!boardId || !secret) {
      message = 'invalid pairing link';
      return;
    }

    setCredentials({ boardId, secret });
    history.replaceState(null, '', '/pair');
    await goto('/', { replaceState: true });
  });
</script>

<svelte:head><title>3tap</title></svelte:head>

<main>{message}</main>

<style>
  :global(html, body) { margin: 0; min-height: 100%; background: #f7f7f5; color: #11110f; }
  main { min-height: 100vh; display: grid; place-items: center; font: 14px/1.4 system-ui, sans-serif; }
</style>
