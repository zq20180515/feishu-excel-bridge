import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// https://vitejs.dev/config/
// 多维表格插件以 iframe 方式加载，必须允许跨域 iframe 嵌入 + 相对路径资源
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    // 构建期把版本号注入，反馈模板里要带上
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      // 不要设置 X-Frame-Options / CSP frame-ancestors，否则飞书 iframe 无法嵌入
    },
  },
  preview: {
    host: '0.0.0.0',
    cors: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2019',
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
})
