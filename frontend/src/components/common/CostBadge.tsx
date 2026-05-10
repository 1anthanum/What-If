import type { TokenUsage } from '../../services/api';

/** Compact cost summary for a single module — labels in cool accent,
 *  amber reserved for the cost figure (the only number that should grab attention). */
export function CostBadge({ usage }: { usage: TokenUsage }) {
  const totalTokensK = ((usage.total_input_tokens + usage.total_output_tokens) / 1000).toFixed(1);
  const costWarning = usage.estimated_cost_usd > 1;

  return (
    <div className="flex items-center gap-3 font-mono text-[12px] tracking-[0.10em]">
      <Stat label="API" value={String(usage.total_api_calls)} />
      <span className="tk-divider-v h-3.5" />
      <Stat label="TKN" value={`${totalTokensK}K`} />
      <span className="tk-divider-v h-3.5" />
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[10px] ${costWarning ? 'text-earth-rust/85' : 'text-amber-300/85'}`}>USD</span>
        <span className={`text-[13px] font-semibold tabular-nums ${costWarning ? 'text-earth-rust' : 'text-amber-200'}`}>
          ${usage.estimated_cost_usd.toFixed(3)}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] tk-cool-soft">{label}</span>
      <span className="text-[13px] tk-text-primary tabular-nums">{value}</span>
    </div>
  );
}
