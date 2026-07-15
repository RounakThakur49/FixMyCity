import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all /api/* requests to the Express backend on port 5000.
      // This covers every route: /api/auth/*, /api/complaints/*, /api/superadmin/*, etc.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
