import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const port = process.env.PLAYWRIGHT_E2E_PORT || '3299';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudecodeui-e2e-'));
const homeDir = path.join(tempRoot, 'home');
const databasePath = path.join(tempRoot, 'auth.db');
const gitConfigPath = path.join(tempRoot, '.gitconfig');

fs.mkdirSync(homeDir, { recursive: true });

const env = {
  ...process.env,
  SERVER_PORT: port,
  DATABASE_PATH: databasePath,
  GIT_CONFIG_GLOBAL: gitConfigPath,
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: homeDir,
  USERPROFILE: homeDir,
  XDG_CONFIG_HOME: homeDir,
  PLAYWRIGHT_E2E: '1',
};

console.log(`[playwright] Starting isolated CloudCLI UI server on port ${port}`);
console.log(`[playwright] Using temporary state at ${tempRoot}`);

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', 'server'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

let shuttingDown = false;

function cleanup() {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (!child.killed) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  cleanup();

  if (signal) {
    process.exit(0);
  }

  process.exit(code ?? 0);
});
