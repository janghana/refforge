import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages: /<repo-name>/ 형태로 배포됨
  // 본인 repo 이름으로 변경하세요 (커스텀 도메인 쓰면 '/'로 변경)
  base: '/',
})
