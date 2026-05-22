/**
 * Concept evolution map — extracts recurring philosophical concepts from
 * all persisted sessions and shows where each appeared + what it relates to.
 *
 * Trigger from header "💡 概念" button. Runs an on-demand LLM extraction
 * over the last N sessions; ~ one Sonnet call per click.
 */
import { useState } from 'react';
import { sessionsApi, type ConceptReport, type ConceptEntry } from '../../services/sessionsApi';

interface Props {
  onClose: () => void;
}

export function ConceptEvolutionPanel({ onClose }: Props) {
  const [report, setReport] = useState<ConceptReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConceptEntry | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await sessionsApi.concepts(25);
      setReport(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Concept "size" scaling — sqrt of count so even small differences read visually.
  const maxCount = report ? Math.max(...report.concepts.map((c) => c.count), 1) : 1;
  const sizeFor = (count: number) => {
    const ratio = Math.sqrt(count / maxCount);
    return 11 + ratio * 12; // 11px → 23px font
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
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
              <span>💡</span>
              概念演化
            </div>
            <h2 className="text-lg font-light text-white">
              跨 session <span className="text-amber-300">反复出现</span>的核心概念
            </h2>
            <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed max-w-2xl">
              LLM 扫描最近 25 个 session 提取真正反复出现的哲学概念，标注它们如何被定义 +
              与哪些其他概念关联。这是你"自己的思想档案"的索引层。
            </p>
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-amber-300/55 bg-amber-300/[0.06] text-amber-200 hover:bg-amber-300/[0.12] disabled:opacity-40 shrink-0"
          >
            {loading ? '提取中…' : (report ? '↻ 重提取' : '▶ 提取概念')}
          </button>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {!report && !loading && (
          <div className="flex-1 flex items-center justify-center text-deep-200/55 text-[13px] italic">
            点上方按钮提取概念
          </div>
        )}

        {report && (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_1.4fr] gap-4 overflow-hidden">
            {/* Concept cloud */}
            <div className="overflow-y-auto pr-1">
              <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-2">
                共 {report.concepts.length} 个概念 · 基于 {report.sessions_analyzed} 个 session
              </p>
              {report.concepts.length === 0 ? (
                <p className="text-[12px] text-deep-200/55 italic">尚无反复出现的概念 — 样本不足</p>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                  {report.concepts.map((c) => {
                    const isSel = selected?.name === c.name;
                    return (
                      <button
                        key={c.name}
                        onClick={() => setSelected(c)}
                        className={`transition-colors rounded px-2 py-0.5 ${
                          isSel
                            ? 'bg-amber-300/[0.10] border border-amber-300/55 text-amber-100'
                            : 'border border-transparent text-deep-50 hover:bg-deep-700/40 hover:text-amber-200'
                        }`}
                        style={{ fontSize: `${sizeFor(c.count)}px`, lineHeight: 1.3 }}
                        title={c.gloss}
                      >
                        {c.name}
                        <span className="ml-1 text-[9px] font-mono text-deep-300/70 tabular-nums align-baseline">
                          ×{c.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail pane */}
            <div className="overflow-y-auto pl-2 border-l border-deep-400/20">
              {!selected ? (
                <p className="text-[12px] text-deep-200/55 italic text-center py-6">
                  点左侧任一概念查看它如何在不同 session 中被讨论
                </p>
              ) : (
                <div className="space-y-3 px-2">
                  <div>
                    <h3 className="text-xl text-amber-200 font-medium mb-1">{selected.name}</h3>
                    <p className="text-[13px] text-deep-100/85 leading-relaxed">{selected.gloss}</p>
                  </div>

                  {selected.related.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">
                        关联概念
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.related.map((r) => (
                          <button
                            key={r}
                            onClick={() => {
                              const target = report.concepts.find((c) => c.name === r);
                              if (target) setSelected(target);
                            }}
                            className="text-[11px] font-mono px-2 py-0.5 rounded border border-amber-300/30 text-amber-300/85 hover:border-amber-300/65 hover:bg-amber-300/[0.05]"
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">
                      出现在 ({selected.session_ids.length}) 个 session
                    </p>
                    <ul className="space-y-1">
                      {selected.session_ids.map((sid) => (
                        <li key={sid} className="text-[11px] font-mono">
                          <span className="text-amber-300/75 tabular-nums">#{sid}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-deep-200/55 italic mt-2">
                      打开「📚 历史」并搜索这些 session id 查看完整内容
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
