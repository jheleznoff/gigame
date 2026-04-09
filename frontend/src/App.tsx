import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/layout/AppLayout';
import { ChatPage } from '@/pages/ChatPage';
import { KnowledgeBasePage } from '@/pages/KnowledgeBasePage';
import { ScenariosPage } from '@/pages/ScenariosPage';
import { ScenarioEditorPage } from '@/pages/ScenarioEditorPage';
import { ScenarioRunPage } from '@/pages/ScenarioRunPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:conversationId" element={<ChatPage />} />
            <Route path="/knowledge-bases" element={<KnowledgeBasePage />} />
            <Route path="/knowledge-bases/:kbId" element={<KnowledgeBasePage />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/scenarios/:scenarioId/edit" element={<ScenarioEditorPage />} />
            <Route path="/scenarios/:scenarioId/runs/:runId" element={<ScenarioRunPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
