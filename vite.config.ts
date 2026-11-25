import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Puertos reservados para easy-cut (ver homelab/Esta máquina.md del vault).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { port: 4850, strictPort: true },
  preview: { port: 4852, strictPort: true },
})
