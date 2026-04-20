import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getConversation, type Message } from '@/api/chat';
import { streamApi } from '@/api/client';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { KBSelector } from './KBSelector';
import { toast } from '@/components/ui/toast';

interface ChatWindowProps {
  conversationId: string;
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortedRef = useRef(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastUsage, setLastUsage] = useState<{ total_tokens: number } | null>(null);

  const { data: conversation, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversation?.messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    setLastUsage(null);
  }, [conversationId]);

  useEffect(() => {
    abortedRef.current = false;
    return () => {
      abortedRef.current = true;
    };
  }, [conversationId]);

  const handleSend = useCallback(
    async (content: string, files?: File[]) => {
      const hasFiles = files && files.length > 0;

      queryClient.setQueryData(
        ['conversation', conversationId],
        (old: typeof conversation) => {
          if (!old) return old;
          return {
            ...old,
            messages: [
              ...old.messages,
              {
                id: crypto.randomUUID(),
                conversation_id: conversationId,
                role: 'user' as const,
                content,
                document_ids: hasFiles ? ['pending'] : [],
                created_at: new Date().toISOString(),
              },
            ],
          };
        },
      );

      setIsStreaming(true);
      setStreamingContent(hasFiles ? `Обработка ${files!.length} документ(ов)...` : '');
      setLastUsage(null);

      try {
        let streamPath: string;
        let streamBody: object | FormData;

        if (hasFiles) {
          const formData = new FormData();
          formData.append('content', content);
          for (const file of files!) {
            formData.append('files', file);
          }
          streamPath = `/conversations/${conversationId}/messages/upload`;
          streamBody = formData;
        } else {
          streamPath = `/conversations/${conversationId}/messages`;
          streamBody = { content };
        }

        abortedRef.current = false;
        const stream = streamApi(streamPath, streamBody);
        let full = '';
        for await (const event of stream) {
          if (abortedRef.current) break;
          if (event.content) {
            if (!full) setStreamingContent('');
            full += event.content;
            setStreamingContent(full);
          }
          if (event.usage) {
            setLastUsage(event.usage);
          }
        }

        await queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId],
        });
        await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch (err) {
        console.error('Stream error:', err);
        toast('Ошибка при получении ответа', 'error');
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
      }
    },
    [conversationId, queryClient, conversation],
  );

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  const messages: Message[] = conversation?.messages || [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-card border-b border-border px-5 py-3 flex items-center justify-between shadow-sm">
        <h2 className="text-base font-semibold text-foreground">{conversation?.title}</h2>
        <div className="flex items-center gap-3">
          {lastUsage && (
            <span className="text-[10px] text-muted-foreground bg-accent rounded-lg px-2 py-1">
              {lastUsage.total_tokens} токенов
            </span>
          )}
          <KBSelector
            value={conversation?.knowledge_base_id || null}
            onChange={() => {}}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <div className="w-16 h-16 rounded-full bg-[#21a038]/10 flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <p className="text-sm">Начните диалог, отправив сообщение</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role}
            content={msg.content}
            documentCount={(msg.document_ids || []).length}
          />
        ))}
        {streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} />
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
