import {
  buildFilePathCandidates,
  getGitErrorDetails,
  isMissingHeadRevisionError,
  normalizeRepositoryRelativeFilePath,
  parseStatusFilePaths,
  stripDiffHeaders,
  validateBranchName,
  validateCommitRef,
  validateFilePath,
  validateProjectPath,
  validateRemoteName,
} from '../../../server/routes/git.js';

describe('git route helpers', () => {
  it('validates commit refs and branch names defensively', () => {
    expect(validateCommitRef('HEAD~1')).toBe('HEAD~1');
    expect(() => validateCommitRef('main; rm -rf /')).toThrow('Invalid commit reference');

    expect(validateBranchName('feature/add-tests')).toBe('feature/add-tests');
    expect(() => validateBranchName('feature branch')).toThrow('Invalid branch name');
  });

  it('validates file paths, project paths, and remotes', () => {
    expect(validateFilePath('src/index.js', '/tmp/project')).toBe('src/index.js');
    expect(() => validateFilePath('../secret.txt', '/tmp/project')).toThrow('path traversal detected');

    expect(validateRemoteName('origin')).toBe('origin');
    expect(() => validateRemoteName('origin;rm')).toThrow('Invalid remote name');

    expect(validateProjectPath('/tmp/project')).toBe('/tmp/project');
    expect(() => validateProjectPath('/')).toThrow('root directory not allowed');
  });

  it('strips diff headers and keeps hunks only', () => {
    const diff = [
      'diff --git a/file.txt b/file.txt',
      'index 123..456 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1 +1 @@',
      '-old line',
      '+new line',
    ].join('\n');

    expect(stripDiffHeaders(diff)).toBe(['@@ -1 +1 @@', '-old line', '+new line'].join('\n'));
  });

  it('normalizes repository-relative paths and parses porcelain output', () => {
    expect(normalizeRepositoryRelativeFilePath('./src\\index.ts')).toBe('src/index.ts');
    expect(normalizeRepositoryRelativeFilePath('/README.md')).toBe('README.md');

    expect(parseStatusFilePaths('M  src/index.ts\nR  old.txt -> new.txt\n')).toEqual([
      'src/index.ts',
      'new.txt',
    ]);
  });

  it('builds candidate paths for nested project directories', () => {
    expect(buildFilePathCandidates('/repo/packages/app', '/repo', 'src/index.ts')).toEqual([
      'src/index.ts',
      'packages/app/src/index.ts',
    ]);

    expect(buildFilePathCandidates('/repo', '/repo', 'src/index.ts')).toEqual(['src/index.ts']);
  });

  it('recognizes missing HEAD revision errors', () => {
    expect(getGitErrorDetails({ message: 'bad revision', stderr: 'unknown revision HEAD', stdout: '' })).toContain('unknown revision HEAD');
    expect(isMissingHeadRevisionError({ message: 'bad revision HEAD', stderr: '', stdout: '' })).toBe(true);
    expect(isMissingHeadRevisionError({ message: 'permission denied', stderr: '', stdout: '' })).toBe(false);
  });
});
