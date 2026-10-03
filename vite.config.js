import { defineConfig } from 'vite';

// Allow Cloudflare quick tunnels (https://*.trycloudflare.com) to reach the dev/preview server.
export default defineConfig({
  server: { allowedHosts: ['.trycloudflare.com'] },
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
