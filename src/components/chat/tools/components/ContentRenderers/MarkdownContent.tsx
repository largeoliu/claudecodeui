import React, { Suspense, lazy } from 'react';

const Markdown = lazy(() =>
  import('../../../view/subcomponents/Markdown').then((module) => ({ default: module.Markdown }))
);

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  return (
    <Suspense fallback={<div className={className}>{content}</div>}>
      <Markdown className={className}>
        {content}
      </Markdown>
    </Suspense>
  );
};
