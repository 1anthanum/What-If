import { useState } from 'react';
import { ScenarioInput } from './components/common/ScenarioInput';
import { DebateRoom } from './components/debate/DebateRoom';
import { CostBadge } from './components/common/CostBadge';
import { useDebateStore } from './store/debateStore';

export default function App() {
  const { sessionId, status, tokenUsage, reset } = useDebateStore();
  const [activeModule] = useState<'debate' | 'causal' | 'counterfactual'>('debate');

  return (
    <div className="min-h-screen bg-surface-900 text-white">
      {/* Header */}
      <header className="border-b border-surface-200/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">What-If Simulation</h1>
          <span className="text-xs bg-primary-500/20 text-primary-500 px-2 py-0.5 rounded-full">
            v0.1 Alpha
          </span>
        </div>
        <div className="flex items-center gap-4">
          {tokenUsage && <CostBadge usage={tokenUsage} />}
          {sessionId && (
            <button
              onClick={reset}
              className="text-sm text-surface-200/60 hover:text-white transition-colors"
            >
              新场景
            </button>
          )}
        </div>
      </header>

      {/* Module Tabs */}
      <nav className="border-b border-surface-200/10 px-6">
        <div className="flex gap-6">
          {[
            { key: 'debate', label: 'AI 辩论室', ready: true },
            { key: 'causal', label: '因果图谱', ready: false },
            { key: 'counterfactual', label: '历史反事实', ready: false },
          ].map(tab => (
            <button
              key={tab.key}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeModule === tab.key
                  ? 'border-primary-500 text-white'
                  : 'border-transparent text-surface-200/40 hover:text-surface-200/70'
              } ${!tab.ready ? 'cursor-not-allowed opacity-40' : ''}`}
              disabled={!tab.ready}
            >
              {tab.label}
              {!tab.ready && <span className="ml-1 text-xs">(即将推出)</span>}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {!sessionId && status !== 'starting' ? (
          <ScenarioInput />
        ) : (
          <DebateRoom />
        )}
      </main>
    </div>
  );
}
