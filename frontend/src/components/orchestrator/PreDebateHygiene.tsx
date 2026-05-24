/**
 * Pre-debate cognitive hygiene panel — surfaced before the user starts a
 * philosophical auto-loop. Captures three things:
 *
 *  1. "What evidence would change my mind" (#18 — Popper-style commitment)
 *  2. Value ranking (#19 — for later persona-vs-user alignment scoring)
 *  3. Desired stance (#21 — rationalization-risk detection)
 *
 * All optional — user can skip. If they fill it in, the draft is held in
 * `useHygieneStore` and committed to the session_id after debate starts.
 */
import { useState } from 'react';
import {
  useHygieneStore, VALUE_LABELS,
  type ValueKey, type StanceDirection, type HygieneRecord,
} from '../../store/preDebateHygieneStore';

const VALUE_KEYS: ValueKey[] = [
  'freedom', 'equity', 'efficiency', 'tradition', 'truth',
  'compassion', 'progress', 'stability', 'autonomy', 'community',
];

export function PreDebateHygiene({ hypothesis, onSaved }: { hypothesis: string; onSaved?: () => void }) {
  const { draft, patchDraft, setDraft } = useHygieneStore();
  const [expanded, setExpanded] = useState(false);
  const [available, setAvailable] = useState<ValueKey[]>(
    () => VALUE_KEYS.filter((k) => !(draft?.value_ranking || []).includes(k)),
  );

  const valueRanking: ValueKey[] = draft?.value_ranking || [];
  const desired = draft?.desired_stance;
  const mind = draft?.mind_change_evidence || '';
  const stanceReason = draft?.desired_stance_reason || '';

  const filled = (mind && mind.trim().length > 10)
    || valueRanking.length >= 3
    || (desired && desired !== 'no_preference');

  const addValue = (k: ValueKey) => {
    patchDraft({ value_ranking: [...valueRanking, k], hypothesis });
    setAvailable((a) => a.filter((x) => x !== k));
  };
  const removeValue = (k: ValueKey) => {
    patchDraft({ value_ranking: valueRanking.filter((x) => x !== k), hypothesis });
    setAvailable((a) => [...a, k]);
  };
  const moveValue = (idx: number, dir: -1 | 1) => {
    const next = [...valueRanking];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    patchDraft({ value_ranking: next, hypothesis });
  };

  const reset = () => {
    setDraft(null);
    setAvailable(VALUE_KEYS);
  };

  return (
    <div className="rounded-lg border border-amber-300/30 bg-amber-300/[0.03] p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="text-[14px]">🧘</span>
        <span className="text-[12px] font-mono text-amber-300/95 uppercase tracking-wider">
          辩论前 · 认知校准（可选）
        </span>
        {filled && (
          <span className="text-[9px] font-mono text-earth-green/85 px-1.5 py-0.5 rounded border border-earth-green/40">
            ✓ 已记录
          </span>
        )}
        <span className="ml-auto text-[11px] font-mono text-amber-300/75">
          {expanded ? '▾ 收起' : '▸ 展开'}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 animate-fade-in">
          <p className="text-[11px] text-deep-100/65 leading-snug">
            填写后，辩论结束系统会跟你「过去的你」对比 — 你的预设是否被论证移动？
            你之前承诺过的"会让我改主意的证据"是否真的出现了？
          </p>

          {/* #18 Mind change commitment */}
          <div>
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
              ① 什么证据会让你改变立场？
            </label>
            <textarea
              value={mind}
              onChange={(e) => patchDraft({ mind_change_evidence: e.target.value, hypothesis })}
              placeholder="例：「如果有元分析显示 X 类政策在 ≥10 个国家都失败了，我会放弃支持它」&#10;Popper：没法写下来的承诺 = 教条立场"
              rows={2}
              className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-2.5 py-1.5 text-[12px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
              maxLength={400}
            />
          </div>

          {/* #19 Value ranking */}
          <div>
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
              ② 哪些价值对你最重要？拖拽排序（点 ▲▼）
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <p className="text-[9px] font-mono text-deep-300/85 uppercase mb-1">已选（高到低）</p>
                {valueRanking.length === 0 ? (
                  <p className="text-[11px] text-deep-200/55 italic px-1.5">↓ 从右侧选</p>
                ) : (
                  <ol className="space-y-1">
                    {valueRanking.map((k, i) => (
                      <li key={k} className="flex items-center gap-1.5 text-[11px] bg-deep-700/40 border border-amber-300/35 rounded px-1.5 py-1">
                        <span className="font-mono text-amber-300/80 tabular-nums w-4">{i + 1}.</span>
                        <span className="text-deep-50">{VALUE_LABELS[k].label}</span>
                        <span className="text-deep-300/65 truncate">— {VALUE_LABELS[k].short}</span>
                        <button onClick={() => moveValue(i, -1)} disabled={i === 0} className="ml-auto text-deep-200/65 hover:text-amber-300 disabled:opacity-30 px-1">▲</button>
                        <button onClick={() => moveValue(i, 1)} disabled={i === valueRanking.length - 1} className="text-deep-200/65 hover:text-amber-300 disabled:opacity-30 px-1">▼</button>
                        <button onClick={() => removeValue(k)} className="text-earth-rust/85 hover:text-earth-rust px-1">✕</button>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <p className="text-[9px] font-mono text-deep-300/85 uppercase mb-1">候选</p>
                <div className="flex flex-wrap gap-1">
                  {available.map((k) => (
                    <button
                      key={k}
                      onClick={() => addValue(k)}
                      className="text-[11px] px-2 py-0.5 rounded border border-deep-400/40 text-deep-100 hover:border-amber-300/55 hover:bg-amber-300/[0.05]"
                      title={VALUE_LABELS[k].short}
                    >
                      + {VALUE_LABELS[k].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* #21 Desired stance */}
          <div>
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
              ③ 你内心希望的辩论结果是？（揭示合理化风险）
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {([
                { k: 'pro',           label: '✓ 支持' },
                { k: 'con',           label: '✗ 反对' },
                { k: 'mixed',         label: '◐ 看情况' },
                { k: 'no_preference', label: '◯ 真的中立' },
              ] as { k: StanceDirection; label: string }[]).map((o) => (
                <button
                  key={o.k}
                  onClick={() => patchDraft({ desired_stance: o.k, hypothesis })}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    desired === o.k
                      ? 'border-amber-300/65 bg-amber-300/[0.10] text-amber-200'
                      : 'border-deep-400/40 text-deep-100/85 hover:border-amber-300/40'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {desired && desired !== 'no_preference' && (
              <textarea
                value={stanceReason}
                onChange={(e) => patchDraft({ desired_stance_reason: e.target.value, hypothesis })}
                placeholder="（可选）一句话写下你为什么希望这个结果 — 跑完会跟实际辩论收敛点对比"
                rows={1}
                className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-2.5 py-1 text-[11px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
                maxLength={200}
              />
            )}
          </div>

          {filled && (
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-300/15">
              <button
                onClick={reset}
                className="text-[10px] font-mono text-deep-200/75 hover:text-earth-rust px-2 py-1 rounded border border-deep-400/30"
              >
                ↺ 清空
              </button>
              {onSaved && (
                <span className="text-[10px] font-mono text-earth-green/85">
                  ✓ 已保存到草稿；启动后绑定 session
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──── Post-debate confrontation panel ──── */

/** Shows after a debate completes, comparing user's pre-debate commitments
 *  against the actual debate. Read-only. */
export function PostDebateConfrontation({ record }: { record: HygieneRecord }) {
  if (!record.mind_change_evidence && !record.value_ranking?.length && !record.desired_stance) {
    return null;
  }
  return (
    <div className="rounded-lg border border-purple-400/35 bg-purple-400/[0.04] p-3 my-3">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[14px]">🪞</span>
        <span className="text-[11px] font-mono text-purple-400/95 uppercase tracking-wider">
          辩论后 · 跟过去的你对话
        </span>
        <span className="text-[9px] font-mono text-deep-300/75 ml-auto">
          记录于 {record.recorded_at.slice(0, 10)}
        </span>
      </div>
      <div className="space-y-2 text-[12px]">
        {record.mind_change_evidence && (
          <div className="rounded bg-deep-700/30 border border-deep-400/30 p-2">
            <p className="text-[10px] font-mono text-amber-300/85 uppercase mb-1">
              你之前说会让你改主意的证据
            </p>
            <p className="text-deep-50 italic">「{record.mind_change_evidence}」</p>
            <p className="text-[10px] text-deep-200/65 mt-1">
              ↳ 现在自问：辩论里出现这个证据了吗？没出现的话，你的立场不该被移动。
            </p>
          </div>
        )}
        {record.desired_stance && record.desired_stance !== 'no_preference' && (
          <div className="rounded bg-deep-700/30 border border-deep-400/30 p-2">
            <p className="text-[10px] font-mono text-amber-300/85 uppercase mb-1">
              你之前希望的结果
            </p>
            <p className="text-deep-50">
              {({ pro: '✓ 支持', con: '✗ 反对', mixed: '◐ 看情况', no_preference: '中立' } as Record<string, string>)[record.desired_stance]}
              {record.desired_stance_reason && <span className="text-deep-200/85"> — {record.desired_stance_reason}</span>}
            </p>
            <p className="text-[10px] text-deep-200/65 mt-1">
              ↳ 如果实际辩论恰好支持你的预期，警惕合理化偏见 — 你可能挑了能确认的论点而忽略了反方。
            </p>
          </div>
        )}
        {record.value_ranking && record.value_ranking.length > 0 && (
          <div className="rounded bg-deep-700/30 border border-deep-400/30 p-2">
            <p className="text-[10px] font-mono text-amber-300/85 uppercase mb-1">
              你的价值排序
            </p>
            <p className="text-deep-50 font-mono text-[11px]">
              {record.value_ranking.map((k, i) => `${i + 1}.${VALUE_LABELS[k].label}`).join('  ')}
            </p>
            <p className="text-[10px] text-deep-200/65 mt-1">
              ↳ 辩论中跟你排序最一致的 persona 可能你最先认同 — 留意是不是「价值同温层」。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
