import { useState } from 'react';
import { useOrchestratorStore } from '../../store/orchestratorStore';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { useAutoLoopStore } from '../../store/autoLoopStore';
import { AutoLoopView } from './AutoLoopView';
import { AutonomousDebateView } from './AutonomousDebateView';
import type { FeedbackLoopConfig } from '../../services/api';

type OrchestratorMode = 'single' | 'autonomous' | 'topic';

const MODULE_LABELS: Record<string, string> = {
  counterfactual: '反事实推演',
  causal: '因果图谱',
  debate: 'AI 辩论',
  synthesizing: '综合提炼',
};

const MODULE_ICONS: Record<string, string> = {
  counterfactual: '◇',
  causal: '◈',
  debate: '◆',
  synthesizing: '⟐',
};

export function FeedbackLoopView() {
  const store = useOrchestratorStore();
  const cfStore = useCounterfactualStore();
  const autoStore = useAutoLoopStore();

  const {
    status,
    error,
    activeModule,
    currentIteration,
    maxIterations,
    iterations,
    finalSynthesis,
    convergenceAchieved,
    tokenUsage,
  } = store;

  // --- Mode toggle ---
  const [mode, setMode] = useState<OrchestratorMode>('single');

  // --- Config form state ---
  const [modification, setModification] = useState('');
  const [maxIter, setMaxIter] = useState(3);

  // Use the selected event from counterfactual store
  const selectedEvent = cfStore.selectedEvent;

  const canStart = selectedEvent && modification.trim() && status !== 'running';

  const handleStart = () => {
    if (!selectedEvent || !modification.trim()) return;
    const config: FeedbackLoopConfig = {
      event_id: selectedEvent.id,
      modification: modification.trim(),
      time_horizon: '30 years',
      max_iterations: maxIter,
    };
    store.startFeedbackLoop(config);
  };

  const progressPct =
    status === 'complete'
      ? 100
      : status === 'running'
        ? Math.min(
            5 + ((currentIteration - 1) / maxIterations) * 90 +
              (activeModule === 'causal' ? 8 : activeModule === 'debate' ? 16 : activeModule === 'synthesizing' ? 24 : 0),
            95,
          )
        : 0;

  // Only show mode toggle when both modes are idle
  const canToggleMode = status === 'idle' && autoStore.status === 'idle';

  return (
    <div className="space-y-8">
      {/* ── 3 Subsection Picker (visible when idle) ──────────────── */}
      {canToggleMode && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xl font-semibold text-white tracking-tight">
              闭环推演 <span className="text-amber-300/95 text-base font-mono ml-2">3 modes</span>
            </h2>
            <p className="text-[12px] font-mono text-deep-300 tracking-wider">
              选择推演模式 · 三种深度递进
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                key: 'single' as const,
                num: '01',
                icon: '◈',
                title: '单次闭环',
                tagline: 'CF → Causal → Debate → Synth',
                desc: '一次性串联反事实推演 → 因果图谱 → AI 辩论 → 综合提炼，最多迭代 3 轮直至收敛。',
                cost: '~$0.05–0.30 / 次',
                time: '2–10 分钟',
              },
              {
                key: 'autonomous' as const,
                num: '02',
                icon: '∞',
                title: '自主探索',
                tagline: 'Multi-cycle Loop',
                desc: '连续多 cycle 闭环或多哲学家持续论辩，每轮根据综合产出新假设，直至自然收敛。',
                cost: '~$0.30–1.00 / 会话',
                time: '5–30 分钟',
              },
              {
                key: 'topic' as const,
                num: '03',
                icon: '🌳',
                title: '议题分支探索',
                tagline: 'Branch + Tiered Models',
                desc: 'Haiku 生成注入变种，Sonnet 给每分支评分，Opus 决定深挖 / 换向 / 收敛。可跑 ~2h。',
                cost: '~$0.50–5.00 / 会话',
                time: '15分钟–2小时',
              },
            ].map(opt => {
              const active = mode === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setMode(opt.key)}
                  className={`
                    relative text-left rounded-xl p-5 transition-all duration-200
                    ${active
                      ? 'bg-gradient-to-br from-amber-300/[0.10] to-amber-600/[0.04] border-2 border-amber-300/65 shadow-glow'
                      : 'glass-subtle border-2 border-deep-400/35 hover:border-amber-300/35 hover:bg-amber-300/[0.02]'
                    }
                  `}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-amber-300/85 tracking-[0.20em]">
                        {opt.num}
                      </span>
                      <span className="text-2xl leading-none">{opt.icon}</span>
                    </div>
                    {active && (
                      <span className="text-[10px] font-mono tracking-wider text-amber-300 px-1.5 py-0.5 rounded border border-amber-300/55 bg-amber-300/[0.08]">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <h3 className={`text-base font-semibold mb-0.5 ${active ? 'text-amber-100' : 'text-deep-50'}`}>
                    {opt.title}
                  </h3>
                  <p className="text-[10px] font-mono text-amber-300/85 tracking-wider uppercase mb-2">
                    {opt.tagline}
                  </p>
                  <p className="text-[12px] text-deep-200/95 leading-snug mb-3 min-h-[3em]">
                    {opt.desc}
                  </p>
                  <div className="flex items-center justify-between pt-2 border-t border-deep-400/30">
                    <span className="text-[10px] font-mono text-deep-300 tracking-wider">{opt.time}</span>
                    <span className="text-[10px] font-mono text-amber-300/95 tabular-nums">{opt.cost}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Autonomous Mode ─────────────────────────── */}
      {mode === 'autonomous' && <AutoLoopView />}

      {/* ── Autonomous Topic Explorer ───────────────── */}
      {mode === 'topic' && <AutonomousDebateView />}

      {/* ── Single Loop Mode ────────────────────────── */}
      {mode === 'single' && (
        <>
      {/* ── Config / Input ──────────────────────────────── */}
      {status === 'idle' && (
        <div className="glass border border-amber-300/35 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-sm font-medium text-white/85 mb-1">跨模块闭环推演</h2>
            <p className="text-[14px] text-deep-200/85 leading-relaxed">
              将反事实推演、因果图谱、AI 辩论串联成循环。每轮迭代的辩论结论会反馈到下一轮的反事实假设中，
              直到推演收敛或达到最大迭代次数。
            </p>
          </div>

          {/* Event selection hint */}
          {!selectedEvent && (
            <div className="text-xs text-amber-300/90 bg-amber-300/5 border border-amber-300/40 rounded-lg px-4 py-3">
              请先在「历史反事实」标签页中选择一个历史事件。选择后回到此处开始闭环推演。
            </div>
          )}

          {selectedEvent && (
            <>
              <div className="bg-deep-700/30 border border-deep-400/40 rounded-lg px-4 py-3">
                <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider">选定事件</span>
                <p className="text-sm text-white/70 mt-1">{selectedEvent.title}</p>
              </div>

              <div>
                <label className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider mb-1.5 block">
                  反事实假设
                </label>
                <textarea
                  value={modification}
                  onChange={(e) => setModification(e.target.value)}
                  placeholder="例如：如果哈伯工艺的合成效率提高了 5 倍..."
                  rows={2}
                  className="w-full bg-deep-700/30 border border-deep-400/45 rounded-lg px-4 py-2.5 text-sm text-white/80 placeholder:text-deep-300/65 focus:outline-none focus:border-amber-300/25 resize-none"
                />
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <label className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider mb-1 block">
                    最大迭代
                  </label>
                  <select
                    value={maxIter}
                    onChange={(e) => setMaxIter(Number(e.target.value))}
                    className="bg-deep-700/30 border border-deep-400/45 rounded px-3 py-1.5 text-xs text-white/70 focus:outline-none"
                  >
                    {[2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} 轮
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1" />
                <div className="text-right">
                  <span className="text-[15px] font-mono text-deep-200/70 block mb-1">
                    预估成本 ${(maxIter * 0.15 + 0.1).toFixed(2)}-${(maxIter * 0.35).toFixed(2)}
                  </span>
                  <button
                    onClick={handleStart}
                    disabled={!canStart}
                    className="px-6 py-2 bg-gradient-to-r from-amber-300/80 to-amber-400/80 text-deep-950 text-xs font-semibold rounded-lg hover:from-amber-300 hover:to-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-glow-sm hover:shadow-glow"
                  >
                    启动闭环推演
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Running Progress ────────────────────────────── */}
      {status === 'running' && (
        <div className="glass border border-amber-300/40 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-amber-300/95 uppercase tracking-wider">
              闭环推演进行中
            </h3>
            <span className="text-[14px] font-mono text-deep-200/85">
              第 {currentIteration}/{maxIterations} 轮
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-deep-600/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${progressPct}%`,
                background: 'linear-gradient(90deg, rgba(196,144,88,0.5), rgba(196,144,88,0.9))',
              }}
            />
          </div>

          {/* Module pipeline */}
          <ModulePipeline activeModule={activeModule} currentIteration={currentIteration} />

          {/* Completed iterations preview */}
          {iterations.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-deep-400/35">
              {iterations
                .filter((it) => it.refinement_for_next)
                .map((it) => (
                  <div key={it.iteration} className="text-[14px] text-deep-200/35">
                    <span className="font-mono text-amber-300/85">第{it.iteration}轮</span>{' '}
                    {it.counterfactual_summary.slice(0, 100)}...
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Error ──────────────────────────────────────── */}
      {status === 'error' && error && (
        <div className="glass border border-earth-rust/20 rounded-lg p-5 text-center">
          <p className="text-xs text-earth-rust/70 mb-2">{error}</p>
          <button
            onClick={() => store.reset()}
            className="text-[14px] font-mono text-amber-300/90 hover:text-amber-300 transition-colors"
          >
            重新开始
          </button>
        </div>
      )}

      {/* ── Results ────────────────────────────────────── */}
      {status === 'complete' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-white/85">闭环推演结果</h2>
              <p className="text-[14px] font-mono text-deep-200/75 mt-0.5">
                {iterations.length} 轮迭代 ·{' '}
                {convergenceAchieved ? '已收敛' : '达到最大轮次'} ·{' '}
                {tokenUsage ? `$${(tokenUsage.estimated_cost_usd || 0).toFixed(3)}` : ''}
              </p>
            </div>
            <button
              onClick={() => store.reset()}
              className="text-[14px] font-mono text-deep-200/85 hover:text-amber-300/70 transition-colors px-2 py-1 border border-deep-400/45 rounded hover:border-amber-300/55"
            >
              新推演
            </button>
          </div>

          {/* Final synthesis */}
          <div className="glass border border-amber-300/40 rounded-lg p-5">
            <h3 className="text-[14px] font-mono text-amber-300/90 uppercase tracking-wider mb-2">
              综合结论
            </h3>
            <p className="text-xs text-deep-100/70 leading-relaxed whitespace-pre-wrap">
              {finalSynthesis}
            </p>
            {convergenceAchieved && (
              <div className="mt-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-earth-green/60" />
                <span className="text-[15px] font-mono text-earth-green/50">
                  推演在第 {iterations.length} 轮收敛
                </span>
              </div>
            )}
          </div>

          {/* Iteration details */}
          <div className="space-y-3">
            <h3 className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider">
              迭代详情
            </h3>
            {iterations.map((it) => (
              <IterationCard key={it.iteration} iteration={it} />
            ))}
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

/* ──── Module Pipeline Visualization ──── */

function ModulePipeline({
  activeModule,
  currentIteration,
}: {
  activeModule: string | null;
  currentIteration: number;
}) {
  const modules = ['counterfactual', 'causal', 'debate', 'synthesizing'];

  return (
    <div className="flex items-center justify-center gap-2">
      {modules.map((mod, idx) => {
        const isActive = activeModule === mod;
        const isPast =
          activeModule !== null && modules.indexOf(activeModule) > idx;

        return (
          <div key={mod} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-300 ${
                isActive
                  ? 'border-amber-300/70 bg-amber-300/10 shadow-glow-sm'
                  : isPast
                    ? 'border-amber-300/45 bg-amber-300/5'
                    : 'border-deep-400/40 bg-deep-700/20'
              }`}
            >
              <span
                className={`text-sm ${
                  isActive
                    ? 'text-amber-300/90'
                    : isPast
                      ? 'text-amber-300/85'
                      : 'text-deep-200/65'
                }`}
              >
                {MODULE_ICONS[mod]}
              </span>
              <div>
                <span
                  className={`text-[15px] font-mono block ${
                    isActive
                      ? 'text-amber-300/80'
                      : isPast
                        ? 'text-amber-300/85'
                        : 'text-deep-200/70'
                  }`}
                >
                  {MODULE_LABELS[mod]}
                </span>
                {isActive && (
                  <span className="text-[14px] font-mono text-amber-300/85 block">
                    第 {currentIteration} 轮
                  </span>
                )}
              </div>
            </div>

            {idx < modules.length - 1 && (
              <span
                className={`text-[14px] ${
                  isPast ? 'text-amber-300/75' : 'text-deep-400/15'
                }`}
              >
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ──── Iteration Card ──── */

function IterationCard({
  iteration,
}: {
  iteration: {
    iteration: number;
    counterfactual_summary: string;
    key_divergences: string[];
    causal_insights: string[];
    debate_consensus: string[];
    debate_dissent: string[];
    refinement_for_next: string;
  };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left glass border border-deep-400/35 hover:border-amber-300/45 rounded-lg p-4 transition-all duration-300"
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[15px] font-mono font-bold text-amber-300/95 bg-amber-300/10 border border-amber-300/45 rounded-full w-6 h-6 flex items-center justify-center shrink-0">
          {iteration.iteration}
        </span>
        <p className="text-[15px] text-white/65 flex-1 leading-relaxed truncate">
          {iteration.counterfactual_summary.slice(0, 120)}...
        </p>
        <span className="text-[15px] text-deep-200/75 shrink-0">
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Summary stats */}
      <div className="flex items-center gap-4 text-[15px] font-mono text-deep-200/75 pl-9">
        <span>{iteration.key_divergences.length} 分歧</span>
        <span>·</span>
        <span>{iteration.causal_insights.length} 因果</span>
        <span>·</span>
        <span>{iteration.debate_consensus.length} 共识</span>
        <span>·</span>
        <span>{iteration.debate_dissent.length} 争议</span>
      </div>

      {expanded && (
        <div className="mt-4 pt-3 border-t border-deep-400/35 space-y-4 pl-9">
          {/* Counterfactual */}
          <IterationSection
            title="反事实推演"
            icon="◇"
            content={iteration.counterfactual_summary}
            tags={iteration.key_divergences}
            tagLabel="关键分歧"
          />

          {/* Causal */}
          {iteration.causal_insights.length > 0 && (
            <IterationSection
              title="因果洞察"
              icon="◈"
              tags={iteration.causal_insights}
              tagLabel="因果链"
            />
          )}

          {/* Debate */}
          {(iteration.debate_consensus.length > 0 ||
            iteration.debate_dissent.length > 0) && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-amber-300/85 text-[14px]">◆</span>
                <span className="text-[15px] font-mono text-amber-300/85 uppercase tracking-wider">
                  辩论结果
                </span>
              </div>
              {iteration.debate_consensus.length > 0 && (
                <div className="mb-1">
                  <span className="text-[14px] font-mono text-earth-green/40">共识:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {iteration.debate_consensus.map((c, i) => (
                      <span
                        key={i}
                        className="text-[15px] bg-earth-green/10 text-earth-green/50 rounded px-2 py-0.5 border border-earth-green/10"
                      >
                        {c.length > 60 ? c.slice(0, 60) + '…' : c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {iteration.debate_dissent.length > 0 && (
                <div>
                  <span className="text-[14px] font-mono text-earth-rust/40">争议:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {iteration.debate_dissent.map((d, i) => (
                      <span
                        key={i}
                        className="text-[15px] bg-earth-rust/10 text-earth-rust/50 rounded px-2 py-0.5 border border-earth-rust/10"
                      >
                        {d.length > 60 ? d.slice(0, 60) + '…' : d}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Refinement */}
          {iteration.refinement_for_next && (
            <div className="bg-deep-700/20 border border-deep-400/35 rounded px-3 py-2">
              <span className="text-[14px] font-mono text-amber-300/75 uppercase">
                下轮改进方向
              </span>
              <p className="text-[14px] text-deep-100/50 leading-relaxed mt-0.5">
                {iteration.refinement_for_next}
              </p>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

/* ──── Section within Iteration ──── */

function IterationSection({
  title,
  icon,
  content,
  tags,
  tagLabel,
}: {
  title: string;
  icon: string;
  content?: string;
  tags?: string[];
  tagLabel?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-amber-300/85 text-[14px]">{icon}</span>
        <span className="text-[15px] font-mono text-amber-300/85 uppercase tracking-wider">
          {title}
        </span>
      </div>
      {content && (
        <p className="text-[14px] text-deep-100/55 leading-relaxed mb-1.5">
          {content}
        </p>
      )}
      {tags && tags.length > 0 && (
        <div>
          {tagLabel && (
            <span className="text-[14px] font-mono text-deep-200/70">{tagLabel}:</span>
          )}
          <div className="flex flex-wrap gap-1 mt-0.5">
            {tags.map((t, i) => (
              <span
                key={i}
                className="text-[15px] bg-deep-600/30 text-deep-200/45 rounded px-2 py-0.5 border border-deep-400/40"
              >
                {t.length > 50 ? t.slice(0, 50) + '…' : t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
