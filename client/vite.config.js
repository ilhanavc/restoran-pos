import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Sentry source map upload — SENTRY_AUTH_TOKEN yoksa build'i kırmaz, sadece upload atlar.
// Bkz: docs/runbooks/sentry-setup-runbook.md
const sentryPlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: process.env.VITE_SENTRY_RELEASE || undefined },
      sourcemaps: {
        assets: './dist/**',
        filesToDeleteAfterUpload: './dist/**/*.map', // prod bundle'da .map sızmasın
      },
      telemetry: false,
    })
  : null;

export default defineConfig({
  plugins: [react(), ...(sentryPlugin ? [sentryPlugin] : [])],
  build: {
    // Source map sadece Sentry upload için üretilir. Auth token yoksa .map dosyaları
    // dist'e sızmasın diye sourcemap kapalı tutulur (önceki davranış).
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? true : false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
