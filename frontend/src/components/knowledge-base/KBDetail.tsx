import { useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getKnowledgeBase,
  uploadDocumentToKB,
  removeDocumentFromKB,
  reindexDocument,
  type KBDocument,
} from '@/api/knowledge-bases';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { DropZone } from '@/components/ui/dropzone';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  processing: { label: 'Индексация...', color: 'text-yellow-600' },
  ready: { label: 'Готов', color: 'text-green-600' },
  error: { label: 'Ошибка', color: 'text-red-600' },
};

export function KBDetail({ kbId }: { kbId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: kb, isLoading } = useQuery({
    queryKey: ['knowledge-base', kbId],
    queryFn: () => getKnowledgeBase(kbId),
    refetchInterval: (query) => {
      // Poll while any document is processing
      const docs = query.state.data?.documents;
      if (docs?.some((d: KBDocument) => d.status === 'processing')) return 3000;
      return false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocumentToKB(kbId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', kbId] });
      toast('Документ загружен и индексируется', 'success');
    },
    onError: () => toast('Не удалось загрузить документ', 'error'),
  });

  const removeMutation = useMutation({
    mutationFn: (documentId: string) => removeDocumentFromKB(kbId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', kbId] });
      toast('Документ удалён из базы знаний', 'success');
    },
    onError: () => toast('Не удалось удалить документ', 'error'),
  });

  const reindexMutation = useMutation({
    mutationFn: (documentId: string) => reindexDocument(kbId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', kbId] });
      toast('Переиндексация запущена', 'info');
    },
    onError: () => toast('Не удалось запустить переиндексацию', 'error'),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      uploadMutation.mutate(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDropFiles = useCallback((files: File[]) => {
    for (const file of files) {
      uploadMutation.mutate(file);
    }
  }, [uploadMutation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (!kb) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-lg font-medium">{kb.name}</h2>
        {kb.description && (
          <p className="text-sm text-muted-foreground mt-1">{kb.description}</p>
        )}
      </div>

      <DropZone onFiles={handleDropFiles} className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium">
            Документы ({kb.documents.length})
          </h3>
          <div>
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
            >
              {uploadMutation.isPending ? 'Загрузка...' : 'Загрузить документ'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
        </div>

        {kb.documents.length === 0 ? (
          <div className="text-center text-muted-foreground py-12 border-2 border-dashed border-border rounded-xl">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-muted-foreground/50">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-base mb-1">Перетащите файлы сюда</p>
            <p className="text-sm">или нажмите «Загрузить документ» (PDF, DOCX, TXT)</p>
          </div>
        ) : (
          <div className="space-y-2">
            {kb.documents.map((doc) => {
              const status = STATUS_LABELS[doc.status] || STATUS_LABELS.error;
              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-3 bg-muted rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {doc.filename}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3 mt-0.5">
                      <span>{(doc.size_bytes / 1024).toFixed(0)} КБ</span>
                      <span className={status.color}>{status.label}</span>
                      {doc.status === 'ready' && (
                        <span>{doc.chunk_count} чанков</span>
                      )}
                      {doc.status === 'error' && (
                        <button
                          onClick={() => reindexMutation.mutate(doc.document_id)}
                          className="text-[#1976d2] hover:underline"
                        >
                          Повторить
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeMutation.mutate(doc.document_id)}
                    className="text-muted-foreground hover:text-destructive text-sm"
                    title="Удалить из базы знаний"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </DropZone>
    </div>
  );
}
