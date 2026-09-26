import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT || '5173';
const port = Number(rawPort);
const basePath = process.env.BASE_PATH || '/';
const apiPort = process.env.API_PORT || '3000';

export default defineConfig(async () => {
  const plugins = [
    react(),
    tailwindcss(),
  ];

  // Optional Replit development overlays if running inside Replit
  if (process.env.REPL_ID !== undefined) {
    try {
      const runtimeErrorOverlay = (await import('@replit/vite-plugin-runtime-error-modal')).default;
      plugins.push(runtimeErrorOverlay());
    } catch {
      // Ignore if not present
    }
  }

  return {
    base: basePath,
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        '/health': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      host: '0.0.0.0',
    },
  };
});
