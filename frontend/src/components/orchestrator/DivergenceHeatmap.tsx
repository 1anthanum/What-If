/**
 * DivergenceHeatmap — Epistemic Divergence Map (认知分歧热力图)
 *
 * Renders a model × argument position matrix as an interactive heatmap.
 * Colors: -1 (strong disagree, red) → 0 (neutral, gray) → +1 (strong agree, blue).
 * Shows cross-cycle evolution when multiple cycles have stances.
 */

import { useMemo } from 'react';
import type { StanceMatrix } from '../../services/api';
import type { CycleState } from '../../store/autoLoopStore';

const PERSONA_LABELS: Record<string, string> = {
  rationalist: '理性主义',
  existentialist: '存在主义',
  pragmatist: '实用主义',
  eastern_philosopher: '东方哲学',
  critical_theorist: '批判理论',
  adversary: '魔鬼代言人',
};

function stanceColor(score: number): string {
  if (score === 0) return 'rgba(100, 100, 120, 0.15)';
  if (score > 0) {
    const intensity = Math.min(score, 1);
    return `rgba(96, 165, 250, ${0.15 + intensity * 0.55})`; // blue
  }
  const intensity = Math.min(Math.abs(score), 1);
  return `rgba(239, 68, 68, ${0.15 + intensity * 0.55})`; // red
}

function stanceText(score: number): string {
  if (Math.abs(score) < 0.15) return '·';
  return score > 0 ? `+${score.toFixed(1)}` : score.toFixed(1);
}

interface Props {
  cycles: CycleState[];
  selectedCycleIndex?: number;
}

export function DivergenceHeatmap({ cycles, selectedCycleIndex }: Props) {
  const cyclesWithStances = useMemo(
    () => cycles.filter((c) => c.stanceMatrix && c.stanceMatrix.arguments.length > 0),
    [cycles],
  );

  if (cyclesWithStances.length === 0) {
    return null;
  }

  const displayCycle =
    selectedCycleIndex !== undefined
      ? cyclesWithStances[selectedCycleIndex] ?? cyclesWithStances[cyclesWithStances.length - 1]
      : cyclesWithStances[cyclesWithStances.length - 1];

  const matrix = displayCycle.stanceMatrix!;
  const personaIds = Object.keys(matrix.stances);

  return (
    <div className="glass border border-purple-400/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-purple-400/50 uppercase tracking-wider">
            认知分歧矩阵
          </span>
          <span className="text-[8px] font-mono text-deep-200/25">
            第 {displayCycle.cycle} 轮
          </span>
        </div>
        <div className="flex items-center gap-3 text-[8px] font-mono text-deep-200/30">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(239,68,68,0.5)' }} />
            反对
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(100,100,120,0.2)' }} />
            中立
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'rgba(96,165,250,0.5)' }} />
            支持
          </span>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-[8px] font-mono text-deep-200/30 text-left pr-2 pb-2 w-20" />
              {matrix.arguments.map((arg, i) => (
                <th
                  key={i}
                  className="text-[8px] font-mono text-deep-200/40 pb-2 px-1 text-center max-w-[80px] truncate"
                  title={arg}
                >
                  {arg}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {personaIds.map((pid) => (
              <tr key={pid}>
                <td className="text-[9px] font-mono text-deep-200/45 pr-2 py-0.5 whitespace-nowrap">
                  {PERSONA_LABELS[pid] ?? pid}
                </td>
                {matrix.stances[pid]?.map((score, i) => (
                  <td key={i} className="px-0.5 py-0.5">
                    <div
                      className="rounded text-center text-[9px] font-mono py-1.5 transition-all hover:scale-110 cursor-default"
                      style={{ background: stanceColor(score) }}
                      title={`${PERSONA_LABELS[pid] ?? pid}: ${matrix.arguments[i]} = ${score}`}
                    >
                      <span className={score === 0 ? 'text-deep-200/20' : score > 0 ? 'text-blue-300/70' : 'text-red-300/70'}>
                        {stanceText(score)}
                      </span>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cross-cycle evolution indicator */}
      {cyclesWithStances.length > 1 && (
        <div className="pt-2 border-t border-deep-400/8">
          <span className="text-[8px] font-mono text-deep-200/25 block mb-1">
            轮次演化 ({cyclesWithStances.length} 轮数据)
          </span>
          <div className="flex gap-1">
            {cyclesWithStances.map((c, i) => (
              <div
                key={c.cycle}
                className={`w-5 h-1.5 rounded-sm transition-all cursor-pointer ${
                  c.cycle === displayCycle.cycle
                    ? 'bg-purple-400/50'
                    : 'bg-deep-400/15 hover:bg-purple-400/20'
                }`}
                title={`第 ${c.cycle} 轮`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
