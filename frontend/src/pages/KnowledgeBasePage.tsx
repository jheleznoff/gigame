import { useParams } from 'react-router-dom';
import { KBDetail } from '@/components/knowledge-base/KBDetail';

export function KnowledgeBasePage() {
  const { kbId } = useParams<{ kbId: string }>();

  if (kbId) {
    return <KBDetail kbId={kbId} />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
      <div className="w-20 h-20 rounded-full bg-[#21a038]/10 flex items-center justify-center">
        <svg
          width="36"
          height="36"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#21a038"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>
      <p className="text-sm">Выберите базу знаний или создайте новую</p>
    </div>
  );
}
