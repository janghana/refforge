import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // For GitHub Pages, set base to '/<repo-name>/'
  // For Vercel or custom domain, keep as '/'
  base: '/',
})
