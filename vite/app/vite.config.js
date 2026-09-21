// -----------------------------------------------------------
//  [*] Config — Vite
//
//  Dev server binds 0.0.0.0:80 with allowedHosts open so the
//  dockerized dev container is reachable through the Caddy
//  ingress; production serves the built dist/ via Caddy
//  instead (see vite/Dockerfile).
// -----------------------------------------------------------

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'


export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  preview: {
    allowedHosts: true
  },
  server: {
    host: '0.0.0.0',
    port: 80,
    allowedHosts: true,
  },
})
