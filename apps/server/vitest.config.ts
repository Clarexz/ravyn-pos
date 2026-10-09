import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Las pruebas usan el código fuente de los paquetes del workspace (sin depender de un build previo).
export default defineConfig({
  resolve: {
    alias: {
      '@pos/db': path.resolve(import.meta.dirname, '../../packages/db/src/index.ts'),
      '@pos/core': path.resolve(import.meta.dirname, '../../packages/core/src/index.ts'),
    },
  },
});
