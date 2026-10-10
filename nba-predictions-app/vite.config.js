import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite can copy into the bundle any variable of the build environment whose
  // name starts with this prefix. Its default, VITE_, would also cover the
  // variable that held the API key when the page asked the provider itself.
  // The page reads one variable, VITE_DATA_BASE_URL.
  envPrefix: 'VITE_DATA_',
})
