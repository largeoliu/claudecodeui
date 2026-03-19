// @vitest-environment jsdom

import {
  getParentPath,
  getSuggestionRootPath,
  isCloneWorkflow,
  isSshGitUrl,
  joinFolderPath,
  shouldShowGithubAuthentication,
} from '../../src/components/project-creation-wizard/utils/pathUtils';

describe('pathUtils', () => {
  it('detects SSH Git URLs and clone workflows', () => {
    expect(isSshGitUrl('git@github.com:siteboon/claudecodeui.git')).toBe(true);
    expect(isSshGitUrl('ssh://git@github.com/siteboon/claudecodeui.git')).toBe(true);
    expect(isSshGitUrl('https://github.com/siteboon/claudecodeui')).toBe(false);

    expect(shouldShowGithubAuthentication('new', 'https://github.com/siteboon/claudecodeui')).toBe(true);
    expect(shouldShowGithubAuthentication('new', 'git@github.com:siteboon/claudecodeui.git')).toBe(false);
    expect(shouldShowGithubAuthentication('existing', 'https://github.com/siteboon/claudecodeui')).toBe(false);

    expect(isCloneWorkflow('new', 'https://github.com/siteboon/claudecodeui')).toBe(true);
    expect(isCloneWorkflow('existing', 'https://github.com/siteboon/claudecodeui')).toBe(false);
  });

  it('derives suggestion roots for empty, Unix, and Windows paths', () => {
    expect(getSuggestionRootPath('')).toBe('~');
    expect(getSuggestionRootPath('/Users/alice/work/demo')).toBe('/Users/alice/work');
    expect(getSuggestionRootPath('/')).toBe('/');
    expect(getSuggestionRootPath('C:')).toBe('C:\\');
    expect(getSuggestionRootPath('C:\\Users\\alice\\demo')).toBe('C:\\Users\\alice');
  });

  it('resolves parent folders and joins child folders consistently', () => {
    expect(getParentPath('~')).toBeNull();
    expect(getParentPath('/')).toBeNull();
    expect(getParentPath('/Users/alice/demo')).toBe('/Users/alice');
    expect(getParentPath('docs')).toBe('/');
    expect(getParentPath('C:\\')).toBeNull();
    expect(getParentPath('C:\\Users\\alice')).toBe('C:\\Users');

    expect(joinFolderPath('/Users/alice', 'demo')).toBe('/Users/alice/demo');
    expect(joinFolderPath('C:\\Users\\alice\\', 'demo')).toBe('C:\\Users\\alice\\demo');
  });
});
