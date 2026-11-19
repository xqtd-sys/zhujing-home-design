import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

type ProxyResponse = {
  headersSent?: boolean
  writableEnded?: boolean
  writeHead: (status: number, headers: Record<string, string>) => unknown
  end: (body?: string) => unknown
}

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Windows 上编辑器/工具会往源码目录写入 “.xxx.tmpdir/” 临时目录，
    // chokidar 监听这些被占用文件时会抛 EBUSY 直接拖垮 dev server，这里忽略掉。
    watch: {
      ignored: ['**/*.tmpdir/**', '**/.*.tmpdir/**', '**/*.tmp'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // 后端没启动或正在重启时，默认只返回一个空响应体的 500，前端只能显示“请求失败”。
        // 这里改成明确的 502 + 提示，便于一眼看出是后端没连上而不是登录逻辑出错。
        configure: (proxy) => {
          proxy.on('error', (_error, _request, response) => {
            const res = response as unknown as ProxyResponse | undefined
            if (!res || typeof res.writeHead !== 'function' || res.headersSent || res.writableEnded) return
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(
              JSON.stringify({
                code: 'API_UNREACHABLE',
                message: '无法连接后端服务，请确认 API 已启动（npm run dev:api）',
              }),
            )
          })
        },
      },
    },
  },
})
