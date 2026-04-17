import { useState } from 'react';
import { useDebateStore } from '../../store/debateStore';

const EXAMPLE_SCENARIOS = [
  {
    title: '粮食产量翻三倍',
    hypothesis: '如果亚热带和温带地区的水稻、小麦产量翻三倍',
    domain: 'agriculture',
  },
  {
    title: 'AGI 实现',
    hypothesis: '如果通用人工智能在 2027 年被实现并开源',
    domain: 'technology',
  },
  {
    title: '石油需求归零',
    hypothesis: '如果核聚变商业化使全球石油需求在 10 年内降至零',
    domain: 'geopolitics',
  },
  {
    title: '全球人口减半',
    hypothesis: '如果一场温和的全球疫情导致生育率永久降低 60%',
    domain: 'general',
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
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">如果…会怎样？</h2>
        <p className="text-surface-200/60">
          输入一个假设场景，AI 将从多个立场展开辩论，帮你看清复杂系统的连锁反应。
        </p>
      </div>

      {/* Example Scenarios */}
      <div className="mb-8">
        <p className="text-xs text-surface-200/40 mb-3 uppercase tracking-wider">示例场景</p>
        <div className="grid grid-cols-2 gap-3">
          {EXAMPLE_SCENARIOS.map((ex, i) => (
            <button
              key={i}
              onClick={() => handleExampleClick(ex)}
              className="text-left p-3 rounded-lg border border-surface-200/10 hover:border-primary-500/40 hover:bg-surface-800/50 transition-all"
            >
              <span className="text-sm font-medium">{ex.title}</span>
              <span className="block text-xs text-surface-200/50 mt-1">{ex.hypothesis}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-surface-200/60 mb-1">场景标题（可选）</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="简短标题"
            className="w-full bg-surface-800 border border-surface-200/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500/50"
          />
        </div>
        <div>
          <label className="block text-sm text-surface-200/60 mb-1">假设描述 *</label>
          <textarea
            value={hypothesis}
            onChange={e => setHypothesis(e.target.value)}
            placeholder="如果……会怎样？"
            rows={3}
            className="w-full bg-surface-800 border border-surface-200/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500/50 resize-none"
          />
        </div>
        <div>
          <label className="block text-sm text-surface-200/60 mb-1">领域</label>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="w-full bg-surface-800 border border-surface-200/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500/50"
          >
            <option value="general">通用</option>
            <option value="agriculture">农业</option>
            <option value="technology">科技</option>
            <option value="geopolitics">地缘政治</option>
          </select>
        </div>

        {error && (
          <div className="text-red-400 text-sm bg-red-400/10 px-4 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!hypothesis.trim() || status === 'starting'}
          className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
        >
          {status === 'starting' ? '正在初始化辩论…' : '开始推演'}
        </button>
      </form>
    </div>
  );
}
