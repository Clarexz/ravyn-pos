import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = `http://127.0.0.1:${process.env.POS_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/ws': { target, ws: true },
    },
  },
});
