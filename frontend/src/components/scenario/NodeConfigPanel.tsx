import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Markdown } from '@/components/ui/markdown';
import { useScenarioStore } from '@/stores/scenarioStore';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getKnowledgeBases } from '@/api/knowledge-bases';

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  input: { label: 'Вход', color: 'bg-[#21a038]' },
  output: { label: 'Выход', color: 'bg-[#21a038]' },
  processing: { label: 'Обработка', color: 'bg-[#7b1fa2]' },
  loop: { label: 'Цикл', color: 'bg-[#00897b]' },
  switch: { label: 'Switch', color: 'bg-[#ff6f00]' },
  if_node: { label: 'If', color: 'bg-[#0277bd]' },
};

export function NodeConfigPanel() {
  const { nodes, edges, selectedNodeId, updateNodeData, deleteNode, selectNode } =
    useScenarioStore();
  const [showPreview, setShowPreview] = useState(false);

  const node = nodes.find((n) => n.id === selectedNodeId);
  const isProcessing = node?.type === 'processing';

  // For Switch: find classes from predecessor Loop (classify_strict)
  const predecessorClasses = (() => {
    if (!node || node.type !== 'switch') return null;
    const inEdge = edges.find((e) => e.target === node.id);
    if (!inEdge) return null;
    const predNode = nodes.find((n) => n.id === inEdge.source);
    if (!predNode || predNode.type !== 'loop') return null;
    const predData = predNode.data as Record<string, string>;
    if (predData.classify_strict !== 'true') return null;
    const classes = predData.classes || '';
    return classes.split(',').map((c: string) => c.trim()).filter(Boolean);
  })();

  // KB list for the RAG selector (only used by processing nodes).
  // Must be called before any early return — React hooks rules.
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => getKnowledgeBases(),
    enabled: isProcessing,
  });

  if (!node) {
    return (
      <div className="w-full h-full bg-card border-l border-border p-5 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">Выберите ноду<br/>для настройки</p>
      </div>
    );
  }

  const data = node.data as Record<string, string>;
  const isIO = node.type === 'input' || node.type === 'output';
  const config = TYPE_CONFIG[node.type || ''] || TYPE_CONFIG.processing;

  return (
    <div className="w-full h-full bg-card border-l border-border p-5 space-y-5 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${config.color}`} />
          <h3 className="text-sm font-semibold">{config.label}</h3>
        </div>
        <button
          onClick={() => selectNode(null)}
          className="w-6 h-6 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Name */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">Название</label>
        <Input
          value={data.label || ''}
          onChange={(e) => updateNodeData(node.id, { label: e.target.value })}
          placeholder={config.label}
          className="rounded-xl"
        />
      </div>

      {!isIO && node.type !== 'switch' && node.type !== 'if_node' && (
        <>
          {/* Prompt — only for processing, loop */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground">Промпт</label>
              {data.prompt && (
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-[10px] text-[#1976d2] hover:underline"
                >
                  {showPreview ? 'Редактор' : 'Превью'}
                </button>
              )}
            </div>
            {showPreview ? (
              <div className="min-h-[140px] rounded-xl border border-border bg-background p-3 overflow-y-auto">
                <Markdown className="text-sm">{data.prompt || ''}</Markdown>
              </div>
            ) : (
              <Textarea
                value={data.prompt || ''}
                onChange={(e) => updateNodeData(node.id, { prompt: e.target.value })}
                placeholder="Инструкции для GigaChat..."
                className="min-h-[140px] rounded-xl text-sm"
              />
            )}
          </div>

          {node.type === 'processing' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5 flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#21a038" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
                База знаний (RAG)
              </label>
              <select
                value={data.knowledge_base_id || ''}
                onChange={(e) => updateNodeData(node.id, { knowledge_base_id: e.target.value })}
                className="w-full text-xs bg-background border border-border rounded-xl px-2.5 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-[#21a038]"
              >
                <option value="">Не использовать</option>
                {knowledgeBases.map((kb) => (
                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                {data.knowledge_base_id
                  ? 'GigaChat получит релевантные фрагменты из базы знаний как дополнительный контекст (similarity search по результату предыдущего шага).'
                  : knowledgeBases.length === 0
                    ? 'Нет доступных баз знаний. Создайте базу в разделе «Базы знаний».'
                    : 'Выберите базу, чтобы узел автоматически подмешивал релевантные фрагменты в контекст.'}
              </p>
            </div>
          )}

          {node.type === 'loop' && (
            <>
              <div className="border border-border rounded-xl p-3 bg-accent/30">
                <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                  <input
                    type="checkbox"
                    checked={data.classify_strict === 'true'}
                    onChange={(e) => updateNodeData(node.id, { classify_strict: e.target.checked ? 'true' : '' })}
                    className="w-3.5 h-3.5 rounded accent-[#00897b]"
                  />
                  <span className="font-medium text-foreground">🏷️ Строгая классификация</span>
                </label>
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                  GigaChat вернёт ТОЛЬКО название класса (одно слово). Промпт ноды используется как
                  подсказка для классификации. Оригинальный текст каждого документа сохранится для следующего
                  узла Switch — он отфильтрует документы по классу и передаст только нужные в каждую ветку.
                </p>
              </div>
              {data.classify_strict === 'true' && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    Возможные классы
                  </label>
                  <Input
                    value={data.classes || ''}
                    onChange={(e) => updateNodeData(node.id, { classes: e.target.value })}
                    placeholder="ПЗ, КП, ПРИКАЗ"
                    className="rounded-xl"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Эти же названия используйте в правилах Switch и метках рёбер
                  </p>
                </div>
              )}
            </>
          )}

        </>
      )}

      {/* Switch — visual rules editor, no prompt */}
      {node.type === 'switch' && (
        <SwitchRulesEditor
          rules={data.rules || '[]'}
          onChange={(rules) => updateNodeData(node.id, { rules })}
          suggestedClasses={predecessorClasses}
        />
      )}

      {/* If — no prompt, condition editor */}
      {node.type === 'if_node' && (
        <>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Поле (необяз.)</label>
            <Input
              value={data.field || ''}
              onChange={(e) => updateNodeData(node.id, { field: e.target.value })}
              placeholder="ТИП, НМЦД, статус..."
              className="rounded-xl"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Оператор</label>
            <select
              value={data.operator || 'contains'}
              onChange={(e) => updateNodeData(node.id, { operator: e.target.value })}
              className="w-full text-xs bg-background border border-border rounded-xl px-2.5 py-2 text-foreground"
            >
              <option value="contains">содержит</option>
              <option value="not_contains">не содержит</option>
              <option value="equals">равно</option>
              <option value="greater_than">больше чем</option>
              <option value="less_than">меньше чем</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Значение</label>
            <Input
              value={data.value || ''}
              onChange={(e) => updateNodeData(node.id, { value: e.target.value })}
              placeholder="КП, 1000000, ошибка..."
              className="rounded-xl"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Рёбра: «true»/«да» и «false»/«нет». Без GigaChat.
          </p>
        </>
      )}

      {!isIO && (
        <Button
          variant="outline"
          size="sm"
          className="w-full rounded-xl text-destructive hover:bg-red-50 border-red-200"
          onClick={() => deleteNode(node.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1.5">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Удалить ноду
        </Button>
      )}
    </div>
  );
}

// ── Visual Switch Rules Editor ──────────────────────────────────────────

interface SwitchRule {
  value: string;
  operator: string;
  label: string;
}

const OPERATORS = [
  { value: 'contains', label: 'содержит' },
  { value: 'equals', label: 'равно' },
  { value: 'startswith', label: 'начинается с' },
];

function SwitchRulesEditor({ rules, onChange, suggestedClasses }: { rules: string; onChange: (v: string) => void; suggestedClasses?: string[] | null }) {
  let parsed: SwitchRule[] = [];
  try {
    parsed = JSON.parse(rules);
  } catch {
    parsed = [];
  }

  const update = (newRules: SwitchRule[]) => {
    onChange(JSON.stringify(newRules));
  };

  const addRule = (cls?: string) => {
    update([...parsed, { value: cls || '', operator: 'contains', label: cls || '' }]);
  };

  const removeRule = (i: number) => {
    update(parsed.filter((_, idx) => idx !== i));
  };

  const updateRule = (i: number, field: keyof SwitchRule, val: string) => {
    const copy = [...parsed];
    copy[i] = { ...copy[i], [field]: val };
    if (field === 'value' && (!copy[i].label || copy[i].label === parsed[i].value)) {
      copy[i].label = val;
    }
    update(copy);
  };

  // Auto-populate rules from predecessor Loop classes
  const usedValues = new Set(parsed.map((r) => r.value));
  const missingClasses = suggestedClasses?.filter((c) => !usedValues.has(c)) || [];

  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-muted-foreground block">Правила маршрутизации</label>
      <p className="text-[10px] text-muted-foreground -mt-1">
        {suggestedClasses
          ? 'Классы подтянуты из узла классификации. Метка ребра определяет ветку.'
          : 'Каждое правило проверяет текст предыдущего узла. Метка ребра определяет ветку.'}
        {' '}Без GigaChat.
      </p>

      {missingClasses.length > 0 && (
        <button
          onClick={() => {
            const newRules = [...parsed];
            for (const cls of missingClasses) {
              newRules.push({ value: cls, operator: 'contains', label: cls });
            }
            update(newRules);
          }}
          className="w-full text-xs bg-[#ff6f00]/10 text-[#ff6f00] border border-[#ff6f00]/30 rounded-xl px-3 py-2 hover:bg-[#ff6f00]/20 transition-colors"
        >
          Добавить классы: {missingClasses.join(', ')}
        </button>
      )}

      {parsed.map((rule, i) => (
        <div key={i} className="flex items-center gap-1.5 bg-accent/30 rounded-xl p-2">
          <div className="flex-1 space-y-1.5">
            <div className="flex gap-1.5">
              <input
                value={rule.value}
                onChange={(e) => updateRule(i, 'value', e.target.value)}
                placeholder="Значение"
                className="flex-1 text-xs bg-background border border-border rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#ff6f00]"
              />
              <select
                value={rule.operator}
                onChange={(e) => updateRule(i, 'operator', e.target.value)}
                className="text-xs bg-background border border-border rounded-lg px-2 py-1.5 outline-none"
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">→ ветка:</span>
              <input
                value={rule.label}
                onChange={(e) => updateRule(i, 'label', e.target.value)}
                placeholder="Метка ребра"
                className="flex-1 text-xs bg-background border border-border rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-[#ff6f00]"
              />
            </div>
          </div>
          <button
            onClick={() => removeRule(i)}
            className="p-1 rounded hover:bg-background hover:text-destructive shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      ))}

      <button
        onClick={() => addRule()}
        className="w-full text-xs border border-dashed border-border rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        + Добавить правило
      </button>
    </div>
  );
}
