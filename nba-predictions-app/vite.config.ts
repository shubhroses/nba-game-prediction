/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite can copy into the bundle any variable of the build environment whose
  // name starts with this prefix. Its default, VITE_, would also cover the
  // variable that held the API key when the page asked the provider itself.
  // The page reads two variables, VITE_DATA_BASE_URL and VITE_DATA_NOW.
  envPrefix: 'VITE_DATA_',
  test: {
    // Vitest hands a test an empty file in place of a stylesheet. The test of
    // the colors reads the stylesheet as text, and this lets it through.
    css: { include: /\.css\?raw$/ },
  },
})
