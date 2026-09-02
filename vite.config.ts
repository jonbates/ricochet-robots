import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 750,
  },
  base: '/rr-v1-1/', // forces relative paths (e.g., "assets/app.js" instead of "/assets/app.js")
  plugins: [tailwindcss()],
});
