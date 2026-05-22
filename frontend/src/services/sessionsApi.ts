/**
 * Sessions archive API — list / search / fetch persisted auto-loop sessions
 * from the SQLite-backed `/api/sessions` endpoints.
 */
import { BASE_URL } from './api';

export interface SessionListItem {
  session_id: string;
  created_at: string;
  finished_at: string | null;
  mode: 'philosophical' | 'historical';
  seed_hypothesis: string;
  cycle_count: number;
  stopped_reason: string | null;
  total_cost_usd: number;
  elapsed_seconds: number;
  synthesis_preview: string | null;
  flags?: Record<string, boolean>;
}

export interface SessionDetail extends SessionListItem {
  final_synthesis: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  cycles: Array<{
    cycle_num: number;
    hypothesis: string;
    synthesis: string | null;
    next_hypothesis: string | null;
    converged: number;
    personas: Array<{
      persona_id: string;
      persona_name: string;
      model: string | null;
      content: string;
      falsifiability: string | null;
      is_dogmatic: number;
    }>;
    judge_verdict?: {
      verdicts: Array<{
        contested_point: string;
        winning_position: string;
        winning_personas: string[];
        verdict_reason: string;
        confidence: number;
      }>;
      overall_strongest?: { persona_id: string; reason: string };
      overall_weakest?: { persona_id: string; reason: string };
    };
  }>;
}

export interface SessionStats {
  total_sessions: number;
  total_cycles: number;
  total_cost_usd: number;
  avg_cycles_per_session: number;
  stopped_reasons: Record<string, number>;
  by_persona: Array<{
    persona_id: string;
    total: number;
    dogmatic: number;
    with_falsifiability: number;
  }>;
}

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE_URL}${path}`, init);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return r.json();
}

export const sessionsApi = {
  list: (q?: string, limit = 30, offset = 0) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    return _fetch<{ sessions: SessionListItem[] }>(`/sessions?${params}`);
  },
  detail: (sessionId: string) => _fetch<SessionDetail>(`/sessions/${sessionId}`),
  stats: () => _fetch<SessionStats>(`/sessions/_stats`),
  remove: (sessionId: string) =>
    _fetch<{ status: string }>(`/sessions/${sessionId}`, { method: 'DELETE' }),
};
