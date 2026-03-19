import { spawn } from 'child_process';
import net from 'net';

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve an open port for Playwright')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

const port = process.env.PLAYWRIGHT_E2E_PORT || `${await getAvailablePort()}`;
const playwrightArgs = process.argv.slice(2);
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(`[playwright] Using E2E port ${port}`);

const child = spawn(npxCommand, ['playwright', 'test', ...playwrightArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PLAYWRIGHT_E2E_PORT: port,
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 0);
});
