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
  // Que Vite no tape los mensajes de Tauri ni vigile src-tauri (target/ tiene miles de ficheros).
  clearScreen: false,
  server: { port: 4850, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  preview: { port: 4852, strictPort: true },
})
