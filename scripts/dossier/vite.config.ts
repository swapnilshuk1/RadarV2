import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

// Compile the development page independently of authenticated production routes.
// The local data API is supplied by dev.ts; no CV or generated dossier is bundled.
export default defineConfig({
  root: resolve('src/dossier/development'), plugins: [react(), tailwind()],
  build: { outDir: resolve('.output/dossier-development'), emptyOutDir: true },
});
