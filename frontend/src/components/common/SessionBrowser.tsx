/**
 * Session archive browser — list + search + detail view of persisted
 * auto-loop sessions. Triggered from the header "📚 历史" button.
 *
 * MVP scope:
 * - List with search, newest first
 * - Click a row → expand detail (cycles, personas with falsifiability,
 *   judge verdicts, final synthesis)
 * - Delete button per session
 * - Cross-session stats bar at top
 *
 * Reopening a past session into the live AutoLoop view is deferred —
 * that requires a separate "replay mode" branch in autoLoopStore.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  sessionsApi,
  type SessionListItem,
  type SessionDetail,
  type SessionStats,
  type ConsistencyReport,
} from '../../services/sessionsApi';
import { useTimeCapsuleStore, ageInDays, REVIEW_AGE_DAYS } from '../../store/timeCapsuleStore';

interface Props {
  onClose: () => void;
}

export function SessionBrowser({ onClose }: Props) {
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const capsule = useTimeCapsuleStore();
  const [capsuleConsistency, setCapsuleConsistency] = useState<string | null>(null);

  const refresh = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const [list, statsResp] = await Promise.all([
        sessionsApi.list(query || undefined),
        sessionsApi.stats(),
      ]);
      setItems(list.sessions);
      setStats(statsResp);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh('');
  }, [refresh]);

  // Debounced search
  useEffect(() => {
    const h = setTimeout(() => refresh(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q, refresh]);

  const loadDetail = async (id: string) => {
    if (selectedId === id) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    setSelectedId(id);
    setDetail(null);
    try {
      setDetail(await sessionsApi.detail(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`确定删除 session ${id}？这不可撤销。`)) return;
    try {
      await sessionsApi.remove(id);
      if (selectedId === id) { setSelectedId(null); setDetail(null); }
      refresh(q.trim());
    } catch (e2) {
      setError((e2 as Error).message);
    }
  };

  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) +
        ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  const fmtElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60}m`;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-6xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>📚</span>
            历史会话
          </div>
          <h2 className="text-lg font-light text-white">
            过往 <span className="text-amber-300">辩论档案</span>
          </h2>
        </div>

        {/* Time capsule banner — surfaces unreviewed sessions ≥ N days old */}
        {(() => {
          const eligible = items
            .filter((s) => {
              const age = ageInDays(s.created_at);
              return age >= REVIEW_AGE_DAYS && !capsule.isReviewed(s.session_id) && !capsule.isSnoozed(s.session_id);
            })
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          if (eligible.length === 0) return null;
          const oldest = eligible[0];
          return (
            <div className="mb-3 rounded-lg border border-purple-400/35 bg-purple-400/[0.05] px-3 py-2.5 flex items-center gap-3">
              <span className="text-[14px]">🕰</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-mono text-purple-400/95 uppercase tracking-wider mb-0.5">
                  时光胶囊 · {eligible.length} 个 session 等你复习
                </p>
                <p className="text-[12px] text-deep-50 leading-snug truncate">
                  「{oldest.seed_hypothesis}」 — {ageInDays(oldest.created_at)} 天前
                </p>
              </div>
              <button
                onClick={() => setCapsuleConsistency(oldest.session_id)}
                className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-purple-400/55 bg-purple-400/[0.10] text-purple-200 hover:bg-purple-400/[0.18] shrink-0"
              >
                ⏱ 现在重测
              </button>
              <button
                onClick={() => capsule.snooze(oldest.session_id)}
                className="text-[10px] font-mono text-deep-200/65 hover:text-amber-300 px-2 py-1 rounded border border-deep-400/30 hover:border-amber-300/35 shrink-0"
                title="30 天内不再提示这条"
              >
                ⌧ 缓 30 天
              </button>
            </div>
          );
        })()}
        {capsuleConsistency && (
          <ConsistencyTestModal
            sessionId={capsuleConsistency}
            onClose={() => {
              capsule.markReviewed(capsuleConsistency);
              setCapsuleConsistency(null);
            }}
          />
        )}

        {/* Stats bar */}
        {stats && (
          <div className="flex flex-wrap gap-3 mb-3 text-[11px] font-mono text-deep-100/85">
            <span className="px-2.5 py-1 rounded border border-deep-400/30 bg-deep-700/30">
              共 <span className="text-amber-300/95 tabular-nums">{stats.total_sessions}</span> 个 session
            </span>
            <span className="px-2.5 py-1 rounded border border-deep-400/30 bg-deep-700/30">
              <span className="text-amber-300/95 tabular-nums">{stats.total_cycles}</span> 个 cycle
            </span>
            <span className="px-2.5 py-1 rounded border border-deep-400/30 bg-deep-700/30">
              平均 <span className="text-amber-300/95 tabular-nums">{stats.avg_cycles_per_session}</span> cycle/session
            </span>
            <span className="px-2.5 py-1 rounded border border-deep-400/30 bg-deep-700/30">
              累计 $<span className="text-amber-300/95 tabular-nums">{stats.total_cost_usd.toFixed(3)}</span>
            </span>
            {Object.entries(stats.stopped_reasons).slice(0, 3).map(([k, v]) => (
              <span key={k} className="px-2.5 py-1 rounded border border-deep-400/30 bg-deep-700/30">
                {k}: <span className="text-amber-300/95 tabular-nums">{v}</span>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-300/70 pointer-events-none">⌕</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 hypothesis / persona 内容 / synthesis…"
              className="w-full pl-8 pr-3 py-2 bg-deep-800/50 border border-deep-400/30 rounded text-[13px] text-deep-50 placeholder-deep-300/50 focus:border-amber-300/55"
            />
          </div>
          <span className="text-[11px] font-mono text-deep-300 self-center tabular-nums whitespace-nowrap">
            {items.length} 个匹配
          </span>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {/* List + Detail split */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-hidden">
          {/* List */}
          <div className="overflow-y-auto pr-1 space-y-1.5">
            {loading && items.length === 0 ? (
              <p className="text-[12px] text-deep-200/55 italic text-center py-6">载入…</p>
            ) : items.length === 0 ? (
              <p className="text-[12px] text-deep-200/55 italic text-center py-6">
                {q ? '无匹配' : '尚无历史 session — 跑一次自动循环就会出现在这里'}
              </p>
            ) : (
              items.map((s) => {
                const active = s.session_id === selectedId;
                return (
                  <div
                    key={s.session_id}
                    onClick={() => loadDetail(s.session_id)}
                    className={`cursor-pointer rounded border p-2.5 transition-colors ${
                      active
                        ? 'border-amber-300/55 bg-amber-300/[0.06]'
                        : 'border-deep-400/30 hover:border-amber-300/35 hover:bg-deep-700/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-mono text-amber-300/70 tabular-nums">
                        #{s.session_id}
                      </span>
                      <span className="text-[9px] font-mono text-deep-300 uppercase tracking-wider">
                        {s.mode === 'philosophical' ? '哲学' : '历史'} · {s.cycle_count} cycle
                      </span>
                      {s.stopped_reason && (
                        <span className={`text-[9px] font-mono px-1 py-0.5 rounded ${
                          s.stopped_reason === 'converged'
                            ? 'text-earth-green/90 bg-earth-green/[0.08] border border-earth-green/30'
                            : 'text-deep-200/60 border border-deep-400/25'
                        }`}>
                          {s.stopped_reason}
                        </span>
                      )}
                      <span className="ml-auto text-[9px] font-mono text-deep-300/75 tabular-nums">
                        {fmtDate(s.created_at)}
                      </span>
                    </div>
                    <p className="text-[12px] text-deep-50 leading-snug line-clamp-2">
                      {s.seed_hypothesis}
                    </p>
                    {s.synthesis_preview && (
                      <p className="text-[10px] text-deep-200/65 leading-snug line-clamp-1 mt-1 italic">
                        {s.synthesis_preview}…
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] font-mono text-deep-300/85 tabular-nums">
                        ${s.total_cost_usd.toFixed(3)} · {fmtElapsed(s.elapsed_seconds)}
                      </span>
                      <button
                        onClick={(e) => handleDelete(s.session_id, e)}
                        className="ml-auto text-[9px] font-mono text-deep-300/60 hover:text-earth-rust px-1.5 py-0.5 rounded border border-deep-400/20 hover:border-earth-rust/40"
                        title="删除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detail */}
          <div className="overflow-y-auto pl-1 border-l border-deep-400/20">
            {!selectedId ? (
              <p className="text-[12px] text-deep-200/55 italic text-center py-6 px-3">
                选择左侧 session 查看完整内容
              </p>
            ) : !detail ? (
              <p className="text-[12px] text-deep-200/55 italic text-center py-6">载入详情…</p>
            ) : (
              <SessionDetailView detail={detail} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──── Time-consistency test modal ──── */

const VERDICT_TONE: Record<string, { label: string; class: string }> = {
  consistent:         { label: '✓ 一致',     class: 'text-earth-green/95 border-earth-green/45 bg-earth-green/[0.08]' },
  nuance_shift:       { label: '◐ 细微偏移', class: 'text-amber-300/95 border-amber-300/45 bg-amber-300/[0.08]' },
  significant_drift:  { label: '⤳ 明显漂移', class: 'text-earth-rust/95 border-earth-rust/45 bg-earth-rust/[0.08]' },
  contradicted:       { label: '⤬ 矛盾',     class: 'text-earth-rust/95 border-earth-rust/65 bg-earth-rust/[0.14]' },
  unknown:            { label: '? 未知',     class: 'text-deep-200/65 border-deep-400/35 bg-deep-700/30' },
};

function ConsistencyTestModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<ConsistencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setData(await sessionsApi.consistencyTest(sessionId));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-deep-950/90 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-purple-400/30 rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-purple-400/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-purple-400/45 rounded-full">
            <span>⏱</span>
            时间一致性测试
          </div>
          <h2 className="text-lg font-light text-white">
            session <span className="text-amber-300">#{sessionId}</span> 立场漂移检测
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            用当下的同一模型 + 同一 persona prompt 重新回答原问题，
            然后让 strong-tier LLM 评估两次回答的立场一致性。
            揭示 LLM 在同一议题上的内在稳定性（或不稳定性）。
          </p>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-deep-200/65 italic">
            正在重新询问每位 persona…
          </div>
        ) : data ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            <div className="text-[11px] font-mono text-deep-300/85 tabular-nums">
              原 session 完成于：{data.original_finished_at?.split('T')[0] ?? '未知'} · 重跑于：{data.replayed_at.split('T')[0]}
            </div>
            {data.results.map((r) => {
              const tone = VERDICT_TONE[r.verdict] || VERDICT_TONE.unknown;
              return (
                <div key={r.persona_id} className="rounded-lg border border-deep-400/30 bg-deep-700/20 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-mono text-amber-300/90">{r.persona_name}</span>
                    <span className="text-[10px] font-mono text-deep-300/70">{r.model}</span>
                    {r.skipped ? (
                      <span className="ml-auto text-[10px] font-mono text-earth-rust/85">
                        ✗ {r.error || '跳过'}
                      </span>
                    ) : (
                      <span className={`ml-auto text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border ${tone.class}`}>
                        {tone.label}
                      </span>
                    )}
                  </div>
                  {!r.skipped && (
                    <>
                      {r.reason && (
                        <p className="text-[12px] text-deep-100/85 leading-snug italic mb-2">
                          ↳ {r.reason}
                        </p>
                      )}
                      {(r.key_continuity || r.key_change) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2 text-[11px]">
                          {r.key_continuity && (
                            <div className="rounded bg-earth-green/[0.05] border border-earth-green/25 px-2 py-1">
                              <span className="font-mono text-earth-green/85 mr-1">保留：</span>
                              <span className="text-deep-100/85">{r.key_continuity}</span>
                            </div>
                          )}
                          {r.key_change && (
                            <div className="rounded bg-earth-rust/[0.05] border border-earth-rust/25 px-2 py-1">
                              <span className="font-mono text-earth-rust/85 mr-1">变化：</span>
                              <span className="text-deep-100/85">{r.key_change}</span>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div className="text-[11px] rounded bg-deep-800/50 border border-deep-400/30 px-2 py-1.5">
                          <p className="text-[9px] font-mono text-deep-300/75 uppercase tracking-wider mb-1">原 (Time A)</p>
                          <p className="text-deep-100/85 leading-snug whitespace-pre-wrap line-clamp-6">
                            {r.original_content}
                          </p>
                        </div>
                        <div className="text-[11px] rounded bg-amber-300/[0.04] border border-amber-300/30 px-2 py-1.5">
                          <p className="text-[9px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">新 (Time B)</p>
                          <p className="text-deep-50 leading-snug whitespace-pre-wrap line-clamp-6">
                            {r.new_content}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SessionDetailView({ detail }: { detail: SessionDetail }) {
  const [consistencyOpen, setConsistencyOpen] = useState(false);
  return (
    <div className="space-y-3 pl-3 pr-1">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-mono text-amber-300/80 uppercase tracking-wider">
            种子假设
          </p>
          <button
            onClick={() => setConsistencyOpen(true)}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-purple-400/45 text-purple-200 hover:bg-purple-400/[0.08] transition-colors"
            title="用当下的 LLM 重跑同一问题，对比 persona 立场是否漂移"
          >
            ⏱ 时间一致性测试
          </button>
        </div>
        <p className="text-[13px] text-deep-50 leading-relaxed mt-1">{detail.seed_hypothesis}</p>
      </div>
      {consistencyOpen && (
        <ConsistencyTestModal
          sessionId={detail.session_id}
          onClose={() => setConsistencyOpen(false)}
        />
      )}

      {detail.final_synthesis && (
        <div>
          <p className="text-[11px] font-mono text-amber-300/80 uppercase tracking-wider mb-1">
            最终综合
          </p>
          <p className="text-[12px] text-deep-100/85 leading-relaxed whitespace-pre-wrap">
            {detail.final_synthesis}
          </p>
        </div>
      )}

      <div>
        <p className="text-[11px] font-mono text-amber-300/80 uppercase tracking-wider mb-2">
          Cycles ({detail.cycles.length})
        </p>
        <div className="space-y-3">
          {detail.cycles.map((c) => (
            <div key={c.cycle_num} className="rounded border border-deep-400/25 bg-deep-700/20 p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded border border-amber-300/40 text-amber-300/90">
                  #{c.cycle_num}
                </span>
                <p className="text-[12px] text-deep-50 font-medium flex-1 line-clamp-2">
                  {c.hypothesis}
                </p>
                {c.converged ? (
                  <span className="text-[9px] font-mono text-earth-green/90 px-1.5 py-0.5 rounded border border-earth-green/40">
                    ✓ 收敛
                  </span>
                ) : null}
              </div>
              {c.personas.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {c.personas.map((p) => (
                    <div key={p.persona_id} className="text-[11px]">
                      <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span className="font-mono text-amber-300/85">{p.persona_name}</span>
                        <span className="font-mono text-[9px] text-deep-300/70">{p.model || ''}</span>
                        {p.falsifiability ? (
                          <span className="text-[8px] font-mono px-1 rounded border border-earth-green/40 text-earth-green/85">
                            ✓ 可证伪
                          </span>
                        ) : p.is_dogmatic ? (
                          <span className="text-[8px] font-mono px-1 rounded border border-earth-rust/40 text-earth-rust/85">
                            ⚠ 教条
                          </span>
                        ) : null}
                      </div>
                      <p className="text-deep-100/85 line-clamp-2 pl-1.5">
                        {p.content}
                      </p>
                      {p.falsifiability && (
                        <p className="text-[10px] text-earth-green/85 italic pl-1.5 mt-0.5">
                          ↳ {p.falsifiability}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {c.judge_verdict && c.judge_verdict.verdicts.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-amber-300/15">
                  <p className="text-[9px] font-mono text-amber-300/75 uppercase tracking-wider mb-1">
                    ⚖ 裁决
                  </p>
                  {c.judge_verdict.verdicts.map((v, i) => (
                    <div key={i} className="text-[10px] text-deep-100/80 leading-snug mb-1">
                      <span className="text-earth-green/85">胜出：</span>
                      {v.winning_position}
                      <span className="text-deep-200/55"> — {v.verdict_reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {c.synthesis && (
                <details className="mt-2">
                  <summary className="text-[10px] font-mono text-purple-400/70 cursor-pointer hover:text-purple-400/95">
                    本轮综合 ▾
                  </summary>
                  <p className="text-[11px] text-deep-100/75 leading-relaxed mt-1 pl-2 whitespace-pre-wrap">
                    {c.synthesis}
                  </p>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
