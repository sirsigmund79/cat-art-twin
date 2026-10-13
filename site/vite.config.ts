import { defineConfig } from 'vite';

export default defineConfig({
  root: 'site',
  // Relative asset paths so the build works from a subpath (GitHub Pages) or a root domain (Cloudflare Pages).
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
  // Transformers.js ships its own WASM; let it load that at runtime.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { fs: { allow: ['..'] } },
});
