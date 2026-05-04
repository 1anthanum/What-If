import { useCounterfactualStore } from '../../store/counterfactualStore';

const DOMAIN_LABELS: Record<string, string> = {
  agriculture: '农业',
  technology: '科技',
  geopolitics: '地缘政治',
  economics: '经济',
};

const CONSTRAINT_LABELS: Record<string, string> = {
  factual_error: '事实错误',
  missing_factor: '缺失因素',
  domain_knowledge: '领域知识',
};

export function CounterfactualPanel() {
  const {
    selectedEvent,
    summary,
    keyDivergences,
    butterflyEffects,
    status,
    streamingText,
    explorationMode,
    possibilityBranches,
    selectedBranchIndex,
    totalExplorations,
    explorationClusters,
    // Falsification
    falsifyStatus,
    vulnerabilityIndex,
    vulnerabilityPoints,
    methodologyNote,
    strongestClaimYear,
    weakestClaimYear,
    falsifyTimeline,
    clearFalsification,
    // Annotations
    annotations,
    removeAnnotation,
    regenerateWithConstraints,
    timelineId,
  } = useCounterfactualStore();

  if (!selectedEvent) return null;

  // In explore mode, show selected branch details
  const selectedBranch =
    explorationMode === 'explore' && selectedBranchIndex !== null
      ? possibilityBranches[selectedBranchIndex]
      : null;

  return (
    <div className="space-y-5">
      {/* Event Info Card */}
      <div className="glass border border-amber-300/8 rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-medium text-white/90">
            {selectedEvent.title}
          </h3>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-amber-300/10 text-amber-300/60 border border-amber-300/15">
            {selectedEvent.period}
          </span>
        </div>
        <p className="text-[11px] text-deep-200/50 leading-relaxed">
          {selectedEvent.description}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-mono text-deep-200/30">
            {DOMAIN_LABELS[selectedEvent.domain] || selectedEvent.domain}
          </span>
          <span className="text-deep-400/20">·</span>
          <span className="text-[9px] font-mono text-deep-200/30">
            {selectedEvent.region}
          </span>
          <span className="text-deep-400/20">·</span>
          <span className="text-[9px] font-mono text-deep-200/30">
            {selectedEvent.decision_nodes.length} 个决策节点
          </span>
        </div>
      </div>

      {/* Key Data Points */}
      {selectedEvent.key_data_points.length > 0 && (
        <div className="glass border border-deep-400/8 rounded-lg p-4">
          <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-3">
            关键数据
          </h4>
          <div className="space-y-2">
            {selectedEvent.key_data_points.map((dp, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between text-[11px]"
              >
                <span className="text-deep-200/40 font-mono mr-2 shrink-0">
                  {dp.year}
                </span>
                <span className="text-deep-200/60 flex-1 truncate">
                  {dp.metric}
                </span>
                <span className="text-amber-300/60 font-mono ml-2 shrink-0 text-right max-w-[140px] truncate">
                  {dp.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decision Nodes */}
      <div className="glass border border-deep-400/8 rounded-lg p-4">
        <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-3">
          决策节点
        </h4>
        <div className="space-y-3">
          {selectedEvent.decision_nodes.map((dn) => (
            <div
              key={dn.id}
              className="border-l-2 border-amber-300/20 pl-3 py-1"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] font-mono text-amber-300/50 bg-amber-300/8 px-1.5 py-0.5 rounded">
                  {dn.year}
                </span>
                <span className="text-xs text-white/80 font-medium">
                  {dn.title}
                </span>
              </div>
              <p className="text-[10px] text-deep-200/40 leading-relaxed">
                {dn.description}
              </p>
              <p className="text-[10px] text-deep-200/30 mt-0.5 italic">
                → {dn.actual_outcome}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Streaming Text (while generating — single mode) */}
      {status === 'generating' && explorationMode === 'single' && streamingText && (
        <div className="glass border border-amber-300/10 rounded-lg p-4">
          <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-2">
            AI 推演中...
          </h4>
          <div className="text-[11px] text-deep-200/50 leading-relaxed max-h-48 overflow-y-auto font-mono">
            {streamingText.slice(-600)}
            <span className="inline-block w-1.5 h-3 bg-amber-300/50 ml-0.5 animate-pulse" />
          </div>
        </div>
      )}

      {/* Analysis Summary (single mode — after completion) */}
      {status === 'complete' && explorationMode === 'single' && summary && (
        <div className="glass border border-amber-300/10 rounded-lg p-4 space-y-4">
          <div>
            <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-2">
              分析摘要
            </h4>
            <p className="text-xs text-deep-100/70 leading-relaxed whitespace-pre-line">
              {summary}
            </p>
          </div>

          {keyDivergences.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-2">
                关键分歧
              </h4>
              <div className="space-y-1.5">
                {keyDivergences.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-amber-300/40 mt-0.5 shrink-0">◇</span>
                    <span className="text-deep-200/60">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {butterflyEffects.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider mb-2">
                蝴蝶效应
              </h4>
              <div className="space-y-1.5">
                {butterflyEffects.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="text-earth-rust/60 mt-0.5 shrink-0">⟡</span>
                    <span className="text-deep-200/60">{b}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Falsification Engine ─────────────────────────── */}
      {status === 'complete' && explorationMode === 'single' && timelineId && (
        <div className="glass border border-deep-400/8 rounded-lg p-4 space-y-3">
          <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider">
            证伪引擎
          </h4>

          {falsifyStatus === 'idle' && (
            <button
              onClick={() => falsifyTimeline()}
              className="w-full py-2 rounded border border-red-400/20 bg-red-500/[0.06] text-xs font-mono text-red-300/60 hover:text-red-300/90 hover:bg-red-500/[0.12] transition-colors"
            >
              ⚔ 运行证伪分析
            </button>
          )}

          {falsifyStatus === 'running' && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-3 h-3 border-2 border-red-300/40 border-t-red-300/80 rounded-full animate-spin" />
              <span className="text-[11px] text-red-300/50 font-mono">对抗性分析中...</span>
            </div>
          )}

          {falsifyStatus === 'complete' && vulnerabilityIndex !== null && (
            <div className="space-y-3">
              {/* Overall index gauge */}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-deep-200/40">整体脆弱指数</span>
                  <span className="text-[10px] font-mono text-red-300/70">
                    {Math.round(vulnerabilityIndex * 100)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-deep-600/30 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.round(vulnerabilityIndex * 100)}%`,
                      background: `linear-gradient(90deg, rgba(220,80,60,0.4), rgba(220,80,60,0.9))`,
                    }}
                  />
                </div>
              </div>

              {/* Strongest / Weakest */}
              <div className="grid grid-cols-2 gap-2">
                {strongestClaimYear && (
                  <div className="p-2 rounded bg-green-500/[0.06] border border-green-400/10 text-center">
                    <p className="text-[9px] text-green-300/50 font-mono mb-0.5">最强论点</p>
                    <p className="text-sm font-mono text-green-300/70">{strongestClaimYear}</p>
                  </div>
                )}
                {weakestClaimYear && (
                  <div className="p-2 rounded bg-red-500/[0.06] border border-red-400/10 text-center">
                    <p className="text-[9px] text-red-300/50 font-mono mb-0.5">最弱论点</p>
                    <p className="text-sm font-mono text-red-300/70">{weakestClaimYear}</p>
                  </div>
                )}
              </div>

              {/* Vulnerability points sorted by severity */}
              <div className="pt-2 border-t border-deep-400/10">
                <h5 className="text-[9px] font-mono text-deep-200/30 uppercase tracking-wider mb-2">
                  脆弱点（按严重度）
                </h5>
                {[...vulnerabilityPoints]
                  .sort((a, b) => b.severity - a.severity)
                  .map((vp, i) => (
                    <div key={i} className="mb-2 border-l-2 pl-2 py-0.5" style={{
                      borderColor: `rgba(220,80,60,${0.2 + vp.severity * 0.6})`,
                    }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[9px] font-mono text-red-300/50 bg-red-500/10 px-1 py-0.5 rounded">
                          {vp.year}
                        </span>
                        <span className="text-[9px] font-mono text-red-300/40">
                          {Math.round(vp.severity * 100)}%
                        </span>
                      </div>
                      <p className="text-[10px] text-deep-200/50 leading-relaxed">{vp.attack_vector}</p>
                    </div>
                  ))}
              </div>

              {/* Methodology note */}
              {methodologyNote && (
                <p className="text-[10px] text-deep-200/25 italic leading-relaxed pt-2 border-t border-deep-400/10">
                  {methodologyNote}
                </p>
              )}

              <button
                onClick={() => clearFalsification()}
                className="w-full py-1.5 rounded border border-deep-400/10 text-[10px] font-mono text-deep-200/30 hover:text-deep-200/50 transition-colors"
              >
                清除证伪结果
              </button>
            </div>
          )}

          {falsifyStatus === 'error' && (
            <div className="text-[11px] text-red-300/60 py-1">
              证伪分析失败，请重试
              <button
                onClick={() => falsifyTimeline()}
                className="ml-2 underline hover:text-red-300/80"
              >
                重试
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── User Annotations ─────────────────────────── */}
      {status === 'complete' && explorationMode === 'single' && timelineId && (
        <div className="glass border border-deep-400/8 rounded-lg p-4 space-y-3">
          <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider">
            用户标注 ({annotations.length})
          </h4>

          {annotations.length === 0 ? (
            <p className="text-[10px] text-deep-200/25 font-mono">
              展开时间点，点击「添加标注」修正 AI 推演
            </p>
          ) : (
            <div className="space-y-2">
              {annotations.map(ann => (
                <div key={ann.year} className="p-2 rounded bg-blue-500/[0.04] border border-blue-400/10">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-blue-300/60 bg-blue-500/10 px-1 py-0.5 rounded">
                        {ann.year}
                      </span>
                      <span className="text-[9px] font-mono text-blue-300/40">
                        {CONSTRAINT_LABELS[ann.constraint_type] || ann.constraint_type}
                      </span>
                    </div>
                    <button
                      onClick={() => removeAnnotation(ann.year)}
                      className="text-[10px] text-deep-200/25 hover:text-red-300/60 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-[10px] text-blue-200/60 leading-relaxed">{ann.correction}</p>
                </div>
              ))}

              <button
                onClick={() => regenerateWithConstraints()}
                className="w-full py-2 rounded border border-blue-400/20 bg-blue-500/[0.06] text-xs font-mono text-blue-300/60 hover:text-blue-300/90 hover:bg-blue-500/[0.12] transition-colors"
              >
                ✦ 基于修正重新生成
              </button>
            </div>
          )}
        </div>
      )}

      {/* Explore Mode: Exploration Statistics */}
      {explorationMode === 'explore' && status === 'complete' && possibilityBranches.length > 0 && (
        <div className="glass border border-amber-300/10 rounded-lg p-4 space-y-3">
          <h4 className="text-[10px] font-mono text-amber-300/40 uppercase tracking-wider">
            探索统计
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-deep-200/40">总探索数</span>
              <span className="text-amber-300/60 font-mono">{totalExplorations}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-deep-200/40">叙事方向</span>
              <span className="text-amber-300/60 font-mono">{possibilityBranches.length}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-deep-200/40">最高共识度</span>
              <span className="text-amber-300/60 font-mono">
                {Math.round((possibilityBranches[0]?.consensus_strength || 0) * 100)}%
              </span>
            </div>
          </div>

          {/* Cluster overview */}
          <div className="pt-2 border-t border-deep-400/10">
            <h5 className="text-[9px] font-mono text-deep-200/30 uppercase tracking-wider mb-2">
              方向分布
            </h5>
            {possibilityBranches.map((b, i) => (
              <div key={b.cluster_id} className="mb-2">
                <div className="flex justify-between mb-0.5">
                  <span className={`text-[10px] ${
                    selectedBranchIndex === i ? 'text-amber-300/80' : 'text-deep-200/50'
                  }`}>
                    {b.narrative_direction}
                  </span>
                  <span className="text-[9px] font-mono text-deep-200/30">
                    {Math.round(b.consensus_strength * 100)}%
                  </span>
                </div>
                <div className="h-1 rounded-full bg-deep-600/20 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round(b.consensus_strength * 100)}%`,
                      backgroundColor: selectedBranchIndex === i
                        ? 'rgba(196,144,88,0.7)'
                        : 'rgba(196,144,88,0.3)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explore Mode: Selected Branch Details */}
      {selectedBranch && (
        <div className="glass border border-amber-300/15 rounded-lg p-4 space-y-4">
          <div>
            <h4 className="text-[10px] font-mono text-amber-300/50 uppercase tracking-wider mb-1">
              选中方向
            </h4>
            <p className="text-sm text-amber-300/80 font-medium">
              {selectedBranch.narrative_direction}
            </p>
          </div>

          <p className="text-[11px] text-deep-200/50 leading-relaxed">
            {selectedBranch.explanation}
          </p>

          <div className="flex items-center gap-3 text-[9px] font-mono text-deep-200/30">
            <span>{selectedBranch.scenario_count} 个探索支持</span>
            <span>·</span>
            <span>共识度 {Math.round(selectedBranch.consensus_strength * 100)}%</span>
            <span>·</span>
            <span>{selectedBranch.timeline_points.length} 个时间点</span>
          </div>

          {/* Branch summary */}
          {selectedBranch.summary && (
            <div className="pt-3 border-t border-deep-400/10">
              <h5 className="text-[9px] font-mono text-amber-300/40 uppercase tracking-wider mb-1.5">
                分析摘要
              </h5>
              <p className="text-[11px] text-deep-100/60 leading-relaxed">
                {selectedBranch.summary}
              </p>
            </div>
          )}

          {/* Branch key divergences */}
          {selectedBranch.key_divergences.length > 0 && (
            <div className="pt-3 border-t border-deep-400/10">
              <h5 className="text-[9px] font-mono text-amber-300/40 uppercase tracking-wider mb-1.5">
                关键分歧
              </h5>
              <div className="space-y-1">
                {selectedBranch.key_divergences.map((d, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span className="text-amber-300/40 mt-0.5 shrink-0">◇</span>
                    <span className="text-deep-200/50">{d}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch butterfly effects */}
          {selectedBranch.butterfly_effects.length > 0 && (
            <div className="pt-3 border-t border-deep-400/10">
              <h5 className="text-[9px] font-mono text-amber-300/40 uppercase tracking-wider mb-1.5">
                蝴蝶效应
              </h5>
              <div className="space-y-1">
                {selectedBranch.butterfly_effects.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-[10px]">
                    <span className="text-earth-rust/50 mt-0.5 shrink-0">⟡</span>
                    <span className="text-deep-200/50">{b}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Explore Mode: No branch selected hint */}
      {explorationMode === 'explore' && status === 'complete' && possibilityBranches.length > 0 && selectedBranchIndex === null && (
        <div className="text-center py-4">
          <p className="text-[10px] text-deep-200/25 font-mono">
            ← 点击左侧分支查看详情
          </p>
        </div>
      )}
    </div>
  );
}
