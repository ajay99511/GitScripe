import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^\/(repos|github|summaries|chat)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'api-cache', networkTimeoutSeconds: 5 },
          },
        ],
      },
      manifest: {
        name: 'GitScripe',
        short_name: 'GitScripe',
        description: 'AI-powered commit intelligence',
        theme_color: '#0f1117',
        background_color: '#0f1117',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      '/repos':     { target: 'http://localhost:3030', changeOrigin: true },
      '/github':    { target: 'http://localhost:3030', changeOrigin: true },
      '/summaries': { target: 'http://localhost:3030', changeOrigin: true },
      '/chat':      { target: 'http://localhost:3030', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3030', changeOrigin: true, ws: true },
    },
  },
});
