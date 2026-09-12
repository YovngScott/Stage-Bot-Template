import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ plugins: [react(), tailwind()], resolve: { alias: [
  { find: '@/lib/api', replacement: fileURLToPath(new URL('./api.ts', import.meta.url)) },
  { find: '@', replacement: fileURLToPath(new URL('../src', import.meta.url)) },
] }, server: { host: '127.0.0.1', port: 4175 } });
