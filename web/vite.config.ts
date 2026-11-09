import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The API lives under /api on the same origin (NestJS serves this build),
// so cookies, CSRF header and CSP work without CORS.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['fonts/*.woff2', 'icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'DigiComp HUB',
        short_name: 'DigiComp',
        description: 'Команда, обладнання, ТЗ і бали творчої групи DigiComp',
        lang: 'uk',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F3F6FB',
        theme_color: '#1D5FD6',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. API answers are never cached: they are personal and
        // must be fresh (and must disappear after logout).
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
