import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  isPathSafe,
  parseCommand,
  processBashCommands,
  processFileIncludes,
  replaceArguments,
  sanitizeOutput,
  validateCommand,
} from '../../../server/utils/commandParser.js';

describe('commandParser', () => {
  it('parses YAML frontmatter and markdown body', () => {
    const command = parseCommand('---\ntitle: Demo\ncategory: testing\n---\nRun checks');

    expect(command.data).toEqual({ title: 'Demo', category: 'testing' });
    expect(command.content.trim()).toBe('Run checks');
    expect(command.raw).toContain('title: Demo');
  });

  it('replaces positional placeholders and $ARGUMENTS', () => {
    const content = 'Run $1 then $2 with $ARGUMENTS';

    expect(replaceArguments(content, ['lint', 'test'])).toBe('Run lint then test with lint test');
    expect(replaceArguments(content, 'deploy')).toBe('Run deploy then  with deploy');
  });

  it('allows only paths inside the base directory', () => {
    expect(isPathSafe('docs/readme.md', '/tmp/project')).toBe(true);
    expect(isPathSafe('../secrets.txt', '/tmp/project')).toBe(false);
  });

  it('processes nested file includes from the same directory', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'command-parser-'));

    try {
      await fs.writeFile(path.join(tempDir, 'a.txt'), 'Alpha @b.txt', 'utf8');
      await fs.writeFile(path.join(tempDir, 'b.txt'), 'Beta', 'utf8');

      const result = await processFileIncludes('Start @a.txt End', tempDir);
      expect(result).toBe('Start Alpha Beta End');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects missing or unsafe include paths', async () => {
    await expect(processFileIncludes('Look @missing.txt', '/tmp')).rejects.toThrow('File not found: missing.txt');
    await expect(processFileIncludes('Look @../secret.txt', '/tmp')).rejects.toThrow('directory traversal');
  });

  it('validates allowed commands and rejects risky shells syntax', () => {
    expect(validateCommand('git status')).toEqual({
      allowed: true,
      command: 'git',
      args: ['status'],
    });

    expect(validateCommand('npm test && rm -rf /')).toMatchObject({
      allowed: false,
      error: expect.stringContaining('Shell operators'),
    });

    expect(validateCommand('rm -rf /')).toMatchObject({
      allowed: false,
      command: 'rm',
      error: expect.stringContaining('allowlist'),
    });

    expect(validateCommand('git show main[1]')).toMatchObject({
      allowed: false,
      error: expect.stringContaining('dangerous characters'),
    });
  });

  it('sanitizes control characters while keeping newlines and tabs', () => {
    expect(sanitizeOutput('ok\u0000\u0008\n\tstill here\u007f')).toBe('ok\n\tstill here');
  });

  it('executes allowed bash commands and injects their output', async () => {
    const result = await processBashCommands('Before\n!echo hello\nAfter');

    expect(result).toContain('Before');
    expect(result).toContain('hello');
    expect(result).toContain('After');
  });

  it('rejects disallowed bash commands', async () => {
    await expect(processBashCommands('!rm -rf /tmp/demo')).rejects.toThrow('Command not allowed');
  });
});
