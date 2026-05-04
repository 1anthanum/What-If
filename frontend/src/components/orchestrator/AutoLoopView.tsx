/**
 * AutoLoopView — Autonomous Exploration UI with rich animations.
 *
 * Three states:
 *   1. Config: seed hypothesis input + cycle settings
 *   2. Running: live EvolutionChain + orbit HUD + elapsed timer
 *   3. Complete: full chain review + statistics
 */

import { useState, useEffect, useRef } from 'react';
import { useAutoLoopStore } from '../../store/autoLoopStore';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { EvolutionChain } from './EvolutionChain';
import type { AutoLoopConfig } from '../../services/api';

export function AutoLoopView() {
  const store = useAutoLoopStore();
  const cfStore = useCounterfactualStore();
  const {
    status,
    error,
    currentCycle,
    maxCycles,
    cycles,
    evolutionChain,
    stoppedReason,
    elapsedSeconds,
  } = store;

  const selectedEvent = cfStore.selectedEvent;
  const [seedHypothesis, setSeedHypothesis] = useState('');
  const [numCycles, setNumCycles] = useState(5);
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

  const handleStart = () => {
    if (!selectedEvent || !seedHypothesis.trim()) return;
    const config: AutoLoopConfig = {
      event_id: selectedEvent.id,
      seed_hypothesis: seedHypothesis.trim(),
      max_cycles: numCycles,
      max_iterations_per_loop: 2,
      time_horizon: '30 years',
    };
    store.start(config);
  };

  return (
    <div className="space-y-6 relative">
      {/* ── Background ambient pulse when running ── */}
      {status === 'running' && (
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full animate-breathe"
            style={{ background: 'radial-gradient(circle, rgba(196,144,88,0.03) 0%, transparent 70%)' }}
          />
        </div>
      )}

      {/* ══════ CONFIG STATE ══════ */}
      {status === 'idle' && (
        <div className="glass border border-amber-300/8 rounded-lg p-6 space-y-5 animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-300/20 to-amber-600/20 flex items-center justify-center border border-amber-300/20">
              <span className="text-amber-300/80 text-lg">∞</span>
            </div>
            <div>
              <h2 className="text-sm font-medium text-white/85">自主探索模式</h2>
              <p className="text-[10px] text-deep-200/40 leading-relaxed">
                系统自动循环推演，每轮从结论中提取新假设，持续深入探索因果链
              </p>
            </div>
          </div>

          {!selectedEvent && (
            <div className="text-xs text-amber-300/50 bg-amber-300/5 border border-amber-300/10 rounded-lg px-4 py-3">
              请先在「历史反事实」标签页中选择一个历史事件。
            </div>
          )}

          {selectedEvent && (
            <>
              <div className="bg-deep-700/30 border border-deep-400/10 rounded-lg px-4 py-3">
                <span className="text-[9px] font-mono text-deep-200/30 uppercase tracking-wider">选定事件</span>
                <p className="text-sm text-white/70 mt-1">{selectedEvent.title}</p>
              </div>

              <div>
                <label className="text-[10px] font-mono text-deep-200/40 uppercase tracking-wider mb-1.5 block">
                  种子假设 — 探索的起点
                </label>
                <textarea
                  value={seedHypothesis}
                  onChange={(e) => setSeedHypothesis(e.target.value)}
                  placeholder="例如：如果哈伯工艺的合成效率提高了 5 倍..."
                  rows={2}
                  className="w-full bg-deep-700/30 border border-deep-400/15 rounded-lg px-4 py-2.5 text-sm text-white/80 placeholder:text-deep-300/25 focus:outline-none focus:border-amber-300/25 resize-none transition-colors"
                />
              </div>

              <div className="flex items-end justify-between">
                <div className="space-y-2">
                  <label className="text-[9px] font-mono text-deep-200/30 uppercase tracking-wider block">
                    探索深度
                  </label>
                  <div className="flex items-center gap-3">
                    {[3, 5, 8, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setNumCycles(n)}
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-mono border transition-all ${
                          numCycles === n
                            ? 'bg-amber-300/15 text-amber-300/80 border-amber-300/25 shadow-glow-sm'
                            : 'bg-deep-700/30 text-deep-200/40 border-deep-400/15 hover:border-amber-300/15'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="text-[9px] font-mono text-deep-200/25">轮</span>
                  </div>
                </div>

                <button
                  onClick={handleStart}
                  disabled={!seedHypothesis.trim()}
                  className="group relative px-8 py-3 bg-gradient-to-r from-amber-300/80 to-amber-400/80 text-deep-950 text-xs font-bold rounded-lg hover:from-amber-300 hover:to-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-glow hover:shadow-glow-lg overflow-hidden"
                >
                  {/* Shimmer effect */}
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  <span className="relative">启动自主探索</span>
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
          <div className="glass border border-amber-300/12 rounded-lg p-4">
            <div className="flex items-center justify-between">
              {/* Left: status + timer */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    status === 'running' ? 'bg-amber-300/80 animate-pulse' : 'bg-deep-200/30'
                  }`} />
                  <span className="text-[10px] font-mono text-amber-300/60 uppercase tracking-wider">
                    {status === 'running' ? '探索中' : '已取消'}
                  </span>
                </div>
                <div className="text-sm font-mono text-amber-300/80 tabular-nums tracking-wider">
                  {formatTime(elapsedSeconds)}
                </div>
              </div>

              {/* Center: cycle progress */}
              <div className="flex items-center gap-2">
                {Array.from({ length: maxCycles }, (_, i) => (
                  <div
                    key={i}
                    className={`w-2.5 h-2.5 rounded-sm transition-all duration-500 ${
                      i + 1 < currentCycle
                        ? 'bg-amber-300/50'
                        : i + 1 === currentCycle
                          ? 'bg-amber-300/80 animate-pulse shadow-glow-sm'
                          : 'bg-deep-600/30'
                    }`}
                  />
                ))}
                <span className="text-[9px] font-mono text-deep-200/30 ml-1">
                  {currentCycle}/{maxCycles}
                </span>
              </div>

              {/* Right: cancel */}
              {status === 'running' && (
                <button
                  onClick={() => store.cancel()}
                  className="text-[10px] font-mono text-deep-200/40 hover:text-earth-rust/60 transition-colors px-3 py-1.5 border border-deep-400/15 rounded hover:border-earth-rust/20"
                >
                  停止探索
                </button>
              )}
            </div>

            {/* Orbit ring animation */}
            {status === 'running' && (
              <div className="mt-3 h-1 rounded-full bg-deep-600/20 overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${Math.min(5 + ((currentCycle - 1) / maxCycles) * 95, 98)}%`,
                    background: 'linear-gradient(90deg, rgba(196,144,88,0.3), rgba(196,144,88,0.7))',
                  }}
                />
                {/* Sweeping highlight */}
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="w-20 h-full animate-sweep"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(196,144,88,0.3), transparent)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Evolution Chain */}
          <EvolutionChain />
        </div>
      )}

      {/* ══════ ERROR STATE ══════ */}
      {status === 'error' && (
        <div className="glass border border-earth-rust/20 rounded-lg p-5 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-earth-rust/60" />
            <span className="text-[10px] font-mono text-earth-rust/60 uppercase tracking-wider">
              探索中断
            </span>
          </div>
          {error && <p className="text-xs text-earth-rust/50">{error}</p>}
          {/* Still show the chain if any cycles completed */}
          {cycles.length > 0 && <EvolutionChain />}
          <button
            onClick={() => store.reset()}
            className="text-[10px] font-mono text-amber-300/50 hover:text-amber-300 transition-colors"
          >
            重新开始
          </button>
        </div>
      )}

      {/* ══════ COMPLETE STATE ══════ */}
      {status === 'complete' && (
        <div className="space-y-6 animate-fade-in">
          {/* Summary stats */}
          <div className="glass border border-amber-300/12 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-earth-green/20 to-amber-300/20 flex items-center justify-center border border-earth-green/20">
                  <span className="text-earth-green/70 text-sm">✓</span>
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white/85">探索完成</h2>
                  <p className="text-[10px] font-mono text-deep-200/30 mt-0.5">
                    {cycles.length} 轮演化 · {formatTime(elapsedSeconds)} ·{' '}
                    {stoppedReason === 'converged' ? '已收敛' : '达到上限'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => store.reset()}
                className="text-[10px] font-mono text-deep-200/40 hover:text-amber-300/70 transition-colors px-3 py-1.5 border border-deep-400/15 rounded hover:border-amber-300/20"
              >
                新探索
              </button>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="演化步数" value={`${evolutionChain.length}`} icon="◈" />
              <StatCard label="探索深度" value={`${cycles.length} 轮`} icon="◇" />
              <StatCard
                label="终止原因"
                value={stoppedReason === 'converged' ? '收敛' : stoppedReason === 'max_cycles' ? '上限' : stoppedReason}
                icon={stoppedReason === 'converged' ? '◉' : '◆'}
              />
            </div>
          </div>

          {/* Hypothesis evolution summary */}
          <div className="glass border border-deep-400/8 rounded-lg p-5">
            <h3 className="text-[10px] font-mono text-amber-300/50 uppercase tracking-wider mb-3">
              假设演化路径
            </h3>
            <div className="space-y-2">
              {evolutionChain.map((hypo, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className={`text-[9px] font-mono font-bold mt-1 shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                    idx === 0
                      ? 'border-amber-300/30 bg-amber-300/10 text-amber-300/60'
                      : idx === evolutionChain.length - 1
                        ? 'border-earth-green/30 bg-earth-green/10 text-earth-green/60'
                        : 'border-deep-400/15 bg-deep-600/20 text-deep-200/40'
                  }`}>
                    {idx === 0 ? '◈' : idx + 1}
                  </span>
                  <p className={`text-[11px] leading-relaxed pt-0.5 ${
                    idx === 0 ? 'text-amber-300/60' : 'text-deep-200/50'
                  }`}>
                    {hypo}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Full chain visualization */}
          <EvolutionChain />
        </div>
      )}
    </div>
  );
}

/* ──── Stat Card ──── */

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="bg-deep-700/20 border border-deep-400/8 rounded-lg px-3 py-3 text-center">
      <span className="text-amber-300/30 text-sm block">{icon}</span>
      <span className="text-sm font-mono text-white/70 block mt-1">{value}</span>
      <span className="text-[8px] font-mono text-deep-200/30 uppercase tracking-wider">{label}</span>
    </div>
  );
}
