import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Vite server forwards /api to the Express service, so the
// browser only ever talks to one origin. Compose uses nginx for the same job.
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiOrigin,
        changeOrigin: true,
      },
    },
  },
});
