import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { runScenario, continueScenarioStep, disableScenarioStepMode } from '@/api/scenarios';
import { Button } from '@/components/ui/button';
import { useScenarioStore } from '@/stores/scenarioStore';

interface ScenarioRunnerProps {
  scenarioId: string;
  onClose: () => void;
}

interface LogEntry {
  time: string;
  text: string;
  type: 'info' | 'start' | 'done' | 'error' | 'iter';
}

interface StepData {
  stepId?: string;
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  inputData?: { documents_text?: string; previous_output?: string };
  outputData?: { result?: string; error?: string };
  promptUsed?: string | null;
  stepIndex?: number;
  totalSteps?: number;
}

function formatElapsed(startMs: number): string {
  const sec = Math.floor((Date.now() - startMs) / 1000);
  if (sec < 60) return `${sec}с`;
  return `${Math.floor(sec / 60)}м ${sec % 60}с`;
}

const now = () => new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function ScenarioRunner({ scenarioId, onClose }: ScenarioRunnerProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const setExecStatus = useScenarioStore((s) => s.setExecStatus);
  const resetExecStatuses = useScenarioStore((s) => s.resetExecStatuses);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'running' | 'paused' | 'done' | 'error'>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ step: 0, total: 0 });
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsed, setElapsed] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [stepMode, setStepMode] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepData | null>(null);
  const [stepHistory, setStepHistory] = useState<StepData[]>([]);

  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'running' && phase !== 'paused') return;
    const iv = setInterval(() => setElapsed(formatElapsed(startTime)), 1000);
    return () => clearInterval(iv);
  }, [phase, startTime]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    setLog(prev => [...prev, { time: now(), text, type }]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleContinue = async () => {
    if (!runId) return;
    setPhase('running');
    try { await continueScenarioStep(runId); } catch (e) { console.error(e); }
  };

  const handleSkipStepMode = async () => {
    if (!runId) return;
    setPhase('running');
    try {
      await disableScenarioStepMode(runId);
    } catch (e) { console.error(e); }
  };

  const handleRun = async () => {
    if (files.length === 0) return;
    setPhase('uploading');
    setLog([]);
    setResult(null);
    setRunId(null);
    setProgress({ step: 0, total: 0 });
    setStartTime(Date.now());
    setCurrentStep(null);
    setStepHistory([]);
    resetExecStatuses();

    addLog(`Загрузка ${files.length} файл(ов) на сервер...`, 'info');

    try {
      for await (const event of runScenario(scenarioId, files, stepMode)) {
        if (event.type === 'upload_progress') {
          const fname = event.file as string;
          const cur = event.current as number;
          const tot = event.total as number;
          setProgress({ step: cur, total: tot });
          addLog(`📄 ${fname} (${cur}/${tot})`, 'info');
        }

        if (event.type === 'upload_error') {
          addLog(`✗ Ошибка: ${event.file} — ${event.error}`, 'error');
        }

        if (event.type === 'upload_done') {
          setPhase('running');
          addLog(`✓ Загружено ${event.count} документ(ов)`, 'done');
          setProgress({ step: 0, total: 0 });
        }

        if (event.type === 'run_started') {
          if (event.run_id) setRunId(event.run_id as string);
        }

        if (event.type === 'status') {
          if (event.run_id) setRunId(event.run_id as string);
          if (event.status === 'completed') {
            setPhase('done');
            if (event.result) setResult(event.result as string);
            addLog(`Сценарий завершён за ${formatElapsed(startTime)}`, 'done');
          } else if (event.status === 'failed') {
            setPhase('error');
            addLog('Сценарий завершился с ошибкой', 'error');
          }
        }

        if (event.type === 'node_status') {
          const label = (event.node_label as string) || (event.node_id as string);
          const nodeId = event.node_id as string;
          const status = event.status as string;
          const step = event.step as number;
          const total = event.total as number;
          if (step && total) setProgress({ step, total });

          // Update visual status on canvas
          if (nodeId && (status === 'running' || status === 'completed' || status === 'failed' || status === 'skipped')) {
            setExecStatus(nodeId, status as 'running' | 'completed' | 'failed' | 'skipped');
          }

          if (status === 'running') {
            addLog(`► ${label}`, 'start');
          } else if (status === 'completed') {
            addLog(`✓ ${label}`, 'done');
          } else if (status === 'skipped') {
            addLog(`⊘ ${label} — пропущено`, 'info');
          } else if (status === 'failed') {
            const err = (event.error as string) || 'Неизвестная ошибка';
            addLog(`✗ ${label} — ${err.slice(0, 80)}`, 'error');
          }
        }

        if (event.type === 'step_complete') {
          const stepData: StepData = {
            stepId: event.step_id as string,
            nodeId: event.node_id as string,
            nodeLabel: (event.node_label as string) || (event.node_id as string),
            nodeType: (event.node_type as string) || 'unknown',
            inputData: event.input_data as StepData['inputData'],
            outputData: event.output_data as StepData['outputData'],
            promptUsed: event.prompt_used as string | null,
            stepIndex: event.step_index as number,
            totalSteps: event.total_steps as number,
          };
          setCurrentStep(stepData);
          setStepHistory(prev => [...prev, stepData]);
        }

        if (event.type === 'step_paused') {
          setPhase('paused');
          const pausedNodeId = event.node_id as string;
          if (pausedNodeId) setExecStatus(pausedNodeId, 'paused');
        }

        if (event.type === 'switch_result') {
          const rule = event.matched_rule as string;
          const lbl = (event.node_label as string) || 'Switch';
          addLog(`🔀 ${lbl} → "${rule}"`, 'iter');
        }

        if (event.type === 'if_result') {
          const branch = event.branch as string;
          const met = event.condition_met as boolean;
          const lbl = (event.node_label as string) || 'If';
          addLog(`${met ? '✅' : '❌'} ${lbl} → ${branch}`, met ? 'done' : 'info');
        }

        if (event.type === 'rag_search') {
          const lbl = (event.node_label as string) || '';
          const count = event.chunks_found as number;
          addLog(`  📚 ${lbl}: RAG нашёл ${count} фрагмент(ов) в базе знаний`, 'iter');
        }

        if (event.type === 'loop_progress') {
          const detail = event.detail as string || '';
          if (detail.startsWith('classified as')) {
            addLog(`  📄 Документ ${event.iteration}/${event.total}: ${detail}`, 'info');
          } else {
            addLog(`  🔄 Итерация ${event.iteration}/${event.total}`, 'iter');
          }
        }
      }
    } catch (err) {
      setPhase('error');
      addLog(`Ошибка: ${err instanceof Error ? err.message : 'Неизвестная'}`, 'error');
    }
  };

  const isActive = phase === 'uploading' || phase === 'running' || phase === 'paused';

  return (
    <div className="w-full h-full bg-card border-l border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {phase === 'paused' ? '⏸ Пауза (отладка)' : 'Запуск'}
        </h3>
        <div className="flex items-center gap-2">
          {isActive && <span className="text-[10px] text-muted-foreground font-mono bg-accent rounded-md px-1.5 py-0.5">{elapsed}</span>}
          <button onClick={onClose} className="w-6 h-6 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* Progress bar */}
        {isActive && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground">
                {phase === 'uploading' ? 'Загрузка файлов...' : progress.total > 0 ? `Шаг ${progress.step} из ${progress.total}` : 'Запуск...'}
              </span>
              {progress.total > 0 && <span className="text-[11px] text-muted-foreground">{Math.round((progress.step / progress.total) * 100)}%</span>}
            </div>
            <div className="h-1.5 bg-accent rounded-full overflow-hidden">
              {phase === 'uploading' ? (
                <div className="h-full bg-[#1976d2] rounded-full animate-pulse w-full opacity-40" />
              ) : (
                <div className={`h-full rounded-full transition-all duration-700 ${phase === 'paused' ? 'bg-[#ff9800]' : 'bg-[#21a038]'}`} style={{ width: progress.total > 0 ? `${(progress.step / progress.total) * 100}%` : '10%' }} />
              )}
            </div>
          </div>
        )}

        {/* Current step inspector (debug mode) */}
        {currentStep && (phase === 'paused' || phase === 'running') && (
          <div className="border-2 border-[#ff9800]/40 rounded-xl bg-[#ff9800]/5 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">
                  Шаг {currentStep.stepIndex}/{currentStep.totalSteps} · {currentStep.nodeType}
                </div>
                <div className="text-sm font-semibold text-foreground">{currentStep.nodeLabel}</div>
              </div>
              {phase === 'paused' && <span className="text-[10px] bg-[#ff9800] text-white rounded px-1.5 py-0.5 font-medium">PAUSED</span>}
            </div>

            {/* Input */}
            {currentStep.inputData && (currentStep.inputData.documents_text || currentStep.inputData.previous_output) && (
              <details className="text-[11px]" open={phase === 'paused'}>
                <summary className="cursor-pointer font-medium text-[#1976d2]">📥 Входные данные</summary>
                <div className="mt-1 space-y-1">
                  {currentStep.inputData.previous_output && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Результат предыдущего шага:</div>
                      <pre className="bg-background border border-border rounded p-1.5 max-h-32 overflow-auto whitespace-pre-wrap text-[10px]">
                        {currentStep.inputData.previous_output.slice(0, 800)}
                        {currentStep.inputData.previous_output.length > 800 ? '\n... (обрезано)' : ''}
                      </pre>
                    </div>
                  )}
                  {currentStep.inputData.documents_text && (
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">Документы (полный текст):</div>
                      <pre className="bg-background border border-border rounded p-1.5 max-h-24 overflow-auto whitespace-pre-wrap text-[10px]">
                        {currentStep.inputData.documents_text.slice(0, 400)}
                        {currentStep.inputData.documents_text.length > 400 ? '\n... (' + currentStep.inputData.documents_text.length + ' симв)' : ''}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Prompt */}
            {currentStep.promptUsed && (
              <details className="text-[11px]" open={phase === 'paused'}>
                <summary className="cursor-pointer font-medium text-[#7b1fa2]">📝 Промпт в GigaChat</summary>
                <pre className="mt-1 bg-background border border-border rounded p-1.5 max-h-32 overflow-auto whitespace-pre-wrap text-[10px]">
                  {currentStep.promptUsed.slice(0, 1000)}
                  {currentStep.promptUsed.length > 1000 ? '\n... (обрезано)' : ''}
                </pre>
              </details>
            )}

            {/* Output */}
            {currentStep.outputData?.result && (
              <details className="text-[11px]" open={phase === 'paused'}>
                <summary className="cursor-pointer font-medium text-[#21a038]">📤 Результат</summary>
                <pre className="mt-1 bg-background border border-border rounded p-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-[10px]">
                  {currentStep.outputData.result.slice(0, 1500)}
                  {currentStep.outputData.result.length > 1500 ? '\n... (обрезано)' : ''}
                </pre>
              </details>
            )}

            {/* Pause controls */}
            {phase === 'paused' && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1 rounded-xl bg-[#ff9800] hover:bg-[#f57c00] text-xs" onClick={handleContinue}>
                  Далее →
                </Button>
                <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={handleSkipStepMode}>
                  ⏩ До конца
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Done / Error banner */}
        {phase === 'done' && (
          <div className="bg-[#21a038]/10 text-[#21a038] rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            Выполнено за {elapsed}
          </div>
        )}
        {phase === 'error' && (
          <div className="bg-destructive/10 text-destructive rounded-xl px-3 py-2 text-xs font-medium flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Ошибка выполнения
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Лог</label>
            <div className="space-y-0.5 text-[11px] font-mono bg-background rounded-xl p-2.5 border border-border max-h-72 overflow-y-auto">
              {log.map((entry, i) => (
                <div key={i} className={`leading-relaxed ${
                  entry.type === 'done' ? 'text-[#21a038]'
                  : entry.type === 'error' ? 'text-destructive'
                  : entry.type === 'start' ? 'text-[#1976d2]'
                  : entry.type === 'iter' ? 'text-[#00897b]'
                  : 'text-muted-foreground'
                }`}>
                  <span className="text-muted-foreground/60">{entry.time}</span> {entry.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Uploading spinner when waiting for first event */}
        {phase === 'uploading' && log.length === 0 && (
          <div className="flex flex-col items-center py-6 text-muted-foreground gap-2">
            <div className="w-7 h-7 border-2 border-[#21a038] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs">Подключение к серверу...</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Результат</label>
            <div className="text-xs bg-accent rounded-xl p-3 max-h-48 overflow-y-auto whitespace-pre-wrap text-foreground leading-relaxed">
              {result.slice(0, 600)}{result.length > 600 ? '...' : ''}
            </div>
          </div>
        )}

        {/* Files (idle) */}
        {phase === 'idle' && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground block mb-1.5">Документы</label>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] bg-accent rounded-lg px-2.5 py-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="2" className="flex-shrink-0">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="truncate flex-1">{f.name}</span>
                  <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="w-full mt-2 rounded-xl text-xs" onClick={() => fileInputRef.current?.click()}>
              + Добавить файлы
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" multiple onChange={handleFileChange} className="hidden" />

            {/* Debug mode toggle */}
            <label className="flex items-center gap-2 mt-3 px-1 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={stepMode}
                onChange={(e) => setStepMode(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[#ff9800]"
              />
              <span className="text-foreground">🐛 Пошаговый режим (отладка)</span>
            </label>
            {stepMode && (
              <p className="text-[10px] text-muted-foreground mt-1 px-1">
                Сценарий будет приостанавливаться после каждой ноды для проверки данных
              </p>
            )}
          </div>
        )}

        {/* Step history (after run, in step mode) */}
        {stepHistory.length > 0 && (phase === 'done' || phase === 'error') && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              История шагов ({stepHistory.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {stepHistory.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(s)}
                  className={`w-full text-left text-[10px] rounded-lg px-2 py-1.5 border transition-colors ${
                    currentStep?.stepId === s.stepId
                      ? 'bg-[#ff9800]/10 border-[#ff9800]'
                      : 'bg-background border-border hover:bg-accent'
                  }`}
                >
                  <span className="font-mono text-muted-foreground">{s.stepIndex}/{s.totalSteps}</span>
                  {' '}
                  {s.nodeLabel}
                </button>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Bottom */}
      <div className="px-4 py-3 border-t border-border space-y-2">
        {phase === 'idle' && (
          <Button className="w-full rounded-xl bg-[#00897b] hover:bg-[#00796b] text-xs" onClick={handleRun} disabled={files.length === 0}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mr-1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Запустить{stepMode ? ' (отладка)' : ''} ({files.length} файл.)
          </Button>
        )}
        {runId && (phase === 'done' || phase === 'error') && (
          <>
            <Button size="sm" variant="outline" className="w-full rounded-xl text-xs" onClick={() => navigate(`/scenarios/${scenarioId}/runs/${runId}`)}>
              Подробный отчёт
            </Button>
            <Button size="sm" variant="outline" className="w-full rounded-xl text-xs" onClick={() => { setPhase('idle'); setLog([]); setResult(null); setProgress({ step: 0, total: 0 }); setCurrentStep(null); setStepHistory([]); }}>
              Запустить снова
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
