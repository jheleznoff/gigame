const BASE_URL = '/api';

export async function fetchApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface StreamEvent {
  content?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  document_ids?: string[];
  done?: boolean;
  error?: string;
}

export async function* streamApi(
  path: string,
  body: object | FormData,
): AsyncGenerator<StreamEvent> {
  const isFormData = body instanceof FormData;
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    body: isFormData ? body : JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

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
        const data = (line.startsWith('data: ') ? line.slice(6) : line.slice(5)).trim();
        if (!data) continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.done) return;
          if (parsed.error) throw new Error(parsed.error);
          yield parsed;
        } catch (e) {
          console.warn('SSE parse error:', line, e);
          if (e instanceof Error && e.message !== 'Unexpected') throw e;
        }
      }
    }
  }
}
