import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**', '**/*.spec.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three')) {
            return 'vendor-three';
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (
            id.includes('node_modules/zod') ||
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/immer') ||
            id.includes('node_modules/zundo')
          ) {
            return 'vendor-core';
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
