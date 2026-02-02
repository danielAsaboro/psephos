import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Optimize bundle size
    target: 'esnext',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        // Manual chunk splitting for optimal loading
        manualChunks: {
          // Core React dependencies in vendor chunk
          'vendor-react': ['react', 'react-dom'],
          // Solana dependencies in separate chunk
          'vendor-solana': ['@solana/kit', '@solana/client', '@solana/react-hooks'],
        },
        // Ensure proper chunk naming
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
          return `assets/[name]-${facadeModuleId}-[hash].js`;
        },
      },
    },
    // Increase chunk size warning limit since we've optimized
    chunkSizeWarningLimit: 1000,
  },
  optimizeDeps: {
    // Pre-bundle these dependencies for faster dev server
    include: ['react', 'react-dom', '@solana/kit', '@solana/client'],
  },
  server: {
    // Configure proxy for proof API during development
    proxy: {
      '/api/proof': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proof/, ''),
      },
    },
  },
});
