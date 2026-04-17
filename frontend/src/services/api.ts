/**
 * API client for the What-If Simulation backend.
 */

const BASE_URL = '/api';

export interface DebateStartRequest {
  scenario_title: string;
  scenario_hypothesis: string;
  domain?: string;
  variables?: Array<{ name: string; original_value: string; modified_value: string; region: string }>;
  constraints?: string[];
  time_horizon?: string;
  personas?: Array<{ id: string; name?: string; custom_prompt?: string }>;
  language?: string;
}

export interface DebateStartResponse {
  session_id: string;
  scenario: string;
  personas: Array<{ id: string; name: string; role: string }>;
  status: string;
}

export interface SessionState {
  session_id: string;
  scenario: string;
  personas: Array<{ id: string; name: string; role: string }>;
  current_round: number;
  rounds: Array<{
    round_number: number;
    injected_event: string | null;
    statements: Array<{
      persona_id: string;
      persona_name: string;
      content: string;
    }>;
  }>;
  pending_event: string | null;
  status: string;
  token_usage: TokenUsage;
}

export interface TokenUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_api_calls: number;
  estimated_cost_usd: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(error.detail || 'API request failed');
  }
  return res.json();
}

export const debateApi = {
  start: (data: DebateStartRequest) =>
    request<DebateStartResponse>('/debate/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSession: (sessionId: string) =>
    request<SessionState>(`/debate/${sessionId}`),

  injectEvent: (sessionId: string, description: string) =>
    request<{ status: string; event: string }>(`/debate/${sessionId}/inject`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),

  getSummary: (sessionId: string) =>
    request<{ summary: string; token_usage: TokenUsage }>(`/debate/${sessionId}/summary`),

  /**
   * Returns the SSE URL for running a debate round.
   * Use with useSSE hook for streaming.
   */
  roundStreamUrl: (sessionId: string) => `${BASE_URL}/debate/${sessionId}/round`,
};
