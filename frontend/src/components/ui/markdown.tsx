import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  children: string;
  className?: string;
}

/**
 * Shared markdown renderer with GitHub Flavored Markdown support
 * (tables, strikethrough, autolinks, task lists).
 *
 * Wraps the content in a prose container with table-specific styles:
 * wide tables get horizontal scrolling instead of breaking the layout.
 */
export function Markdown({ children, className = '' }: MarkdownProps) {
  return (
    <div
      className={`prose prose-sm max-w-none dark:prose-invert
        prose-table:my-3 prose-table:text-xs
        prose-th:bg-accent prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1.5 prose-th:text-left
        prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1.5
        prose-p:leading-relaxed
        prose-headings:text-foreground prose-strong:text-foreground
        [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full
        ${className}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
