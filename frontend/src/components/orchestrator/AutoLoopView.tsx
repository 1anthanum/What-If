/**
 * AutoLoopView — Autonomous Exploration UI with rich animations.
 *
 * Three states:  Config → Running → Complete
 * Two modes:
 *   - historical: full orchestrator pipeline (requires event selection)
 *   - philosophical: pure debate loop (free-form question input)
 */

import { useState, useEffect, useRef } from 'react';
import { useAutoLoopStore, type PhilPersonaState } from '../../store/autoLoopStore';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { autoLoopApi } from '../../services/api';
import { PHILOSOPHICAL_PRESETS, CATEGORY_META, type PhilosophicalPreset } from './PhilosophicalPresets';
import { EvolutionChain } from './EvolutionChain';
import { DivergenceHeatmap } from './DivergenceHeatmap';
import { ForkingTree } from './ForkingTree';
import { SpectatorPanel } from './SpectatorPanel';
import type { AutoLoopConfig, AutoLoopMode } from '../../services/api';

const PERSONA_COLORS: Record<string, string> = {
  rationalist: 'text-blue-400/70 border-blue-400/20 bg-blue-400/5',
  existentialist: 'text-rose-400/70 border-rose-400/20 bg-rose-400/5',
  pragmatist: 'text-emerald-400/70 border-emerald-400/20 bg-emerald-400/5',
  eastern_philosopher: 'text-amber-400/70 border-amber-400/20 bg-amber-400/5',
  critical_theorist: 'text-purple-400/70 border-purple-400/20 bg-purple-400/5',
  adversary: 'text-red-400/70 border-red-400/20 bg-red-400/5',
};

const PERSONA_ICONS: Record<string, string> = {
  rationalist: '⟐',
  existentialist: '◈',
  pragmatist: '◆',
  eastern_philosopher: '☯',
  critical_theorist: '⚡',
  adversary: '🗡',
};

export function AutoLoopView() {
  const store = useAutoLoopStore();
  const cfStore = useCounterfactualStore();
  const {
    status,
    error,
    mode: runningMode,
    currentCycle,
    maxCycles,
    cycles,
    evolutionChain,
    stoppedReason,
    elapsedSeconds,
    activePersonaId,
    finalSynthesis,
    finalSynthPending,
  } = store;

  const selectedEvent = cfStore.selectedEvent;
  const [seedInput, setSeedInput] = useState('');
  const [numCycles, setNumCycles] = useState(5);
  const [configMode, setConfigMode] = useState<AutoLoopMode>('philosophical');
  const [adversarialEnabled, setAdversarialEnabled] = useState(false);
  const [stanceEnabled, setStanceEnabled] = useState(false);
  const [branchingEnabled, setBranchingEnabled] = useState(false);
  const [flipStanceEnabled, setFlipStanceEnabled] = useState(false);
  // Philosophical presets
  const [presetCategory, setPresetCategory] = useState<PhilosophicalPreset['category'] | 'all'>('all');
  const [presetsCollapsed, setPresetsCollapsed] = useState(false);
  // Topic utility state
  const [critique, setCritique] = useState<import('../../services/api').TopicCritique | null>(null);
  const [decomposition, setDecomposition] = useState<import('../../services/api').TopicDecomposition | null>(null);
  const [topicBusy, setTopicBusy] = useState<'critique' | 'decompose' | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer
  useEffect(() => {
    if (status === 'running') {
      timerRef.current = setInterval(() => store.tick(), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const canStart =
    configMode === 'philosophical'
      ? seedInput.trim().length > 0
      : selectedEvent && seedInput.trim().length > 0;

  const handleStart = () => {
    if (!canStart) return;
    const config: AutoLoopConfig = {
      seed_hypothesis: seedInput.trim(),
      mode: configMode,
      event_id: configMode === 'historical' ? selectedEvent?.id ?? '' : '',
      max_cycles: numCycles,
      max_iterations_per_loop: 2,
      time_horizon: '30 years',
      adversarial: configMode === 'philosophical' ? adversarialEnabled : false,
      extract_stances: configMode === 'philosophical' ? stanceEnabled : false,
      branching: configMode === 'philosophical' ? branchingEnabled : false,
      flip_stance: configMode === 'philosophical' ? flipStanceEnabled : false,
    } as AutoLoopConfig & { flip_stance?: boolean };
    store.start(config);
  };

  // Detect active cycle for live persona view
  const activeCycle = cycles.find((c) => c.cycle === currentCycle);
  const isPhilosophical = status === 'idle' ? configMode === 'philosophical' : runningMode === 'philosophical';

  return (
    <div className="space-y-6 relative">
      {/* ── Background ambient pulse when running ── */}
      {status === 'running' && (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full animate-breathe"
            style={{ background: `radial-gradient(circle, ${isPhilosophical ? 'rgba(139,92,246,0.03)' : 'rgba(196,144,88,0.03)'} 0%, transparent 70%)` }}
          />
        </div>
      )}

      {/* ══════ CONFIG STATE ══════ */}
      {status === 'idle' && (
        <div className="glass border border-amber-300/35 rounded-lg p-6 space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
              configMode === 'philosophical'
                ? 'bg-gradient-to-br from-purple-400/20 to-blue-400/20 border-purple-400/20'
                : 'bg-gradient-to-br from-amber-300/20 to-amber-600/20 border-amber-300/55'
            }`}>
              <span className={`text-lg ${configMode === 'philosophical' ? 'text-purple-400/80' : 'text-amber-300/80'}`}>
                {configMode === 'philosophical' ? '∿' : '∞'}
              </span>
            </div>
            <div>
              <h2 className="text-sm font-medium text-white/85">自主探索模式</h2>
              <p className="text-[14px] text-deep-200/85 leading-relaxed">
                {configMode === 'philosophical'
                  ? '五个哲学流派持续辩论，每轮提炼核心分歧，自动追问更深层的子问题'
                  : '系统自动循环推演，每轮从结论中提取新假设，持续深入探索因果链'}
              </p>
            </div>
          </div>

          {/* Mode sub-toggle */}
          <div className="flex items-center gap-1 bg-deep-800/30 rounded-md p-0.5 max-w-xs">
            <button
              onClick={() => setConfigMode('philosophical')}
              className={`flex-1 py-1.5 px-3 rounded text-[14px] font-mono transition-all ${
                configMode === 'philosophical'
                  ? 'bg-purple-400/15 text-purple-300/80 border border-purple-400/20'
                  : 'text-deep-200/35 hover:text-deep-200/95 border border-transparent'
              }`}
            >
              哲学对话
            </button>
            <button
              onClick={() => setConfigMode('historical')}
              className={`flex-1 py-1.5 px-3 rounded text-[14px] font-mono transition-all ${
                configMode === 'historical'
                  ? 'bg-amber-300/15 text-amber-300/80 border border-amber-300/55'
                  : 'text-deep-200/35 hover:text-deep-200/95 border border-transparent'
              }`}
            >
              历史推演
            </button>
          </div>

          {/* Historical mode: event selection */}
          {configMode === 'historical' && !selectedEvent && (
            <div className="text-xs text-amber-300/90 bg-amber-300/5 border border-amber-300/40 rounded-lg px-4 py-3">
              请先在「历史反事实」标签页中选择一个历史事件。
            </div>
          )}

          {configMode === 'historical' && selectedEvent && (
            <div className="bg-deep-700/30 border border-deep-400/40 rounded-lg px-4 py-3">
              <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider">选定事件</span>
              <p className="text-sm text-white/70 mt-1">{selectedEvent.title}</p>
            </div>
          )}

          {/* Input — adapts to mode */}
          {(configMode === 'philosophical' || selectedEvent) && (
            <>
              {/* Philosophical preset library — counter-intuitive thought experiments */}
              {configMode === 'philosophical' && (() => {
                const visible = presetCategory === 'all'
                  ? PHILOSOPHICAL_PRESETS
                  : PHILOSOPHICAL_PRESETS.filter(p => p.category === presetCategory);
                return (
                  <div className="rounded-lg bg-deep-800/40 border tk-border-faint p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono tracking-[0.20em] text-amber-300/95 uppercase">
                        💭 反直觉哲学议题库 · {PHILOSOPHICAL_PRESETS.length}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPresetsCollapsed(!presetsCollapsed)}
                        className="text-[11px] font-mono tk-text-muted hover:text-amber-300 px-2 py-0.5 rounded border tk-border-faint hover:tk-border"
                      >
                        {presetsCollapsed ? '▼ 展开' : '▲ 收起'}
                      </button>
                    </div>
                    {!presetsCollapsed && (
                      <>
                        {/* Category filter */}
                        <div className="flex flex-wrap gap-1 mb-2">
                          <button
                            type="button"
                            onClick={() => setPresetCategory('all')}
                            className={`text-[11px] font-mono px-2 py-0.5 rounded transition-all ${
                              presetCategory === 'all'
                                ? 'bg-amber-300/[0.08] border border-amber-300/55 text-amber-200'
                                : 'bg-deep-900/40 border tk-border-faint tk-text-secondary hover:tk-border'
                            }`}
                          >全部 {PHILOSOPHICAL_PRESETS.length}</button>
                          {Object.entries(CATEGORY_META).map(([cat, meta]) => {
                            const count = PHILOSOPHICAL_PRESETS.filter(p => p.category === cat).length;
                            const active = presetCategory === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => setPresetCategory(cat as any)}
                                className={`text-[11px] font-mono px-2 py-0.5 rounded transition-all ${
                                  active
                                    ? 'bg-amber-300/[0.08] border border-amber-300/55 text-amber-200'
                                    : 'bg-deep-900/40 border tk-border-faint tk-text-secondary hover:tk-border'
                                }`}
                              >
                                <span className="mr-1">{meta.icon}</span>{meta.label} {count}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => {
                              const pool = visible.filter(p => p.question !== seedInput);
                              const pick = (pool.length > 0 ? pool : visible)[
                                Math.floor(Math.random() * (pool.length > 0 ? pool.length : visible.length))
                              ];
                              if (pick) {
                                setSeedInput(pick.question);
                                setCritique(null); setDecomposition(null);
                              }
                            }}
                            className="ml-auto text-[11px] font-mono px-2 py-0.5 rounded bg-amber-300/[0.06] border border-amber-300/45 text-amber-300/95 hover:bg-amber-300/[0.12] hover:border-amber-300/65"
                            title="随机抽一个反直觉议题"
                          >
                            🎲 SURPRISE
                          </button>
                        </div>

                        {/* Preset grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-[320px] overflow-y-auto">
                          {visible.map(p => {
                            const selected = seedInput.trim() === p.question.trim();
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                  setSeedInput(p.question);
                                  setCritique(null); setDecomposition(null);
                                }}
                                className={`text-left rounded p-2.5 transition-all ${
                                  selected
                                    ? 'bg-amber-300/[0.08] border border-amber-300/65 shadow-glow-sm'
                                    : 'bg-deep-900/40 border tk-border-faint hover:tk-border hover:bg-amber-300/[0.03]'
                                }`}
                                title={p.hook}
                              >
                                <div className="flex items-baseline justify-between gap-2 mb-1">
                                  <span className={`text-[13px] font-medium leading-snug ${
                                    selected ? 'text-amber-100' : 'text-deep-50'
                                  }`}>
                                    {p.title}
                                  </span>
                                  <span className="text-[9px] font-mono tk-cool-soft shrink-0 mt-0.5">
                                    {CATEGORY_META[p.category].icon}
                                  </span>
                                </div>
                                <p className="text-[11px] tk-text-muted leading-snug line-clamp-2">
                                  {p.question}
                                </p>
                                <p className="text-[10px] font-mono tk-cool-soft italic mt-1 leading-snug">
                                  钩子：{p.hook}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              <div>
                <label className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider mb-1.5 block">
                  {configMode === 'philosophical' ? '哲学问题 — 对话的起点' : '种子假设 — 探索的起点'}
                </label>
                <textarea
                  value={seedInput}
                  onChange={(e) => { setSeedInput(e.target.value); setCritique(null); setDecomposition(null); }}
                  placeholder={
                    configMode === 'philosophical'
                      ? '例如：自由意志是否存在？如果一切行为都由因果链决定，道德责任是否是一种幻觉？'
                      : '例如：如果哈伯工艺的合成效率提高了 5 倍...'
                  }
                  rows={3}
                  className="w-full bg-deep-700/30 border border-deep-400/45 rounded-lg px-4 py-2.5 text-sm text-white/80 placeholder:text-deep-300/65 focus:outline-none focus:border-amber-300/25 resize-none transition-colors"
                />

                {/* Topic utility row — pre-flight critique + decompose */}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!seedInput.trim() || topicBusy !== null}
                    onClick={async () => {
                      setTopicBusy('critique');
                      try {
                        const r = await (await import('../../services/api')).topicApi.critique(seedInput.trim());
                        setCritique(r);
                      } catch (e) { console.error(e); }
                      finally { setTopicBusy(null); }
                    }}
                    className="text-[11px] font-mono tracking-[0.16em] px-3 py-1.5 rounded border border-amber-300/45 text-amber-300/95 hover:border-amber-300/65 hover:bg-amber-300/[0.05] disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Haiku 快速预审议题（~$0.001）"
                  >
                    {topicBusy === 'critique' ? '审查中…' : '📝 议题预审'}
                  </button>
                  <button
                    type="button"
                    disabled={!seedInput.trim() || topicBusy !== null}
                    onClick={async () => {
                      setTopicBusy('decompose');
                      try {
                        const r = await (await import('../../services/api')).topicApi.decompose(seedInput.trim());
                        setDecomposition(r);
                      } catch (e) { console.error(e); }
                      finally { setTopicBusy(null); }
                    }}
                    className="text-[11px] font-mono tracking-[0.16em] px-3 py-1.5 rounded border border-deep-400/45 text-deep-100 hover:border-amber-300/55 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="检测复合议题并拆分（Sonnet）"
                  >
                    {topicBusy === 'decompose' ? '拆分中…' : '🔀 拆分议题'}
                  </button>
                  {(critique || decomposition) && (
                    <button
                      type="button"
                      onClick={() => { setCritique(null); setDecomposition(null); }}
                      className="ml-auto text-[10px] font-mono text-deep-300 hover:text-amber-300 px-2 py-1"
                    >✕ 清空</button>
                  )}
                </div>

                {/* Critique result */}
                {critique && (
                  <div className="mt-2 rounded-lg bg-amber-300/[0.04] border border-amber-300/35 p-3 animate-fade-in-up text-[12px]">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="font-mono tracking-[0.2em] text-amber-300/95 uppercase text-[10px]">
                        📝 预审结果
                      </span>
                      <span className="font-mono text-[10px] text-deep-300">
                        复杂度 {critique.complexity_score}/10
                        {critique.ready_to_run ? ' · ✓ 可直接跑' : ' · ⚠ 建议优化'}
                      </span>
                    </div>
                    {critique.issues.length > 0 && (
                      <ul className="space-y-0.5 mb-2">
                        {critique.issues.map((iss, i) => (
                          <li key={i} className="text-deep-100 leading-snug">· {iss}</li>
                        ))}
                      </ul>
                    )}
                    {critique.suggested_rewrite && critique.suggested_rewrite !== seedInput.trim() && (
                      <div className="border-t border-amber-300/25 pt-2 mt-2">
                        <p className="text-[10px] font-mono text-amber-300/85 mb-1">建议改写：</p>
                        <p className="text-deep-50 italic leading-snug">{critique.suggested_rewrite}</p>
                        <button
                          type="button"
                          onClick={() => { setSeedInput(critique.suggested_rewrite); setCritique(null); }}
                          className="mt-1.5 text-[11px] font-mono px-2 py-1 rounded border border-amber-300/55 text-amber-300 hover:bg-amber-300/[0.08]"
                        >
                          ✓ 采纳改写
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Decomposition result */}
                {decomposition && (
                  <div className="mt-2 rounded-lg bg-deep-800/60 border border-deep-400/45 p-3 animate-fade-in-up text-[12px]">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="font-mono tracking-[0.2em] text-amber-300/95 uppercase text-[10px]">
                        🔀 议题拆分
                      </span>
                      <span className="font-mono text-[10px] text-deep-300">
                        {decomposition.is_compound
                          ? `复合议题 — 拆为 ${decomposition.sub_topics.length} 个`
                          : '议题已聚焦，无需拆分'}
                      </span>
                    </div>
                    {decomposition.reasoning && (
                      <p className="text-[11px] text-deep-300 italic leading-snug mb-2">
                        {decomposition.reasoning}
                      </p>
                    )}
                    {decomposition.is_compound && (
                      <div className="space-y-1.5">
                        {decomposition.sub_topics.map((s, i) => (
                          <div key={i} className="flex items-start gap-2 rounded bg-deep-900/50 border border-deep-400/30 px-2 py-1.5">
                            <span className="font-mono text-[10px] text-amber-300/85 shrink-0 mt-0.5">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-deep-50 font-medium">{s.title}</p>
                              <p className="text-[11px] text-deep-200 leading-snug mt-0.5">{s.hypothesis}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setSeedInput(s.hypothesis); setDecomposition(null); }}
                              className="text-[10px] font-mono px-2 py-1 rounded border border-amber-300/45 text-amber-300 hover:bg-amber-300/[0.06] shrink-0"
                            >
                              用此跑
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Philosophical mode: persona preview */}
              {configMode === 'philosophical' && (
                <div className="bg-deep-700/20 border border-deep-400/35 rounded-lg px-4 py-3">
                  <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider block mb-2">
                    参与辩论的哲学流派
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'rationalist', name: '理性主义' },
                      { id: 'existentialist', name: '存在主义' },
                      { id: 'pragmatist', name: '实用主义' },
                      { id: 'eastern_philosopher', name: '东方哲学' },
                      { id: adversarialEnabled ? 'adversary' : 'critical_theorist', name: adversarialEnabled ? '魔鬼代言人' : '批判理论' },
                    ].map((p) => (
                      <span
                        key={p.id}
                        className={`text-[14px] px-2.5 py-1 rounded-md border ${PERSONA_COLORS[p.id] ?? 'text-deep-200/50 border-deep-400/45'}`}
                      >
                        {PERSONA_ICONS[p.id] ?? '◇'} {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Feature toggles (philosophical mode only) */}
              {configMode === 'philosophical' && (
                <div className="bg-deep-700/20 border border-deep-400/35 rounded-lg px-4 py-3 space-y-2">
                  <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider block">
                    高级选项
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <FeatureToggle
                      label="对抗模式"
                      description="第五位替换为魔鬼代言人，专攻其他论点弱点"
                      enabled={adversarialEnabled}
                      onToggle={setAdversarialEnabled}
                      color="red"
                    />
                    <FeatureToggle
                      label="分歧热力图"
                      description="每轮提取各模型在核心论点上的立场矩阵"
                      enabled={stanceEnabled}
                      onToggle={setStanceEnabled}
                      color="blue"
                    />
                    <FeatureToggle
                      label="决策分支"
                      description="每轮提供 3 个候选子问题，展示未探索的分支"
                      enabled={branchingEnabled}
                      onToggle={setBranchingEnabled}
                      color="amber"
                    />
                    <FeatureToggle
                      label="立场反转"
                      description="cycle ≥2 时强制每位 persona 论证与自身传统相反的立场，检验思想韧性"
                      enabled={flipStanceEnabled}
                      onToggle={setFlipStanceEnabled}
                      color="purple"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-end justify-between">
                <div className="space-y-2">
                  <label className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider block">
                    {configMode === 'philosophical' ? '对话轮次' : '探索深度'}
                  </label>
                  <div className="flex items-center gap-3">
                    {[3, 5, 8, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setNumCycles(n)}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-mono border transition-all ${
                          numCycles === n
                            ? configMode === 'philosophical'
                              ? 'bg-purple-400/15 text-purple-300/80 border-purple-400/25 shadow-glow-sm'
                              : 'bg-amber-300/15 text-amber-300/80 border-amber-300/25 shadow-glow-sm'
                            : 'bg-deep-700/30 text-deep-200/85 border-deep-400/45 hover:border-amber-300/45'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-[15px] font-mono text-deep-200/70">轮</span>
                  </div>
                </div>

                <button
                  onClick={handleStart}
                  disabled={!canStart}
                  className={`group relative px-8 py-3 text-xs font-bold rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-all overflow-hidden ${
                    configMode === 'philosophical'
                      ? 'bg-gradient-to-r from-purple-400/80 to-blue-400/80 text-white hover:from-purple-400 hover:to-blue-400 shadow-glow hover:shadow-glow-lg'
                      : 'bg-gradient-to-r from-amber-300/80 to-amber-400/80 text-deep-950 hover:from-amber-300 hover:to-amber-400 shadow-glow hover:shadow-glow-lg'
                  }`}
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  <span className="relative">
                    {configMode === 'philosophical' ? '启动哲学对话' : '启动自主探索'}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════ RUNNING STATE ══════ */}
      {(status === 'running' || status === 'cancelled') && (
        <div className="space-y-6 animate-fade-in">
          {/* HUD Bar */}
          <div className={`glass border rounded-lg p-4 ${
            isPhilosophical ? 'border-purple-400/12' : 'border-amber-300/12'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    status === 'running'
                      ? isPhilosophical ? 'bg-purple-400/80 animate-pulse' : 'bg-amber-300/80 animate-pulse'
                      : 'bg-deep-200/30'
                  }`} />
                  <span className={`text-[14px] font-mono uppercase tracking-wider ${
                    isPhilosophical ? 'text-purple-400/60' : 'text-amber-300/95'
                  }`}>
                    {status === 'running'
                      ? isPhilosophical ? '哲学对话中' : '探索中'
                      : '已取消'}
                  </span>
                </div>
                <div className={`text-sm font-mono tabular-nums tracking-wider ${
                  isPhilosophical ? 'text-purple-400/80' : 'text-amber-300/80'
                }`}>
                  {formatTime(elapsedSeconds)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {Array.from({ length: maxCycles }, (_, i) => (
                  <div
                    key={i}
                    className={`w-2.5 h-2.5 rounded-sm transition-all duration-500 ${
                      i + 1 < currentCycle
                        ? isPhilosophical ? 'bg-purple-400/50' : 'bg-amber-300/50'
                        : i + 1 === currentCycle
                          ? `${isPhilosophical ? 'bg-purple-400/80' : 'bg-amber-300/80'} animate-pulse shadow-glow-sm`
                          : 'bg-deep-600/30'
                    }`}
                  />
                ))}
                <span className="text-[15px] font-mono text-deep-200/75 ml-1">
                  {currentCycle}/{maxCycles}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isPhilosophical && (
                  <button
                    onClick={() => store.toggleSpectator()}
                    className={`text-[14px] font-mono transition-colors px-3 py-1.5 border rounded ${
                      store.spectatorOpen
                        ? 'text-emerald-400/60 border-emerald-400/20 bg-emerald-400/5'
                        : 'text-deep-200/85 border-deep-400/45 hover:border-deep-400/25'
                    }`}
                  >
                    观战
                  </button>
                )}
                {status === 'running' && (
                  <button
                    onClick={() => store.cancel()}
                    className="text-[14px] font-mono text-deep-200/85 hover:text-earth-rust/60 transition-colors px-3 py-1.5 border border-deep-400/45 rounded hover:border-earth-rust/20"
                  >
                    停止
                  </button>
                )}
              </div>
            </div>

            {status === 'running' && (
              <div className="mt-3 h-1 rounded-full bg-deep-600/20 overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${Math.min(5 + ((currentCycle - 1) / maxCycles) * 95, 98)}%`,
                    background: isPhilosophical
                      ? 'linear-gradient(90deg, rgba(139,92,246,0.3), rgba(96,165,250,0.7))'
                      : 'linear-gradient(90deg, rgba(196,144,88,0.3), rgba(196,144,88,0.7))',
                  }}
                />
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="w-20 h-full animate-sweep"
                    style={{
                      background: isPhilosophical
                        ? 'linear-gradient(90deg, transparent, rgba(139,92,246,0.3), transparent)'
                        : 'linear-gradient(90deg, transparent, rgba(196,144,88,0.3), transparent)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Feature 4: Spectator Panel */}
          {isPhilosophical && store.spectatorOpen && <SpectatorPanel />}

          {/* Live Persona Responses (philosophical mode) */}
          {isPhilosophical && activeCycle && activeCycle.personas.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[14px] font-mono text-purple-400/40 uppercase tracking-wider">
                第 {activeCycle.cycle} 轮辩论
              </h3>
              <div className="grid gap-3">
                {activeCycle.personas.map((p) => (
                  <PersonaCard
                    key={p.id}
                    persona={p}
                    isActive={p.id === activePersonaId}
                  />
                ))}
              </div>
              {activeCycle.activeModule === 'synthesizing' && (
                <div className="glass border border-purple-400/10 rounded-lg p-4 animate-fade-in">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400/60 animate-pulse" />
                    <span className="text-[14px] font-mono text-purple-400/50 uppercase tracking-wider">
                      综合分析中...
                    </span>
                  </div>
                  {activeCycle.synthesisPreview && (
                    <p className="text-[15px] text-deep-100/95 leading-relaxed whitespace-pre-wrap">
                      {activeCycle.synthesisPreview}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Live heatmap during running state */}
          {isPhilosophical && cycles.some((c) => c.stanceMatrix) && (
            <DivergenceHeatmap cycles={cycles} />
          )}

          {/* Evolution Chain */}
          <EvolutionChain />
        </div>
      )}

      {/* ══════ ERROR STATE ══════ */}
      {status === 'error' && (
        <div className="glass border border-earth-rust/20 rounded-lg p-5 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-earth-rust/60" />
            <span className="text-[14px] font-mono text-earth-rust/60 uppercase tracking-wider">
              探索中断
            </span>
          </div>
          {error && <p className="text-xs text-earth-rust/50">{error}</p>}
          {cycles.length > 0 && <EvolutionChain />}
          <button
            onClick={() => store.reset()}
            className="text-[14px] font-mono text-amber-300/90 hover:text-amber-300 transition-colors"
          >
            重新开始
          </button>
        </div>
      )}

      {/* ══════ COMPLETE STATE ══════ */}
      {status === 'complete' && (
        <div className="space-y-6 animate-fade-in">
          <div className={`glass border rounded-lg p-5 ${
            isPhilosophical ? 'border-purple-400/12' : 'border-amber-300/12'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                  isPhilosophical
                    ? 'bg-gradient-to-br from-purple-400/20 to-blue-400/20 border-purple-400/20'
                    : 'bg-gradient-to-br from-earth-green/20 to-amber-300/20 border-earth-green/20'
                }`}>
                  <span className={`text-sm ${isPhilosophical ? 'text-purple-400/70' : 'text-earth-green/70'}`}>✓</span>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white/85">
                    {isPhilosophical ? '哲学对话完成' : '探索完成'}
                  </h2>
                  <p className="text-[14px] font-mono text-deep-200/75 mt-0.5">
                    {cycles.length} 轮{isPhilosophical ? '辩论' : '演化'} · {formatTime(elapsedSeconds)} ·{' '}
                    {stoppedReason === 'converged' ? '已收敛' : '达到上限'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const sid = (store as any).sessionId;
                    if (!sid) return;
                    try {
                      const r = await autoLoopApi.getBriefing(sid);
                      const blob = new Blob([r.markdown], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `whatif-auto-${sid}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) { console.error(e); }
                  }}
                  className="text-[12px] font-mono tracking-[0.18em] text-amber-300/95 hover:text-amber-200 px-3 py-1.5 rounded border border-amber-300/45 hover:border-amber-300/70 hover:bg-amber-300/[0.06] transition-all"
                  title="下载完整辩论简报（含每轮所有 persona 完整发言）"
                >
                  📄 EXPORT
                </button>
                <button
                  onClick={async () => {
                    const sid = (store as any).sessionId;
                    if (!sid) return;
                    try {
                      const r = await autoLoopApi.getBriefing(sid);
                      await navigator.clipboard.writeText(r.markdown);
                      alert('已复制到剪贴板');
                    } catch (e) { console.error(e); }
                  }}
                  className="text-[12px] font-mono tracking-[0.18em] text-deep-100 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/45 hover:border-amber-300/55 transition-all"
                  title="复制 markdown 简报"
                >
                  ⎘ COPY
                </button>
              <button
                onClick={() => store.reset()}
                className="text-[14px] font-mono text-deep-200/85 hover:text-amber-300/70 transition-colors px-3 py-1.5 border border-deep-400/45 rounded hover:border-amber-300/55"
              >
                新对话
              </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label={isPhilosophical ? '对话轮次' : '演化步数'}
                value={`${evolutionChain.length}`}
                icon="◈"
              />
              <StatCard
                label={isPhilosophical ? '辩论深度' : '探索深度'}
                value={`${cycles.length} 轮`}
                icon="◇"
              />
              <StatCard
                label="终止原因"
                value={stoppedReason === 'converged' ? '收敛' : stoppedReason === 'max_cycles' ? '上限' : stoppedReason}
                icon={stoppedReason === 'converged' ? '◉' : '◆'}
              />
            </div>
          </div>

          {/* Hypothesis/Question evolution summary */}
          <div className="glass border border-deep-400/35 rounded-lg p-5">
            <h3 className="text-[14px] font-mono text-amber-300/90 uppercase tracking-wider mb-3">
              {isPhilosophical ? '问题演化路径' : '假设演化路径'}
            </h3>
            <div className="space-y-2">
              {evolutionChain.map((hypo, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className={`text-[15px] font-mono font-bold mt-1 shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                    idx === 0
                      ? isPhilosophical
                        ? 'border-purple-400/30 bg-purple-400/10 text-purple-400/60'
                        : 'border-amber-300/70 bg-amber-300/10 text-amber-300/95'
                      : idx === evolutionChain.length - 1
                        ? 'border-earth-green/30 bg-earth-green/10 text-earth-green/60'
                        : 'border-deep-400/45 bg-deep-600/20 text-deep-200/85'
                  }`}>
                    {idx === 0 ? '◈' : idx + 1}
                  </span>
                  <p className={`text-[15px] leading-relaxed pt-0.5 ${
                    idx === 0
                      ? isPhilosophical ? 'text-purple-400/60' : 'text-amber-300/95'
                      : 'text-deep-200/50'
                  }`}>
                    {hypo}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-cycle Opus meta-synthesis (only philosophical, ≥2 cycles) */}
          {isPhilosophical && (finalSynthPending || finalSynthesis) && (
            <div className="glass border border-amber-300/55 rounded-xl p-6 shadow-glow-lg animate-fade-in-up">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[12px] font-mono tracking-[0.22em] text-amber-300 uppercase font-semibold">
                  ⚖ Opus 跨 Cycle 元综合
                </span>
                <span className="flex-1 h-px bg-amber-300/30" />
                {finalSynthPending && (
                  <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/85">
                    <span className="w-2.5 h-2.5 border-2 border-amber-300/50 border-t-amber-300 rounded-full animate-spin" />
                    撰写中…
                  </span>
                )}
              </div>
              {finalSynthesis ? (
                <div className="text-[15px] text-deep-50 leading-relaxed whitespace-pre-wrap">
                  {finalSynthesis}
                </div>
              ) : (
                <p className="text-[13px] text-deep-300 italic">
                  Opus 正在阅读所有 cycle 的综合，撰写跨周期演化分析…
                </p>
              )}
            </div>
          )}

          {/* Feature 1: Epistemic Divergence Heatmap */}
          {isPhilosophical && cycles.some((c) => c.stanceMatrix) && (
            <DivergenceHeatmap cycles={cycles} />
          )}

          {/* Feature 3: Forking Tree */}
          {isPhilosophical && cycles.some((c) => c.candidateQuestions.length > 0) && (
            <ForkingTree cycles={cycles} evolutionChain={evolutionChain} />
          )}

          {/* Expandable cycle details for philosophical mode */}
          {isPhilosophical && cycles.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider">
                辩论详情
              </h3>
              {cycles.map((c) => (
                <CycleDetail key={c.cycle} cycle={c} />
              ))}
            </div>
          )}

          <EvolutionChain />
        </div>
      )}
    </div>
  );
}

/* ──── Persona Card (live streaming during philosophical debate) ──── */

function PersonaCard({ persona, isActive }: { persona: PhilPersonaState; isActive: boolean }) {
  const colorClass = PERSONA_COLORS[persona.id] ?? 'text-deep-200/50 border-deep-400/45 bg-deep-600/5';
  const icon = PERSONA_ICONS[persona.id] ?? '◇';

  return (
    <div className={`glass border rounded-lg p-4 transition-all duration-300 ${
      isActive ? `${colorClass} shadow-glow-sm` : 'border-deep-400/35'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm ${isActive ? '' : 'opacity-50'}`}>{icon}</span>
        <span className={`text-[14px] font-mono font-medium ${isActive ? '' : 'text-deep-200/85'}`}>
          {persona.name}
        </span>
        <span className="text-[14px] font-mono text-deep-200/65">{persona.model}</span>
        {persona.streaming && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        )}
        {!persona.streaming && persona.content && (
          <span className="ml-auto text-[14px] font-mono text-deep-200/65">✓</span>
        )}
      </div>
      {persona.content && (
        <p className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
          isActive ? 'text-deep-100/70' : 'text-deep-200/85'
        }`}>
          {persona.content}
          {persona.streaming && <span className="cursor-blink" />}
        </p>
      )}
    </div>
  );
}

/* ──── Cycle Detail (expandable, for complete state) ──── */

function CycleDetail({ cycle }: { cycle: import('../../store/autoLoopStore').CycleState }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left glass border border-deep-400/35 hover:border-purple-400/15 rounded-lg p-4 transition-all duration-300"
    >
      <div className="flex items-center gap-3 mb-1">
        <span className="text-[15px] font-mono font-bold text-purple-400/60 bg-purple-400/10 border border-purple-400/15 rounded-full w-6 h-6 flex items-center justify-center shrink-0">
          {cycle.cycle}
        </span>
        <p className="text-[15px] text-white/65 flex-1 leading-relaxed truncate">
          {cycle.hypothesis}
        </p>
        <span className="text-[15px] text-deep-200/75 shrink-0">
          {expanded ? '▼' : '▶'}
        </span>
      </div>

      {!expanded && cycle.synthesisPreview && (
        <p className="text-[14px] text-deep-200/35 pl-9 line-clamp-2">
          {cycle.synthesisPreview.slice(0, 150)}...
        </p>
      )}

      {expanded && (
        <div className="mt-3 pt-3 border-t border-deep-400/35 space-y-3 pl-9">
          {cycle.personas.map((p) => (
            <div key={p.id} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-[14px] ${PERSONA_COLORS[p.id]?.split(' ')[0] ?? 'text-deep-200/50'}`}>
                  {PERSONA_ICONS[p.id] ?? '◇'}
                </span>
                <span className="text-[15px] font-mono text-deep-200/85">
                  {p.name}
                </span>
                <span className="text-[14px] font-mono text-deep-200/65">{p.model}</span>
              </div>
              <p className="text-[14px] text-deep-200/45 leading-relaxed whitespace-pre-wrap">
                {p.content}
              </p>
            </div>
          ))}

          {cycle.synthesisPreview && (
            <div className="bg-deep-700/20 border border-purple-400/10 rounded px-3 py-2">
              <span className="text-[14px] font-mono text-purple-400/30 uppercase block mb-1">
                综合分析
              </span>
              <p className="text-[14px] text-deep-100/55 leading-relaxed whitespace-pre-wrap">
                {cycle.synthesisPreview}
              </p>
            </div>
          )}

          {cycle.nextHypothesis && (
            <div className="bg-deep-700/20 border border-deep-400/35 rounded px-3 py-2">
              <span className="text-[14px] font-mono text-amber-300/75 uppercase block mb-1">
                下一轮问题
              </span>
              <p className="text-[14px] text-amber-300/90 leading-relaxed">
                {cycle.nextHypothesis}
              </p>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

/* ──── Stat Card ──── */

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-deep-700/20 border border-deep-400/35 rounded-lg px-3 py-3 text-center">
      <span className="text-amber-300/75 text-sm block">{icon}</span>
      <span className="text-sm font-mono text-white/70 block mt-1">{value}</span>
      <span className="text-[14px] font-mono text-deep-200/75 uppercase tracking-wider">{label}</span>
    </div>
  );
}

/* ──── Feature Toggle ──── */

function FeatureToggle({
  label,
  description,
  enabled,
  onToggle,
  color,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  color: 'red' | 'blue' | 'amber' | 'purple';
}) {
  const colorMap = {
    red: {
      on: 'border-red-400/25 bg-red-400/8 text-red-400/70',
      off: 'border-deep-400/12 bg-deep-700/20 text-deep-200/35',
      dot: 'bg-red-400/60',
    },
    blue: {
      on: 'border-blue-400/25 bg-blue-400/8 text-blue-400/70',
      off: 'border-deep-400/12 bg-deep-700/20 text-deep-200/35',
      dot: 'bg-blue-400/60',
    },
    amber: {
      on: 'border-amber-300/25 bg-amber-300/8 text-amber-300/70',
      off: 'border-deep-400/12 bg-deep-700/20 text-deep-200/35',
      dot: 'bg-amber-300/60',
    },
    purple: {
      on: 'border-purple-400/25 bg-purple-400/8 text-purple-400/70',
      off: 'border-deep-400/12 bg-deep-700/20 text-deep-200/35',
      dot: 'bg-purple-400/60',
    },
  };

  const c = colorMap[color];

  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`px-3 py-2 rounded-lg border text-left transition-all ${
        enabled ? c.on : c.off
      }`}
      title={description}
    >
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full transition-colors ${
          enabled ? c.dot : 'bg-deep-400/20'
        }`} />
        <span className="text-[14px] font-mono">{label}</span>
      </div>
      <p className="text-[14px] mt-0.5 opacity-50 leading-tight max-w-[160px]">
        {description}
      </p>
    </button>
  );
}
