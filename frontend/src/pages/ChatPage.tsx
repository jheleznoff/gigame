import { useParams } from 'react-router-dom';
import { ChatWindow } from '@/components/chat/ChatWindow';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();

  if (conversationId) {
    return <ChatWindow conversationId={conversationId} />;
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
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p className="text-sm">Выберите диалог или создайте новый</p>
    </div>
  );
}
