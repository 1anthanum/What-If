/**
 * EvolutionChain — Animated hypothesis evolution visualization.
 *
 * Renders the chain of hypotheses as a vertical flowing timeline with:
 *   - Glowing amber nodes for each hypothesis
 *   - Animated connection lines with particle effects
 *   - Expanding synthesis previews
 *   - Pulse animation on the active node
 */

import { useState, useEffect, useRef } from 'react';
import { useAutoLoopStore, type CycleState } from '../../store/autoLoopStore';

export function EvolutionChain() {
  const { cycles, evolutionChain, currentCycle, status } = useAutoLoopStore();

  return (
    <div className="relative">
      {/* Vertical spine line */}
      <div className="absolute left-6 top-0 bottom-0 w-px">
        <div
          className="w-full h-full"
          style={{
            background: 'linear-gradient(180deg, rgba(196,144,88,0.4) 0%, rgba(196,144,88,0.1) 100%)',
          }}
        />
        {/* Animated particles flowing down */}
        {status === 'running' && (
          <>
            <div className="absolute left-0 w-px h-3 bg-amber-300/60 rounded-full animate-flow-particle" style={{ animationDelay: '0s' }} />
            <div className="absolute left-0 w-px h-3 bg-amber-300/40 rounded-full animate-flow-particle" style={{ animationDelay: '1.3s' }} />
            <div className="absolute left-0 w-px h-3 bg-amber-300/30 rounded-full animate-flow-particle" style={{ animationDelay: '2.6s' }} />
          </>
        )}
      </div>

      {/* Seed hypothesis (root) */}
      <div className="relative pl-14 pb-6">
        <NodeDot type="seed" active={currentCycle <= 1 && status === 'running'} />
        <div className="glass border border-amber-300/45 rounded-lg p-4">
          <span className="text-[14px] font-mono text-amber-300/85 uppercase tracking-widest">
            种子假设
          </span>
          <p className="text-xs text-white/70 mt-1 leading-relaxed">
            {evolutionChain[0]}
          </p>
        </div>
      </div>

      {/* Cycle nodes */}
      {cycles.map((cycle, idx) => (
        <CycleNode
          key={cycle.cycle}
          cycle={cycle}
          isActive={cycle.cycle === currentCycle && status === 'running'}
          isLast={idx === cycles.length - 1}
          chainHypothesis={evolutionChain[idx + 1]}
        />
      ))}

      {/* Terminal node */}
      {status === 'complete' && (
        <div className="relative pl-14 pt-2">
          <NodeDot type="terminal" active={false} />
          <div className="text-[15px] font-mono text-amber-300/85 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-earth-green/50" />
            探索完成
          </div>
        </div>
      )}
    </div>
  );
}

/* ──── Cycle Node ──── */

function CycleNode({
  cycle,
  isActive,
  isLast,
  chainHypothesis,
}: {
  cycle: CycleState;
  isActive: boolean;
  isLast: boolean;
  chainHypothesis?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand active node
  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  return (
    <div className="relative pl-14 pb-5">
      <NodeDot
        type="cycle"
        active={isActive}
        completed={!isActive && !!cycle.synthesisPreview}
      />

      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left rounded-lg p-4 transition-all duration-500 ${
          isActive
            ? 'glass border border-amber-300/55 shadow-glow-sm'
            : 'glass border border-deep-400/35 hover:border-amber-300/40'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <span className={`text-[15px] font-mono font-bold px-2 py-0.5 rounded-full border transition-all ${
            isActive
              ? 'bg-amber-300/15 text-amber-300/80 border-amber-300/25'
              : 'bg-deep-600/30 text-deep-200/85 border-deep-400/45'
          }`}>
            C{cycle.cycle}
          </span>

          {/* Active module indicator */}
          {isActive && cycle.activeModule && (
            <ModuleBadge module={cycle.activeModule} iteration={cycle.currentIteration} />
          )}

          <div className="flex-1" />
          <span className="text-[15px] text-deep-200/70">
            {expanded ? '▾' : '▸'}
          </span>
        </div>

        {/* Hypothesis */}
        <p className={`text-[15px] leading-relaxed transition-colors ${
          isActive ? 'text-white/70' : 'text-deep-200/50'
        }`}>
          {cycle.hypothesis.length > 120 && !expanded
            ? cycle.hypothesis.slice(0, 120) + '…'
            : cycle.hypothesis
          }
        </p>

        {/* Expanded content */}
        {expanded && cycle.synthesisPreview && (
          <div className="mt-3 pt-3 border-t border-deep-400/35 space-y-3 animate-fade-in">
            {/* Synthesis */}
            <div>
              <span className="text-[14px] font-mono text-amber-300/75 uppercase tracking-wider">
                综合结论
              </span>
              <p className="text-[14px] text-deep-200/45 leading-relaxed mt-1">
                {cycle.synthesisPreview}
              </p>
            </div>

            {/* Next hypothesis arrow */}
            {cycle.nextHypothesis && (
              <div className="flex items-start gap-2 bg-amber-300/5 border border-amber-300/40 rounded px-3 py-2">
                <span className="text-amber-300/85 text-xs mt-0.5">→</span>
                <div>
                  <span className="text-[14px] font-mono text-amber-300/75 uppercase tracking-wider">
                    演化方向
                  </span>
                  <p className="text-[14px] text-amber-300/90 leading-relaxed mt-0.5">
                    {cycle.nextHypothesis}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

/* ──── Node Dot ──── */

function NodeDot({
  type,
  active,
  completed,
}: {
  type: 'seed' | 'cycle' | 'terminal';
  active: boolean;
  completed?: boolean;
}) {
  return (
    <div className="absolute left-4 -translate-x-1/2 top-5 z-10">
      {/* Outer glow ring (active only) */}
      {active && (
        <div className="absolute -inset-2 rounded-full bg-amber-300/10 animate-pulse-slow" />
      )}
      {/* Inner ring */}
      <div className={`absolute -inset-1 rounded-full transition-all duration-500 ${
        active
          ? 'bg-amber-300/20 animate-ping-slow'
          : 'bg-transparent'
      }`} />
      {/* Core dot */}
      <div className={`relative w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
        type === 'seed'
          ? 'border-amber-300/55 bg-amber-300/20'
          : type === 'terminal'
            ? 'border-earth-green/40 bg-earth-green/15'
            : active
              ? 'border-amber-300/70 bg-amber-300/30 shadow-glow-sm'
              : completed
                ? 'border-amber-300/70 bg-amber-300/10'
                : 'border-deep-400/45 bg-deep-700/40'
      }`}>
        {type === 'seed' && (
          <span className="text-[7px] text-amber-300/80">◈</span>
        )}
        {type === 'terminal' && (
          <span className="text-[7px] text-earth-green/60">✓</span>
        )}
        {type === 'cycle' && completed && (
          <span className="text-[6px] text-amber-300/90">●</span>
        )}
        {type === 'cycle' && active && (
          <span className="text-[6px] text-amber-300/80 animate-pulse">◆</span>
        )}
      </div>
    </div>
  );
}

/* ──── Module Badge ──── */

const MODULE_MAP: Record<string, { label: string; icon: string }> = {
  counterfactual: { label: '反事实', icon: '◇' },
  causal: { label: '因果', icon: '◈' },
  debate: { label: '辩论', icon: '◆' },
  synthesizing: { label: '综合', icon: '⟐' },
};

function ModuleBadge({ module, iteration }: { module: string; iteration: number }) {
  const info = MODULE_MAP[module] || { label: module, icon: '·' };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-300/10 border border-amber-300/45 animate-fade-in">
      <span className="text-[14px] text-amber-300/95">{info.icon}</span>
      <span className="text-[14px] font-mono text-amber-300/90">
        {info.label}
        {iteration > 0 && <span className="text-amber-300/75"> i{iteration}</span>}
      </span>
    </span>
  );
}
