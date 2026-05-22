/**
 * Same-persona × multiple-models comparison.
 *
 * Triggered from a per-PersonaCard "🔀 多模型对比" button. Sends the
 * persona's question through Claude / GPT-5 / DeepSeek (default specs)
 * in parallel and shows the three responses side by side so the user
 * can see each model's internal philosophical biases.
 */
import { useEffect, useState } from 'react';
import { autoLoopApi, type PersonaCompareResponse } from '../../services/api';

interface Props {
  personaId: string;
  personaName: string;
  question: string;
  history?: string;
  onClose: () => void;
}

const DEFAULT_SPECS = [
  'claude:claude-sonnet-4-6',
  'openai:gpt-5-mini',
  'deepseek:deepseek-chat',
];

export function PersonaCompareModal({
  personaId,
  personaName,
  question,
  history,
  onClose,
}: Props) {
  const [data, setData] = useState<PersonaCompareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [specs, setSpecs] = useState<string[]>(DEFAULT_SPECS);

  const run = async (useSpecs: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const r = await autoLoopApi.comparePersona({
        persona_id: personaId,
        question,
        history,
        specs: useSpecs,
      });
      setData(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run(specs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <span>🔀</span>
            同 persona × 多模型
          </div>
          <h2 className="text-lg font-light text-white">
            <span className="text-amber-300">{personaName}</span> 在 {specs.length} 个模型下的诠释差异
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            同一个 system prompt + 同一个问题 → 不同模型的回答揭示各家 LLM 的内置哲学倾向。
          </p>
        </div>

        <div className="mb-3 px-3 py-2 rounded bg-deep-800/40 border border-deep-400/30">
          <p className="text-[10px] font-mono text-amber-300/75 uppercase tracking-wider mb-1">问题</p>
          <p className="text-[12px] text-deep-50 leading-relaxed line-clamp-3">{question}</p>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-hidden">
          {(data?.responses ?? specs.map(s => ({ spec: s, content: '', latency_ms: 0, error: null }))).map((r) => (
            <div
              key={r.spec}
              className="rounded-lg border border-deep-400/35 bg-deep-700/20 p-3 flex flex-col overflow-hidden"
            >
              <div className="flex items-baseline gap-2 mb-2 shrink-0">
                <span className="text-[11px] font-mono text-amber-300/90 tracking-wider">
                  {r.spec.split(':')[0]}
                </span>
                <span className="text-[9px] font-mono text-deep-300/75 truncate">
                  {r.spec.split(':')[1]}
                </span>
                {r.latency_ms > 0 && (
                  <span className="ml-auto text-[9px] font-mono text-deep-300/65 tabular-nums shrink-0">
                    {Math.round(r.latency_ms)}ms
                  </span>
                )}
              </div>
              <div className="overflow-y-auto pr-1">
                {loading && !r.content ? (
                  <p className="text-[11px] text-deep-200/55 italic">载入…</p>
                ) : r.error ? (
                  <p className="text-[11px] text-earth-rust/85 italic">{r.error}</p>
                ) : (
                  <p className="text-[12px] text-deep-100/85 leading-relaxed whitespace-pre-wrap">
                    {r.content || '(空)'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 shrink-0">
          <p className="text-[10px] font-mono text-deep-200/55 italic">
            这不是 persona 在主辩论中实际发言的版本 — 只是用同样的 prompt 重跑一次。
          </p>
          <button
            onClick={() => run(specs)}
            disabled={loading}
            className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-amber-300/40 text-amber-300 hover:border-amber-300/65 hover:bg-amber-300/[0.05] disabled:opacity-40"
          >
            {loading ? '运行中…' : '↻ 重跑'}
          </button>
        </div>
      </div>
    </div>
  );
}
