import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function buildStampPlugin(): Plugin {
  const builtAt = new Date().toISOString()
  const mode = process.env.NODE_ENV === 'production' ? 'build' : 'dev'

  return {
    name: 'build-stamp',
    transformIndexHtml(html) {
      const stamp = `${mode}@${builtAt}`
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
