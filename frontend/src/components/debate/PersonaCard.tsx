/**
 * Displays a single persona's statement in the debate.
 */

const PERSONA_COLORS: Record<string, string> = {
  '中国农业农村部部长': 'border-l-red-500',
  '美国农业巨头CEO': 'border-l-blue-500',
  '印度小农代表': 'border-l-green-500',
  'IMF首席经济学家': 'border-l-purple-500',
  '国际环保组织负责人': 'border-l-emerald-500',
};

interface PersonaCardProps {
  personaName: string;
  personaRole?: string;
  content: string;
  isStreaming?: boolean;
}

export function PersonaCard({ personaName, personaRole, content, isStreaming }: PersonaCardProps) {
  const colorClass = PERSONA_COLORS[personaName] || 'border-l-surface-200/30';

  return (
    <div className={`bg-surface-800/30 border border-surface-200/5 border-l-4 ${colorClass} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-semibold">{personaName}</span>
        {personaRole && (
          <span className="text-xs text-surface-200/40">{personaRole}</span>
        )}
        {isStreaming && (
          <span className="inline-flex items-center gap-1 text-xs text-primary-500">
            <span className="w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse" />
            输出中
          </span>
        )}
      </div>
      <div className="text-sm text-surface-200/75 leading-relaxed whitespace-pre-wrap">
        {content}
        {isStreaming && <span className="inline-block w-1 h-4 bg-primary-500 animate-pulse ml-0.5" />}
      </div>
    </div>
  );
}
