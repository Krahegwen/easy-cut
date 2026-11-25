import { defineConfig } from 'vitest/config'

// Tests unitarios del dominio: puros, sin ffmpeg.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
