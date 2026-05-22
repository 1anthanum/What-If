/**
 * Bias analysis dashboard — surfaces persona / model biases from the
 * persisted session archive.
 *
 * Read-only research tool; powered by GET /api/sessions/_bias.
 *
 * Key questions it answers:
 * - which persona is reliably dogmatic (never gives falsifiability lines)?
 * - which persona wins more judge-verdicts than others?
 * - which model writes longer / shorter when playing the same persona?
 * - does swapping the model change a persona's dogmatic rate?
 */
import { useEffect, useState, useCallback } from 'react';
import { sessionsApi, type BiasAnalytics, type RetrospectiveReport } from '../../services/sessionsApi';

const PERSONA_LABELS: Record<string, string> = {
  rationalist: '理性主义',
  existentialist: '存在主义',
  pragmatist: '实用主义',
  eastern_philosopher: '东方哲学',
  critical_theorist: '批判理论',
  adversary: '魔鬼代言人',
  virtue_ethicist: '美德伦理',
  utilitarian: '功利主义',
  feminist_theorist: '女性主义',
  religious_traditionalist: '宗教传统',
  complexity_theorist: '复杂系统',
};

interface Props {
  onClose: () => void;
}

export function BiasAnalysisPanel({ onClose }: Props) {
  const [data, setData] = useState<BiasAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retro, setRetro] = useState<RetrospectiveReport | null>(null);
  const [retroLoading, setRetroLoading] = useState(false);
  const [retroError, setRetroError] = useState<string | null>(null);

  const runRetro = async () => {
    setRetroLoading(true);
    setRetroError(null);
    try {
      setRetro(await sessionsApi.retrospective(15));
    } catch (e) {
      setRetroError((e as Error).message);
    } finally {
      setRetroLoading(false);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await sessionsApi.bias());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-surface notable patterns
  const patterns = (() => {
    if (!data) return [];
    const out: { kind: 'good' | 'warn' | 'neutral'; text: string }[] = [];
    // Most-dogmatic persona (≥ 3 statements)
    const elig = data.by_persona.filter((p) => p.total_statements >= 3);
    if (elig.length) {
      const mostDog = elig.slice().sort((a, b) => b.dogmatic_rate - a.dogmatic_rate)[0];
      if (mostDog.dogmatic_rate >= 40) {
        out.push({
          kind: 'warn',
          text: `${PERSONA_LABELS[mostDog.persona_id] ?? mostDog.persona_id} 在 ${mostDog.total_statements} 次发言中有 ${mostDog.dogmatic_rate}% 被标教条 — 该 persona 可能需要更强的可证伪 prompt`,
        });
      }
      const leastDog = elig.slice().sort((a, b) => a.dogmatic_rate - b.dogmatic_rate)[0];
      if (leastDog.dogmatic_rate <= 10 && leastDog.total_statements >= 5) {
        out.push({
          kind: 'good',
          text: `${PERSONA_LABELS[leastDog.persona_id] ?? leastDog.persona_id} 是最反思性的 persona（${leastDog.with_falsifiability} 次给出可证伪线 / ${leastDog.total_statements} 次发言）`,
        });
      }
    }
    // Most-winning persona
    const elig2 = data.by_persona.filter((p) => p.judge_wins > 0);
    if (elig2.length) {
      const winner = elig2.slice().sort((a, b) => b.judge_wins - a.judge_wins)[0];
      out.push({
        kind: 'neutral',
        text: `${PERSONA_LABELS[winner.persona_id] ?? winner.persona_id} 在 ${data.total_verdicts_analyzed} 次裁决中赢得 ${winner.judge_wins} 个争议点 — 表面上最有"说服力"，但也可能是 judge 的偏见`,
      });
    }
    // Per-model bias
    if (data.by_model.length >= 2) {
      const longest = data.by_model.slice().sort((a, b) => b.avg_content_length - a.avg_content_length)[0];
      const shortest = data.by_model.slice().sort((a, b) => a.avg_content_length - b.avg_content_length)[0];
      if (longest.avg_content_length > shortest.avg_content_length * 1.3 && shortest.total_statements >= 3) {
        out.push({
          kind: 'neutral',
          text: `${longest.model} 平均输出 ${Math.round(longest.avg_content_length)} 字 vs ${shortest.model} 的 ${Math.round(shortest.avg_content_length)} 字 — 模型间存在 verbosity 偏差`,
        });
      }
    }
    return out.slice(0, 4);
  })();

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
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
              <span>🧭</span>
              偏见分析
            </div>
            <h2 className="text-lg font-light text-white">
              persona × model <span className="text-amber-300">系统性偏差</span>
            </h2>
            <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed max-w-2xl">
              基于所有持久化 session 聚合而成。需要至少几次完整 cycle 才有有效信号 —
              单次数据只是好奇而已。
            </p>
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
            {/* Notable patterns */}
            {patterns.length > 0 && (
              <div className="mb-4 space-y-1.5">
                {patterns.map((p, i) => {
                  const tone = {
                    good: 'border-earth-green/40 bg-earth-green/[0.06] text-earth-green/95',
                    warn: 'border-earth-rust/45 bg-earth-rust/[0.08] text-earth-rust/95',
                    neutral: 'border-amber-300/35 bg-amber-300/[0.04] text-amber-200',
                  }[p.kind];
                  const icon = p.kind === 'good' ? '✓' : p.kind === 'warn' ? '⚠' : '◇';
                  return (
                    <div key={i} className={`text-[12px] leading-snug px-3 py-2 rounded border ${tone}`}>
                      <span className="font-mono mr-1.5">{icon}</span>
                      {p.text}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Per-persona table */}
            <div className="mb-5">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                  Per-persona
                </span>
                <span className="flex-1 h-px bg-amber-300/10" />
                <span className="text-[10px] font-mono text-deep-300 tabular-nums">
                  {data.by_persona.length} 个 persona · {data.total_verdicts_analyzed} 次裁决
                </span>
              </div>
              {data.by_persona.length === 0 ? (
                <p className="text-[12px] text-deep-200/55 italic">尚无 persona 发言记录 — 跑完一次 auto-loop 就会出现</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="text-deep-300/75 border-b border-deep-400/25">
                        <th className="text-left py-1 px-2 font-normal">persona</th>
                        <th className="text-right py-1 px-2 font-normal">发言</th>
                        <th className="text-right py-1 px-2 font-normal">教条率</th>
                        <th className="text-right py-1 px-2 font-normal">可证伪</th>
                        <th className="text-right py-1 px-2 font-normal">avg 字</th>
                        <th className="text-right py-1 px-2 font-normal">judge 胜</th>
                        <th className="text-right py-1 px-2 font-normal">最强</th>
                        <th className="text-right py-1 px-2 font-normal">最弱</th>
                        <th className="text-left py-1 px-2 font-normal">主用模型</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_persona.map((p) => (
                        <tr key={p.persona_id} className="border-b border-deep-400/10">
                          <td className="py-1 px-2 text-deep-50">
                            {PERSONA_LABELS[p.persona_id] ?? p.persona_id}
                          </td>
                          <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{p.total_statements}</td>
                          <td className={`text-right py-1 px-2 tabular-nums ${
                            p.dogmatic_rate >= 40 ? 'text-earth-rust/95'
                            : p.dogmatic_rate >= 20 ? 'text-amber-300/85'
                            : 'text-earth-green/85'
                          }`}>
                            {p.dogmatic_rate}%
                          </td>
                          <td className="text-right py-1 px-2 text-earth-green/85 tabular-nums">{p.with_falsifiability}</td>
                          <td className="text-right py-1 px-2 text-deep-100/75 tabular-nums">{Math.round(p.avg_content_length)}</td>
                          <td className="text-right py-1 px-2 text-amber-300/90 tabular-nums">{p.judge_wins}</td>
                          <td className="text-right py-1 px-2 text-earth-green/85 tabular-nums">{p.judge_strongest || ''}</td>
                          <td className="text-right py-1 px-2 text-earth-rust/85 tabular-nums">{p.judge_weakest || ''}</td>
                          <td className="text-left py-1 px-2 text-deep-200/70 truncate max-w-[180px]">
                            {p.top_models[0]?.model || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Meta-LLM retrospective — opt-in (costs a Sonnet call) */}
            <div className="mb-5 rounded-lg border border-purple-400/25 bg-purple-400/[0.03] p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div>
                  <span className="text-[10px] font-mono text-purple-400/95 uppercase tracking-wider">
                    🧠 元分析（Auto Retrospective）
                  </span>
                  <p className="text-[11px] text-deep-100/65 mt-1 leading-snug max-w-xl">
                    让一个 strong-tier LLM 读最近 15 个 session，找出每位 persona 的复发模式 +
                    缺席视角 + 具体的 prompt 改进建议。每跑一次 ≈ Sonnet 一次调用。
                  </p>
                </div>
                <button
                  onClick={runRetro}
                  disabled={retroLoading}
                  className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-purple-400/55 text-purple-200 hover:bg-purple-400/[0.10] disabled:opacity-40 shrink-0 whitespace-nowrap"
                >
                  {retroLoading ? '分析中…' : '▶ 跑元分析'}
                </button>
              </div>
              {retroError && (
                <div className="text-[11px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-2.5 py-1.5 mt-2">
                  {retroError}
                </div>
              )}
              {retro && (
                <div className="mt-3 space-y-3">
                  {retro.meta_observation && (
                    <div className="text-[12px] text-deep-50 leading-relaxed italic border-l-2 border-purple-400/40 pl-3 py-1">
                      {retro.meta_observation}
                    </div>
                  )}
                  {retro.persona_patterns.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-purple-400/85 uppercase tracking-wider mb-1.5">
                        复发模式 ({retro.persona_patterns.length})
                      </p>
                      <ul className="space-y-2">
                        {retro.persona_patterns.map((p, i) => (
                          <li key={i} className="text-[12px] rounded bg-deep-700/30 border border-deep-400/25 px-3 py-2">
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-[10px] font-mono text-amber-300/85">
                                {PERSONA_LABELS[p.persona_id] ?? p.persona_id}
                              </span>
                              <span className="text-deep-50 leading-snug flex-1 font-medium">{p.pattern}</span>
                            </div>
                            {p.evidence && p.evidence.length > 0 && (
                              <ul className="text-[11px] text-deep-200/70 italic pl-3 leading-snug mb-1.5">
                                {p.evidence.slice(0, 3).map((e, j) => (
                                  <li key={j}>· 「{e}」</li>
                                ))}
                              </ul>
                            )}
                            {p.prompt_suggestion && (
                              <p className="text-[11px] text-earth-green/85 leading-snug pl-3 mt-1">
                                <span className="font-mono text-earth-green/65">建议：</span>
                                {p.prompt_suggestion}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {retro.missing_perspectives.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-purple-400/85 uppercase tracking-wider mb-1.5">
                        缺席视角 ({retro.missing_perspectives.length})
                      </p>
                      <ul className="text-[11px] text-deep-100/85 space-y-0.5 pl-3">
                        {retro.missing_perspectives.map((m, i) => (
                          <li key={i}>· {m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-[10px] font-mono text-deep-300/65 tabular-nums">
                    基于 {retro.sessions_analyzed} 个 session{retro.model ? ` · model: ${retro.model}` : ''}
                  </p>
                </div>
              )}
            </div>

            {/* Per-model table */}
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                  Per-model
                </span>
                <span className="flex-1 h-px bg-amber-300/10" />
              </div>
              {data.by_model.length === 0 ? (
                <p className="text-[12px] text-deep-200/55 italic">尚无模型归因数据</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="text-deep-300/75 border-b border-deep-400/25">
                        <th className="text-left py-1 px-2 font-normal">model</th>
                        <th className="text-right py-1 px-2 font-normal">总发言</th>
                        <th className="text-right py-1 px-2 font-normal">教条率</th>
                        <th className="text-right py-1 px-2 font-normal">avg 字</th>
                        <th className="text-right py-1 px-2 font-normal">演过几个 persona</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_model.map((m) => (
                        <tr key={m.model} className="border-b border-deep-400/10">
                          <td className="py-1 px-2 text-deep-50 truncate max-w-[260px]" title={m.model}>{m.model}</td>
                          <td className="text-right py-1 px-2 text-deep-100/85 tabular-nums">{m.total_statements}</td>
                          <td className={`text-right py-1 px-2 tabular-nums ${
                            m.dogmatic_rate >= 40 ? 'text-earth-rust/95'
                            : m.dogmatic_rate >= 20 ? 'text-amber-300/85'
                            : 'text-earth-green/85'
                          }`}>
                            {m.dogmatic_rate}%
                          </td>
                          <td className="text-right py-1 px-2 text-deep-100/75 tabular-nums">{Math.round(m.avg_content_length)}</td>
                          <td className="text-right py-1 px-2 text-deep-100/75 tabular-nums">{m.personas_played}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
