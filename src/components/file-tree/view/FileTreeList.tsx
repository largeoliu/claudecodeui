import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { FileTreeNode as FileTreeNodeType, FileTreeViewMode } from '../types/types';
import FileTreeNode from './FileTreeNode';

type FlatFileTreeItem = {
  item: FileTreeNodeType;
  level: number;
};

type FileTreeListProps = {
  items: FileTreeNodeType[];
  viewMode: FileTreeViewMode;
  scrollContainerRef: RefObject<HTMLDivElement>;
  expandedDirs: Set<string>;
  onItemClick: (item: FileTreeNodeType) => void;
  renderFileIcon: (filename: string) => ReactNode;
  formatFileSize: (bytes?: number) => string;
  formatRelativeTime: (date?: string) => string;
  onRename?: (item: FileTreeNodeType) => void;
  onDelete?: (item: FileTreeNodeType) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onCopyPath?: (item: FileTreeNodeType) => void;
  onDownload?: (item: FileTreeNodeType) => void;
  onRefresh?: () => void;
  renamingItem?: FileTreeNodeType | null;
  renameValue?: string;
  setRenameValue?: (value: string) => void;
  handleConfirmRename?: () => void;
  handleCancelRename?: () => void;
  renameInputRef?: RefObject<HTMLInputElement>;
  operationLoading?: boolean;
};

function flattenVisibleItems(
  items: FileTreeNodeType[],
  expandedDirs: Set<string>,
  level = 0,
): FlatFileTreeItem[] {
  const flattened: FlatFileTreeItem[] = [];

  items.forEach((item) => {
    flattened.push({ item, level });

    if (item.type === 'directory' && expandedDirs.has(item.path) && item.children?.length) {
      flattened.push(...flattenVisibleItems(item.children, expandedDirs, level + 1));
    }
  });

  return flattened;
}

export default function FileTreeList({
  items,
  viewMode,
  scrollContainerRef,
  expandedDirs,
  onItemClick,
  renderFileIcon,
  formatFileSize,
  formatRelativeTime,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onCopyPath,
  onDownload,
  onRefresh,
  renamingItem,
  renameValue,
  setRenameValue,
  handleConfirmRename,
  handleCancelRename,
  renameInputRef,
  operationLoading,
}: FileTreeListProps) {
  const flatItems = useMemo(
    () => flattenVisibleItems(items, expandedDirs),
    [expandedDirs, items],
  );
  const shouldVirtualize = flatItems.length > 120;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? flatItems.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => (viewMode === 'detailed' ? 32 : 30),
    overscan: 12,
    getItemKey: (index) => flatItems[index]?.item.path ?? index,
  });
  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];

  useEffect(() => {
    if (shouldVirtualize) {
      rowVirtualizer.measure();
    }
  }, [flatItems.length, rowVirtualizer, shouldVirtualize, viewMode]);

  const renderRow = ({ item, level }: FlatFileTreeItem) => (
    <FileTreeNode
      key={item.path}
      item={item}
      level={level}
      viewMode={viewMode}
      expandedDirs={expandedDirs}
      renderChildren={false}
      onItemClick={onItemClick}
      renderFileIcon={renderFileIcon}
      formatFileSize={formatFileSize}
      formatRelativeTime={formatRelativeTime}
      onRename={onRename}
      onDelete={onDelete}
      onNewFile={onNewFile}
      onNewFolder={onNewFolder}
      onCopyPath={onCopyPath}
      onDownload={onDownload}
      onRefresh={onRefresh}
      renamingItem={renamingItem}
      renameValue={renameValue}
      setRenameValue={setRenameValue}
      handleConfirmRename={handleConfirmRename}
      handleCancelRename={handleCancelRename}
      renameInputRef={renameInputRef}
      operationLoading={operationLoading}
    />
  );

  if (!shouldVirtualize) {
    return <div>{flatItems.map(renderRow)}</div>;
  }

  return (
    <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
      {virtualItems.map((virtualItem) => {
        const flatItem = flatItems[virtualItem.index];
        if (!flatItem) {
          return null;
        }

        return (
          <div
            key={virtualItem.key}
            ref={rowVirtualizer.measureElement}
            data-index={virtualItem.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {renderRow(flatItem)}
          </div>
        );
      })}
    </div>
  );
}
