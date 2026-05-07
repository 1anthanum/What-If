/**
 * Displays a single persona's statement in the debate with warm ambient styling.
 */
import type { PersonaEval } from '../../store/debateStore';

const PERSONA_THEMES: Record<string, { accent: string; bg: string; label: string }> = {
  '中国农业农村部部长': { accent: '#C47D5A', bg: 'rgba(196,125,90,0.03)', label: 'GOV-CN' },
  '美国农业巨头CEO': { accent: '#8B9FBF', bg: 'rgba(139,159,191,0.03)', label: 'CORP-US' },
  '印度小农代表': { accent: '#6EBF8B', bg: 'rgba(110,191,139,0.03)', label: 'CIVIL-IN' },
  'IMF首席经济学家': { accent: '#D4A574', bg: 'rgba(212,165,116,0.03)', label: 'IMF-ECO' },
  '国际环保组织负责人': { accent: '#8BA888', bg: 'rgba(139,168,136,0.03)', label: 'NGO-ENV' },
};

const DEFAULT_THEME = { accent: '#9B7B6B', bg: 'rgba(155,123,107,0.03)', label: 'AGENT' };

const STYLE_BADGES: Record<string, { color: string; bg: string }> = {
  '经验主义': { color: '#8BA888', bg: 'rgba(139,168,136,0.10)' },
  '理论推演': { color: '#8B9FBF', bg: 'rgba(139,159,191,0.10)' },
  '直觉判断': { color: '#E8B988', bg: 'rgba(232,185,136,0.10)' },
  '对抗反驳': { color: '#C47D5A', bg: 'rgba(196,125,90,0.10)' },
  '整合调和': { color: '#9B7B6B', bg: 'rgba(155,123,107,0.10)' },
};

interface PersonaCardProps {
  personaName: string;
  personaRole?: string;
  model?: string;
  content: string;
  isStreaming?: boolean;
  evaluation?: PersonaEval;
}

/** Horizontal bar gauge for 0..100 evaluation dims. */
function Gauge({ label, value, accentColor }: { label: string; value: number; accentColor: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-deep-200 tracking-wider w-10 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-deep-700/70 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: accentColor, boxShadow: `0 0 6px ${accentColor}66` }}
        />
      </div>
      <span className="text-[11px] font-mono font-semibold tabular-nums text-deep-100 w-7 text-right">
        {pct}
      </span>
    </div>
  );
}

/** Bidirectional bar for stance: -100..+100 with center anchor. */
function StanceBar({ value }: { value: number }) {
  const v = Math.max(-100, Math.min(100, value));
  const half = Math.abs(v) / 2;        // 0..50 (each half is 50% wide)
  const isPro = v >= 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-deep-200 tracking-wider w-10 shrink-0">立场</span>
      <div className="flex-1 relative h-1.5 rounded-full bg-deep-700/70 overflow-hidden flex">
        {/* center divider */}
        <span className="absolute left-1/2 top-0 bottom-0 w-px bg-deep-300/70 z-10" />
        <div className="w-1/2 flex justify-end">
          {!isPro && (
            <div
              className="h-full"
              style={{ width: `${half * 2}%`, background: '#C47D5A', boxShadow: '0 0 6px rgba(196,125,90,0.4)' }}
            />
          )}
        </div>
        <div className="w-1/2">
          {isPro && (
            <div
              className="h-full"
              style={{ width: `${half * 2}%`, background: '#6EBF8B', boxShadow: '0 0 6px rgba(110,191,139,0.4)' }}
            />
          )}
        </div>
      </div>
      <span
        className="text-[11px] font-mono font-semibold tabular-nums w-7 text-right"
        style={{ color: isPro ? '#8BCFA1' : '#D88E6E' }}
      >
        {v > 0 ? '+' : ''}{v}
      </span>
    </div>
  );
}

/** Trim "ollama:qwen2.5:7b" → "qwen2.5:7b", "claude:claude-sonnet-4-6" → "claude-sonnet-4-6". */
function shortenModel(label: string): string {
  if (label.startsWith('ollama:')) return label.slice(7);
  if (label.startsWith('claude:')) return label.slice(7);
  return label;
}

export function PersonaCard({ personaName, personaRole, model, content, isStreaming, evaluation }: PersonaCardProps) {
  const theme = PERSONA_THEMES[personaName] || DEFAULT_THEME;
  const isJudge = model?.startsWith('claude:');
  const modelLabel = model ? shortenModel(model) : null;
  const styleBadge = evaluation ? STYLE_BADGES[evaluation.style] ?? STYLE_BADGES['整合调和'] : null;

  return (
    <div
      className="relative rounded-lg overflow-hidden animate-slide-up"
      style={{
        background: theme.bg,
        borderLeft: `2px solid ${theme.accent}`,
        boxShadow: `inset 4px 0 20px -8px ${theme.accent}25`,
      }}
    >
      {/* Scan line effect when streaming */}
      {isStreaming && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ opacity: 0.2 }}
        >
          <div
            className="absolute left-0 right-0 h-px animate-scan"
            style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }}
          />
        </div>
      )}

      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            {/* Status dot */}
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: theme.accent,
                boxShadow: isStreaming ? `0 0 8px ${theme.accent}` : 'none',
              }}
            />
            <span className="text-sm font-medium text-white">{personaName}</span>
            {personaRole && (
              <span className="text-[14px] text-deep-200/75 font-mono">
                {personaRole}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <span
                className="text-[15px] font-mono tracking-widest animate-pulse"
                style={{ color: theme.accent }}
              >
                TRANSMITTING
              </span>
            )}
            {modelLabel && (
              <span
                className="text-[15px] font-mono tracking-wider px-1.5 py-0.5 rounded border"
                style={{
                  color: isJudge ? '#F5C896' : '#DAD2C8',
                  borderColor: isJudge ? 'rgba(245,200,150,0.45)' : 'rgba(218,210,200,0.30)',
                  backgroundColor: isJudge ? 'rgba(245,200,150,0.06)' : 'rgba(218,210,200,0.04)',
                }}
                title={isJudge ? 'Claude API（裁判 / 综合分析）' : '本地 Ollama 模型'}
              >
                {isJudge ? '⚖ ' : '◇ '}{modelLabel}
              </span>
            )}
            <span
              className="text-[15px] font-mono tracking-wider px-1.5 py-0.5 rounded border"
              style={{
                color: `${theme.accent}99`,
                borderColor: `${theme.accent}20`,
                backgroundColor: `${theme.accent}08`,
              }}
            >
              {theme.label}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="text-sm text-deep-100/75 leading-relaxed whitespace-pre-wrap pl-4">
          {content}
          {isStreaming && <span className="cursor-blink" />}
        </div>

        {/* Judge evaluation block */}
        {evaluation && styleBadge && (
          <div className="mt-3.5 pl-4 pr-1 pt-3 border-t border-deep-400/30">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-mono tracking-[0.22em] text-amber-300/90 uppercase">
                ⚖ Judge Evaluation
              </span>
              <span
                className="text-[10px] font-mono tracking-wider px-1.5 py-0.5 rounded border"
                style={{
                  color: styleBadge.color,
                  borderColor: `${styleBadge.color}55`,
                  backgroundColor: styleBadge.bg,
                }}
                title="认知风格"
              >
                ◇ {evaluation.style}
              </span>
            </div>
            <div className="space-y-1.5">
              <Gauge label="置信度" value={evaluation.confidence} accentColor="#E8B988" />
              <StanceBar value={evaluation.stance} />
              <Gauge label="新颖性" value={evaluation.novelty} accentColor="#8B9FBF" />
              <Gauge label="风险预" value={evaluation.risk} accentColor="#C47D5A" />
            </div>
            {evaluation.rationale && (
              <p className="mt-2 text-[12px] text-deep-200/85 leading-snug italic">
                — {evaluation.rationale}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
