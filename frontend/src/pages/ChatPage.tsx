import { useCallback, useState } from 'react';
import {
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getConversations,
  createConversation,
  deleteConversation,
} from '@/api/chat';
import { getKnowledgeBases } from '@/api/knowledge-bases';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ChatWindow } from '@/components/chat/ChatWindow';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedKbId, setSelectedKbId] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations', search],
    queryFn: () => getConversations(search || undefined),
  });

  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: getKnowledgeBases,
  });

  const createMutation = useMutation({
    mutationFn: () => createConversation(undefined, selectedKbId || undefined),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setSelectedKbId('');
      navigate(`/chat/${conv.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate('/chat');
    },
  });

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (confirm('Удалить диалог?')) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation],
  );

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-3 space-y-2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск диалогов..."
              className="w-full text-xs bg-background border border-border rounded-lg pl-8 pr-2.5 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
            />
          </div>
          {knowledgeBases.length > 0 && (
            <select
              value={selectedKbId}
              onChange={(e) => setSelectedKbId(e.target.value)}
              className="w-full text-xs bg-background border border-border rounded-lg px-2.5 py-1.5 text-foreground"
            >
              <option value="">Без базы знаний</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))}
            </select>
          )}
          <Button
            className="w-full rounded-xl"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            + Новый диалог
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => navigate(`/chat/${conv.id}`)}
              className={`group flex items-center justify-between px-3 py-2.5 mx-1.5 my-0.5 cursor-pointer text-sm transition-all rounded-xl ${
                conv.id === conversationId
                  ? 'bg-[#21a038]/10 text-foreground font-medium'
                  : 'text-foreground/60 hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="truncate flex-1">{conv.title}</span>
              <button
                onClick={(e) => handleDelete(e, conv.id)}
                className="ml-2 opacity-0 group-hover:opacity-100 hover:text-destructive text-xs transition-opacity"
                title="Удалить"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1">
        {conversationId ? (
          <ChatWindow conversationId={conversationId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
            <div className="w-20 h-20 rounded-full bg-[#21a038]/10 flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p className="text-sm">Выберите диалог или создайте новый</p>
          </div>
        )}
      </div>
    </div>
  );
}
