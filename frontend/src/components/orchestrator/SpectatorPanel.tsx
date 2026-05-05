/**
 * SpectatorPanel — Real-time spectator dashboard (实时观战面板)
 *
 * Shows live stats during long-running philosophical debates:
 * - Current round and elapsed time
 * - Per-model cumulative word count bars
 * - Active persona indicator
 * - Estimated remaining time
 * - Token consumption rate
 *
 * Pure frontend — no extra backend calls needed.
 */

import { useMemo } from 'react';
import { useAutoLoopStore } from '../../store/autoLoopStore';

const PERSONA_COLORS: Record<string, { bar: string; text: string }> = {
  rationalist: { bar: 'bg-blue-400/40', text: 'text-blue-400/60' },
  existentialist: { bar: 'bg-rose-400/40', text: 'text-rose-400/60' },
  pragmatist: { bar: 'bg-emerald-400/40', text: 'text-emerald-400/60' },
  eastern_philosopher: { bar: 'bg-amber-400/40', text: 'text-amber-400/60' },
  critical_theorist: { bar: 'bg-purple-400/40', text: 'text-purple-400/60' },
  adversary: { bar: 'bg-red-400/40', text: 'text-red-400/60' },
};

const PERSONA_NAMES: Record<string, string> = {
  rationalist: '理性主义',
  existentialist: '存在主义',
  pragmatist: '实用主义',
  eastern_philosopher: '东方哲学',
  critical_theorist: '批判理论',
  adversary: '魔鬼代言人',
};

export function SpectatorPanel() {
  const {
    status,
    currentCycle,
    maxCycles,
    elapsedSeconds,
    totalPersonaWords,
    activePersonaId,
    adversarial,
    cycles,
  } = useAutoLoopStore();

  const isRunning = status === 'running';

  // Compute derived stats
  const stats = useMemo(() => {
    const maxWords = Math.max(1, ...Object.values(totalPersonaWords));
    const totalWords = Object.values(totalPersonaWords).reduce((a, b) => a + b, 0);

    // Estimate remaining time
    const completedCycles = currentCycle - 1;
    const avgSecondsPerCycle = completedCycles > 0 ? elapsedSeconds / completedCycles : 0;
    const remainingCycles = maxCycles - currentCycle + 1;
    const estimatedRemainingSeconds = Math.round(avgSecondsPerCycle * remainingCycles);

    // Words per minute
    const wpm = elapsedSeconds > 0 ? Math.round((totalWords / elapsedSeconds) * 60) : 0;

    return { maxWords, totalWords, avgSecondsPerCycle, estimatedRemainingSeconds, wpm };
  }, [totalPersonaWords, elapsedSeconds, currentCycle, maxCycles]);

  const formatTime = (seconds: number) => {
    if (seconds <= 0) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="glass border border-deep-400/10 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-deep-200/40 uppercase tracking-wider">
            观战面板
          </span>
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
          )}
        </div>
        <span className="text-[8px] font-mono text-deep-200/20">
          LIVE
        </span>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2">
        <MiniStat label="当前轮" value={`${currentCycle}/${maxCycles}`} />
        <MiniStat label="已用时" value={formatTime(elapsedSeconds)} />
        <MiniStat
          label="预计剩余"
          value={isRunning ? formatTime(stats.estimatedRemainingSeconds) : '--'}
        />
        <MiniStat label="产出速率" value={`${stats.wpm} 字/分`} />
      </div>

      {/* Per-persona word count bars */}
      <div className="space-y-1.5">
        <span className="text-[8px] font-mono text-deep-200/25 block">各模型累计产出</span>
        {Object.entries(totalPersonaWords)
          .sort(([, a], [, b]) => b - a)
          .map(([pid, count]) => {
            const colors = PERSONA_COLORS[pid] ?? { bar: 'bg-deep-400/30', text: 'text-deep-200/40' };
            const width = (count / stats.maxWords) * 100;
            const isActive = pid === activePersonaId;

            return (
              <div key={pid} className="flex items-center gap-2">
                <span className={`text-[8px] font-mono w-14 shrink-0 text-right ${colors.text}`}>
                  {PERSONA_NAMES[pid] ?? pid}
                </span>
                <div className="flex-1 h-3 bg-deep-700/20 rounded-sm overflow-hidden relative">
                  <div
                    className={`h-full rounded-sm transition-all duration-500 ${colors.bar}`}
                    style={{ width: `${width}%` }}
                  />
                  {isActive && (
                    <div className="absolute right-0 top-0 h-full w-1 bg-white/30 animate-pulse" />
                  )}
                </div>
                <span className="text-[8px] font-mono text-deep-200/25 w-10 text-right tabular-nums">
                  {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                </span>
              </div>
            );
          })}
      </div>

      {/* Active persona indicator */}
      {isRunning && activePersonaId && (
        <div className="flex items-center gap-2 pt-1 border-t border-deep-400/8">
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"
            style={{ color: PERSONA_COLORS[activePersonaId]?.text.replace('text-', '').replace('/60', '') || 'rgba(200,200,200,0.4)' }}
          />
          <span className="text-[9px] font-mono text-deep-200/35">
            正在发言: {PERSONA_NAMES[activePersonaId] ?? activePersonaId}
          </span>
        </div>
      )}

      {/* Adversarial badge */}
      {adversarial && (
        <div className="flex items-center gap-1.5 text-[8px] font-mono text-red-400/40 border-t border-deep-400/8 pt-2">
          <span>⚡</span>
          <span>对抗模式已启用</span>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <span className="text-[11px] font-mono text-white/60 block tabular-nums">{value}</span>
      <span className="text-[7px] font-mono text-deep-200/25 uppercase tracking-wider">{label}</span>
    </div>
  );
}
