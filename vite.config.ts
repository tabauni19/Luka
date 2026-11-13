/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // En GitHub Pages se usa BASE_PATH=./ (rutas relativas); en local y en Android, la raíz.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Luka · Finanzas personales',
        short_name: 'Luka',
        description: 'Registra gastos con una frase y mira cuánto te queda libre hasta tu próximo pago.',
        lang: 'es-CO',
        theme_color: '#0E3B36',
        background_color: '#0E3B36',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      }
    })
  ],
  server: { watch: { ignored: ['**/android/**', '**/android-parser-tests/**'] } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
