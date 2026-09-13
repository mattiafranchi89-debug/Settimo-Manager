import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Firebase is the heaviest dependency and almost never changes:
        // isolating it lets the browser reuse it across releases instead of
        // downloading the whole application again after every deploy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('firebase') || id.includes('@firebase')) return 'firebase';
          if (id.includes('react-router')) return 'router';
          if (id.includes('react')) return 'react';
        }
      }
    }
  }
});
