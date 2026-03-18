module.exports = {
  apps: [
    {
      name: 'claudecodeui',
      cwd: '/opt/claudecodeui',
      script: 'server/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 5000,
      env: {
        HOST: '127.0.0.1',
        SERVER_PORT: '3001',
        NODE_ENV: 'production',
      },
    },
  ],
};
