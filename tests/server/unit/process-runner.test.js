import { describe, expect, it } from 'vitest';

import { runCommand } from '../../../server/utils/process-runner.js';

describe('process runner', () => {
  it('caps buffered stdout to the configured maximum', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(5000))'], {
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      timeoutMs: 5_000,
    });

    expect(result.stdout.length).toBeLessThanOrEqual(1024);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdoutBytes).toBe(5000);
  });

  it('fails with a timeout error when the process hangs', async () => {
    await expect(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      timeoutMs: 100,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
    })).rejects.toMatchObject({ code: 'ETIMEDOUT' });
  });
});
