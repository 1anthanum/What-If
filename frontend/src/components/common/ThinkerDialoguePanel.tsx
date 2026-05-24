/**
 * Thinker-vs-thinker dialogue — pick two historical philosophers from
 * the curated corpus, give them a question, watch them alternate.
 *
 * Each thinker's responses are anchored in their actual writings (RAG).
 * Wittgenstein vs Zhuangzi on language, Kant vs Mencius on duty,
 * Plato vs Confucius on virtue — these dialogues never actually
 * happened but become possible here.
 *
 * Triggered from header "💬 思想家对话" button.
 */
import { useEffect, useState } from 'react';
import { classicsApi, type ClassicThinker, type ClassicsDialogueResponse } from '../../services/api';

interface Props {
  onClose: () => void;
}

export function ThinkerDialoguePanel({ onClose }: Props) {
  const [thinkers, setThinkers] = useState<ClassicThinker[]>([]);
  const [a, setA] = useState('plato');
  const [b, setB] = useState('zhuangzi');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState(4);
  const [result, setResult] = useState<ClassicsDialogueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    classicsApi.listThinkers().then((r) => setThinkers(r.thinkers)).catch(() => undefined);
  }, []);

  const run = async () => {
    if (!question.trim() || a === b) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await classicsApi.dialogue({ thinker_a: a, thinker_b: b, question: question.trim(), turns })); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
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

        <div className="mb-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>💬</span>
            思想家对话
          </div>
          <h2 className="text-lg font-light text-white">
            从未发生过的<span className="text-amber-300">跨时代对话</span>
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            两位历史哲学家各自带着自己的文本（RAG）展开 N 回合对话。
            Wittgenstein 与庄子谈语言、Kant 与孟子谈义务、Plato 与孔子谈德性 — 这些对话历史上从未发生过。
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          {/* Picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
                A 方
              </label>
              <select
                value={a}
                onChange={(e) => setA(e.target.value)}
                className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-2 py-1.5 text-[12px] text-deep-50"
              >
                {thinkers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.name_en}) · {t.tradition}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
                B 方
              </label>
              <select
                value={b}
                onChange={(e) => setB(e.target.value)}
                className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-2 py-1.5 text-[12px] text-deep-50"
              >
                {thinkers.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id === a}>
                    {t.name} ({t.name_en}) · {t.tradition}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
              议题
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例：「语言是否能完全表达思想？」「德性是否可以教？」「自由意志与决定论如何调和？」"
              rows={2}
              className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-2.5 py-1.5 text-[12px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
              maxLength={300}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">回合数</label>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setTurns(n)}
                className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                  turns === n
                    ? 'border-amber-300/65 bg-amber-300/[0.10] text-amber-200'
                    : 'border-deep-400/40 text-deep-100/85 hover:border-amber-300/45'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          {error && (
            <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-2">
              {result.transcript.map((t) => {
                const isA = t.speaker_id === result.thinker_a.id;
                return (
                  <div
                    key={t.turn}
                    className={`rounded border p-3 ${
                      isA ? 'border-amber-300/45 bg-amber-300/[0.04]'
                          : 'border-blue-400/45 bg-blue-400/[0.04]'
                    }`}
                  >
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span className={`text-[12px] font-medium ${isA ? 'text-amber-200' : 'text-blue-200'}`}>
                        {t.speaker_name}
                      </span>
                      <span className="text-[9px] font-mono text-deep-300/65 tabular-nums">
                        回合 {t.turn}
                      </span>
                    </div>
                    <p className="text-[13px] text-deep-50 leading-relaxed whitespace-pre-wrap">
                      {t.content}
                    </p>
                  </div>
                );
              })}
              <details className="text-[11px] mt-3">
                <summary className="cursor-pointer text-deep-300/75 hover:text-amber-300 font-mono">
                  📜 本次对话引用的文本片段
                </summary>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                  <div>
                    <p className="text-[10px] font-mono text-amber-300/85 mb-1">{result.thinker_a.name}</p>
                    <ul className="space-y-1 text-[11px] text-deep-100/75">
                      {result.a_passages.map((p, i) => (
                        <li key={i} className="italic">· {p.source}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-blue-300/85 mb-1">{result.thinker_b.name}</p>
                    <ul className="space-y-1 text-[11px] text-deep-100/75">
                      {result.b_passages.map((p, i) => (
                        <li key={i} className="italic">· {p.source}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45"
          >
            关闭
          </button>
          <button
            onClick={run}
            disabled={!question.trim() || a === b || loading}
            className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              !question.trim() || a === b || loading
                ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
            }`}
          >
            {loading ? `进行 ${turns} 回合…` : (result ? '↻ 再来一次' : '▶ 开始对话')}
          </button>
        </div>
      </div>
    </div>
  );
}
