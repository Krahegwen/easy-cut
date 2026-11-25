import { createApp } from 'vue'
import './styles.css'

// La pantalla de diagnóstico solo existe en desarrollo (?diagnostics); en producción ni se incluye.
async function start() {
  const wantsDiagnostics = import.meta.env.DEV && new URLSearchParams(location.search).has('diagnostics')
  const root = wantsDiagnostics
    ? (await import('./views/DiagnosticsView.vue')).default
    : (await import('./App.vue')).default
  if (wantsDiagnostics) document.body.classList.add('diagnostics')
  createApp(root).mount('#app')
}

void start()
