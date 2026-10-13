import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Demo app (fake host) dev server. Set HTTPS=1 to serve over a self-signed
// cert so a phone on the LAN can use the camera (needs a secure context).
export default defineConfig({
  root: 'demo',
  // GitHub Pages serves project sites from /<repo>/, so CI sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  server: { host: !!process.env.HTTPS },
  build: { outDir: '../dist-demo', emptyOutDir: true },
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Image tests do per-pixel work in JS; CI runners are slower than a dev machine.
    testTimeout: 30000,
  },
});
