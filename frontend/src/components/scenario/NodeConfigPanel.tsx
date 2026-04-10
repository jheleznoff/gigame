import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
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
  const { nodes, selectedNodeId, updateNodeData, deleteNode, selectNode } =
    useScenarioStore();
  const [showPreview, setShowPreview] = useState(false);

  const node = nodes.find((n) => n.id === selectedNodeId);
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

  // KB list for the RAG selector (only used by processing nodes)
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => getKnowledgeBases(),
    enabled: node.type === 'processing',
  });

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

      {!isIO && (
        <>
          {/* Prompt */}
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
              <div className="min-h-[140px] rounded-xl border border-border bg-background p-3 text-sm prose prose-sm max-w-none overflow-y-auto">
                <ReactMarkdown>{data.prompt || ''}</ReactMarkdown>
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
                    checked={data.classify_strict === 'true' || data.classify_strict === true}
                    onChange={(e) => updateNodeData(node.id, { classify_strict: e.target.checked ? 'true' : '' })}
                    className="w-3.5 h-3.5 rounded accent-[#00897b]"
                  />
                  <span className="font-medium text-foreground">🏷️ Строгая классификация</span>
                </label>
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                  GigaChat вернёт ТОЛЬКО название класса (одно слово). Промпт ноды игнорируется.
                  Оригинальный текст каждого документа сохранится для следующего узла Switch
                  — он сможет отфильтровать документы по классу и передать только нужные в каждую ветку.
                </p>
              </div>
              {(data.classify_strict === 'true' || data.classify_strict === true) && (
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

          {node.type === 'switch' && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Правила маршрутизации (JSON)
              </label>
              <Textarea
                value={data.rules || '[]'}
                onChange={(e) => updateNodeData(node.id, { rules: e.target.value })}
                placeholder={'[\n  {"value": "КП", "operator": "contains", "label": "КП"},\n  {"value": "ПЗ", "operator": "contains", "label": "ПЗ"}\n]'}
                className="min-h-[120px] rounded-xl text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                operator: contains, equals, startswith<br/>
                label → метка ребра. Без GigaChat.
              </p>
            </div>
          )}

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
