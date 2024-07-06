import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  esbuild: {
    supported: {
      'top-level-await': true //browsers can handle top-level-await features
    },
  },
  base: '',
  plugins: [
    react(),
    wasm({
      exclude: ['vite-plugin-wasm-namespace:C:\code\js\ezshare\ezshare-frontend\node_modules\argon2-browser\dist\argon2.wasm']
    })
  ],
  server: {    
    open: false,
    port: 3000, 
  },
});
