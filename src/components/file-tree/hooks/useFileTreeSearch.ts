import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { collectExpandedDirectoryPaths, filterFileTree } from '../utils/fileTreeUtils';
import type { FileTreeNode } from '../types/types';

type UseFileTreeSearchArgs = {
  files: FileTreeNode[];
  expandDirectories: (paths: string[]) => void;
};

type UseFileTreeSearchResult = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredFiles: FileTreeNode[];
};

export function useFileTreeSearch({
  files,
  expandDirectories,
}: UseFileTreeSearchArgs): UseFileTreeSearchResult {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

  const filteredFiles = useMemo(() => {
    if (!normalizedQuery) {
      return files;
    }

    return filterFileTree(files, normalizedQuery);
  }, [files, normalizedQuery]);

  useEffect(() => {
    if (!normalizedQuery) {
      return;
    }

    // Keep search results visible by opening every matching ancestor directory once per query update.
    expandDirectories(collectExpandedDirectoryPaths(filteredFiles));
  }, [expandDirectories, filteredFiles, normalizedQuery]);

  return {
    searchQuery,
    setSearchQuery,
    filteredFiles,
  };
}
