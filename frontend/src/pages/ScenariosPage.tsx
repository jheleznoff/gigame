import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getScenarios, createScenario, updateScenario, deleteScenario, duplicateScenario } from '@/api/scenarios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

const TEMPLATES = [
  {
    name: 'Анализ документа',
    description: 'Классификация и извлечение ключевых данных',
    graph_data: {
      nodes: [
        { id: 'node_0', type: 'input', position: { x: 250, y: 50 }, data: { label: 'Документ' } },
        { id: 'node_1', type: 'classification', position: { x: 250, y: 180 }, data: { label: 'Классификация', prompt: 'Определи тип документа.', categories: 'Договор, КП, ТЗ, Счёт, Акт, Другое' } },
        { id: 'node_2', type: 'extraction', position: { x: 250, y: 310 }, data: { label: 'Извлечение', prompt: 'Извлеки ключевые данные из документа.', fields: 'дата, стороны, сумма, предмет' } },
        { id: 'node_3', type: 'output', position: { x: 250, y: 440 }, data: { label: 'Результат' } },
      ],
      edges: [
        { id: 'e0', source: 'node_0', target: 'node_1' },
        { id: 'e1', source: 'node_1', target: 'node_2' },
        { id: 'e2', source: 'node_2', target: 'node_3' },
      ],
    },
  },
  {
    name: 'Сравнение КП',
    description: 'Анализ и сравнение коммерческих предложений',
    graph_data: {
      nodes: [
        { id: 'node_0', type: 'input', position: { x: 250, y: 50 }, data: { label: 'Документы' } },
        { id: 'node_1', type: 'loop', position: { x: 250, y: 180 }, data: { label: 'Извлечение из каждого КП', prompt: 'Извлеки: название компании, цену, сроки, условия оплаты, гарантии.' } },
        { id: 'node_2', type: 'processing', position: { x: 250, y: 310 }, data: { label: 'Сравнение', prompt: 'Сравни коммерческие предложения и выбери лучшее. Обоснуй выбор.' } },
        { id: 'node_3', type: 'output', position: { x: 250, y: 440 }, data: { label: 'Результат' } },
      ],
      edges: [
        { id: 'e0', source: 'node_0', target: 'node_1' },
        { id: 'e1', source: 'node_1', target: 'node_2' },
        { id: 'e2', source: 'node_2', target: 'node_3' },
      ],
    },
  },
  {
    name: 'Суммаризация',
    description: 'Краткое изложение документа',
    graph_data: {
      nodes: [
        { id: 'node_0', type: 'input', position: { x: 250, y: 50 }, data: { label: 'Документ' } },
        { id: 'node_1', type: 'processing', position: { x: 250, y: 180 }, data: { label: 'Суммаризация', prompt: 'Составь краткое изложение документа в 5-7 ключевых пунктах. Выдели главное.' } },
        { id: 'node_2', type: 'output', position: { x: 250, y: 310 }, data: { label: 'Результат' } },
      ],
      edges: [
        { id: 'e0', source: 'node_0', target: 'node_1' },
        { id: 'e1', source: 'node_1', target: 'node_2' },
      ],
    },
  },
];

export function ScenariosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data: scenarios = [] } = useQuery({
    queryKey: ['scenarios'],
    queryFn: getScenarios,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createScenario(name),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setNewName('');
      setShowCreate(false);
      navigate(`/scenarios/${s.id}/edit`);
    },
  });

  const createFromTemplate = async (template: typeof TEMPLATES[number]) => {
    const s = await createScenario(template.name);
    await updateScenario(s.id, { graph_data: template.graph_data });
    queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    navigate(`/scenarios/${s.id}/edit`);
  };

  const deleteMutation = useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      toast('Сценарий удалён', 'success');
    },
    onError: () => toast('Не удалось удалить сценарий', 'error'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Сценарии</h1>
        {showCreate ? (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название сценария"
              className="w-64"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim());
              }}
              autoFocus
            />
            <Button onClick={() => newName.trim() && createMutation.mutate(newName.trim())} disabled={!newName.trim()}>
              Создать
            </Button>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewName(''); }}>
              Отмена
            </Button>
          </div>
        ) : (
          <Button onClick={() => setShowCreate(true)}>Новый сценарий</Button>
        )}
      </div>

      {scenarios.length === 0 ? (
        <div className="text-center text-muted-foreground py-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-lg mb-2">Нет сценариев</p>
          <p className="text-sm mb-6">Создайте сценарий или выберите шаблон</p>
          <div className="flex gap-3 justify-center flex-wrap">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => createFromTemplate(t)}
                className="text-left border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors max-w-[200px]"
              >
                <div className="text-sm font-medium text-foreground">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map((s) => (
            <div
              key={s.id}
              className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/scenarios/${s.id}/edit`)}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{s.name}</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      const copy = await duplicateScenario(s.id);
                      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
                      toast('Сценарий скопирован', 'success');
                    }}
                    className="text-muted-foreground hover:text-foreground text-sm p-1 rounded hover:bg-accent"
                    title="Дублировать"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm('Удалить сценарий?')) deleteMutation.mutate(s.id); }}
                    className="text-muted-foreground hover:text-destructive text-sm p-1 rounded hover:bg-accent"
                    title="Удалить"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
              {s.description && (
                <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                {new Date(s.updated_at).toLocaleDateString('ru')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
