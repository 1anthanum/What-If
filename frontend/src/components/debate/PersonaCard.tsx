/**
 * Displays a single persona's statement in the debate with warm ambient styling.
 */

const PERSONA_THEMES: Record<string, { accent: string; bg: string; label: string }> = {
  '中国农业农村部部长': { accent: '#C47D5A', bg: 'rgba(196,125,90,0.03)', label: 'GOV-CN' },
  '美国农业巨头CEO': { accent: '#8B9FBF', bg: 'rgba(139,159,191,0.03)', label: 'CORP-US' },
  '印度小农代表': { accent: '#6EBF8B', bg: 'rgba(110,191,139,0.03)', label: 'CIVIL-IN' },
  'IMF首席经济学家': { accent: '#D4A574', bg: 'rgba(212,165,116,0.03)', label: 'IMF-ECO' },
  '国际环保组织负责人': { accent: '#8BA888', bg: 'rgba(139,168,136,0.03)', label: 'NGO-ENV' },
};

const DEFAULT_THEME = { accent: '#9B7B6B', bg: 'rgba(155,123,107,0.03)', label: 'AGENT' };

interface PersonaCardProps {
  personaName: string;
  personaRole?: string;
  content: string;
  isStreaming?: boolean;
}

export function PersonaCard({ personaName, personaRole, content, isStreaming }: PersonaCardProps) {
  const theme = PERSONA_THEMES[personaName] || DEFAULT_THEME;

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
              <span className="text-[10px] text-deep-200/30 font-mono">
                {personaRole}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <span
                className="text-[9px] font-mono tracking-widest animate-pulse"
                style={{ color: theme.accent }}
              >
                TRANSMITTING
              </span>
            )}
            <span
              className="text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded border"
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
      </div>
    </div>
  );
}
