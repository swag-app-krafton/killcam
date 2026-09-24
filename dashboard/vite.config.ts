import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Dev server only: `?fakeNative=1` injects a stub window.KillcamNative (dev/fake-native.js). */
function fakeNativeInDev(): Plugin {
  return {
    name: 'killcam-fake-native',
    apply: 'serve',
    transformIndexHtml(html) {
      const stub = readFileSync(new URL('./dev/fake-native.js', import.meta.url), 'utf8');
      return html.replace('<head>', `<head>\n    <script>${stub}</script>`);
    },
  };
}

/** Where the Kotlin server picks the dashboard up from (served at `/`). */
const outDir = fileURLToPath(
  new URL('../killcam-core/src/main/resources/killcam-web', import.meta.url),
);

/** The device (via `adb forward tcp:8090 tcp:8090`) or `npm run mock`. */
const target = process.env.KILLCAM_URL ?? 'http://localhost:8090';

export default defineConfig({
  base: './',
  plugins: [react(), fakeNativeInDev()],
  // The same alias as swagperf, so vendored design-system imports resolve unchanged.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir,
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target,
        // Keep Host as localhost:5173: the device only accepts localhost / IP-literal hosts.
        changeOrigin: false,
        ws: false,
        configure(proxy) {
          // Ask for identity encoding so SSE (/api/live) is never compressed and buffered.
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('accept-encoding', 'identity');
          });
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            const type = String(proxyRes.headers['content-type'] ?? '');
            if (type.startsWith('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
              proxyRes.headers['x-accel-buffering'] = 'no';
              res.once('pipe', () => res.flushHeaders());
            }
          });
        },
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target, changeOrigin: false },
    },
  },
});
