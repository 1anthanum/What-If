/**
 * Dev-facing metrics panel — fetches /api/metrics and renders
 * per-backend latency / token / error stats + SSE bus state.
 *
 * Triggered from a header button. Polls on demand (manual refresh).
 */
import { useState, useEffect, useCallback } from 'react';
import { BASE_URL } from '../../services/api';

interface BackendLatency {
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  error_count: number;
}

interface BackendTokens {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  api_calls: number;
}

interface TrackerSummary {
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  estimated_cost_usd: number;
  by_backend: Record<string, BackendTokens>;
  latency_by_backend: Record<string, BackendLatency>;
  latency_by_phase: Record<string, BackendLatency>;
}

interface BusSession {
  session_id: string;
  completed: boolean;
  next_event_id: number;
  buffered: number;
  last_activity_age_s: number;
}

interface MetricsResponse {
  trackers: Record<string, TrackerSummary | { error: string }>;
  buses: {
    active: number;
    completed: number;
    buffered_events: number;
    by_session: BusSession[];
  };
}

export function MetricsPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTracker, setSelectedTracker] = useState<string>('auto_loop');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_URL}/metrics`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const tracker = data?.trackers[selectedTracker];
  const trackerSummary: TrackerSummary | null =
    tracker && !('error' in tracker) ? tracker : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="flex items-baseline justify-between mb-4">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
              <span>📊</span>
              Metrics
            </div>
            <h2 className="text-lg font-light text-white">
              后端 <span className="text-amber-300">observability</span>
            </h2>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-amber-300/40 text-amber-300 hover:border-amber-300/65 hover:bg-amber-300/[0.05] disabled:opacity-40"
          >
            {loading ? '加载…' : '↻ 刷新'}
          </button>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Bus registry */}
            <div className="bg-blue-400/[0.04] border border-blue-400/25 rounded-lg p-3 mb-4">
              <div className="flex items-baseline gap-3 mb-1.5">
                <span className="text-[10px] font-mono text-blue-400/90 uppercase tracking-wider">
                  SSE Bus
                </span>
                <span className="flex-1 h-px bg-blue-400/15" />
                <span className="text-[11px] font-mono text-deep-100/85 tabular-nums">
                  {data.buses.active} 活跃 · {data.buses.completed} 已完 · {data.buses.buffered_events} 个缓存事件
                </span>
              </div>
              {data.buses.by_session.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
                  {data.buses.by_session.slice(0, 9).map((b) => (
                    <div
                      key={b.session_id}
                      className={`text-[11px] font-mono px-2 py-1 rounded border tabular-nums ${
                        b.completed
                          ? 'border-deep-400/30 text-deep-200/75'
                          : 'border-earth-green/45 text-earth-green/95 bg-earth-green/[0.04]'
                      }`}
                    >
                      <span className="opacity-80">#{b.session_id}</span>
                      <span className="ml-1">· e{b.next_event_id - 1}</span>
                      <span className="ml-1 text-[10px] opacity-70">· {b.last_activity_age_s}s</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tracker selector */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {Object.keys(data.trackers).map((key) => {
                const t = data.trackers[key];
                const calls = t && !('error' in t) ? t.total_calls : 0;
                const cost = t && !('error' in t) ? t.estimated_cost_usd : 0;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedTracker(key)}
                    className={`text-[11px] font-mono px-2.5 py-1 rounded border tabular-nums ${
                      selectedTracker === key
                        ? 'border-amber-300/65 text-amber-200 bg-amber-300/[0.08]'
                        : 'border-deep-400/30 text-deep-200/75 hover:border-amber-300/40'
                    }`}
                  >
                    {key} <span className="opacity-65">({calls} · ${cost.toFixed(3)})</span>
                  </button>
                );
              })}
            </div>

            {trackerSummary ? (
              <>
                {/* Per-backend latency table */}
                <div className="mb-4">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                      Latency by backend
                    </span>
                    <span className="flex-1 h-px bg-amber-300/10" />
                  </div>
                  {Object.keys(trackerSummary.latency_by_backend).length === 0 ? (
                    <p className="text-[11px] text-deep-200/55 italic">尚无调用记录</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-deep-300/75 border-b border-deep-400/25">
                            <th className="text-left py-1 px-2 font-normal">backend</th>
                            <th className="text-right py-1 px-2 font-normal">calls</th>
                            <th className="text-right py-1 px-2 font-normal">avg</th>
                            <th className="text-right py-1 px-2 font-normal">p50</th>
                            <th className="text-right py-1 px-2 font-normal">p95</th>
                            <th className="text-right py-1 px-2 font-normal">max</th>
                            <th className="text-right py-1 px-2 font-normal">errors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(trackerSummary.latency_by_backend).map(([k, v]) => (
                            <tr key={k} className="border-b border-deep-400/10">
                              <td className="py-1 px-2 text-deep-50">{k}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{v.count}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{Math.round(v.avg_ms)}ms</td>
                              <td className="text-right py-1 px-2 text-deep-100/75 tabular-nums">{Math.round(v.p50_ms)}ms</td>
                              <td className="text-right py-1 px-2 text-amber-300/85 tabular-nums">{Math.round(v.p95_ms)}ms</td>
                              <td className="text-right py-1 px-2 text-deep-200/65 tabular-nums">{Math.round(v.max_ms)}ms</td>
                              <td className={`text-right py-1 px-2 tabular-nums ${v.error_count > 0 ? 'text-earth-rust/90' : 'text-deep-200/55'}`}>
                                {v.error_count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Per-phase latency */}
                {Object.keys(trackerSummary.latency_by_phase).length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                        Latency by phase
                      </span>
                      <span className="flex-1 h-px bg-amber-300/10" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-deep-300/75 border-b border-deep-400/25">
                            <th className="text-left py-1 px-2 font-normal">phase</th>
                            <th className="text-right py-1 px-2 font-normal">calls</th>
                            <th className="text-right py-1 px-2 font-normal">avg</th>
                            <th className="text-right py-1 px-2 font-normal">p95</th>
                            <th className="text-right py-1 px-2 font-normal">max</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(trackerSummary.latency_by_phase).map(([k, v]) => (
                            <tr key={k} className="border-b border-deep-400/10">
                              <td className="py-1 px-2 text-deep-50 truncate max-w-[260px]" title={k}>{k}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{v.count}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{Math.round(v.avg_ms)}ms</td>
                              <td className="text-right py-1 px-2 text-amber-300/85 tabular-nums">{Math.round(v.p95_ms)}ms</td>
                              <td className="text-right py-1 px-2 text-deep-200/65 tabular-nums">{Math.round(v.max_ms)}ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Per-backend tokens / cost */}
                {Object.keys(trackerSummary.by_backend).length > 0 && (
                  <div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                        Tokens & cost by backend
                      </span>
                      <span className="flex-1 h-px bg-amber-300/10" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="text-deep-300/75 border-b border-deep-400/25">
                            <th className="text-left py-1 px-2 font-normal">backend</th>
                            <th className="text-right py-1 px-2 font-normal">in</th>
                            <th className="text-right py-1 px-2 font-normal">cached</th>
                            <th className="text-right py-1 px-2 font-normal">out</th>
                            <th className="text-right py-1 px-2 font-normal">cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(trackerSummary.by_backend).map(([k, v]) => (
                            <tr key={k} className="border-b border-deep-400/10">
                              <td className="py-1 px-2 text-deep-50">{k}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{v.input_tokens.toLocaleString()}</td>
                              <td className="text-right py-1 px-2 text-earth-green/75 tabular-nums">{v.cached_input_tokens.toLocaleString()}</td>
                              <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{v.output_tokens.toLocaleString()}</td>
                              <td className="text-right py-1 px-2 text-amber-300/85 tabular-nums">${v.cost_usd.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-[12px] text-deep-200/65 italic">该 tracker 无数据或加载失败</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
