// @vitest-environment jsdom

import { vi } from 'vitest';
import {
  collectExpandedDirectoryPaths,
  filterFileTree,
  formatFileSize,
  formatRelativeTime,
  isImageFile,
} from '../../src/components/file-tree/utils/fileTreeUtils';

const tree = [
  {
    name: 'src',
    type: 'directory',
    path: 'src',
    children: [
      { name: 'App.tsx', type: 'file', path: 'src/App.tsx', size: 2048 },
      {
        name: 'assets',
        type: 'directory',
        path: 'src/assets',
        children: [{ name: 'logo.png', type: 'file', path: 'src/assets/logo.png' }],
      },
    ],
  },
  { name: 'README.md', type: 'file', path: 'README.md', size: 512 },
];

const t = (key: string, options?: { count?: number }) =>
  options?.count ? `${key}:${options.count}` : key;

describe('fileTreeUtils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters nested trees while keeping matching parent directories', () => {
    expect(filterFileTree(tree, 'logo')).toEqual([
      {
        name: 'src',
        type: 'directory',
        path: 'src',
        children: [
          {
            name: 'assets',
            type: 'directory',
            path: 'src/assets',
            children: [{ name: 'logo.png', type: 'file', path: 'src/assets/logo.png', children: [] }],
          },
        ],
      },
    ]);

    expect(filterFileTree(tree, 'readme')).toEqual([
      { name: 'README.md', type: 'file', path: 'README.md', size: 512, children: [] },
    ]);
  });

  it('collects expanded directory paths from filtered trees', () => {
    expect(collectExpandedDirectoryPaths(tree)).toEqual(['src', 'src/assets']);
  });

  it('formats byte sizes across common ranges', () => {
    expect(formatFileSize()).toBe('0 B');
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('formats relative times and older dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    expect(formatRelativeTime('2026-03-20T11:59:45Z', t)).toBe('fileTree.justNow');
    expect(formatRelativeTime('2026-03-20T11:55:00Z', t)).toBe('fileTree.minAgo:5');
    expect(formatRelativeTime('2026-03-20T08:00:00Z', t)).toBe('fileTree.hoursAgo:4');
    expect(formatRelativeTime('2026-03-18T12:00:00Z', t)).toBe('fileTree.daysAgo:2');
    expect(formatRelativeTime('2025-12-01T00:00:00Z', t)).toBe(new Date('2025-12-01T00:00:00Z').toLocaleDateString());
    expect(formatRelativeTime(undefined, t)).toBe('-');
  });

  it('recognizes image files by extension', () => {
    expect(isImageFile('photo.png')).toBe(true);
    expect(isImageFile('archive.zip')).toBe(false);
    expect(isImageFile('vector.SVG')).toBe(true);
  });
});
