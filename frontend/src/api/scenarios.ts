import { fetchApi } from './client';

export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioDetail extends Scenario {
  graph_data: {
    nodes: ScenarioNode[];
    edges: ScenarioEdge[];
  };
}

export interface ScenarioNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, string>;
}

export interface ScenarioEdge {
  id: string;
  source: string;
  target: string;
}

export interface ScenarioRun {
  id: string;
  scenario_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input_document_ids: string[];
  result: { output: string } | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ScenarioRunStep {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  input_data: unknown;
  output_data: unknown;
  prompt_used: string | null;
  tokens_used: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ScenarioRunDetail extends ScenarioRun {
  steps: ScenarioRunStep[];
}

export function getScenarios(): Promise<Scenario[]> {
  return fetchApi('/scenarios');
}

export function getScenario(id: string): Promise<ScenarioDetail> {
  return fetchApi(`/scenarios/${id}`);
}

export function createScenario(
  name: string,
  description?: string,
): Promise<Scenario> {
  return fetchApi('/scenarios', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: description || null,
      graph_data: { nodes: [], edges: [] },
    }),
  });
}

export function updateScenario(
  id: string,
  data: { name?: string; description?: string; graph_data?: unknown },
): Promise<Scenario> {
  return fetchApi(`/scenarios/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function duplicateScenario(id: string): Promise<Scenario> {
  return fetchApi(`/scenarios/${id}/duplicate`, { method: 'POST' });
}

export function deleteScenario(id: string): Promise<void> {
  return fetchApi(`/scenarios/${id}`, { method: 'DELETE' });
}

export function getScenarioRuns(scenarioId: string): Promise<ScenarioRun[]> {
  return fetchApi(`/scenarios/${scenarioId}/runs`);
}

export function getScenarioRun(runId: string): Promise<ScenarioRunDetail> {
  return fetchApi(`/scenarios/runs/${runId}`);
}

export function continueScenarioStep(runId: string): Promise<void> {
  return fetchApi(`/scenarios/runs/${runId}/continue`, { method: 'POST' });
}

export function disableScenarioStepMode(runId: string): Promise<void> {
  return fetchApi(`/scenarios/runs/${runId}/disable-step-mode`, { method: 'POST' });
}

export async function* runScenario(
  scenarioId: string,
  files: File[],
  stepMode: boolean = false,
): AsyncGenerator<Record<string, unknown>> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const url = `/api/scenarios/${scenarioId}/run${stepMode ? '?step_mode=true' : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Run failed: ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const json = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
          yield JSON.parse(json);
        } catch (e) {
          console.warn('Scenario SSE parse error:', line, e);
        }
      }
    }
  }
}
