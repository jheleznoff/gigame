import { useQuery } from '@tanstack/react-query';
import { getKnowledgeBases } from '@/api/knowledge-bases';

interface KBSelectorProps {
  value: string | null;
  onChange: (kbId: string | null) => void;
}

export function KBSelector({ value, onChange }: KBSelectorProps) {
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: getKnowledgeBases,
  });

  if (knowledgeBases.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="text-xs bg-transparent border-none text-muted-foreground focus:outline-none cursor-pointer"
      >
        <option value="">Без базы знаний</option>
        {knowledgeBases.map((kb) => (
          <option key={kb.id} value={kb.id}>{kb.name}</option>
        ))}
      </select>
    </div>
  );
}
