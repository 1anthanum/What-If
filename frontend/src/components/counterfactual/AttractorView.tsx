import { useState } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';

/**
 * AttractorView — 吸引子检测面板
 *
 * 用户输入 3-5 个不同的反事实假设，系统对每个假设运行 Ensemble 探索，
 * 然后跨 fan 分析，发现无论怎么改变历史都会收敛到的"吸引子"结局。
 */
export function AttractorView() {
  const store = useCounterfactualStore();
  const {
    selectedEvent,
    attractorStatus,
    attractorAnalysis,
    attractorProgress,
    attractorModifications,
    status,
    error,
    tokenUsage,
  } = store;

  const [inputText, setInputText] = useState('');

  const addModification = () => {
    const text = inputText.trim();
    if (!text || attractorModifications.includes(text)) return;
    store.setAttractorModifications([...attractorModifications, text]);
    setInputText('');
  };

  const removeModification = (idx: number) => {
    store.setAttractorModifications(
      attractorModifications.filter((_, i) => i !== idx),
    );
  };

  const canStart = attractorModifications.length >= 2 && attractorStatus === 'idle';
  const isRunning = attractorStatus === 'exploring' || attractorStatus === 'analyzing';

  return (
    <div className="space-y-6">
      {/* Input Section */}
      {attractorStatus === 'idle' && !attractorAnalysis && (
        <div className="glass border border-amber-300/8 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-xs font-mono text-amber-300/50 uppercase tracking-wider mb-1">
              吸引子检测
            </h3>
            <p className="text-[10px] text-deep-200/35 leading-relaxed">
              输入 2-5 个不同的反事实假设。系统将对每个假设运行 Ensemble 探索，
              然后分析哪些历史结局无论假设怎么变都会出现——这些就是历史的"吸引子"。
            </p>
          </div>

          {/* Modification list */}
          {attractorModifications.length > 0 && (
            <div className="space-y-2">
              {attractorModifications.map((mod, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 bg-deep-700/30 border border-deep-400/10 rounded-lg px-3 py-2"
                >
                  <span className="text-[9px] font-mono text-amber-300/40 bg-amber-300/10 rounded w-5 h-5 flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-[11px] text-white/70 flex-1 leading-snug">
                    {mod}
                  </span>
                  <button
                    onClick={() => removeModification(idx)}
                    className="text-[9px] text-earth-rust/40 hover:text-earth-rust/70 transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add input */}
          {attractorModifications.length < 5 && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addModification()}
                placeholder={`输入第 ${attractorModifications.length + 1} 个反事实假设...`}
                className="flex-1 bg-deep-700/30 border border-deep-400/15 rounded-lg px-4 py-2.5 text-sm text-white/80 placeholder:text-deep-300/25 focus:outline-none focus:border-amber-300/25"
              />
              <button
                onClick={addModification}
                disabled={!inputText.trim()}
                className="px-3 py-2.5 text-[10px] font-mono text-amber-300/70 border border-amber-300/20 rounded-lg hover:bg-amber-300/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                添加
              </button>
            </div>
          )}

          {/* Suggested modifications from event */}
          {selectedEvent?.default_modification && attractorModifications.length === 0 && (
            <button
              onClick={() => {
                store.setAttractorModifications([selectedEvent.default_modification]);
              }}
              className="text-[10px] text-amber-300/30 hover:text-amber-300/60 transition-colors font-mono"
            >
              使用推荐假设作为起点 →
            </button>
          )}

          {/* Start button */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-[9px] font-mono text-deep-200/25">
              {attractorModifications.length}/5 个假设 · 成本约 $0.30-$0.60
            </span>
            <button
              onClick={() => store.detectAttractors()}
              disabled={!canStart}
              className="px-5 py-2 bg-gradient-to-r from-amber-300/80 to-amber-400/80 text-deep-950 text-xs font-semibold rounded-lg hover:from-amber-300 hover:to-amber-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-glow-sm hover:shadow-glow"
            >
              检测历史吸引子
            </button>
          </div>
        </div>
      )}

      {/* Running Progress */}
      {isRunning && (
        <div className="glass border border-amber-300/10 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono text-amber-300/60 uppercase tracking-wider">
              吸引子检测
            </h3>
            <span className="text-[10px] font-mono text-deep-200/40">
              {attractorStatus === 'exploring'
                ? `探索中 ${attractorProgress.current}/${attractorProgress.total}`
                : '跨 Fan 分析中...'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 rounded-full bg-deep-600/30 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: attractorStatus === 'exploring'
                  ? `${attractorProgress.total > 0
                      ? (attractorProgress.current / attractorProgress.total) * 80
                      : 5}%`
                  : '90%',
                background: 'linear-gradient(90deg, rgba(196,144,88,0.5), rgba(196,144,88,0.9))',
              }}
            />
          </div>

          {/* Steps */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-mono font-bold border transition-all ${
                attractorStatus === 'exploring'
                  ? 'border-amber-300/50 bg-amber-300/15 text-amber-300/90 shadow-glow-sm'
                  : 'border-amber-300/30 bg-amber-300/10 text-amber-300/60'
              }`}>
                {attractorStatus === 'analyzing' ? '✓' : '1'}
              </div>
              <span className={`text-[9px] font-mono ${
                attractorStatus === 'exploring' ? 'text-amber-300/70' : 'text-deep-200/40'
              }`}>
                多假设 Ensemble 探索
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-mono font-bold border transition-all ${
                attractorStatus === 'analyzing'
                  ? 'border-amber-300/50 bg-amber-300/15 text-amber-300/90 shadow-glow-sm'
                  : 'border-deep-400/20 bg-deep-700/30 text-deep-200/30'
              }`}>
                2
              </div>
              <span className={`text-[9px] font-mono ${
                attractorStatus === 'analyzing' ? 'text-amber-300/70' : 'text-deep-200/20'
              }`}>
                跨 Fan 收敛分析
              </span>
            </div>
          </div>

          <p className="text-[10px] text-deep-200/30 font-mono">
            {attractorStatus === 'exploring' && '正在对每个假设运行 Ensemble 可能性探索...'}
            {attractorStatus === 'analyzing' && '正在分析所有探索结果，寻找跨假设的收敛结局...'}
          </p>
        </div>
      )}

      {/* Error */}
      {attractorStatus === 'error' && error && (
        <div className="glass border border-earth-rust/20 rounded-lg p-4 text-center">
          <p className="text-xs text-earth-rust/70">{error}</p>
          <button
            onClick={() => store.detectAttractors()}
            className="mt-2 text-[10px] font-mono text-amber-300/50 hover:text-amber-300 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Results */}
      {attractorAnalysis && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white/85">
                吸引子分析结果
              </h3>
              <p className="text-[10px] font-mono text-deep-200/30 mt-0.5">
                {attractorAnalysis.modifications_tested.length} 个假设 ·{' '}
                {attractorAnalysis.attractors.length} 个吸引子 ·{' '}
                {attractorAnalysis.divergent_outcomes.length} 个独特结局
              </p>
            </div>
            <button
              onClick={() => store.clearAttractors()}
              className="text-[10px] font-mono text-deep-200/40 hover:text-amber-300/70 transition-colors px-2 py-1 border border-deep-400/15 rounded hover:border-amber-300/20"
            >
              重新检测
            </button>
          </div>

          {/* Tested modifications */}
          <div className="glass border border-deep-400/8 rounded-lg p-4">
            <h4 className="text-[10px] font-mono text-deep-200/40 uppercase tracking-wider mb-2">
              测试的假设
            </h4>
            <div className="flex flex-wrap gap-2">
              {attractorAnalysis.modifications_tested.map((mod, idx) => (
                <span
                  key={idx}
                  className="text-[10px] bg-deep-600/30 border border-deep-400/10 rounded-full px-3 py-1 text-deep-200/50"
                >
                  {mod}
                </span>
              ))}
            </div>
          </div>

          {/* Attractor cards */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-mono text-amber-300/50 uppercase tracking-wider">
              历史吸引子（收敛结局）
            </h4>
            {attractorAnalysis.attractors
              .sort((a, b) => b.convergence_score - a.convergence_score)
              .map((attr, idx) => (
                <AttractorCard key={idx} attractor={attr} rank={idx + 1} />
              ))}
          </div>

          {/* Divergent outcomes */}
          {attractorAnalysis.divergent_outcomes.length > 0 && (
            <div className="glass border border-deep-400/8 rounded-lg p-4 space-y-2">
              <h4 className="text-[10px] font-mono text-deep-200/40 uppercase tracking-wider">
                独特结局（仅出现在单一假设下）
              </h4>
              {attractorAnalysis.divergent_outcomes.map((outcome, idx) => (
                <p
                  key={idx}
                  className="text-[11px] text-deep-200/50 leading-relaxed pl-3 border-l border-deep-400/15"
                >
                  {outcome}
                </p>
              ))}
            </div>
          )}

          {/* Methodology */}
          {attractorAnalysis.methodology && (
            <div className="text-[9px] text-deep-200/25 font-mono bg-deep-700/20 rounded px-3 py-2 border border-deep-400/8 leading-relaxed">
              {attractorAnalysis.methodology}
            </div>
          )}

          {/* Cost */}
          {tokenUsage && (
            <div className="text-[9px] font-mono text-deep-200/25 text-right">
              成本: ${tokenUsage.estimated_cost_usd.toFixed(4)} ·{' '}
              {tokenUsage.total_api_calls} 次 API 调用
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──── Attractor Card ──── */

interface AttractorCardProps {
  attractor: {
    outcome_description: string;
    convergence_score: number;
    contributing_fan_count: number;
    earliest_emergence_year: number;
    resistance_to_change: number;
  };
  rank: number;
}

function AttractorCard({ attractor, rank }: AttractorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const convergencePct = Math.round(attractor.convergence_score * 100);
  const resistancePct = Math.round(attractor.resistance_to_change * 100);

  // Color gradient: high convergence = warm amber, low = cool
  const barColor = attractor.convergence_score > 0.7
    ? 'from-amber-300/80 to-amber-400/80'
    : attractor.convergence_score > 0.4
      ? 'from-amber-300/50 to-earth-400/50'
      : 'from-deep-200/30 to-deep-300/30';

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="w-full text-left glass border border-deep-400/8 hover:border-amber-300/15 rounded-lg p-4 transition-all duration-300 hover:bg-amber-300/[0.02] group"
    >
      <div className="flex items-start gap-3">
        {/* Rank badge */}
        <span className="text-[9px] font-mono font-bold text-amber-300/60 bg-amber-300/10 border border-amber-300/15 rounded-full w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
          {rank}
        </span>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Description */}
          <p className="text-[11px] text-white/75 leading-relaxed">
            {attractor.outcome_description}
          </p>

          {/* Convergence bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-deep-600/30 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-500`}
                style={{ width: `${convergencePct}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-amber-300/60 w-10 text-right">
              {convergencePct}%
            </span>
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-4 text-[9px] font-mono text-deep-200/30">
            <span>
              {attractor.contributing_fan_count} 个假设收敛
            </span>
            <span>·</span>
            <span>
              最早出现: {attractor.earliest_emergence_year}
            </span>
            <span>·</span>
            <span>
              抗变性: {resistancePct}%
            </span>
          </div>

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-deep-400/8 space-y-2">
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-deep-200/35">收敛强度</span>
                <span className="text-amber-300/50">{convergencePct}%</span>
              </div>
              <div className="flex items-center justify-between text-[9px] font-mono">
                <span className="text-deep-200/35">抗干预程度</span>
                <span className="text-amber-300/50">{resistancePct}%</span>
              </div>
              <p className="text-[10px] text-deep-200/30 italic leading-relaxed">
                该结局在 {attractor.contributing_fan_count} 个不同假设的探索中反复出现，
                表明它具有较{attractor.resistance_to_change > 0.7 ? '强' : '弱'}的历史惯性。
                {attractor.resistance_to_change > 0.7
                  ? '即使大幅改变初始条件，历史仍倾向于收敛到这一结局。'
                  : '在某些极端假设下，可能被避免。'}
              </p>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
