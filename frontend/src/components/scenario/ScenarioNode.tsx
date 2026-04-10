import { Handle, Position, type NodeProps } from '@xyflow/react';

const NODE_STYLES: Record<string, { bg: string; border: string; iconBg: string; icon: JSX.Element; label: string }> = {
  input: {
    bg: 'bg-white', border: 'border-[#21a038]', iconBg: 'bg-[#21a038]', label: 'Вход',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>,
  },
  output: {
    bg: 'bg-white', border: 'border-[#21a038]', iconBg: 'bg-[#21a038]', label: 'Выход',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M19 12l-7-7v4H4v6h8v4l7-7z"/></svg>,
  },
  classification: {
    bg: 'bg-white', border: 'border-[#f57c00]', iconBg: 'bg-[#f57c00]', label: 'Классификация',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="0"><path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/></svg>,
  },
  extraction: {
    bg: 'bg-white', border: 'border-[#1976d2]', iconBg: 'bg-[#1976d2]', label: 'Извлечение',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  },
  processing: {
    bg: 'bg-white', border: 'border-[#7b1fa2]', iconBg: 'bg-[#7b1fa2]', label: 'Обработка',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
  loop: {
    bg: 'bg-white', border: 'border-[#00897b]', iconBg: 'bg-[#00897b]', label: 'Цикл',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
  },
  condition: {
    bg: 'bg-white', border: 'border-[#e53935]', iconBg: 'bg-[#e53935]', label: 'Условие',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-6"/><path d="M21 3l-9 9-9-9"/></svg>,
  },
  loop_subgraph: {
    bg: 'bg-white', border: 'border-[#6a1b9a]', iconBg: 'bg-[#6a1b9a]', label: 'Цикл + ветки',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M17 3l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 21l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  },
  switch: {
    bg: 'bg-white', border: 'border-[#ff6f00]', iconBg: 'bg-[#ff6f00]', label: 'Switch',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 8l4 4-4 4"/><path d="M2 12h20"/><path d="M18 4l4 4"/><path d="M18 20l4-4"/></svg>,
  },
  if_node: {
    bg: 'bg-white', border: 'border-[#0277bd]', iconBg: 'bg-[#0277bd]', label: 'If',
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M12 3v6"/><path d="M6 15l6-6 6 6"/><path d="M6 21h5"/><path d="M13 21h5"/></svg>,
  },
};

// Visual styles per execution status (overrides static border)
const EXEC_STYLES: Record<string, { ring: string; badge: { bg: string; text: string; label: string } }> = {
  running: {
    ring: 'ring-4 ring-[#1976d2]/40 shadow-[0_0_24px_rgba(25,118,210,0.5)] animate-pulse',
    badge: { bg: 'bg-[#1976d2]', text: 'text-white', label: '⚡ выполняется' },
  },
  paused: {
    ring: 'ring-4 ring-[#ff9800]/50 shadow-[0_0_24px_rgba(255,152,0,0.5)]',
    badge: { bg: 'bg-[#ff9800]', text: 'text-white', label: '⏸ пауза' },
  },
  completed: {
    ring: 'ring-2 ring-[#21a038]/40',
    badge: { bg: 'bg-[#21a038]', text: 'text-white', label: '✓' },
  },
  failed: {
    ring: 'ring-4 ring-[#e53935]/50 shadow-[0_0_24px_rgba(229,57,53,0.4)]',
    badge: { bg: 'bg-[#e53935]', text: 'text-white', label: '✗ ошибка' },
  },
  skipped: {
    ring: 'ring-2 ring-gray-300 opacity-50',
    badge: { bg: 'bg-gray-400', text: 'text-white', label: '⊘ пропущено' },
  },
};

export function ScenarioNode({ data, type, selected }: NodeProps) {
  const style = NODE_STYLES[type || ''] || NODE_STYLES.processing;
  const dataObj = data as Record<string, string>;
  const label = dataObj.label || style.label;
  const prompt = dataObj.prompt;
  const execStatus = dataObj.execStatus as string | undefined;
  const execStyle = execStatus ? EXEC_STYLES[execStatus] : undefined;

  return (
    <div
      className={`relative rounded-2xl border-2 min-w-[180px] shadow-md transition-all ${style.bg} ${style.border} ${
        execStyle ? execStyle.ring : selected ? 'shadow-lg ring-2 ring-[#21a038]/30' : 'hover:shadow-lg'
      }`}
    >
      {execStyle && (
        <div className={`absolute -top-2 left-1/2 -translate-x-1/2 ${execStyle.badge.bg} ${execStyle.badge.text} text-[9px] font-semibold px-2 py-0.5 rounded-full shadow-md whitespace-nowrap z-10`}>
          {execStyle.badge.label}
        </div>
      )}
      {type !== 'input' && (
        <Handle
          type="target"
          position={Position.Top}
          className="!bg-[#21a038] !w-3 !h-3 !border-2 !border-white"
        />
      )}

      <div className="px-5 py-4 text-center">
        <div className={`w-9 h-9 rounded-xl ${style.iconBg} flex items-center justify-center mx-auto mb-2 shadow-sm`}>
          {style.icon}
        </div>
        <div className="text-sm font-semibold text-[#1a1a1a]">{label}</div>
        {prompt && (
          <div className="text-[11px] text-[#6b7c6e] mt-1 truncate max-w-[160px] mx-auto">
            {prompt.slice(0, 35)}...
          </div>
        )}
      </div>

      {type !== 'output' && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-[#21a038] !w-3 !h-3 !border-2 !border-white"
        />
      )}
    </div>
  );
}

export const nodeTypes = {
  input: ScenarioNode,
  output: ScenarioNode,
  classification: ScenarioNode,
  extraction: ScenarioNode,
  processing: ScenarioNode,
  loop: ScenarioNode,
  condition: ScenarioNode,
  loop_subgraph: ScenarioNode,
  switch: ScenarioNode,
  if_node: ScenarioNode,
};
