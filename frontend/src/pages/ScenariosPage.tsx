import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createScenario, updateScenario } from '@/api/scenarios';

const TEMPLATES = [
  {
    name: 'Анализ документа',
    description: 'Классификация и извлечение ключевых данных',
    graph_data: {
      nodes: [
        { id: 'node_0', type: 'input', position: { x: 250, y: 50 }, data: { label: 'Документ' } },
        { id: 'node_1', type: 'processing', position: { x: 250, y: 180 }, data: { label: 'Анализ документа', prompt: 'Определи тип документа (Договор, КП, ТЗ, Счёт, Акт, Другое) и извлеки ключевые данные: дата, стороны, сумма, предмет. Верни структурированный ответ.' } },
        { id: 'node_2', type: 'output', position: { x: 250, y: 310 }, data: { label: 'Результат' } },
      ],
      edges: [
        { id: 'e0', source: 'node_0', target: 'node_1' },
        { id: 'e1', source: 'node_1', target: 'node_2' },
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

  const createFromTemplateMut = useMutation({
    mutationFn: async (template: typeof TEMPLATES[number]) => {
      const s = await createScenario(template.name);
      await updateScenario(s.id, { graph_data: template.graph_data });
      return s;
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      navigate(`/scenarios/${s.id}/edit`);
    },
  });

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 overflow-y-auto">
      <div className="w-20 h-20 rounded-full bg-[#21a038]/10 flex items-center justify-center mb-6">
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
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6m0 6v6" />
          <path d="m17.66 6.34-4.24 4.24m-2.84 2.84-4.24 4.24" />
          <path d="M23 12h-6m-6 0H5" />
          <path d="m17.66 17.66-4.24-4.24m-2.84-2.84L6.34 6.34" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold mb-2 text-foreground">Сценарии</h1>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-md">
        Выберите сценарий в сайдбаре или создайте новый из шаблона
      </p>

      <div className="w-full max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Шаблоны
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              onClick={() => createFromTemplateMut.mutate(t)}
              disabled={createFromTemplateMut.isPending}
              className="text-left border border-border rounded-xl p-4 hover:bg-accent/50 hover:border-[#21a038]/30 transition-all disabled:opacity-50 bg-card"
            >
              <div className="text-sm font-medium text-foreground mb-1">{t.name}</div>
              <div className="text-xs text-muted-foreground">{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
