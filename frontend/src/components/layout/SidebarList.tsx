import { type ReactNode, useState, useRef, useEffect } from 'react';

export interface SidebarListItem {
  id: string;
  title: string;
  created_at: string;
}

interface SidebarListProps<T extends SidebarListItem> {
  items: T[];
  activeId?: string;
  onClick: (id: string) => void;
  onDelete?: (id: string) => void;
  onRename?: (id: string, newTitle: string) => void;
  emptyText: string;
  renderExtraActions?: (item: T) => ReactNode;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function SidebarList<T extends SidebarListItem>({
  items,
  activeId,
  onClick,
  onDelete,
  onRename,
  emptyText,
  renderExtraActions,
}: SidebarListProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (item: T) => {
    setEditingId(item.id);
    setEditValue(item.title);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim() && onRename) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    );
  }

  const today: T[] = [];
  const older: T[] = [];
  for (const item of items) {
    (isToday(item.created_at) ? today : older).push(item);
  }

  const renderGroup = (label: string, group: T[]) => {
    if (group.length === 0) return null;
    return (
      <div>
        <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {group.map((item) => (
          <div
            key={item.id}
            onClick={() => { if (editingId !== item.id) onClick(item.id); }}
            className={`group flex items-center justify-between px-3 py-2 mx-1.5 my-0.5 cursor-pointer text-sm transition-all rounded-xl ${
              item.id === activeId
                ? 'bg-[#21a038]/10 text-foreground font-medium'
                : 'text-foreground/60 hover:bg-accent hover:text-foreground'
            }`}
          >
            {editingId === item.id ? (
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className="flex-1 bg-background border border-border rounded px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-[#21a038]"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="truncate flex-1"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (onRename) startEdit(item);
                }}
              >
                {item.title}
              </span>
            )}
            <div className="ml-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {onRename && editingId !== item.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(item);
                  }}
                  className="p-1 rounded hover:bg-background hover:text-foreground"
                  title="Переименовать"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
              {renderExtraActions?.(item)}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  className="p-1 rounded hover:bg-background hover:text-destructive"
                  title="Удалить"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {renderGroup('Сегодня', today)}
      {renderGroup('Ранее', older)}
    </>
  );
}
