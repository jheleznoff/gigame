import { useState, useEffect, useRef, type ReactNode } from 'react';

interface ResizablePanelProps {
  children: ReactNode;
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * A right-docked panel whose left edge can be dragged to resize its width.
 * Width is persisted to localStorage when storageKey is provided.
 */
export function ResizablePanel({
  children,
  storageKey = 'scenario-side-panel-width',
  defaultWidth = 320,
  minWidth = 240,
  maxWidth = 720,
}: ResizablePanelProps) {
  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const n = parseInt(stored, 10);
        if (!Number.isNaN(n) && n >= minWidth && n <= maxWidth) return n;
      }
    } catch {
      /* noop */
    }
    return defaultWidth;
  });

  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      /* noop */
    }
  }, [width, storageKey]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      // Panel is docked on the right — dragging left grows it
      const dx = startXRef.current - ev.clientX;
      const next = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + dx));
      setWidth(next);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClick = () => setWidth(defaultWidth);

  return (
    <div className="relative flex-shrink-0" style={{ width: `${width}px` }}>
      {/* Drag handle — narrow strip on the left edge of the panel */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Перетащите, чтобы изменить ширину. Двойной клик — сброс."
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize z-20 group flex items-center justify-center"
      >
        <div className="w-0.5 h-full bg-transparent group-hover:bg-[#21a038]/40 group-active:bg-[#21a038] transition-colors" />
      </div>
      <div className="w-full h-full">{children}</div>
    </div>
  );
}
