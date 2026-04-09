import { fetchApi } from './client';

export interface Conversation {
  id: string;
  title: string;
  knowledge_base_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  document_ids: string[];
  created_at: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export function getConversations(search?: string): Promise<Conversation[]> {
  const params = search ? `?q=${encodeURIComponent(search)}` : '';
  return fetchApi(`/conversations${params}`);
}

export function getConversation(id: string): Promise<ConversationWithMessages> {
  return fetchApi(`/conversations/${id}`);
}

export function createConversation(
  title?: string,
  knowledgeBaseId?: string,
): Promise<Conversation> {
  return fetchApi('/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: title || null,
      knowledge_base_id: knowledgeBaseId || null,
    }),
  });
}

export function deleteConversation(id: string): Promise<void> {
  return fetchApi(`/conversations/${id}`, { method: 'DELETE' });
}
