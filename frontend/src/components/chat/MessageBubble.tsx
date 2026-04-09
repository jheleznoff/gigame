import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  documentCount?: number;
}

function pluralDocs(n: number): string {
  if (n === 1) return '1 документ прикреплён';
  if (n >= 2 && n <= 4) return `${n} документа прикреплено`;
  return `${n} документов прикреплено`;
}

export function MessageBubble({ role, content, documentCount = 0 }: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#21a038] flex items-center justify-center mr-2 mt-1 flex-shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? 'bg-[#21a038] text-white rounded-br-md'
            : 'bg-white text-foreground shadow-sm border border-border/50 rounded-bl-md'
        }`}
      >
        {documentCount > 0 && (
          <div className={`text-xs mb-1.5 flex items-center gap-1.5 ${isUser ? 'text-white/70' : 'text-muted-foreground'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>{pluralDocs(documentCount)}</span>
          </div>
        )}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>
        ) : (
          <div className="text-sm prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-foreground prose-strong:text-foreground">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
