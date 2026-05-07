import { useDebateStore } from '../../store/debateStore';
import { useCausalStore } from '../../store/causalStore';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import { useOrchestratorStore } from '../../store/orchestratorStore';

type TokenLike = {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_api_calls?: number;
  estimated_cost_usd?: number;
} | Record<string, number> | null;

function pick(u: TokenLike, key: string): number {
  if (!u) return 0;
  const v = (u as Record<string, number>)[key];
  return typeof v === 'number' ? v : 0;
}

const MODULE_LABELS: Record<string, string> = {
  debate: '辩论',
  causal: '因果',
  counterfactual: '反事实',
  orchestrator: '闭环',
};

/**
 * Aggregated cost summary across all four modules. Lives in the header
 * so the user always sees total spend at a glance.
 */
export function CumulativeCostBadge({ activeModule }: { activeModule: string }) {
  const debate = useDebateStore(s => s.tokenUsage);
  const causal = useCausalStore(s => s.tokenUsage);
  const counterfactual = useCounterfactualStore(s => s.tokenUsage);
  const orchestrator = useOrchestratorStore(s => s.tokenUsage);

  const sources: Array<[string, TokenLike]> = [
    ['debate', debate],
    ['causal', causal],
    ['counterfactual', counterfactual],
    ['orchestrator', orchestrator],
  ];

  const totalCalls = sources.reduce((s, [, u]) => s + pick(u, 'total_api_calls'), 0);
  const totalIn = sources.reduce((s, [, u]) => s + pick(u, 'total_input_tokens'), 0);
  const totalOut = sources.reduce((s, [, u]) => s + pick(u, 'total_output_tokens'), 0);
  const totalCost = sources.reduce((s, [, u]) => s + pick(u, 'estimated_cost_usd'), 0);
  const totalTokensK = ((totalIn + totalOut) / 1000).toFixed(1);

  const hasAny = totalCalls > 0 || totalIn > 0 || totalOut > 0;
  const costWarning = totalCost > 1;

  if (!hasAny) {
    return (
      <div className="font-mono text-[11px] tracking-[0.18em] text-deep-300 px-3 py-1.5 rounded-md bg-deep-800/40 border border-deep-400/35">
        ▢ NO USAGE YET
      </div>
    );
  }

  return (
    <div className="group relative">
      <div
        className={`
          flex items-center gap-3.5 px-3.5 py-1.5 rounded-md font-mono text-[12px] tracking-[0.10em]
          bg-gradient-to-r from-deep-800/80 to-deep-700/60 border
          ${costWarning ? 'border-earth-rust/55 shadow-[0_0_12px_rgba(196,125,90,0.18)]' : 'border-amber-300/35 shadow-[0_0_12px_rgba(232,185,136,0.10)]'}
        `}
      >
        <span className="text-amber-300/95 font-semibold tracking-[0.18em]">Σ TOTAL</span>
        <span className="w-px h-3 bg-amber-300/30" />
        <span className="flex items-baseline gap-1">
          <span className="text-deep-300 text-[10px]">CALLS</span>
          <span className="text-deep-50 text-[13px] font-semibold">{totalCalls}</span>
        </span>
        <span className="w-px h-3 bg-deep-400/40" />
        <span className="flex items-baseline gap-1">
          <span className="text-deep-300 text-[10px]">TOKENS</span>
          <span className="text-deep-50 text-[13px] font-semibold">{totalTokensK}K</span>
        </span>
        <span className="w-px h-3 bg-deep-400/40" />
        <span className="flex items-baseline gap-1">
          <span className={costWarning ? 'text-earth-rust/85 text-[10px]' : 'text-amber-300/90 text-[10px]'}>USD</span>
          <span className={`text-[14px] font-bold ${costWarning ? 'text-earth-rust' : 'text-amber-200'}`}>
            ${totalCost.toFixed(3)}
          </span>
        </span>
      </div>

      {/* Hover detail — per-module breakdown */}
      <div
        className="
          invisible group-hover:visible opacity-0 group-hover:opacity-100
          transition-all duration-150
          absolute right-0 top-full mt-2 z-50
          min-w-[280px] glass rounded-lg p-3.5 border border-amber-300/35 shadow-glow
        "
      >
        <div className="text-[10px] font-mono tracking-[0.22em] text-amber-300/95 uppercase mb-2.5">
          Cost Breakdown · 各模块拆分
        </div>
        <div className="space-y-1.5">
          {sources.map(([key, u]) => {
            const cost = pick(u, 'estimated_cost_usd');
            const calls = pick(u, 'total_api_calls');
            const tokK = ((pick(u, 'total_input_tokens') + pick(u, 'total_output_tokens')) / 1000).toFixed(1);
            const isActive = key === activeModule;
            return (
              <div
                key={key}
                className={`
                  flex items-center justify-between font-mono text-[12px]
                  ${cost > 0 || calls > 0 ? 'text-deep-100' : 'text-deep-300/70'}
                `}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-amber-300' : 'bg-deep-400'}`} />
                  <span className="text-[12px]">{MODULE_LABELS[key]}</span>
                </span>
                <span className="flex items-center gap-3 text-[11px]">
                  <span className="text-deep-300">{calls}调用</span>
                  <span className="text-deep-200">{tokK}K</span>
                  <span className={cost > 0 ? 'text-amber-200 font-semibold' : 'text-deep-300'}>
                    ${cost.toFixed(3)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2 border-t border-amber-300/15 flex items-center justify-between">
          <span className="text-[10px] font-mono text-deep-300 tracking-wider">RATE · Sonnet 4.6</span>
          <span className="text-[10px] font-mono text-deep-200">$3 / $15 per 1M</span>
        </div>
      </div>
    </div>
  );
}
