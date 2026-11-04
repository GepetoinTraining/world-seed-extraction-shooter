import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { worldSeedDatabase } from './server/vitePlugin';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // A database folder is thousands of files the server itself rewrites. Nothing there is source.
        watch: { ignored: ['**/data/**'] },
      },
      // The database comes up with the dev server: one command, one port (D31).
      plugins: [react(), worldSeedDatabase(__dirname)],
      // PGlite brings its own WebAssembly and data files, which the dependency optimizer must leave whole
      optimizeDeps: { exclude: ['@electric-sql/pglite'] },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // --- FIX START ---
          // Force Vite to look in the local node_modules for these packages
          // This bridges the gap between your source code location and your install location
          'zustand': path.resolve(__dirname, 'node_modules/zustand'),
          'react': path.resolve(__dirname, 'node_modules/react'),
          'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
          // --- FIX END ---
        }
      }
    };
});