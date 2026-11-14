import type { CapacitorConfig } from '@capacitor/cli';

// La app Android carga la versión publicada en GitHub Pages: cada cambio que se
// publique ahí le llega sola a la app (no hay que reinstalar el APK). Solo hace
// falta un APK nuevo si cambia la parte nativa (Kotlin, permisos, plugins).
// El service worker deja la app guardada, así que funciona sin internet después
// de la primera carga. Si abre por primera vez sin conexión, muestra offline.html.
const config: CapacitorConfig = {
  appId: 'co.luka.finanzas',
  appName: 'Luka',
  webDir: 'dist',
  server: {
    url: 'https://tabauni19.github.io/Luka/',
    errorPath: 'offline.html'
  }
};

export default config;
