import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function formatBuildStamp(date: Date, mode: 'build' | 'dev'): string {
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return mode === 'build' ? `build ${time}` : `dev ${time}`
}

function buildStampPlugin(): Plugin {
  const builtAt = new Date()
  const mode = process.env.NODE_ENV === 'production' ? 'build' : 'dev'
  const stamp = formatBuildStamp(builtAt, mode as 'build' | 'dev')

  return {
    name: 'build-stamp',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `    <meta name="app-build" content="${stamp}" />\n    <!-- Smile Battle ${stamp} -->\n  </head>`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), buildStampPlugin()],
})
