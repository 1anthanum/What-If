import { useEffect, useState } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { Timeline } from './Timeline';
import { CounterfactualPanel } from './CounterfactualPanel';
import { PossibilityFan } from './PossibilityFan';
import { AnnotationModal } from './AnnotationModal';
import { AttractorView } from './AttractorView';
import { PersonaSelector } from './PersonaSelector';
import { ConeVisualization } from './ConeVisualization';
import { Button } from '../common/ui';

const DOMAIN_ICONS: Record<string, string> = {
  agriculture: '🌾',
  technology: '💻',
  geopolitics: '🌍',
  economics: '📊',
};

const STAGE_LABELS: Record<string, string> = {
  diverge: '发散探索 (Haiku × N)',
  cluster: '语义聚类 (Sonnet)',
  refine: '精炼时间线 (Sonnet × K)',
  complete: '完成',
};

export function CounterfactualView() {
  const store = useCounterfactualStore();
  const {
    events,
    selectedEvent,
    status,
    error,
    modification,
    timelinePoints,
    explorationMode,
    explorationStage,
    explorationProgress,
    possibilityBranches,
    coneViewEnabled,
  } = store;

  const [timeHorizon, setTimeHorizon] = useState('30 years');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const BASIC_MODES = [
    { key: 'single',  label: '单一时间线', hint: '推演一条主线' },
    { key: 'explore', label: '可能性探索', hint: 'Ensemble 多分支' },
  ] as const;
  const ADVANCED_MODES = [
    { key: 'embodied',  label: '具身视角',     hint: '历史人物代理' },
    { key: 'attractor', label: '吸引子检测', hint: '跨假设收敛点' },
  ] as const;

  // Load events on mount
  useEffect(() => {
    if (!events.length && status === 'idle') {
      store.loadEvents();
    }
  }, []);

  // Phase 1: Event Selection
  if (!selectedEvent && status !== 'loading_event') {
    return (
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h2 className="text-lg font-medium text-white/90 tracking-wide">
            历史反事实引擎
          </h2>
          <p className="text-xs text-deep-200/85 max-w-lg mx-auto leading-relaxed">
            选择一个历史事件，修改关键决策参数，探索"如果历史走了另一条路"会发生什么
          </p>
        </div>

        {/* Loading state */}
        {status === 'loading_events' && (
          <div className="text-center py-12">
            <div className="inline-block w-5 h-5 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
            <p className="text-xs text-deep-200/75 mt-3 font-mono">
              加载历史事件...
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="glass border border-earth-rust/20 rounded-lg p-4 text-center">
            <p className="text-xs text-earth-rust/70">{error}</p>
          </div>
        )}

        {/* Event Cards */}
        {events.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {events.map((ev) => (
              <button
                key={ev.id}
                onClick={() => store.selectEvent(ev.id)}
                className="glass border border-deep-400/35 hover:border-amber-300/45 rounded-lg p-5 text-left transition-all duration-300 hover:bg-amber-300/[0.02] group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {DOMAIN_ICONS[ev.domain] || '📜'}
                    </span>
                    <h3 className="text-sm font-medium text-white/85 group-hover:text-amber-300/90 transition-colors">
                      {ev.title}
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono tk-cool-soft bg-deep-600/30 px-2 py-0.5 rounded tabular-nums">
                    {ev.period}
                  </span>
                </div>
                <p className="text-[13px] tk-text-secondary leading-relaxed mb-3 line-clamp-2">
                  {ev.description}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[11px] font-mono tk-text-muted">
                    <span>{ev.region}</span>
                    <span className="tk-text-faint">·</span>
                    <span>{ev.decision_node_count} 决策节点</span>
                  </div>
                  <span className="text-[12px] font-mono text-amber-300/85 group-hover:text-amber-200 transition-colors tracking-[0.10em]">
                    探索 →
                  </span>
                </div>
                {ev.default_modification && (
                  <div className="mt-3 pt-2 border-t tk-border-faint">
                    <p className="text-[12px] text-amber-300/85 italic leading-relaxed">
                      推荐假设：{ev.default_modification}
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Loading event detail
  if (status === 'loading_event') {
    return (
      <div className="text-center py-20">
        <div className="inline-block w-6 h-6 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
        <p className="text-xs text-deep-200/75 mt-3 font-mono">
          加载事件详情...
        </p>
      </div>
    );
  }

  // Phase 2: Modification Input + Timeline / Fan Display
  const hasTimeline = timelinePoints.length > 0;
  const hasFan = possibilityBranches.length > 0;
  const isGenerating = status === 'generating';
  const hasResult = hasTimeline || hasFan;

  return (
    <div className="space-y-6">
      {/* Back button + Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button onClick={() => store.clearEvent()} variant="ghost" size="sm">
            ← 返回
          </Button>
          <h2 className="text-sm font-medium tk-text-primary">
            {selectedEvent?.title}
          </h2>
        </div>
        <span className="text-[12px] font-mono tk-cool-soft tabular-nums">
          {selectedEvent?.period}
        </span>
      </div>

      {/* Attractor mode has its own complete UI */}
      {explorationMode === 'attractor' && (
        <AttractorView />
      )}

      {/* Modification Input (if no result yet, and not attractor mode) */}
      {explorationMode !== 'attractor' && !hasResult && !isGenerating && (
        <div className="glass border border-amber-300/35 rounded-lg p-5 space-y-4">
          <h3 className="text-xs font-mono text-amber-300/90 uppercase tracking-wider">
            你的反事实假设
          </h3>
          <textarea
            value={modification}
            onChange={(e) => store.setModification(e.target.value)}
            placeholder="输入你想改变的历史假设..."
            rows={3}
            className="w-full bg-deep-700/30 border border-deep-400/45 rounded-lg px-4 py-3 text-sm text-white/80 placeholder:text-deep-300/65 focus:outline-none focus:border-amber-300/25 resize-none"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Time horizon */}
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-mono text-deep-200/75">
                  推演跨度:
                </span>
                <select
                  value={timeHorizon}
                  onChange={(e) => setTimeHorizon(e.target.value)}
                  className="bg-deep-700/30 border border-deep-400/45 rounded px-2 py-1 text-[15px] text-deep-200/95 focus:outline-none focus:border-amber-300/55"
                >
                  <option value="10 years">10 年</option>
                  <option value="20 years">20 年</option>
                  <option value="30 years">30 年</option>
                  <option value="50 years">50 年</option>
                </select>
              </div>

              {/* Mode toggle — basic tier; advanced reveals on demand */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-deep-700/30 rounded-lg border tk-border-faint p-0.5">
                  {BASIC_MODES.map(({ key, label, hint }) => {
                    const active = explorationMode === key;
                    return (
                      <button
                        key={key}
                        onClick={() => store.setExplorationMode(key)}
                        title={hint}
                        className={`px-3 py-1.5 rounded text-[13px] font-mono transition-all ${
                          active
                            ? 'bg-amber-300/[0.12] text-amber-200 border border-amber-300/55 shadow-glow-sm'
                            : 'tk-text-secondary hover:text-amber-300 border border-transparent'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {(showAdvanced || (ADVANCED_MODES as readonly { key: string }[]).some(m => m.key === explorationMode)) ? (
                  <div className="flex items-center gap-1 bg-cool-400/[0.04] rounded-lg border border-cool-400/30 p-0.5 animate-fade-in">
                    {ADVANCED_MODES.map(({ key, label, hint }) => {
                      const active = explorationMode === key;
                      return (
                        <button
                          key={key}
                          onClick={() => store.setExplorationMode(key)}
                          title={hint}
                          className={`px-3 py-1.5 rounded text-[13px] font-mono transition-all ${
                            active
                              ? 'bg-cool-400/[0.12] text-cool-200 border border-cool-400/55'
                              : 'tk-text-secondary hover:text-cool-300 border border-transparent'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAdvanced(true)}
                    className="text-[12px] font-mono tk-cool-soft hover:tk-cool tracking-[0.10em] px-2.5 py-1.5 rounded border border-cool-400/25 hover:border-cool-400/55 transition-all"
                    title="解锁具身视角与吸引子检测"
                  >
                    + 进阶 ▾
                  </button>
                )}
              </div>
            </div>

            {/* Generate button — outer guard already excludes 'attractor' mode */}
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                if (!modification.trim()) return;
                if (explorationMode === 'explore') {
                  store.startExploration(modification.trim(), timeHorizon);
                } else if (explorationMode === 'embodied') {
                  store.startEmbodiedExploration(modification.trim(), timeHorizon);
                } else {
                  store.generateTimeline(modification.trim(), timeHorizon);
                }
              }}
              disabled={
                !modification.trim() ||
                (explorationMode === 'embodied' && store.selectedPersonaIds.length < 2)
              }
            >
              {explorationMode === 'explore'
                ? '▶ 探索所有可能性'
                : explorationMode === 'embodied'
                  ? '▶ 以历史人物视角'
                  : '▶ 生成时间线'}
            </Button>
          </div>

          {/* Mode descriptions */}
          {explorationMode === 'explore' && (
            <div className="text-[14px] text-deep-200/75 bg-deep-700/20 rounded px-3 py-2 border border-deep-400/35 leading-relaxed">
              探索模式会用快速模型并行生成 15 个分歧方案，然后聚类为 3-4 个叙事方向，
              最后为每个方向生成完整时间线。成本约 $0.10-$0.15。
            </div>
          )}

          {/* Embodied mode: persona selector */}
          {explorationMode === 'embodied' && (
            <PersonaSelector />
          )}
        </div>
      )}

      {/* Generating: Single mode spinner */}
      {isGenerating && explorationMode === 'single' && !hasTimeline && (
        <div className="text-center py-12">
          <div className="inline-block w-6 h-6 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
          <p className="text-xs text-deep-200/75 mt-3 font-mono">
            AI 正在推演反事实时间线...
          </p>
        </div>
      )}

      {/* Generating: Explore / Embodied mode progress */}
      {isGenerating && (explorationMode === 'explore' || explorationMode === 'embodied') && !hasFan && (
        <div className="glass border border-amber-300/40 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-amber-300/95 uppercase tracking-wider">
              三阶段 Ensemble 管线
            </h3>
            <span className="text-[14px] font-mono text-deep-200/85">
              {explorationProgress}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-deep-600/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${explorationProgress}%`,
                background: 'linear-gradient(90deg, rgba(196,144,88,0.5), rgba(196,144,88,0.9))',
              }}
            />
          </div>

          {/* Stage indicators */}
          <div className="flex items-center gap-4">
            {(['diverge', 'cluster', 'refine'] as const).map((stage, idx) => {
              const isActive = explorationStage === stage;
              const isDone =
                (stage === 'diverge' && ['cluster', 'refine', 'complete'].includes(explorationStage)) ||
                (stage === 'cluster' && ['refine', 'complete'].includes(explorationStage)) ||
                (stage === 'refine' && explorationStage === 'complete');

              return (
                <div key={stage} className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[14px] font-mono font-bold border transition-all ${
                      isActive
                        ? 'border-amber-300/50 bg-amber-300/15 text-amber-300/90 shadow-glow-sm'
                        : isDone
                          ? 'border-amber-300/70 bg-amber-300/10 text-amber-300/95'
                          : 'border-deep-400/45 bg-deep-700/30 text-deep-200/75'
                    }`}
                  >
                    {isDone ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`text-[15px] font-mono ${
                      isActive
                        ? 'text-amber-300/70'
                        : isDone
                          ? 'text-deep-200/85'
                          : 'text-deep-200/65'
                    }`}
                  >
                    {STAGE_LABELS[stage]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Current stage detail */}
          <p className="text-[14px] text-deep-200/75 font-mono">
            {explorationStage === 'diverge' && (explorationMode === 'embodied'
              ? '正在以每位历史人物的视角并行探索分歧可能性...'
              : '正在从军事/经济/文化/科技/政治五个视角并行探索分歧可能性...')}
            {explorationStage === 'cluster' && (explorationMode === 'embodied'
              ? '正在按利益联盟聚类，分析行动者如何结盟...'
              : '正在将探索结果归类为不同的叙事方向...')}
            {explorationStage === 'refine' && '正在为每个方向生成完整的反事实时间线...'}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass border border-earth-rust/20 rounded-lg p-4 text-center">
          <p className="text-xs text-earth-rust/70">{error}</p>
          <button
            onClick={() => {
              if (explorationMode === 'explore') {
                store.startExploration(modification.trim(), timeHorizon);
              } else {
                store.generateTimeline(modification.trim(), timeHorizon);
              }
            }}
            className="mt-2 text-[14px] font-mono text-amber-300/90 hover:text-amber-300 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Main Layout: Single Timeline Mode */}
      {explorationMode === 'single' && (hasTimeline || (isGenerating && hasTimeline)) && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
          <div className="min-w-0">
            <div className="glass border border-amber-300/40 rounded-lg p-3 mb-6">
              <p className="text-[14px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">
                反事实假设
              </p>
              <p className="text-xs text-amber-300/70">「{modification}」</p>
            </div>
            <Timeline />
          </div>
          <div className="min-w-0">
            <CounterfactualPanel />
          </div>
        </div>
      )}

      {/* Main Layout: Explore / Embodied Mode — Possibility Fan / Cone */}
      {(explorationMode === 'explore' || explorationMode === 'embodied') && hasFan && (
        <>
          {/* View toggle: fan vs cone */}
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-mono text-deep-200/75 uppercase tracking-wider">
              视图
            </span>
            <div className="flex items-center gap-0.5 bg-deep-700/30 rounded border border-deep-400/45 p-0.5">
              <button
                onClick={() => coneViewEnabled && store.toggleConeView()}
                className={`px-3 py-1 rounded text-[14px] font-mono transition-all ${
                  !coneViewEnabled
                    ? 'bg-amber-300/15 text-amber-300/80 border border-amber-300/55'
                    : 'text-deep-200/85 hover:text-deep-200/95 border border-transparent'
                }`}
              >
                分支视图
              </button>
              <button
                onClick={() => !coneViewEnabled && store.toggleConeView()}
                className={`px-3 py-1 rounded text-[14px] font-mono transition-all ${
                  coneViewEnabled
                    ? 'bg-amber-300/15 text-amber-300/80 border border-amber-300/55'
                    : 'text-deep-200/85 hover:text-deep-200/95 border border-transparent'
                }`}
              >
                概率锥
              </button>
            </div>
          </div>

          {/* Cone visualization */}
          {coneViewEnabled ? (
            <ConeVisualization />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              <div className="min-w-0">
                <PossibilityFan />
              </div>
              <div className="min-w-0">
                <CounterfactualPanel />
              </div>
            </div>
          )}
        </>
      )}

      {/* Annotation Modal */}
      <AnnotationModal />
    </div>
  );
}
