import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// La versión sale de package.json (la misma que usa tauri.conf.json): una sola fuente.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Puertos reservados para easy-cut (ver homelab/Esta máquina.md del vault).
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
