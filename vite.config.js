import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const configuredHost = env.HOST || '0.0.0.0';
  const host = normalizeLoopbackHost(configuredHost);
  const proxyHost = getConnectableHost(configuredHost);
  const serverPort = env.SERVER_PORT || env.PORT || 3001;

  return {
    plugins: [react()],
    server: {
      host,
      port: parseInt(env.VITE_PORT, 10) || 5173,
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true,
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark',
            ],
            'vendor-xterm': [
              '@xterm/xterm',
              '@xterm/addon-fit',
              '@xterm/addon-clipboard',
              '@xterm/addon-webgl',
            ],
          },
        },
      },
    },
  };
});
