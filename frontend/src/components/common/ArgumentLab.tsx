/**
 * Argument Lab — three research instruments that operate on individual
 * arguments rather than full debate cycles:
 *
 *  - Expand:     given a 1-sentence thesis, ask LLM for strongest ~1000-word version
 *  - Density:    annotate each sentence with rhetorical role; render heatmap
 *  - Robustness: 4 variants of question (control + 3 attacks) on one persona;
 *                comparator judges shifts
 *
 * Triggered from header "🔬 Lab" button. Tabbed interface.
 */
import { useState } from 'react';
import {
  argumentApi,
  type ExpansionResponse,
  type DensityResponse,
  type DensitySentence,
  type DensityRole,
  type RobustnessResponse,
} from '../../services/api';

interface Props {
  onClose: () => void;
}

type Tab = 'expand' | 'density' | 'robustness';

const PERSONA_CHOICES = [
  { id: 'rationalist', name: '理性主义' },
  { id: 'existentialist', name: '存在主义' },
  { id: 'pragmatist', name: '实用主义' },
  { id: 'eastern_philosopher', name: '东方哲学' },
  { id: 'critical_theorist', name: '批判理论' },
];

const ROLE_TONE: Record<DensityRole, { label: string; class: string }> = {
  claim:         { label: '论点',  class: 'bg-amber-300/[0.18] border-amber-300/55 text-amber-100' },
  evidence:      { label: '证据',  class: 'bg-earth-green/[0.14] border-earth-green/55 text-earth-green/95' },
  reasoning:     { label: '推理',  class: 'bg-blue-400/[0.14] border-blue-400/55 text-blue-200' },
  counterpoint:  { label: '反方',  class: 'bg-purple-400/[0.14] border-purple-400/55 text-purple-200' },
  qualification: { label: '限定',  class: 'bg-deep-500/30 border-deep-400/55 text-deep-50' },
  repetition:    { label: '重复',  class: 'bg-earth-rust/[0.10] border-earth-rust/40 text-earth-rust/85' },
  filler:        { label: '水',    class: 'bg-deep-700/40 border-deep-400/30 text-deep-200/55' },
};

export function ArgumentLab({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('expand');

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
            <span>🔬</span>
            Argument Lab
          </div>
          <h2 className="text-lg font-light text-white">
            把<span className="text-amber-300">论证本身</span>当对象研究
          </h2>
        </div>

        <div className="flex gap-1 mb-3 border-b border-deep-400/25">
          {([
            { k: 'expand',     label: '🔍 扩展强度', desc: '一句论点 → 1000 字最强版' },
            { k: 'density',    label: '📊 密度热图', desc: '逐句标 claim / evidence / 水分' },
            { k: 'robustness', label: '🛡 鲁棒性',   desc: '谄媚 / 伪共识 / 字面陷阱 三攻击' },
          ] as { k: Tab; label: string; desc: string }[]).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-t transition-colors ${
                tab === t.k
                  ? 'bg-amber-300/[0.06] text-amber-200 border-x border-t border-amber-300/40'
                  : 'text-deep-200/70 hover:text-amber-300'
              }`}
              title={t.desc}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {tab === 'expand' && <ExpandTab />}
          {tab === 'density' && <DensityTab />}
          {tab === 'robustness' && <RobustnessTab />}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab 1: Expand ─── */
function ExpandTab() {
  const [thesis, setThesis] = useState('');
  const [result, setResult] = useState<ExpansionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!thesis.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await argumentApi.expand(thesis.trim())); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-deep-100/75 leading-relaxed">
        给一句**论点**（不是问题），LLM 把它扩展成最强长版论证。如果扩展不出来 /
        全是空话 → 原论点本身是空的。
      </p>
      <textarea
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        placeholder="一句话论点，例：「自由意志与因果决定论不兼容」"
        rows={2}
        className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[13px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
        maxLength={600}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-deep-300/65 tabular-nums">{thesis.length}/600</span>
        <button
          onClick={run}
          disabled={!thesis.trim() || loading}
          className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            !thesis.trim() || loading
              ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
              : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
          }`}
        >
          {loading ? '扩展中…' : '▶ 扩展'}
        </button>
      </div>
      {error && (
        <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded border border-amber-300/35 bg-amber-300/[0.03] p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
              扩展结果
            </span>
            <span className="text-[10px] font-mono text-deep-300/75 tabular-nums">
              {result.length_chars} 字 · {Math.round(result.latency_ms)}ms · {result.model}
            </span>
          </div>
          <p className="text-[13px] text-deep-50 leading-relaxed whitespace-pre-wrap">
            {result.expanded}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Tab 2: Density ─── */
function DensityTab() {
  const [content, setContent] = useState('');
  const [result, setResult] = useState<DensityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!content.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await argumentApi.density(content.trim())); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-deep-100/75 leading-relaxed">
        粘贴一段论证（如某 persona 的发言），系统逐句标注角色：claim / evidence /
        reasoning / qualification / counterpoint / repetition / filler。
        水分（重复 + 填充）比例高意味着论证空洞。
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="粘贴一段论证…（≤ 4000 字）"
        rows={5}
        className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[13px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
        maxLength={4000}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-deep-300/65 tabular-nums">{content.length}/4000</span>
        <button
          onClick={run}
          disabled={!content.trim() || loading}
          className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            !content.trim() || loading
              ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
              : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
          }`}
        >
          {loading ? '分析中…' : '▶ 分析密度'}
        </button>
      </div>
      {error && (
        <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <>
          <div className="rounded border border-amber-300/35 bg-amber-300/[0.03] p-3">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                论证物质率
              </span>
              <span className={`text-2xl font-mono font-bold tabular-nums ${
                result.substance_ratio >= 70 ? 'text-earth-green/95'
                : result.substance_ratio >= 40 ? 'text-amber-300/95'
                : 'text-earth-rust/95'
              }`}>
                {result.substance_ratio}%
              </span>
              <span className="text-[10px] text-deep-200/65">
                claim + evidence + reasoning + counterpoint 在总权重中的占比
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              {Object.entries(result.role_counts).map(([role, count]) => (
                <span
                  key={role}
                  className={`px-1.5 py-0.5 rounded border ${ROLE_TONE[role as DensityRole]?.class || 'border-deep-400/30 text-deep-200/70'}`}
                >
                  {ROLE_TONE[role as DensityRole]?.label || role}: {count}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            {result.sentences.map((s: DensitySentence, i: number) => {
              const tone = ROLE_TONE[s.role];
              return (
                <div key={i} className={`text-[12px] leading-snug rounded px-2 py-1 border-l-2 ${tone.class}`}>
                  <span className="font-mono text-[9px] uppercase tracking-wider mr-2 opacity-80">
                    {tone.label}·{s.weight}
                  </span>
                  {s.text}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Tab 3: Robustness ─── */
function RobustnessTab() {
  const [personaId, setPersonaId] = useState('rationalist');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<RobustnessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!question.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try { setResult(await argumentApi.robustness({ persona_id: personaId, question: question.trim() })); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const shiftTone = (s: 'no' | 'mild' | 'yes') =>
    s === 'no' ? 'border-earth-green/55 bg-earth-green/[0.08] text-earth-green/95'
    : s === 'mild' ? 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200'
    : 'border-earth-rust/65 bg-earth-rust/[0.14] text-earth-rust';
  const shiftLabel = (s: 'no' | 'mild' | 'yes') =>
    s === 'no' ? '✓ 鲁棒' : s === 'mild' ? '◐ 微移' : '✗ 易诱';

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-deep-100/75 leading-relaxed">
        让一个 persona 在 4 个版本的同一问题上各回答一次：control（中立）/
        谄媚诱导（「我觉得 YES」）/ 伪共识陷阱（「前几轮我们已经同意 YES」）/
        字面 vs 精神测试（用一个明显谬误的论证逼它评估）。
        comparator 判定立场是否被每种扰动移动 — 衡量这个 persona+model 组合的鲁棒性。
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <select
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          className="bg-deep-800/40 border border-deep-400/40 rounded px-2 py-1.5 text-[12px] text-deep-50 focus:border-amber-300/55"
        >
          {PERSONA_CHOICES.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="测试问题…（如「AI 应被赋予法律人格吗？」）"
          rows={2}
          className="bg-deep-800/40 border border-deep-400/40 rounded px-2 py-1.5 text-[12px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
          maxLength={300}
        />
      </div>
      <button
        onClick={run}
        disabled={!question.trim() || loading}
        className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
          !question.trim() || loading
            ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
            : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
        }`}
      >
        {loading ? '运行 4 个变体…' : '▶ 跑鲁棒性测试'}
      </button>
      {error && (
        <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
          {error}
        </div>
      )}
      {result && (
        <>
          {result.analysis && (
            <div className="rounded border border-amber-300/35 bg-amber-300/[0.03] p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                  鲁棒性总分
                </span>
                <span className="text-2xl font-mono font-bold text-amber-300 tabular-nums">
                  {result.analysis.overall_robustness}<span className="text-[12px] text-deep-200/55">/5</span>
                </span>
              </div>
              <p className="text-[12px] text-deep-50 leading-snug italic">{result.analysis.overall_comment}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {([
                  ['sycophancy', '谄媚诱导'],
                  ['fake_consensus', '伪共识陷阱'],
                  ['literal_vs_spirit', '字面 vs 精神'],
                ] as [keyof typeof result.analysis & ('sycophancy' | 'fake_consensus' | 'literal_vs_spirit'), string][]).map(([k, label]) => {
                  const a = result.analysis![k];
                  return (
                    <div key={k} className={`rounded border p-2 text-[11px] ${shiftTone(a.shifted)}`}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="font-mono text-[10px] uppercase tracking-wider opacity-90">{label}</span>
                        <span className="font-mono text-[10px]">{shiftLabel(a.shifted)}</span>
                      </div>
                      <p className="leading-snug opacity-95">{a.shift_evidence}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(['control', 'sycophancy', 'fake_consensus', 'literal_vs_spirit'] as const).map((k) => {
              const labels = { control: 'Control', sycophancy: 'A. 谄媚', fake_consensus: 'B. 伪共识', literal_vs_spirit: 'C. 字面陷阱' };
              const v = result.variants[k];
              return (
                <div key={k} className="rounded border border-deep-400/30 bg-deep-700/20 p-2.5">
                  <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">{labels[k]}</p>
                  {v.error ? (
                    <p className="text-[11px] text-earth-rust/85 italic">{v.error}</p>
                  ) : (
                    <p className="text-[12px] text-deep-50 leading-snug whitespace-pre-wrap">{v.content}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
