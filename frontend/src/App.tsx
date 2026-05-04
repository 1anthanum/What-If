import { useState } from 'react';
import { ScenarioInput } from './components/common/ScenarioInput';
import { DebateRoom } from './components/debate/DebateRoom';
import { CausalView } from './components/causal/CausalView';
import { CounterfactualView } from './components/counterfactual/CounterfactualView';
import { FeedbackLoopView } from './components/orchestrator/FeedbackLoopView';
import { CostBadge } from './components/common/CostBadge';
import { useDebateStore } from './store/debateStore';
import { useCausalStore } from './store/causalStore';
import { useCounterfactualStore } from './store/counterfactualStore';
import { useOrchestratorStore } from './store/orchestratorStore';

const MODULES = [
  { key: 'debate', label: 'AI 辩论室', ready: true },
  { key: 'causal', label: '因果图谱', ready: true },
  { key: 'counterfactual', label: '历史反事实', ready: true },
  { key: 'orchestrator', label: '闭环推演', ready: true },
] as const;

export default function App() {
  const debateStore = useDebateStore();
  const causalStore = useCausalStore();
  const counterfactualStore = useCounterfactualStore();
  const orchestratorStore = useOrchestratorStore();
  const [activeModule, setActiveModule] = useState<string>('debate');

  // Determine which module's token usage to show
  const tokenUsage =
    activeModule === 'causal'
      ? causalStore.tokenUsage
      : activeModule === 'counterfactual'
        ? counterfactualStore.tokenUsage
        : activeModule === 'orchestrator'
          ? orchestratorStore.tokenUsage
          : debateStore.tokenUsage;

  // Determine if we should show reset button
  const hasActiveSession =
    (activeModule === 'debate' && debateStore.sessionId) ||
    (activeModule === 'causal' && causalStore.graphId) ||
    (activeModule === 'counterfactual' && counterfactualStore.timelineId) ||
    (activeModule === 'orchestrator' && orchestratorStore.loopId);

  const handleReset = () => {
    if (activeModule === 'debate') debateStore.reset();
    else if (activeModule === 'causal') causalStore.reset();
    else if (activeModule === 'counterfactual') counterfactualStore.reset();
    else if (activeModule === 'orchestrator') orchestratorStore.reset();
  };

  return (
    <div className="min-h-screen relative">
      {/* Ambient warmth */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[400px] bg-amber-300/[0.02] rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-amber-800/[0.03] rounded-full blur-[100px] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 glass border-b border-amber-300/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-amber-300 to-amber-600 flex items-center justify-center text-deep-950 font-bold text-xs shadow-glow-sm">
              ◈
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white tracking-wide">WHAT-IF</h1>
              <p className="text-[9px] text-amber-300/40 font-mono tracking-[0.2em] uppercase">
                Macro Simulation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            {tokenUsage && <CostBadge usage={tokenUsage} />}
            <div className="flex items-center gap-2">
              <span className="status-dot bg-earth-green text-earth-green" />
              <span className="text-[9px] font-mono text-deep-200 uppercase tracking-wider">
                Online
              </span>
            </div>
            {hasActiveSession && (
              <button
                onClick={handleReset}
                className="text-[10px] font-mono text-deep-200 hover:text-amber-300 transition-colors px-2.5 py-1 border border-deep-400/20 rounded hover:border-amber-300/20"
              >
                NEW
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Module Tabs */}
      <nav className="relative z-10 border-b border-deep-400/8 bg-deep-800/40">
        <div className="max-w-7xl mx-auto px-6 flex gap-0.5">
          {MODULES.map(tab => (
            <button
              key={tab.key}
              disabled={!tab.ready}
              onClick={() => tab.ready && setActiveModule(tab.key)}
              className={`
                relative py-3 px-5 text-xs tracking-wide transition-all
                ${activeModule === tab.key
                  ? 'text-amber-300 font-medium'
                  : 'text-deep-200/30 hover:text-deep-200/60'
                }
                ${!tab.ready ? 'cursor-not-allowed opacity-25' : ''}
              `}
            >
              {tab.label}
              {activeModule === tab.key && (
                <span className="absolute bottom-0 left-2 right-2 h-px bg-gradient-to-r from-transparent via-amber-300/60 to-transparent" />
              )}
              {!tab.ready && (
                <span className="ml-1.5 text-[8px] font-mono text-deep-300/40 border border-deep-400/10 px-1.5 py-0.5 rounded">
                  SOON
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content */}
      <main className={`relative z-10 ${activeModule === 'debate' ? 'max-w-5xl' : 'max-w-7xl'} mx-auto px-6 py-10`}>
        {/* Debate Module */}
        {activeModule === 'debate' && (
          <>
            {!debateStore.sessionId && debateStore.status !== 'starting' ? (
              <ScenarioInput />
            ) : (
              <DebateRoom />
            )}
          </>
        )}

        {/* Causal Graph Module */}
        {activeModule === 'causal' && (
          <CausalView />
        )}

        {/* Counterfactual Module */}
        {activeModule === 'counterfactual' && (
          <CounterfactualView />
        )}

        {/* Orchestrator Module */}
        {activeModule === 'orchestrator' && (
          <FeedbackLoopView />
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-deep-400/5 py-4 text-center">
        <p className="text-[9px] font-mono text-deep-300/20 tracking-[0.15em]">
          POWERED BY CLAUDE API — REAL-TIME TOKEN TRACKING
        </p>
      </footer>
    </div>
  );
}
