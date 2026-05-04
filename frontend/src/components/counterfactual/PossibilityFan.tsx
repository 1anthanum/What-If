import { useState } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { Timeline } from './Timeline';

const CATEGORY_COLORS: Record<string, string> = {
  economic: '#C49058',
  social: '#8BA888',
  environmental: '#6EBF8B',
  political: '#8B9FBF',
  military: '#BF8B8B',
  cultural: '#B8A088',
};

export function PossibilityFan() {
  const {
    possibilityBranches,
    selectedBranchIndex,
    selectBranch,
    totalExplorations,
    modification,
    tokenUsage,
    explorationMode,
    embodiedCoalitions,
  } = useCounterfactualStore();

  const isEmbodied = explorationMode === 'embodied';

  const [expandedBranch, setExpandedBranch] = useState<number | null>(null);

  if (!possibilityBranches.length) return null;

  return (
    <div className="space-y-6">
      {/* Fan header */}
      <div className="glass border border-amber-300/10 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-amber-300/20 to-amber-600/20 flex items-center justify-center border border-amber-300/20">
              <span className="text-amber-300/80 text-sm">◇</span>
            </div>
            <div>
              <h3 className="text-xs font-mono text-amber-300/80 uppercase tracking-wider">
                {isEmbodied ? '具身视角扇形图' : '可能性扇形图'}
              </h3>
              <p className="text-[9px] font-mono text-deep-200/40 mt-0.5">
                {totalExplorations} 次探索 → {possibilityBranches.length} 个{isEmbodied ? '行动者联盟' : '叙事方向'}
              </p>
            </div>
          </div>
          {tokenUsage && (
            <span className="text-[9px] font-mono text-deep-200/30 border border-deep-400/10 px-2 py-1 rounded">
              ${tokenUsage.estimated_cost_usd.toFixed(3)}
            </span>
          )}
        </div>

        {/* Modification reminder */}
        <div className="text-[10px] text-deep-200/50 bg-deep-700/30 rounded px-3 py-2 border border-deep-400/10">
          假设：「{modification}」
        </div>
      </div>

      {/* Branch cards — fan layout */}
      <div className="relative">
        {/* Connecting spine from origin */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-amber-300/30 via-amber-300/10 to-transparent" />

        <div className="space-y-3 pl-12">
          {possibilityBranches.map((branch, idx) => {
            const isSelected = selectedBranchIndex === idx;
            const isExpanded = expandedBranch === idx;
            const pct = Math.round(branch.consensus_strength * 100);

            return (
              <div key={branch.cluster_id} className="relative">
                {/* Branch connector line */}
                <div
                  className="absolute -left-6 top-5 w-6 h-px"
                  style={{
                    background: `linear-gradient(90deg, rgba(196,144,88,${0.1 + branch.consensus_strength * 0.4}), rgba(196,144,88,${0.05 + branch.consensus_strength * 0.2}))`,
                  }}
                />

                {/* Branch node dot */}
                <div
                  className="absolute -left-8 top-3 w-3 h-3 rounded-full border-2"
                  style={{
                    borderColor: `rgba(196,144,88,${0.3 + branch.consensus_strength * 0.5})`,
                    backgroundColor: `rgba(196,144,88,${branch.consensus_strength * 0.3})`,
                    boxShadow: isSelected
                      ? `0 0 8px rgba(196,144,88,0.3)`
                      : 'none',
                  }}
                />

                {/* Branch card */}
                <button
                  onClick={() => {
                    selectBranch(isSelected ? null : idx);
                    setExpandedBranch(isExpanded ? null : idx);
                  }}
                  className={`w-full text-left transition-all duration-300 rounded-lg border ${
                    isSelected
                      ? 'glass border-amber-300/20 shadow-glow-sm'
                      : 'bg-deep-800/40 border-deep-400/10 hover:border-deep-400/20'
                  }`}
                >
                  <div className="p-4">
                    {/* Top row: direction name + consensus badge */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <h4
                          className={`text-sm font-medium ${
                            isSelected ? 'text-amber-300/90' : 'text-deep-100/70'
                          }`}
                        >
                          {branch.narrative_direction}
                        </h4>
                        <p className="text-[10px] text-deep-200/40 mt-1 leading-relaxed">
                          {branch.explanation}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
                          style={{
                            color: `rgba(196,144,88,${0.5 + branch.consensus_strength * 0.5})`,
                            backgroundColor: `rgba(196,144,88,${branch.consensus_strength * 0.15})`,
                            border: `1px solid rgba(196,144,88,${branch.consensus_strength * 0.25})`,
                          }}
                        >
                          {pct}% 共识
                        </span>
                        <span className="text-[9px] font-mono text-deep-200/30">
                          {branch.scenario_count} 探索支持
                        </span>
                      </div>
                    </div>

                    {/* Coalition details (embodied mode) */}
                    {isEmbodied && (() => {
                      const coalition = embodiedCoalitions.find(
                        (c) => c.coalition_name === branch.narrative_direction
                      );
                      if (!coalition) return null;
                      return (
                        <div className="mb-2 mt-1">
                          <div className="flex flex-wrap gap-1 mb-1">
                            {coalition.members.map((member, mi) => (
                              <span
                                key={mi}
                                className="text-[8px] bg-amber-300/10 text-amber-300/60 rounded-full px-2 py-0.5 border border-amber-300/15"
                              >
                                {member}
                              </span>
                            ))}
                          </div>
                          {coalition.shared_interest && (
                            <p className="text-[9px] text-deep-200/35 italic">
                              共同利益: {coalition.shared_interest}
                            </p>
                          )}
                          {coalition.conflict_points.length > 0 && (
                            <p className="text-[9px] text-earth-rust/40 mt-0.5">
                              内部分歧: {coalition.conflict_points.join('、')}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Consensus bar */}
                    <div className="h-1 rounded-full bg-deep-600/30 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background: `linear-gradient(90deg, rgba(196,144,88,0.4), rgba(196,144,88,0.8))`,
                        }}
                      />
                    </div>

                    {/* Key divergences preview */}
                    {branch.key_divergences.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {branch.key_divergences.slice(0, 3).map((d, i) => (
                          <span
                            key={i}
                            className="text-[9px] text-deep-200/40 bg-deep-700/30 rounded px-1.5 py-0.5 border border-deep-400/10"
                          >
                            {d.length > 30 ? d.slice(0, 30) + '…' : d}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>

                {/* Expanded timeline */}
                {isExpanded && branch.timeline_points.length > 0 && (
                  <div className="mt-3 glass border border-amber-300/8 rounded-lg p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <h4 className="text-[10px] font-mono text-amber-300/50 uppercase tracking-wider">
                        {branch.narrative_direction} — 完整时间线
                      </h4>
                      <span className="text-[9px] font-mono text-deep-200/30">
                        {branch.timeline_points.length} 个时间点
                      </span>
                    </div>

                    {/* Inline mini-timeline */}
                    <BranchTimeline points={branch.timeline_points} />

                    {/* Summary */}
                    {branch.summary && (
                      <div className="mt-4 pt-3 border-t border-deep-400/10">
                        <h5 className="text-[9px] font-mono text-deep-200/40 uppercase tracking-wider mb-1.5">
                          分析摘要
                        </h5>
                        <p className="text-xs text-deep-100/60 leading-relaxed">
                          {branch.summary}
                        </p>
                      </div>
                    )}

                    {/* Butterfly effects */}
                    {branch.butterfly_effects.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-deep-400/10">
                        <h5 className="text-[9px] font-mono text-amber-300/40 uppercase tracking-wider mb-1.5">
                          蝴蝶效应
                        </h5>
                        <div className="space-y-1">
                          {branch.butterfly_effects.map((be, i) => (
                            <p key={i} className="text-[11px] text-amber-300/50 leading-relaxed">
                              ◈ {be}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Inline Branch Timeline ─────────────────────────────────

interface BranchTimelineProps {
  points: Array<{
    year: number;
    actual: string;
    counterfactual: string;
    divergence_level: number;
    confidence: number;
    reasoning: string;
    category: string;
  }>;
}

function BranchTimeline({ points }: BranchTimelineProps) {
  const [expandedYear, setExpandedYear] = useState<number | null>(null);

  return (
    <div className="space-y-0">
      {points.map((point, idx) => {
        const isExpanded = expandedYear === point.year;
        const catColor = CATEGORY_COLORS[point.category] || '#8B9FBF';
        const divergePct = Math.round(point.divergence_level * 100);

        return (
          <div key={`${point.year}-${idx}`} className="relative">
            <div className="flex items-stretch min-h-[56px]">
              {/* Left: Actual */}
              <div className="flex-1 pr-4 flex justify-end">
                <p className="text-[10px] text-deep-200/40 leading-relaxed max-w-[200px] text-right">
                  {point.actual}
                </p>
              </div>

              {/* Center: Year */}
              <div className="relative flex flex-col items-center z-10 w-16 shrink-0">
                {idx > 0 && (
                  <div className="absolute top-0 bottom-1/2 w-px bg-deep-400/15" />
                )}
                {idx < points.length - 1 && (
                  <div className="absolute top-1/2 bottom-0 w-px bg-deep-400/15" />
                )}
                <button
                  onClick={() => setExpandedYear(isExpanded ? null : point.year)}
                  className="relative z-10"
                >
                  <div
                    className="w-8 h-8 rounded-full border flex items-center justify-center transition-all hover:scale-110"
                    style={{
                      borderColor: `${catColor}60`,
                      backgroundColor: `${catColor}15`,
                    }}
                  >
                    <span className="text-[8px] font-mono font-bold text-white/70">
                      {point.year}
                    </span>
                  </div>
                </button>
              </div>

              {/* Right: Counterfactual */}
              <div className="flex-1 pl-4">
                <p className="text-[10px] text-amber-300/60 leading-relaxed max-w-[200px]">
                  {point.counterfactual}
                </p>
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mx-auto max-w-md my-2 p-3 bg-deep-700/30 border border-deep-400/10 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="px-1.5 py-0.5 rounded text-[8px] font-mono uppercase"
                    style={{
                      backgroundColor: `${catColor}20`,
                      color: catColor,
                      border: `1px solid ${catColor}30`,
                    }}
                  >
                    {point.category}
                  </span>
                  <span className="text-[8px] font-mono text-deep-200/40">
                    偏离 {divergePct}% · 置信 {Math.round(point.confidence * 100)}%
                  </span>
                </div>
                <p className="text-[10px] text-deep-100/60 leading-relaxed">
                  {point.reasoning}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
