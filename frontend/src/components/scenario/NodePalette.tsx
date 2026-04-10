const PALETTE_ITEMS = [
  { type: 'input', color: 'bg-[#21a038]', label: 'Вход',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> },
  { type: 'processing', color: 'bg-[#7b1fa2]', label: 'Обработка',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2m-7.07-3.93l1.41-1.41m9.9-9.9l1.41-1.41M1 12h2m18 0h2m-3.93 7.07l-1.41-1.41m-9.9-9.9L4.93 4.93"/></svg> },
  { type: 'loop', color: 'bg-[#00897b]', label: 'Цикл',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> },
  { type: 'switch', color: 'bg-[#ff6f00]', label: 'Switch',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 8l4 4-4 4"/><path d="M2 12h20"/><path d="M18 4l4 4"/><path d="M18 20l4-4"/></svg> },
  { type: 'if_node', color: 'bg-[#0277bd]', label: 'If',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3v6"/><path d="M6 15l6-6 6 6"/><path d="M6 21h5"/><path d="M13 21h5"/></svg> },
  { type: 'output', color: 'bg-[#21a038]', label: 'Выход',
    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M19 12l-7-7v4H4v6h8v4l7-7z"/></svg> },
];

interface NodePaletteProps {
  onAdd: (type: string) => void;
}

export function NodePalette({ onAdd }: NodePaletteProps) {
  return (
    <div className="w-52 bg-card border-r border-border p-4 space-y-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        Компоненты
      </h3>
      {PALETTE_ITEMS.map((item) => (
        <button
          key={item.type}
          onClick={() => onAdd(item.type)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-accent transition-all text-left group"
        >
          <div className={`w-7 h-7 rounded-lg ${item.color} flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
            {item.icon}
          </div>
          <span className="text-foreground/80 group-hover:text-foreground">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
