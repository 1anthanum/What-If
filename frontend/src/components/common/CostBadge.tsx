import type { TokenUsage } from '../../services/api';

export function CostBadge({ usage }: { usage: TokenUsage }) {
  const totalTokensK = ((usage.total_input_tokens + usage.total_output_tokens) / 1000).toFixed(1);
  const costWarning = usage.estimated_cost_usd > 1;

  return (
    <div className="flex items-center gap-3 font-mono text-[10px] tracking-wider">
      <div className="flex items-center gap-1.5 text-deep-200/40">
        <span className="text-amber-300/40">API</span>
        <span className="text-deep-100">{usage.total_api_calls}</span>
      </div>
      <span className="w-px h-3 bg-deep-400/15" />
      <div className="flex items-center gap-1.5 text-deep-200/40">
        <span className="text-amber-300/40">TKN</span>
        <span className="text-deep-100">{totalTokensK}K</span>
      </div>
      <span className="w-px h-3 bg-deep-400/15" />
      <div className={`flex items-center gap-1.5 ${costWarning ? 'text-earth-rust' : 'text-deep-200/40'}`}>
        <span className={costWarning ? 'text-earth-rust/70' : 'text-amber-300/40'}>USD</span>
        <span className={costWarning ? 'text-earth-rust' : 'text-deep-100'}>
          ${usage.estimated_cost_usd.toFixed(3)}
        </span>
      </div>
    </div>
  );
}
