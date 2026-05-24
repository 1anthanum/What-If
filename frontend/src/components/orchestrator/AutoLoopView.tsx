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
import { usePortalStore } from '../../store/portalStore';
import { autoLoopApi } from '../../services/api';
import { PHILOSOPHICAL_PRESETS, CATEGORY_META, type PhilosophicalPreset } from './PhilosophicalPresets';
import { EvolutionChain } from './EvolutionChain';
import { DivergenceHeatmap } from './DivergenceHeatmap';
import { ForkingTree } from './ForkingTree';
import { SpectatorPanel } from './SpectatorPanel';
import { PortalSendButton } from '../common/PortalSendButton';
import { PersonaPromptEditor } from './PersonaPromptEditor';
import { PersonaCompareModal } from './PersonaCompareModal';
import { PersonaFollowupModal } from './PersonaFollowupModal';
import { usePersonaPromptStore } from '../../store/personaPromptStore';
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
    replayed,
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
  const [subqDecomp, setSubqDecomp] = useState(false);
  const [selfReflection, setSelfReflection] = useState(false);
  const [subdomainRouting, setSubdomainRouting] = useState(false);
  const [judgeVerdictEnabled, setJudgeVerdictEnabled] = useState(false);
  // Stance prediction game — before debate, predict each persona's stance.
  // Saved in component state so it survives across the running cycle and the
  // PersonaCard render can show "你预测：X" next to actual content.
  const [predictionEnabled, setPredictionEnabled] = useState(false);
  type StancePred = 'support' | 'oppose' | 'neutral';
  const [stancePredictions, setStancePredictions] = useState<Record<string, StancePred>>({});
  const [selfContradictEnabled, setSelfContradictEnabled] = useState(false);
  const [crossLingualEnabled, setCrossLingualEnabled] = useState(false);
  const [liveCriticEnabled, setLiveCriticEnabled] = useState(false);
  const [factCheckEnabled, setFactCheckEnabled] = useState(false);
  const [futurePerspectiveEnabled, setFuturePerspectiveEnabled] = useState(false);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const editedPersonaIds = usePersonaPromptStore((s) => s.editedIds);
  const overridePayload = usePersonaPromptStore((s) => s.overridePayload);
  // Philosophical presets
  const [presetCategory, setPresetCategory] = useState<PhilosophicalPreset['category'] | 'all'>('all');
  const [presetsCollapsed, setPresetsCollapsed] = useState(false);
  // Topic utility state
  const [critique, setCritique] = useState<import('../../services/api').TopicCritique | null>(null);
  const [decomposition, setDecomposition] = useState<import('../../services/api').TopicDecomposition | null>(null);
  const [analogies, setAnalogies] = useState<import('../../services/api').TopicAnalogies | null>(null);
  const [topicBusy, setTopicBusy] = useState<'critique' | 'decompose' | 'analogies' | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [portalSource, setPortalSource] = useState<string | null>(null);

  // Consume portal payload from other modules — becomes the seed hypothesis.
  const portalPending = usePortalStore((s) => s.pending);
  const consumePortal = usePortalStore((s) => s.consume);
  useEffect(() => {
    if (!portalPending || portalPending.target !== 'orchestrator') return;
    const payload = consumePortal('orchestrator');
    if (!payload) return;
    setSeedInput(payload.text);
    setCritique(null);
    setDecomposition(null);
    setPortalSource(payload.sourceLabel);
  }, [portalPending, consumePortal]);

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
      subq_decomposition: configMode === 'philosophical' ? subqDecomp : false,
      self_reflection: configMode === 'philosophical' ? selfReflection : false,
      subdomain_routing: configMode === 'philosophical' ? (subqDecomp && subdomainRouting) : false,
      judge_verdict: configMode === 'philosophical' ? judgeVerdictEnabled : false,
      self_contradict: configMode === 'philosophical' ? selfContradictEnabled : false,
      cross_lingual: configMode === 'philosophical' ? crossLingualEnabled : false,
      live_critic: configMode === 'philosophical' ? liveCriticEnabled : false,
      fact_check: configMode === 'philosophical' ? factCheckEnabled : false,
      future_perspective: configMode === 'philosophical' ? futurePerspectiveEnabled : false,
    } as AutoLoopConfig & { flip_stance?: boolean };
    // Include persona overrides (only applies in philosophical mode where personas matter).
    if (configMode === 'philosophical') {
      const activeIds = [
        'rationalist', 'existentialist', 'pragmatist', 'eastern_philosopher',
        adversarialEnabled ? 'adversary' : 'critical_theorist',
      ];
      const overrides = overridePayload(activeIds);
      if (Object.keys(overrides).length > 0) {
        (config as any).persona_overrides = overrides;
      }
    }
    store.start(config);
  };

  // Detect active cycle for live persona view
  const activeCycle = cycles.find((c) => c.cycle === currentCycle);
  const isPhilosophical = status === 'idle' ? configMode === 'philosophical' : runningMode === 'philosophical';

  return (
    <div className="space-y-6 relative">
      {/* Replay-mode banner — shown when this view was hydrated from an
          archived session via SessionBrowser "▶ 重新打开 live" */}
      {replayed && store.sessionId && (
        <div className="rounded-lg border border-amber-300/45 bg-amber-300/[0.05] px-3 py-2 flex items-center gap-3 animate-fade-in">
          <span className="text-[13px]">🗂</span>
          <p className="flex-1 text-[12px] text-deep-50 leading-snug">
            正在浏览历史 session <span className="font-mono text-amber-300">#{store.sessionId}</span>
            （只读重放） — 所有 persona / verdict / falsifiability 已重建。可继续 💬 追问 /
            🔀 对比模型 / 🆚 A/B 测试，但不能再延展 cycle。
          </p>
          <button
            onClick={() => store.reset()}
            className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-amber-300/45 text-amber-200 hover:bg-amber-300/[0.12]"
          >
            ✕ 退出重放
          </button>
        </div>
      )}

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
                                {(p.difficulty || p.classical_source) && (
                                  <div className="flex flex-wrap items-baseline gap-1.5 mt-1.5">
                                    {p.difficulty && (
                                      <span className={`text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded border ${
                                        p.difficulty === 'intro' ? 'border-earth-green/40 text-earth-green/85'
                                        : p.difficulty === 'advanced' ? 'border-earth-rust/40 text-earth-rust/85'
                                        : 'border-amber-300/35 text-amber-300/80'
                                      }`}>
                                        {p.difficulty === 'intro' ? '入门' : p.difficulty === 'advanced' ? '进阶' : '中等'}
                                      </span>
                                    )}
                                    {p.classical_source && (
                                      <span className="text-[8px] font-mono text-deep-200/60 italic truncate max-w-[180px]" title={p.classical_source}>
                                        📖 {p.classical_source}
                                      </span>
                                    )}
                                  </div>
                                )}
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
                <div className="flex items-baseline justify-between mb-1.5">
                  <label className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider block">
                    {configMode === 'philosophical' ? '哲学问题 — 对话的起点' : '种子假设 — 探索的起点'}
                  </label>
                  {portalSource && (
                    <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider px-2 py-0.5 rounded bg-amber-300/[0.06] border border-amber-300/30">
                      ⇆ 已从「{portalSource}」注入
                    </span>
                  )}
                </div>
                <textarea
                  value={seedInput}
                  onChange={(e) => { setSeedInput(e.target.value); setCritique(null); setDecomposition(null); setAnalogies(null); setPortalSource(null); }}
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
                  <button
                    type="button"
                    disabled={!seedInput.trim() || topicBusy !== null}
                    onClick={async () => {
                      setTopicBusy('analogies');
                      try {
                        const r = await (await import('../../services/api')).topicApi.analogies(seedInput.trim());
                        setAnalogies(r);
                      } catch (e) { console.error(e); }
                      finally { setTopicBusy(null); }
                    }}
                    className="text-[11px] font-mono tracking-[0.16em] px-3 py-1.5 rounded border border-deep-400/45 text-deep-100 hover:border-amber-300/55 hover:text-amber-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="找 3-5 个结构同构的历史/跨域案例（Sonnet）"
                  >
                    {topicBusy === 'analogies' ? '查找中…' : '🔗 找类比'}
                  </button>
                  {(critique || decomposition || analogies) && (
                    <button
                      type="button"
                      onClick={() => { setCritique(null); setDecomposition(null); setAnalogies(null); }}
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

                {/* Analogies result — 3-5 structural parallels */}
                {analogies && (
                  <div className="mt-2 rounded-lg bg-blue-400/[0.04] border border-blue-400/30 p-3 animate-fade-in-up text-[12px]">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="font-mono tracking-[0.2em] text-blue-400/95 uppercase text-[10px]">
                        🔗 结构同构案例
                      </span>
                      <span className="font-mono text-[10px] text-deep-300">
                        {analogies.analogies.length} 个 · 点「以此为类比」追加到种子
                      </span>
                    </div>
                    {analogies.analogies.length === 0 ? (
                      <p className="text-[11px] text-deep-300 italic">未找到合适的类比 — 议题可能过于具体或语义模糊</p>
                    ) : (
                      <div className="space-y-1.5">
                        {analogies.analogies.map((a, i) => (
                          <div key={i} className="rounded bg-deep-900/50 border border-deep-400/30 px-2.5 py-2">
                            <div className="flex items-start gap-2">
                              <span className="font-mono text-[10px] text-blue-400/85 shrink-0 mt-0.5 tabular-nums">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 mb-0.5">
                                  <p className="text-deep-50 font-medium">{a.title}</p>
                                  {a.era && (
                                    <span className="text-[9px] font-mono text-deep-300 uppercase tracking-wider shrink-0">
                                      {a.era}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-deep-200/85 leading-snug">
                                  <span className="text-blue-400/85 font-mono">同构：</span>{a.why_analogous}
                                </p>
                                {a.key_lesson && (
                                  <p className="text-[11px] text-earth-green/80 leading-snug mt-0.5">
                                    <span className="font-mono text-earth-green/65">教训：</span>{a.key_lesson}
                                  </p>
                                )}
                                {a.key_difference && (
                                  <p className="text-[11px] text-earth-rust/75 leading-snug mt-0.5">
                                    <span className="font-mono text-earth-rust/60">不同：</span>{a.key_difference}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const inject = `${seedInput.trim()}\n\n参考类比：${a.title}（${a.era}）— ${a.why_analogous} 教训：${a.key_lesson}`;
                                  setSeedInput(inject);
                                  setAnalogies(null);
                                }}
                                className="text-[10px] font-mono px-2 py-1 rounded border border-blue-400/45 text-blue-400 hover:bg-blue-400/[0.06] shrink-0"
                                title="把此类比追加到种子问题，辩论时可参考"
                              >
                                以此为类比
                              </button>
                            </div>
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
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider">
                      参与辩论的哲学流派
                    </span>
                    <button
                      type="button"
                      onClick={() => setPromptEditorOpen(true)}
                      className="text-[11px] font-mono uppercase tracking-[0.16em] text-amber-300/85 hover:text-amber-200 px-2.5 py-1 rounded border border-amber-300/35 hover:border-amber-300/65 hover:bg-amber-300/[0.05] transition-colors"
                      title="自定义每位 persona 的 system prompt"
                    >
                      ✎ 编辑 persona{editedPersonaIds.length > 0 && (
                        <span className="ml-1.5 text-[9px] tabular-nums">({editedPersonaIds.length})</span>
                      )}
                    </button>
                  </div>
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

              {/* Stance prediction game — predict each persona's stance before debate starts */}
              {configMode === 'philosophical' && predictionEnabled && seedInput.trim() && (
                <div className="bg-blue-400/[0.04] border border-blue-400/30 rounded-lg px-4 py-3.5 space-y-2.5 animate-fade-in">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-mono text-blue-400/90 uppercase tracking-wider">
                      🎯 先猜立场再开始
                    </span>
                    <span className="text-[10px] font-mono text-deep-200/55 tabular-nums">
                      {Object.keys(stancePredictions).length} / 5
                    </span>
                  </div>
                  <p className="text-[11px] text-deep-200/65 leading-relaxed">
                    在让 LLM 辩论前，先点选每位 persona 你认为会持的立场。结束后会逐个对比实际发言。
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { id: 'rationalist', name: '理性主义' },
                      { id: 'existentialist', name: '存在主义' },
                      { id: 'pragmatist', name: '实用主义' },
                      { id: 'eastern_philosopher', name: '东方哲学' },
                      { id: adversarialEnabled ? 'adversary' : 'critical_theorist', name: adversarialEnabled ? '魔鬼代言人' : '批判理论' },
                    ].map((p) => {
                      const sel = stancePredictions[p.id];
                      const options: Array<{ key: StancePred; label: string; activeClass: string }> = [
                        { key: 'support', label: '支持', activeClass: 'border-earth-green/65 bg-earth-green/[0.10] text-earth-green/90' },
                        { key: 'neutral', label: '中立', activeClass: 'border-deep-200/55 bg-deep-200/[0.08] text-deep-50' },
                        { key: 'oppose',  label: '反对', activeClass: 'border-earth-rust/65 bg-earth-rust/[0.10] text-earth-rust/90' },
                      ];
                      return (
                        <div key={p.id} className="flex items-center gap-2">
                          <span className={`text-[12px] font-mono w-32 shrink-0 ${PERSONA_COLORS[p.id]?.split(' ')[0] ?? 'text-deep-200/80'}`}>
                            {PERSONA_ICONS[p.id] ?? '◇'} {p.name}
                          </span>
                          {options.map((opt) => {
                            const active = sel === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                onClick={() => setStancePredictions((s) => ({ ...s, [p.id]: opt.key }))}
                                className={`text-[11px] font-mono px-2 py-1 rounded border transition-colors ${
                                  active
                                    ? opt.activeClass
                                    : 'border-deep-400/30 text-deep-200/65 hover:border-deep-400/55 hover:text-deep-100'
                                }`}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
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
                    <FeatureToggle
                      label="🌳 子问题分解"
                      description="A — 先拆议题成 2-4 个正交子问题，各自辩论再汇总（双层深度，~2-3x 成本）"
                      enabled={subqDecomp}
                      onToggle={setSubqDecomp}
                      color="amber"
                    />
                    <FeatureToggle
                      label="🪞 自反思"
                      description="B — 每个 persona 发言后再调一次同模型，自识隐含假设和被忽视的反方观点"
                      enabled={selfReflection}
                      onToggle={setSelfReflection}
                      color="blue"
                    />
                    <FeatureToggle
                      label="🎯 子领域路由"
                      description="C — 仅在 A 开启时生效：每个子问题按 domain 自动选最匹配 provider"
                      enabled={subdomainRouting && subqDecomp}
                      onToggle={setSubdomainRouting}
                      color="purple"
                    />
                    <FeatureToggle
                      label="⚖ 裁决"
                      description="每轮综合后让裁判明确给出各争议点的胜出立场+理由（结构化输出）"
                      enabled={judgeVerdictEnabled}
                      onToggle={setJudgeVerdictEnabled}
                      color="amber"
                    />
                    <FeatureToggle
                      label="🎯 立场预测"
                      description="开始前你先猜每位 persona 会如何站队；结束后对比实际发言"
                      enabled={predictionEnabled}
                      onToggle={setPredictionEnabled}
                      color="blue"
                    />
                    <FeatureToggle
                      label="🪞 自我反驳"
                      description="每位 persona 必须写出最锐利的反方论证 + 解释为何仍坚持原立场。测试论证深度。"
                      enabled={selfContradictEnabled}
                      onToggle={setSelfContradictEnabled}
                      color="purple"
                    />
                    <FeatureToggle
                      label="🌍 母语思维"
                      description="每位 persona 用本传统的原始术语（德/法存在主义、古汉语/经文、批判理论德语词等）思考再表达"
                      enabled={crossLingualEnabled}
                      onToggle={setCrossLingualEnabled}
                      color="blue"
                    />
                    <FeatureToggle
                      label="🔍 实时 critic"
                      description="每位 persona 发言完，cheap-tier 审稿人立刻指出至多 3 条逻辑问题（循环论证 / 隐含前提 / 证据不足等）"
                      enabled={liveCriticEnabled}
                      onToggle={setLiveCriticEnabled}
                      color="red"
                    />
                    <FeatureToggle
                      label="📋 事实核查"
                      description="对每个发言中的经验性命题做 LLM 合理性检查（标 certain / uncertain / likely_wrong / unverifiable）。不能替代真正的 web 核查。"
                      enabled={factCheckEnabled}
                      onToggle={setFactCheckEnabled}
                      color="red"
                    />
                    <FeatureToggle
                      label="⏳ 未来人辩论"
                      description="每位 persona 假装是 2050 年的版本，从未来回望此问题，指出当下盲点"
                      enabled={futurePerspectiveEnabled}
                      onToggle={setFuturePerspectiveEnabled}
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
                    prediction={stancePredictions[p.id]}
                    cycleHypothesis={activeCycle.hypothesis}
                    cycleNum={activeCycle.cycle}
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
                {finalSynthesis && (
                  <PortalSendButton text={finalSynthesis} sourceLabel="Opus 元综合" exclude="orchestrator" />
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

      {/* Persona prompt editor — opens from "✎ 编辑 persona" button. */}
      {promptEditorOpen && (
        <PersonaPromptEditor onClose={() => setPromptEditorOpen(false)} />
      )}
    </div>
  );
}

/* ──── Persona Card (live streaming during philosophical debate) ──── */

/** Detect the Popper falsifiability line and split it off from the main body.
 *  Matches both Chinese "可证伪线：" and English "Falsifiability line:" forms. */
function splitFalsifiability(content: string): { body: string; falsifiability: string | null } {
  const re = /(?:^|\n)\s*\**\s*(?:可证伪线|Falsifiability\s+line)\s*[:：]\s*(.+)$/i;
  const m = content.match(re);
  if (!m) return { body: content, falsifiability: null };
  const body = content.slice(0, m.index ?? content.length).replace(/\s+$/, '');
  return { body, falsifiability: m[1].trim() };
}

/** Detect the self-contradiction test sections ("反方最强论证" + "我仍坚持原立场").
 *  Returns the cleaned body + the two extracted paragraphs (or null if absent).
 *  Run AFTER splitFalsifiability so the falsifiability line doesn't bleed in. */
function splitSelfContradiction(content: string): {
  body: string;
  counterArg: string | null;
  stillHold: string | null;
} {
  const counterRe = /(?:^|\n)\s*\**\s*(?:反方最强论证|Strongest counter-argument)\s*[:：]\s*([\s\S]+?)(?=(?:\n\s*\**\s*(?:我仍坚持原立场|I still hold my stance)\s*[，,]?\s*(?:因为|because)\s*[:：])|$)/i;
  const stillHoldRe = /(?:^|\n)\s*\**\s*(?:我仍坚持原立场|I still hold my stance)\s*[，,]?\s*(?:因为|because)\s*[:：]\s*([\s\S]+?)$/i;
  const counter = content.match(counterRe);
  const stillHold = content.match(stillHoldRe);
  if (!counter && !stillHold) return { body: content, counterArg: null, stillHold: null };

  const cutFrom = counter
    ? (counter.index ?? content.length)
    : (stillHold ? (stillHold.index ?? content.length) : content.length);
  const body = content.slice(0, cutFrom).replace(/\s+$/, '');
  return {
    body,
    counterArg: counter ? counter[1].trim() : null,
    stillHold: stillHold ? stillHold[1].trim() : null,
  };
}

function PersonaCard({
  persona, isActive, prediction, cycleHypothesis, cycleNum,
}: {
  persona: PhilPersonaState;
  isActive: boolean;
  prediction?: 'support' | 'oppose' | 'neutral';
  cycleHypothesis?: string;
  cycleNum?: number;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);
  const colorClass = PERSONA_COLORS[persona.id] ?? 'text-deep-200/50 border-deep-400/45 bg-deep-600/5';
  const icon = PERSONA_ICONS[persona.id] ?? '◇';
  // Strip falsifiability line first, then peel off optional self-contradiction
  // sections; the remaining `body` is the persona's primary statement.
  const afterFals = splitFalsifiability(persona.content);
  const falsifiability = afterFals.falsifiability;
  const sc = splitSelfContradiction(afterFals.body);
  const body = sc.body;
  const counterArg = sc.counterArg;
  const stillHold = sc.stillHold;
  const dogmatic = !persona.streaming && persona.content.length > 0 && falsifiability === null;
  const predLabel = prediction === 'support' ? '支持' : prediction === 'oppose' ? '反对' : prediction === 'neutral' ? '中立' : null;
  const predClass = prediction === 'support'
    ? 'border-earth-green/40 bg-earth-green/[0.08] text-earth-green/90'
    : prediction === 'oppose'
      ? 'border-earth-rust/40 bg-earth-rust/[0.08] text-earth-rust/90'
      : 'border-deep-400/40 bg-deep-700/20 text-deep-100/85';

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
        {predLabel && (
          <span
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${predClass}`}
            title="你开始前的预测立场"
          >
            🎯 你猜：{predLabel}
          </span>
        )}
        {falsifiability && (
          <span
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-earth-green/40 bg-earth-green/[0.08] text-earth-green/90"
            title="该发言给出了可证伪线 — 符合 Popper 标准"
          >
            ✓ 可证伪
          </span>
        )}
        {dogmatic && (
          <span
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-earth-rust/40 bg-earth-rust/[0.08] text-earth-rust/90"
            title="该发言未给出可证伪线 — 论证封闭"
          >
            ⚠ 教条
          </span>
        )}
        {persona.streaming && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        )}
        {!persona.streaming && persona.content && cycleHypothesis && (
          <button
            type="button"
            onClick={() => setFollowupOpen(true)}
            className="ml-auto text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-300/35 text-amber-300/85 hover:border-amber-300/65 hover:bg-amber-300/[0.05] transition-colors"
            title="向这位 persona 直接追问"
          >
            💬 追问
          </button>
        )}
        {!persona.streaming && persona.content && cycleHypothesis && (
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-300/35 text-amber-300/85 hover:border-amber-300/65 hover:bg-amber-300/[0.05] transition-colors"
            title="用同一 prompt 跑 Claude / GPT-5 / DeepSeek，对比三家模型对此 persona 的诠释差异"
          >
            🔀 对比
          </button>
        )}
        {!persona.streaming && persona.content && !cycleHypothesis && !falsifiability && !dogmatic && (
          <span className="ml-auto text-[14px] font-mono text-deep-200/65">✓</span>
        )}
      </div>
      {body && (
        <p className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
          isActive ? 'text-deep-100/70' : 'text-deep-200/85'
        }`}>
          {body}
          {persona.streaming && <span className="cursor-blink" />}
        </p>
      )}
      {counterArg && (
        <div className="mt-3 pt-3 border-t border-purple-400/15">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-purple-400/85">
              🪞 反方最强论证
            </span>
            <span className="flex-1 h-px bg-purple-400/15" />
          </div>
          <p className="text-[13px] text-purple-300/90 leading-relaxed whitespace-pre-wrap">
            {counterArg}
          </p>
        </div>
      )}
      {stillHold && (
        <div className="mt-2 pt-2 border-t border-purple-400/10">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-purple-400/70">
              我仍坚持，因为
            </span>
            <span className="flex-1 h-px bg-purple-400/10" />
          </div>
          <p className="text-[13px] text-purple-300/75 leading-relaxed whitespace-pre-wrap italic">
            {stillHold}
          </p>
        </div>
      )}
      {falsifiability && (
        <div className="mt-3 pt-3 border-t border-earth-green/15">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[9px] font-mono uppercase tracking-wider text-earth-green/75">
              可证伪线
            </span>
            <span className="flex-1 h-px bg-earth-green/15" />
          </div>
          <p className="text-[13px] text-earth-green/90 leading-relaxed italic">
            {falsifiability}
          </p>
        </div>
      )}
      {persona.critic_issues && persona.critic_issues.length > 0 && (
        <div className="mt-3 pt-3 border-t border-earth-rust/15">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-earth-rust/85">
              🔍 critic 标记 ({persona.critic_issues.length})
            </span>
            <span className="flex-1 h-px bg-earth-rust/15" />
          </div>
          <ul className="space-y-1">
            {persona.critic_issues.map((iss, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-earth-rust/40 bg-earth-rust/[0.06] text-earth-rust/85 shrink-0 mt-0.5">
                  {iss.type || '?'}
                </span>
                <span className="text-deep-100/85 leading-snug">{iss.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {compareOpen && cycleHypothesis && (
        <PersonaCompareModal
          personaId={persona.id}
          personaName={persona.name}
          question={cycleHypothesis}
          onClose={() => setCompareOpen(false)}
        />
      )}
      {followupOpen && cycleHypothesis && cycleNum != null && (
        <PersonaFollowupModal
          personaId={persona.id}
          personaName={persona.name}
          cycleNum={cycleNum}
          cycleHypothesis={cycleHypothesis}
          personaStatement={persona.content}
          onClose={() => setFollowupOpen(false)}
        />
      )}
      {persona.followups && persona.followups.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-300/15 space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[9px] font-mono uppercase tracking-wider text-amber-300/85">
              💬 追问对话 ({persona.followups.length})
            </span>
            <span className="flex-1 h-px bg-amber-300/15" />
          </div>
          {persona.followups.map((f, i) => (
            <div key={i} className="text-[12px] leading-snug">
              <p className="text-amber-300/85 font-medium">▶ {f.followup}</p>
              <p className="text-deep-100/85 mt-0.5 pl-3 whitespace-pre-wrap">{f.response}</p>
            </div>
          ))}
        </div>
      )}
      {persona.fact_check_claims && persona.fact_check_claims.length > 0 && (
        <div className="mt-3 pt-3 border-t border-amber-300/15">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[9px] font-mono uppercase tracking-wider text-amber-300/85">
              📋 事实核查 ({persona.fact_check_claims.length})
            </span>
            <span className="flex-1 h-px bg-amber-300/15" />
            <span
              className="text-[8px] font-mono text-deep-200/45 italic"
              title="本核查是 LLM 合理性评估，不是权威核查"
            >
              非权威
            </span>
          </div>
          <ul className="space-y-1.5">
            {persona.fact_check_claims.map((c, i) => {
              const tone = {
                certain:        'border-earth-green/40 bg-earth-green/[0.05] text-earth-green/95',
                uncertain:      'border-amber-300/40 bg-amber-300/[0.06] text-amber-200',
                likely_wrong:   'border-earth-rust/55 bg-earth-rust/[0.10] text-earth-rust',
                unverifiable:   'border-deep-400/35 bg-deep-700/30 text-deep-200/65',
              }[c.verdict] || 'border-deep-400/30 text-deep-200/70';
              const label = {
                certain: '✓ 较可信',
                uncertain: '? 不确定',
                likely_wrong: '✗ 可能错',
                unverifiable: '⚬ 不可查',
              }[c.verdict] || c.verdict;
              return (
                <li key={i} className="text-[12px]">
                  <div className="flex items-start gap-2">
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${tone}`}>
                      {label}
                    </span>
                    <span className="text-deep-100/85 leading-snug flex-1">
                      <span className="italic">「{c.claim}」</span>
                    </span>
                  </div>
                  {c.reason && (
                    <p className="text-[11px] text-deep-200/65 leading-snug mt-0.5 pl-[3.25rem]">
                      ↳ {c.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
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
        {cycle.compressed && (
          <span
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-deep-400/35 text-deep-200/55 shrink-0"
            title="该轮详情已压缩以节省内存（保留摘要 + 裁决）"
          >
            ⊟ 已压缩
          </span>
        )}
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
          {/* Method A: Sub-questions section */}
          {cycle.subQuestions && cycle.subQuestions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] font-mono tracking-[0.20em] text-amber-300/95 uppercase">
                  🌳 子问题分解 · {cycle.subQuestions.length}
                </span>
                {cycle.subdomainRouting && (
                  <span className="text-[10px] font-mono tk-cool-soft px-1.5 py-0.5 rounded tk-cool-bg border">
                    🎯 子领域路由
                  </span>
                )}
              </div>
              {cycle.subQuestions.map(sq => (
                <div key={sq.idx} className="rounded bg-deep-800/40 border tk-border-faint p-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[13px] font-medium text-amber-200">
                      <span className="font-mono text-[10px] text-amber-300/85 mr-1.5">SQ{sq.idx + 1}</span>
                      {sq.title}
                    </span>
                    <span className="text-[10px] font-mono tk-cool-soft px-1.5 py-0.5 rounded tk-cool-bg border">
                      {sq.domain}
                    </span>
                  </div>
                  <p className="text-[12px] tk-text-secondary mb-2 leading-snug">{sq.question}</p>
                  <div className="space-y-1.5">
                    {sq.personas.map(p => (
                      <div key={p.id} className="rounded bg-deep-900/40 px-2 py-1.5">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[12px] ${PERSONA_COLORS[p.id]?.split(' ')[0] ?? 'text-deep-200/50'}`}>
                            {PERSONA_ICONS[p.id] ?? '◇'}
                          </span>
                          <span className="text-[12px] font-mono tk-text-secondary">{p.name}</span>
                          <span className="text-[10px] font-mono tk-cool-soft ml-auto">{p.model}</span>
                        </div>
                        <p className="text-[12px] tk-text-muted leading-snug whitespace-pre-wrap">{p.content}{p.streaming && <span className="cursor-blink" />}</p>
                        {p.reflection && (
                          <div className="mt-1 pl-2 border-l-2 border-blue-400/35 text-[11px] tk-cool-soft italic leading-snug whitespace-pre-wrap">
                            🪞 {p.reflection}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {sq.synthesis && (
                    <div className="mt-2 pt-2 border-t border-amber-300/15">
                      <span className="text-[10px] font-mono text-amber-300/85 tracking-wider uppercase mb-1 block">
                        ◆ 子综合
                      </span>
                      <p className="text-[12px] tk-text-secondary leading-relaxed whitespace-pre-wrap">{sq.synthesis}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Regular personas (non-subq path) */}
          {(!cycle.subQuestions || cycle.subQuestions.length === 0) && cycle.personas.map((p) => (
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
              {p.reflection && (
                <div className="mt-1 ml-4 pl-2 border-l-2 border-blue-400/35 text-[12px] tk-cool-soft italic leading-snug whitespace-pre-wrap">
                  🪞 {p.reflection}
                </div>
              )}
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

          {cycle.judgeVerdict && cycle.judgeVerdict.verdicts && cycle.judgeVerdict.verdicts.length > 0 && (
            <div className="bg-amber-300/[0.04] border border-amber-300/25 rounded-lg p-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[12px] font-mono text-amber-300/90 uppercase tracking-wider">
                  ⚖ 裁决
                </span>
                <span className="flex-1 h-px bg-amber-300/15" />
              </div>
              <div className="space-y-2.5">
                {cycle.judgeVerdict.verdicts.map((v, i) => (
                  <div key={i} className="border-l-2 border-amber-300/30 pl-3">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-[11px] font-mono text-amber-300/65 tabular-nums">#{i + 1}</span>
                      <span className="text-[13px] text-deep-50 font-medium">{v.contested_point}</span>
                      <span className="ml-auto text-[10px] font-mono text-amber-300/65" title="裁判信心度">
                        {'★'.repeat(Math.max(0, Math.min(5, v.confidence)))}
                      </span>
                    </div>
                    <div className="text-[12px] text-deep-100/80 leading-relaxed">
                      <span className="text-earth-green/85 font-medium">胜出：</span>
                      {v.winning_position}
                      {v.winning_personas?.length > 0 && (
                        <span className="ml-1.5 text-[10px] font-mono text-amber-300/75">
                          ({v.winning_personas.join('、')})
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-deep-200/75 leading-relaxed italic mt-1">
                      {v.verdict_reason}
                    </div>
                  </div>
                ))}
              </div>
              {(cycle.judgeVerdict.overall_strongest || cycle.judgeVerdict.overall_weakest) && (
                <div className="mt-3 pt-2.5 border-t border-amber-300/15 flex flex-col sm:flex-row gap-2 text-[11px]">
                  {cycle.judgeVerdict.overall_strongest && (
                    <div className="flex-1">
                      <span className="text-earth-green/85 font-mono uppercase tracking-wider">最强：</span>
                      <span className="text-deep-100/85"> {cycle.judgeVerdict.overall_strongest.persona_id} — {cycle.judgeVerdict.overall_strongest.reason}</span>
                    </div>
                  )}
                  {cycle.judgeVerdict.overall_weakest && (
                    <div className="flex-1">
                      <span className="text-earth-rust/85 font-mono uppercase tracking-wider">最弱：</span>
                      <span className="text-deep-100/85"> {cycle.judgeVerdict.overall_weakest.persona_id} — {cycle.judgeVerdict.overall_weakest.reason}</span>
                    </div>
                  )}
                </div>
              )}
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
