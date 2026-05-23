/**
 * Persona prompt editor — open from AutoLoopView's "✎ 编辑 persona" button.
 *
 * Lets the user override each philosophical persona's system prompt. Edits
 * are saved per-user in localStorage and sent with every auto-loop start
 * as `persona_overrides`. Original prompts always reachable via "重置".
 */
import { useEffect, useState } from 'react';
import { usePersonaPromptStore, type PersonaDefault } from '../../store/personaPromptStore';
import { autoLoopApi, type PromptABResponse } from '../../services/api';

interface Props {
  onClose: () => void;
}

const PERSONA_ICONS: Record<string, string> = {
  rationalist: '⟐',
  existentialist: '◈',
  pragmatist: '◆',
  eastern_philosopher: '☯',
  critical_theorist: '⚡',
  adversary: '🗡',
  virtue_ethicist: '✦',
  utilitarian: '∑',
  feminist_theorist: '♀',
  religious_traditionalist: '⛪',
  complexity_theorist: '※',
};

export function PersonaPromptEditor({ onClose }: Props) {
  const { defaults, fetchingDefaults, edits, loadDefaults, setEdit, clearEdit, clearAll } = usePersonaPromptStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  useEffect(() => {
    if (defaults && defaults.length > 0 && !activeId) {
      setActiveId(defaults[0].id);
    }
  }, [defaults, activeId]);

  const active: PersonaDefault | undefined = defaults?.find((p) => p.id === activeId);
  // Pull draft from store whenever the active persona changes, so switching tabs
  // doesn't drop edits-in-progress on other personas.
  useEffect(() => {
    if (!active) return;
    setDraftText(edits[active.id] ?? active.system_prompt);
  }, [active, edits]);

  const handleSave = () => {
    if (!active) return;
    const trimmed = draftText.trim();
    // If user reset to default text, clear the override entry.
    if (trimmed === active.system_prompt.trim() || trimmed === '') {
      clearEdit(active.id);
    } else {
      setEdit(active.id, trimmed);
    }
  };

  const handleReset = () => {
    if (!active) return;
    setDraftText(active.system_prompt);
    clearEdit(active.id);
  };

  const isDirty = active ? draftText.trim() !== (edits[active.id] ?? active.system_prompt).trim() : false;
  const isEdited = active ? !!edits[active.id] : false;
  // A/B test state
  const [abOpen, setAbOpen] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
          aria-label="关闭"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>✎</span>
            编辑 persona
          </div>
          <h2 className="text-lg font-light text-white tracking-tight">
            自定义 persona 的<span className="text-amber-300"> system prompt</span>
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            修改后的 prompt 会在你下次开始辩论时生效。你怎么定义「理性主义」决定了它会说什么 —
            这本身就是哲学训练。
          </p>
        </div>

        {fetchingDefaults && !defaults && (
          <div className="text-[12px] text-deep-200/70 py-6 text-center">载入 persona…</div>
        )}

        {defaults && defaults.length > 0 && (
          <div className="flex flex-1 min-h-0 gap-4">
            {/* Sidebar — persona list */}
            <div className="w-44 shrink-0 overflow-y-auto pr-1 space-y-0.5">
              {defaults.map((p) => {
                const edited = !!edits[p.id];
                const isActive = p.id === activeId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded text-[12px] transition-colors ${
                      isActive
                        ? 'bg-amber-300/[0.08] border border-amber-300/45 text-amber-100'
                        : 'border border-transparent text-deep-100/75 hover:bg-deep-700/30 hover:text-deep-50'
                    }`}
                  >
                    <span className="font-mono text-amber-300/85 shrink-0 w-3.5">
                      {PERSONA_ICONS[p.id] ?? '◇'}
                    </span>
                    <span className="flex-1 truncate">{p.name}</span>
                    {edited && (
                      <span className="text-[8px] font-mono px-1 py-0.5 rounded border border-earth-green/40 text-earth-green/85 leading-none">
                        改
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="pt-2 mt-2 border-t border-deep-400/20">
                <button
                  onClick={() => { if (confirm('确定清空所有 persona 编辑？')) { clearAll(); if (active) setDraftText(active.system_prompt); } }}
                  className="w-full text-[10px] font-mono text-deep-200/65 hover:text-earth-rust px-2 py-1.5 rounded border border-deep-400/30 hover:border-earth-rust/40"
                >
                  ✕ 重置全部
                </button>
              </div>
            </div>

            {/* Editor pane */}
            {active ? (
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-baseline gap-3 mb-2">
                  <h3 className="text-[15px] font-medium text-deep-50">
                    {PERSONA_ICONS[active.id] ?? '◇'} {active.name}
                  </h3>
                  <span className="text-[11px] font-mono text-deep-300 tracking-wider">
                    {active.role}
                  </span>
                  {isEdited && (
                    <span className="ml-auto text-[10px] font-mono text-earth-green/85 px-1.5 py-0.5 rounded border border-earth-green/40">
                      ✓ 已自定义
                    </span>
                  )}
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={14}
                  className="flex-1 w-full bg-deep-800/40 border border-deep-400/45 rounded-lg px-4 py-3 text-[13px] text-deep-50 leading-relaxed font-mono resize-none focus:outline-none focus:border-amber-300/50"
                  placeholder="（空表示使用默认）"
                  maxLength={4000}
                />
                <div className="flex items-center justify-between mt-2.5 gap-2">
                  <div className="text-[10px] font-mono text-deep-300 tabular-nums">
                    {draftText.length} / 4000 字符
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAbOpen(true)}
                      disabled={draftText.trim() === active.system_prompt.trim()}
                      className="text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-purple-400/45 text-purple-200 hover:bg-purple-400/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="跟内置 prompt 对照跑同一议题，让 LLM 打分"
                    >
                      🆚 A/B 测试
                    </button>
                    <button
                      onClick={handleReset}
                      className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45 transition-colors"
                      title="恢复为内置 prompt 并清除自定义"
                    >
                      ↺ 重置
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={!isDirty}
                      className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
                        isDirty
                          ? 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
                          : 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                      }`}
                    >
                      ✓ 保存
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-deep-200/55 text-[13px]">
                选一个 persona 开始编辑
              </div>
            )}
          </div>
        )}
      </div>

      {abOpen && active && (
        <PromptABModal
          personaId={active.id}
          personaName={active.name}
          promptA={active.system_prompt}
          promptB={draftText}
          onClose={() => setAbOpen(false)}
        />
      )}
    </div>
  );
}

/* ──── A/B test modal ──── */

function PromptABModal({
  personaId, personaName, promptA, promptB, onClose,
}: {
  personaId: string; personaName: string;
  promptA: string; promptB: string;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PromptABResponse | null>(null);

  const run = async () => {
    if (!question.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await autoLoopApi.abTestPrompt({
        persona_id: personaId,
        question: question.trim(),
        prompt_a: promptA,
        prompt_b: promptB,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const winner = result?.comparison?.winner;
  return (
    <div
      className="fixed inset-0 z-[60] bg-deep-950/90 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-purple-400/35 rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-purple-400/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-purple-400/45 rounded-full">
            <span>🆚</span>
            Prompt A/B 测试
          </div>
          <h2 className="text-lg font-light text-white">
            <span className="text-amber-300">{personaName}</span> · 内置 prompt vs 你的编辑版
          </h2>
        </div>

        <div className="mb-3">
          <label className="block text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
            测试问题
          </label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入一个具体的哲学议题…（例如：自由意志是否存在？）"
            rows={2}
            className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[12px] text-deep-50 placeholder-deep-300/50 resize-none focus:border-purple-400/55"
            maxLength={400}
          />
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {result && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {result.comparison && (
              <div className="rounded-lg border border-purple-400/35 bg-purple-400/[0.05] p-3">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[10px] font-mono text-purple-400/85 uppercase tracking-wider">
                    判定
                  </span>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                    winner === 'A' ? 'border-amber-300/55 text-amber-200 bg-amber-300/[0.10]'
                    : winner === 'B' ? 'border-earth-green/55 text-earth-green/95 bg-earth-green/[0.10]'
                    : 'border-deep-400/40 text-deep-200/75'
                  }`}>
                    {winner === 'A' ? 'A 内置版胜' : winner === 'B' ? 'B 你的编辑胜' : '势均力敌'}
                  </span>
                </div>
                <p className="text-[12px] text-deep-50 leading-snug italic">
                  {result.comparison.reason}
                </p>
                {result.comparison.scores && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="text-[10px] font-mono w-full">
                      <thead>
                        <tr className="text-deep-300/70 border-b border-deep-400/20">
                          <th className="text-left py-0.5 px-2 font-normal">维度</th>
                          <th className="text-right py-0.5 px-2 font-normal">A 内置</th>
                          <th className="text-right py-0.5 px-2 font-normal">B 编辑</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['depth', 'clarity', 'specificity', 'philosophical_integrity', 'falsifiability'] as const).map((k) => {
                          const a = result.comparison!.scores!.a[k];
                          const b = result.comparison!.scores!.b[k];
                          const better = a === b ? 'tie' : a > b ? 'a' : 'b';
                          const label = { depth: '深度', clarity: '清晰', specificity: '具体', philosophical_integrity: '哲学完整', falsifiability: '可证伪' }[k];
                          return (
                            <tr key={k} className="border-b border-deep-400/10">
                              <td className="py-0.5 px-2 text-deep-50">{label}</td>
                              <td className={`text-right py-0.5 px-2 tabular-nums ${better === 'a' ? 'text-amber-300/95 font-semibold' : 'text-deep-100/75'}`}>{a}/5</td>
                              <td className={`text-right py-0.5 px-2 tabular-nums ${better === 'b' ? 'text-earth-green/95 font-semibold' : 'text-deep-100/75'}`}>{b}/5</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded border border-amber-300/30 bg-amber-300/[0.03] p-2.5">
                <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <span>A · 内置 prompt</span>
                  <span className="text-deep-300/65 tabular-nums">{Math.round(result.a.latency_ms)}ms</span>
                </p>
                {result.a.error ? (
                  <p className="text-[11px] text-earth-rust/85 italic">{result.a.error}</p>
                ) : (
                  <p className="text-[12px] text-deep-50 leading-snug whitespace-pre-wrap">{result.a.content}</p>
                )}
              </div>
              <div className="rounded border border-earth-green/35 bg-earth-green/[0.03] p-2.5">
                <p className="text-[10px] font-mono text-earth-green/85 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <span>B · 你的编辑</span>
                  <span className="text-deep-300/65 tabular-nums">{Math.round(result.b.latency_ms)}ms</span>
                </p>
                {result.b.error ? (
                  <p className="text-[11px] text-earth-rust/85 italic">{result.b.error}</p>
                ) : (
                  <p className="text-[12px] text-deep-50 leading-snug whitespace-pre-wrap">{result.b.content}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-3">
          <span className="text-[10px] font-mono text-deep-300/65 tabular-nums mr-auto">
            {question.length} / 400
          </span>
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45"
          >
            关闭
          </button>
          <button
            onClick={run}
            disabled={!question.trim() || running}
            className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              !question.trim() || running
                ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                : 'border-purple-400/55 bg-purple-400/[0.08] text-purple-200 hover:bg-purple-400/[0.14]'
            }`}
          >
            {running ? '运行中…' : (result ? '↻ 再跑' : '▶ 开始 A/B')}
          </button>
        </div>
      </div>
    </div>
  );
}
