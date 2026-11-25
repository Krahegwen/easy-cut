import { defineConfig } from 'vitest/config'

// Prueba de integración con el ffmpeg real de la máquina. No corre en `pnpm test`.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.itest.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
})
