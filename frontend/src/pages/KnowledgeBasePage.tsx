import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
} from '@/api/knowledge-bases';
import { KBDetail } from '@/components/knowledge-base/KBDetail';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/components/ui/toast';

export function KnowledgeBasePage() {
  const { kbId } = useParams<{ kbId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases', search],
    queryFn: () => getKnowledgeBases(search || undefined),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createKnowledgeBase(name),
    onSuccess: (kb) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      setNewName('');
      setShowCreate(false);
      navigate(`/knowledge-bases/${kb.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] });
      toast('База знаний удалена', 'success');
      navigate('/knowledge-bases');
    },
    onError: () => toast('Не удалось удалить базу знаний', 'error'),
  });

  return (
    <div className="flex h-full">
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-3 space-y-2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск баз знаний..."
              className="w-full text-xs bg-background border border-border rounded-lg pl-8 pr-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
            />
          </div>
        </div>
        <div className="px-3 pb-3">
          {showCreate ? (
            <div className="flex flex-col gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название базы знаний"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    createMutation.mutate(newName.trim());
                  }
                }}
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  Создать
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowCreate(false); setNewName(''); }}
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
            <Button className="w-full" onClick={() => setShowCreate(true)}>
              Новая база знаний
            </Button>
          )}
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          {knowledgeBases.map((kb) => (
            <div
              key={kb.id}
              onClick={() => navigate(`/knowledge-bases/${kb.id}`)}
              className={`flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors ${
                kb.id === kbId
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              <span className="truncate flex-1">{kb.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Удалить базу знаний? Все документы будут удалены.')) {
                    deleteMutation.mutate(kb.id);
                  }
                }}
                className="ml-2 hover:text-destructive text-xs"
                title="Удалить"
              >
                ✕
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      <div className="flex-1">
        {kbId ? (
          <KBDetail kbId={kbId} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Выберите базу знаний или создайте новую
          </div>
        )}
      </div>
    </div>
  );
}
