import { useState, useRef, type ReactNode, type DragEvent } from 'react';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

export function DropZone({ onFiles, accept = '.pdf,.docx,.xlsx,.xls,.txt', multiple = true, disabled, children, className = '' }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.items.length > 0) setDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    dragCounter.current = 0;
    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    const acceptExts = accept.split(',').map(s => s.trim().toLowerCase());
    const valid = files.filter(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return acceptExts.includes(ext);
    });

    if (valid.length > 0) {
      onFiles(multiple ? valid : [valid[0]]);
    }
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative ${className} ${dragging ? 'ring-2 ring-[#21a038] ring-offset-2 bg-[#21a038]/5' : ''} transition-all`}
    >
      {children}
      {dragging && (
        <div className="absolute inset-0 bg-[#21a038]/10 rounded-xl flex items-center justify-center z-10 pointer-events-none">
          <div className="bg-white rounded-xl px-4 py-2 shadow-lg text-sm font-medium text-[#21a038]">
            Отпустите файлы здесь
          </div>
        </div>
      )}
    </div>
  );
}
