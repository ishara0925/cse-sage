import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from https://<user>.github.io/cse-sage/ — keep base in sync with the repo name.
export default defineConfig({
  base: '/cse-sage/',
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'iife',
  },
})
