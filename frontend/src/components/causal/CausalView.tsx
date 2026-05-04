/**
 * Main container for the Causal Graph module.
 * Handles scenario input → graph generation → interactive exploration.
 */

import { useState } from 'react';
import { useCausalStore } from '../../store/causalStore';
import { CausalGraphView } from './CausalGraph';
import { CausalPanel } from './CausalPanel';

const EXAMPLE_SCENARIOS = [
  {
    title: '粮食产量翻三倍',
    hypothesis: '如果亚热带和温带地区的水稻、小麦产量翻三倍',
    domain: 'agriculture',
  },
  {
    title: 'AGI 开源',
    hypothesis: '如果通用人工智能在 2027 年被实现并完全开源',
    domain: 'technology',
  },
  {
    title: '石油需求归零',
    hypothesis: '如果核聚变商业化使全球石油需求在 10 年内降至零',
    domain: 'geopolitics',
  },
];

export function CausalView() {
  const { graphId, status, error, streamingText, reset, generateGraph } = useCausalStore();
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [domain, setDomain] = useState('general');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hypothesis.trim()) return;
    await generateGraph(title || hypothesis.slice(0, 20), hypothesis, domain);
  };

  const handleExample = (ex: typeof EXAMPLE_SCENARIOS[0]) => {
    setTitle(ex.title);
    setHypothesis(ex.hypothesis);
    setDomain(ex.domain);
  };

  // ─── Scenario Input Phase ────────────────────────────────

  if (!graphId && status !== 'generating') {
    return (
      <div className="max-w-xl mx-auto animate-fade-in">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 text-[9px] font-mono text-amber-300/40 tracking-[0.2em] uppercase mb-5 px-3 py-1.5 border border-amber-300/8 rounded-full">
            <span className="status-dot bg-amber-300 text-amber-300" />
            CAUSAL ENGINE
          </div>
          <h2 className="text-3xl font-light text-white mb-4 tracking-tight">
            因果<span className="text-amber-300">图谱</span>推演
          </h2>
          <p className="text-sm text-deep-200/40 max-w-sm mx-auto leading-relaxed">
            输入假设场景，AI 将构建因果关系网络。点击节点探索级联传播效应。
          </p>
        </div>

        {/* Examples */}
        <div className="mb-10">
          <p className="text-[9px] font-mono text-deep-200/25 mb-3 uppercase tracking-[0.2em]">
            预设场景
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            {EXAMPLE_SCENARIOS.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExample(ex)}
                className={`
                  group text-left p-4 rounded-lg transition-all duration-300
                  ${hypothesis === ex.hypothesis
                    ? 'border-glow-active bg-amber-300/[0.03]'
                    : 'glass-subtle hover:border-glow'
                  }
                `}
              >
                <span className="text-[13px] font-medium text-deep-50 group-hover:text-amber-200 transition-colors block">
                  {ex.title}
                </span>
                <span className="block text-[10px] text-deep-200/30 mt-1.5 leading-relaxed">
                  {ex.hypothesis}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-8">
          <span className="flex-1 divider-warm" />
          <span className="text-[9px] font-mono text-deep-300/20 uppercase tracking-[0.2em]">或自定义</span>
          <span className="flex-1 divider-warm" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[9px] font-mono text-deep-200/30 mb-2 uppercase tracking-[0.2em]">
              场景标题（可选）
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="简短标题"
              className="w-full bg-deep-700/30 border border-deep-400/10 rounded-lg px-4 py-3 text-sm text-white placeholder-deep-300/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-[9px] font-mono text-deep-200/30 mb-2 uppercase tracking-[0.2em]">
              假设描述 <span className="text-amber-300/50">*</span>
            </label>
            <textarea
              value={hypothesis}
              onChange={e => setHypothesis(e.target.value)}
              placeholder="如果……会怎样？"
              rows={3}
              className="w-full bg-deep-700/30 border border-deep-400/10 rounded-lg px-4 py-3 text-sm text-white placeholder-deep-300/20 resize-none transition-all"
            />
          </div>

          <div>
            <label className="block text-[9px] font-mono text-deep-200/30 mb-2 uppercase tracking-[0.2em]">
              领域分类
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: 'general', label: '通用' },
                { value: 'agriculture', label: '农业' },
                { value: 'technology', label: '科技' },
                { value: 'geopolitics', label: '地缘' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDomain(opt.value)}
                  className={`
                    py-2.5 rounded-lg text-xs transition-all
                    ${domain === opt.value
                      ? 'bg-amber-300/[0.06] border border-amber-300/15 text-amber-300 shadow-glow-sm'
                      : 'bg-deep-700/20 border border-deep-400/8 text-deep-200/40 hover:border-deep-400/15 hover:text-deep-200/60'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-earth-rust text-xs bg-earth-rust/5 border border-earth-rust/15 px-4 py-3 rounded-lg font-mono">
              <span>⚠</span> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!hypothesis.trim()}
            className={`
              w-full relative overflow-hidden font-medium py-3.5 rounded-lg transition-all duration-300
              ${hypothesis.trim()
                ? 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg btn-glow'
                : 'bg-deep-600/50 text-deep-300/25 cursor-not-allowed'
              }
            `}
          >
            <span className="flex items-center justify-center gap-2 text-sm tracking-wide">
              ◇ 生成因果图谱
            </span>
          </button>
        </form>
      </div>
    );
  }

  // ─── Generating Phase ────────────────────────────────────

  if (status === 'generating') {
    return (
      <div className="max-w-xl mx-auto animate-fade-in text-center py-20">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-300/[0.05] border border-amber-300/10 mb-6">
          <span className="w-8 h-8 border-2 border-amber-300/20 border-t-amber-300 rounded-full animate-spin" />
        </div>
        <h3 className="text-lg font-light text-white mb-3">正在构建因果图谱</h3>
        <p className="text-xs text-deep-200/30 mb-6">AI 正在分析场景并建立因果关系网络…</p>

        {streamingText && (
          <div className="glass rounded-lg p-4 text-left max-w-md mx-auto max-h-48 overflow-y-auto">
            <p className="text-[10px] font-mono text-amber-300/30 mb-2">▸ AI OUTPUT</p>
            <p className="text-[11px] text-deep-100/40 leading-relaxed whitespace-pre-wrap">
              {streamingText.slice(-400)}
              <span className="cursor-blink" />
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── Graph Exploration Phase ─────────────────────────────

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-amber-300/40 tracking-widest uppercase">
            ◇ 因果图谱
          </span>
          <span className="h-px flex-1 bg-amber-300/8 min-w-[60px]" />
        </div>
        <button
          onClick={reset}
          className="text-[10px] font-mono text-deep-200 hover:text-amber-300 transition-colors px-2.5 py-1 border border-deep-400/20 rounded hover:border-amber-300/20"
        >
          NEW
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-earth-rust text-xs bg-earth-rust/5 border border-earth-rust/15 px-4 py-3 rounded-lg font-mono mb-4">
          <span>⚠</span> {error}
        </div>
      )}

      {/* Main layout: Graph + Panel */}
      <div className="flex gap-5">
        <div className="flex-1 min-w-0">
          <CausalGraphView />
        </div>
        <CausalPanel />
      </div>
    </div>
  );
}
