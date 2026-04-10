import type { ReactNode } from 'react';

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
  emptyText,
  renderExtraActions,
}: SidebarListProps<T>) {
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
            onClick={() => onClick(item.id)}
            className={`group flex items-center justify-between px-3 py-2 mx-1.5 my-0.5 cursor-pointer text-sm transition-all rounded-xl ${
              item.id === activeId
                ? 'bg-[#21a038]/10 text-foreground font-medium'
                : 'text-foreground/60 hover:bg-accent hover:text-foreground'
            }`}
          >
            <span className="truncate flex-1">{item.title}</span>
            <div className="ml-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
