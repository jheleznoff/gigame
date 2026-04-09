import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getScenarioRun } from '@/api/scenarios';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  pending: { label: 'Ожидание', color: 'text-gray-500' },
  running: { label: 'Выполняется', color: 'text-blue-500' },
  completed: { label: 'Завершён', color: 'text-green-600' },
  failed: { label: 'Ошибка', color: 'text-red-600' },
};

export function ScenarioRunPage() {
  const { scenarioId, runId } = useParams<{ scenarioId: string; runId: string }>();
  const navigate = useNavigate();

  const { data: run, isLoading } = useQuery({
    queryKey: ['scenario-run', runId],
    queryFn: () => getScenarioRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 2000 : false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (!run) return null;

  const status = STATUS_STYLES[run.status] || STATUS_STYLES.pending;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/scenarios/${scenarioId}/edit`)}
        >
          ← К редактору
        </Button>
        <h1 className="text-xl font-semibold">Запуск сценария</h1>
        <span className={`text-sm font-medium ${status.color}`}>
          {status.label}
        </span>
        <div className="flex-1" />
        {run.status === 'completed' && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            onClick={() => {
              window.open(`/api/scenarios/runs/${runId}/export`, '_blank');
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Скачать DOCX
          </Button>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-3 mb-6">
        <h2 className="text-sm font-semibold">Шаги выполнения</h2>
        {run.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет шагов</p>
        ) : (
          run.steps.map((step) => {
            const stepStatus = STATUS_STYLES[step.status] || STATUS_STYLES.pending;
            return (
              <div
                key={step.id}
                className="border border-border rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        step.status === 'completed'
                          ? 'bg-green-500'
                          : step.status === 'running'
                            ? 'bg-blue-500 animate-pulse'
                            : step.status === 'failed'
                              ? 'bg-red-500'
                              : 'bg-gray-300'
                      }`}
                    />
                    <span className="text-sm font-medium">
                      {step.node_id} ({step.node_type})
                    </span>
                  </div>
                  <span className={`text-xs ${stepStatus.color}`}>
                    {stepStatus.label}
                  </span>
                </div>
                {step.prompt_used && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer">
                      Промпт
                    </summary>
                    <pre className="text-xs bg-muted rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap">
                      {step.prompt_used}
                    </pre>
                  </details>
                )}
                {step.output_data && (
                  <details className="mt-2" open={step.status === 'completed'}>
                    <summary className="text-xs text-muted-foreground cursor-pointer">
                      Результат
                    </summary>
                    <div className="text-xs bg-muted rounded p-2 mt-1 whitespace-pre-wrap">
                      {typeof step.output_data === 'object'
                        ? JSON.stringify(step.output_data, null, 2)
                        : String(step.output_data)}
                    </div>
                  </details>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Final result */}
      {run.result && (
        <div className="border border-border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-2">Итоговый результат</h2>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{run.result.output || ''}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
