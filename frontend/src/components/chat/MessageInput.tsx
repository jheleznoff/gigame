import { useState, useRef, type KeyboardEvent, type ChangeEvent } from 'react';
import { Textarea } from '@/components/ui/textarea';

interface MessageInputProps {
  onSend: (content: string, files?: File[]) => void;
  disabled?: boolean;
}

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];

export function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, files.length > 0 ? files : undefined);
    setContent('');
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const newFiles: File[] = [];
    for (const file of Array.from(selected)) {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        newFiles.push(file);
      }
    }
    if (newFiles.length === 0) {
      alert(`Поддерживаемые форматы: ${ALLOWED_EXTENSIONS.join(', ')}`);
    } else {
      setFiles(prev => [...prev, ...newFiles]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="bg-card border-t border-border px-5 py-3">
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-1.5 text-sm text-foreground bg-[#21a038]/10 rounded-xl px-2.5 py-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span className="text-xs max-w-[120px] truncate">{file.name}</span>
              <span className="text-[10px] text-muted-foreground">({(file.size / 1024).toFixed(0)} КБ)</span>
              <button
                onClick={() => removeFile(i)}
                className="ml-0.5 text-muted-foreground hover:text-destructive"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
          title="Прикрепить документы (PDF, DOCX, TXT)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Введите сообщение..."
          className="min-h-[44px] max-h-[200px] resize-none rounded-2xl bg-background border-border text-sm"
          rows={1}
          disabled={disabled}
        />
        <button
          onClick={handleSend}
          disabled={!content.trim() || disabled}
          className="flex-shrink-0 w-9 h-9 rounded-full bg-[#21a038] text-white flex items-center justify-center transition-all hover:bg-[#1b8a30] disabled:opacity-40 disabled:hover:bg-[#21a038]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
