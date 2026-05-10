import { useState } from 'react';
import { ScenarioInput } from './components/common/ScenarioInput';
import { DebateRoom } from './components/debate/DebateRoom';
import { CausalView } from './components/causal/CausalView';
import { CounterfactualView } from './components/counterfactual/CounterfactualView';
import { FeedbackLoopView } from './components/orchestrator/FeedbackLoopView';
import { VotingHall } from './components/voting/VotingHall';
import { CostBadge } from './components/common/CostBadge';
import { CumulativeCostBadge } from './components/common/CumulativeCostBadge';
import { SettingsPanel } from './components/common/SettingsPanel';
import { Button } from './components/common/ui';
import { useDebateStore } from './store/debateStore';
import { useCausalStore } from './store/causalStore';
import { useCounterfactualStore } from './store/counterfactualStore';
import { useOrchestratorStore } from './store/orchestratorStore';

const MODULES = [
  { key: 'debate', label: 'AI 辩论室', ready: true },
  { key: 'causal', label: '因果图谱', ready: true },
  { key: 'counterfactual', label: '历史反事实', ready: true },
  { key: 'orchestrator', label: '闭环推演', ready: true },
  { key: 'voting', label: '模型投票厅', ready: true },
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
      <header className="relative z-10 glass border-b border-amber-300/[0.10]">
        <div className="max-w-7xl mx-auto px-7 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-10 h-10 rounded-lg bg-gradient-to-br from-amber-200 via-amber-400 to-amber-700 flex items-center justify-center text-deep-950 font-bold text-xl shadow-glow">
              <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-white/30 to-transparent" />
              <span className="relative">◈</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-[0.04em] leading-none">
                WHAT<span className="text-amber-300">·</span>IF
              </h1>
              <p className="mt-1 text-[11px] text-amber-300/95 font-mono tracking-[0.30em] uppercase">
                Macro Simulation Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <CumulativeCostBadge activeModule={activeModule} />
            <SettingsPanel />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-deep-800/60 border tk-border-faint">
              <span className="status-dot bg-electric" />
              <span className="text-[11px] font-mono uppercase tracking-[0.22em] glow-electric font-semibold">
                ONLINE
              </span>
            </div>
            {hasActiveSession && (
              <Button onClick={handleReset} variant="secondary" size="sm">
                ＋ NEW
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Module Tabs */}
      <nav className="relative z-10 border-b tk-border-faint bg-deep-800/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-7 flex items-end gap-1">
          {MODULES.map((tab, i) => {
            const active = activeModule === tab.key;
            return (
              <button
                key={tab.key}
                disabled={!tab.ready}
                onClick={() => tab.ready && setActiveModule(tab.key)}
                className={`
                  relative py-4 px-5 text-[14px] tracking-[0.04em] font-medium transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-300/40 focus-visible:rounded
                  ${active ? 'text-amber-200' : 'tk-text-secondary hover:text-deep-50'}
                  ${!tab.ready ? 'cursor-not-allowed opacity-30' : ''}
                `}
                aria-current={active ? 'page' : undefined}
              >
                <span className={`font-mono text-[10px] mr-2 align-middle tabular-nums ${active ? 'text-amber-300/85' : 'tk-cool-soft'}`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {tab.label}
                {active && (
                  <>
                    <span className="absolute -bottom-px left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
                    <span className="absolute inset-0 bg-gradient-to-b from-amber-300/[0.06] to-transparent pointer-events-none" />
                  </>
                )}
                {!tab.ready && (
                  <span className="ml-1.5 text-[10px] font-mono tk-text-faint border tk-border-faint px-1.5 py-0.5 rounded">
                    SOON
                  </span>
                )}
              </button>
            );
          })}
          {/* Active-module mini cost badge — shows current module's spend without distracting from total */}
          <div className="ml-auto py-3 hidden md:block">
            {tokenUsage && <CostBadge usage={tokenUsage as any} />}
          </div>
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

        {/* Voting Hall — model panel votes on a structured question */}
        {activeModule === 'voting' && (
          <VotingHall />
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t tk-border-faint py-4 text-center">
        <p className="text-[10px] font-mono tk-text-faint tracking-[0.22em]">
          POWERED BY CLAUDE API · REAL-TIME TOKEN TRACKING
        </p>
      </footer>
    </div>
  );
}
