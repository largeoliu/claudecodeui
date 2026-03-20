import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5_000;

function appendOutput(state, chunk, maxBytes) {
  const text = chunk.toString();
  state.totalBytes += Buffer.byteLength(text);

  if (state.bytes >= maxBytes) {
    state.truncated = true;
    return;
  }

  const remainingBytes = maxBytes - state.bytes;
  const textBytes = Buffer.byteLength(text);
  if (textBytes <= remainingBytes) {
    state.value += text;
    state.bytes += textBytes;
    return;
  }

  state.value += Buffer.from(text).subarray(0, remainingBytes).toString('utf8');
  state.bytes = maxBytes;
  state.truncated = true;
}

function createProcessError(message, code, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  error.code = code;
  return error;
}

export function createRequestAbortController(req, res) {
  const controller = new AbortController();

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(createProcessError('Client closed request', 'ERR_CLIENT_ABORTED'));
    }
  };

  req?.once?.('aborted', abort);
  req?.once?.('close', abort);
  res?.once?.('close', abort);

  return {
    controller,
    signal: controller.signal,
    cleanup() {
      req?.removeListener?.('aborted', abort);
      req?.removeListener?.('close', abort);
      res?.removeListener?.('close', abort);
    },
  };
}

export function killProcess(proc, forceAfterMs = DEFAULT_FORCE_KILL_TIMEOUT_MS) {
  if (!proc || proc.killed || !proc.pid) {
    return null;
  }

  const killGroup = (signal) => {
    if (process.platform !== 'win32') {
      process.kill(-proc.pid, signal);
      return;
    }
    proc.kill(signal);
  };

  try {
    killGroup('SIGTERM');
  } catch {
    try {
      proc.kill('SIGTERM');
    } catch {
      return null;
    }
  }

  const forceTimer = setTimeout(() => {
    try {
      killGroup('SIGKILL');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore final kill errors.
      }
    }
  }, forceAfterMs);

  if (typeof forceTimer.unref === 'function') {
    forceTimer.unref();
  }

  return forceTimer;
}

export function startManagedProcess(command, args = [], options = {}) {
  const {
    cwd,
    env,
    shell = false,
    stdio = ['ignore', 'pipe', 'pipe'],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    forceKillAfterMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
    maxStdoutBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxStderrBytes = DEFAULT_MAX_OUTPUT_BYTES,
    signal,
    input,
    detached = process.platform !== 'win32',
  } = options;

  const child = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    shell,
    stdio,
    detached,
  });

  const stdoutState = { value: '', bytes: 0, totalBytes: 0, truncated: false };
  const stderrState = { value: '', bytes: 0, totalBytes: 0, truncated: false };
  let settled = false;
  let timeoutTriggered = false;
  let abortTriggered = false;
  let forceTimer = null;

  const cleanup = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeoutId);
    if (forceTimer) {
      clearTimeout(forceTimer);
      forceTimer = null;
    }
    if (signal && removeAbortListener) {
      signal.removeEventListener('abort', removeAbortListener);
    }
  };

  const terminate = () => {
    if (forceTimer) {
      return;
    }
    forceTimer = killProcess(child, forceKillAfterMs);
  };

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      appendOutput(stdoutState, chunk, maxStdoutBytes);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      appendOutput(stderrState, chunk, maxStderrBytes);
    });
  }

  if (input !== undefined && child.stdin) {
    child.stdin.write(input);
    child.stdin.end();
  } else if (child.stdin && stdio[0] === 'pipe') {
    child.stdin.end();
  }

  const timeoutId = timeoutMs > 0
    ? setTimeout(() => {
        timeoutTriggered = true;
        terminate();
      }, timeoutMs)
    : null;

  if (timeoutId && typeof timeoutId.unref === 'function') {
    timeoutId.unref();
  }

  let removeAbortListener = null;
  if (signal) {
    removeAbortListener = () => {
      abortTriggered = true;
      terminate();
    };

    if (signal.aborted) {
      removeAbortListener();
    } else {
      signal.addEventListener('abort', removeAbortListener, { once: true });
    }
  }

  const wait = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });

    child.once('close', (code, closeSignal) => {
      cleanup();
      resolve({
        code,
        signal: closeSignal,
        stdout: stdoutState.value,
        stderr: stderrState.value,
        stdoutTruncated: stdoutState.truncated,
        stderrTruncated: stderrState.truncated,
        stdoutBytes: stdoutState.totalBytes,
        stderrBytes: stderrState.totalBytes,
        timedOut: timeoutTriggered,
        aborted: abortTriggered,
      });
    });
  });

  return {
    child,
    kill: terminate,
    wait,
  };
}

export async function runCommand(command, args = [], options = {}) {
  const managed = startManagedProcess(command, args, options);
  const result = await managed.wait;

  if (result.aborted) {
    throw createProcessError('Client closed request', 'ERR_CLIENT_ABORTED', result);
  }

  if (result.timedOut) {
    throw createProcessError(`Command timed out after ${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms`, 'ETIMEDOUT', result);
  }

  if (!options.allowNonZeroExit && result.code !== 0) {
    throw createProcessError(
      `Command failed: ${command} ${args.join(' ')}`,
      'ERR_PROCESS_EXIT',
      result,
    );
  }

  return result;
}
