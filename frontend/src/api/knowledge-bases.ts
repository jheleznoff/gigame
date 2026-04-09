import { fetchApi } from './client';

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBDocument {
  id: string;
  document_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  chunk_count: number;
  status: 'processing' | 'ready' | 'error';
  error_message: string | null;
  created_at: string;
}

export interface KBDetail extends KnowledgeBase {
  documents: KBDocument[];
}

export function getKnowledgeBases(search?: string): Promise<KnowledgeBase[]> {
  const params = search ? `?q=${encodeURIComponent(search)}` : '';
  return fetchApi(`/knowledge-bases${params}`);
}

export function getKnowledgeBase(id: string): Promise<KBDetail> {
  return fetchApi(`/knowledge-bases/${id}`);
}

export function createKnowledgeBase(
  name: string,
  description?: string,
): Promise<KnowledgeBase> {
  return fetchApi('/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify({ name, description: description || null }),
  });
}

export function updateKnowledgeBase(
  id: string,
  data: { name?: string; description?: string },
): Promise<KnowledgeBase> {
  return fetchApi(`/knowledge-bases/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteKnowledgeBase(id: string): Promise<void> {
  return fetchApi(`/knowledge-bases/${id}`, { method: 'DELETE' });
}

export async function uploadDocumentToKB(
  kbId: string,
  file: File,
): Promise<KBDocument> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export function reindexDocument(
  kbId: string,
  documentId: string,
): Promise<KBDocument> {
  return fetchApi(`/knowledge-bases/${kbId}/documents/${documentId}/reindex`, {
    method: 'POST',
  });
}

export function removeDocumentFromKB(
  kbId: string,
  documentId: string,
): Promise<void> {
  return fetchApi(`/knowledge-bases/${kbId}/documents/${documentId}`, {
    method: 'DELETE',
  });
}
