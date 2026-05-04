import { useState } from 'react';
import { useDebateStore } from '../../store/debateStore';

const EXAMPLE_SCENARIOS = [
  {
    title: '粮食产量翻三倍',
    hypothesis: '如果亚热带和温带地区的水稻、小麦产量翻三倍',
    domain: 'agriculture',
    icon: '🌾',
  },
  {
    title: 'AGI 实现',
    hypothesis: '如果通用人工智能在 2027 年被实现并开源',
    domain: 'technology',
    icon: '◇',
  },
  {
    title: '石油需求归零',
    hypothesis: '如果核聚变商业化使全球石油需求在 10 年内降至零',
    domain: 'geopolitics',
    icon: '◆',
  },
  {
    title: '全球人口减半',
    hypothesis: '如果一场温和的全球疫情导致生育率永久降低 60%',
    domain: 'general',
    icon: '○',
  },
];

export function ScenarioInput() {
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [domain, setDomain] = useState('general');
  const { startDebate, status, error } = useDebateStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hypothesis.trim()) return;
    await startDebate({
      title: title || hypothesis.slice(0, 20),
      hypothesis,
      domain,
    });
  };

  const handleExampleClick = (example: typeof EXAMPLE_SCENARIOS[0]) => {
    setTitle(example.title);
    setHypothesis(example.hypothesis);
    setDomain(example.domain);
  };

  return (
    <div className="max-w-xl mx-auto animate-fade-in">
      {/* Hero */}
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 text-[9px] font-mono text-amber-300/40 tracking-[0.2em] uppercase mb-5 px-3 py-1.5 border border-amber-300/8 rounded-full">
          <span className="status-dot bg-amber-300 text-amber-300" />
          SCENARIO ENGINE
        </div>
        <h2 className="text-3xl font-light text-white mb-4 tracking-tight">
          如果<span className="text-amber-300">…</span>会怎样？
        </h2>
        <p className="text-sm text-deep-200/40 max-w-sm mx-auto leading-relaxed">
          输入一个假设场景，AI 将从多个立场展开辩论，帮你看清复杂系统的连锁反应。
        </p>
      </div>

      {/* Example Scenarios */}
      <div className="mb-10">
        <p className="text-[9px] font-mono text-deep-200/25 mb-3 uppercase tracking-[0.2em]">
          预设场景
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {EXAMPLE_SCENARIOS.map((ex, i) => (
            <button
              key={i}
              onClick={() => handleExampleClick(ex)}
              className={`
                group text-left p-4 rounded-lg transition-all duration-300
                ${hypothesis === ex.hypothesis
                  ? 'border-glow-active bg-amber-300/[0.03]'
                  : 'glass-subtle hover:border-glow'
                }
              `}
            >
              <div className="flex items-start gap-3">
                <span className="text-amber-300/30 text-sm mt-0.5 font-mono">{ex.icon}</span>
                <div>
                  <span className="text-[13px] font-medium text-deep-50 group-hover:text-amber-200 transition-colors">
                    {ex.title}
                  </span>
                  <span className="block text-[11px] text-deep-200/30 mt-1 leading-relaxed">
                    {ex.hypothesis}
                  </span>
                </div>
              </div>
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

      {/* Input Form */}
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
          disabled={!hypothesis.trim() || status === 'starting'}
          className={`
            w-full relative overflow-hidden font-medium py-3.5 rounded-lg transition-all duration-300
            ${hypothesis.trim()
              ? 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg btn-glow'
              : 'bg-deep-600/50 text-deep-300/25 cursor-not-allowed'
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {status === 'starting' ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="text-sm">正在初始化…</span>
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2 text-sm tracking-wide">
              启动推演
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
