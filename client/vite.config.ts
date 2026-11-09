import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
