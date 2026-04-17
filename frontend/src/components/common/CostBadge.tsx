import type { TokenUsage } from '../../services/api';

export function CostBadge({ usage }: { usage: TokenUsage }) {
  return (
    <div className="flex items-center gap-2 text-xs text-surface-200/50">
      <span title="API 调用次数">
        {usage.total_api_calls} calls
      </span>
      <span className="text-surface-200/20">|</span>
      <span title="Token 用量">
        {((usage.total_input_tokens + usage.total_output_tokens) / 1000).toFixed(1)}K tokens
      </span>
      <span className="text-surface-200/20">|</span>
      <span
        title="预估成本"
        className={usage.estimated_cost_usd > 1 ? 'text-yellow-400' : ''}
      >
        ${usage.estimated_cost_usd.toFixed(3)}
      </span>
    </div>
  );
}
