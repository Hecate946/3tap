import adapter from '@sveltejs/adapter-cloudflare';

// Local development does not need Cloudflare's runtime emulation: every server
// route reads Supabase credentials from process.env. Skipping the adapter while
// `npm run dev` is active avoids starting workerd/Miniflare (and therefore its
// local SQLite store) entirely. Production builds still use Cloudflare.
const localDev = process.env.THREE_TAP_LOCAL_DEV === '1';

export default {
  kit: localDev ? {} : { adapter: adapter() }
};
