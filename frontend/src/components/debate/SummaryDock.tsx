import { useDebateStore } from '../../store/debateStore';

const PERSONA_COLORS: Record<string, string> = {
  '中国农业农村部部长': '#C47D5A',
  '美国农业巨头CEO': '#8B9FBF',
  '印度小农代表': '#6EBF8B',
  'IMF首席经济学家': '#D4A574',
  '国际环保组织负责人': '#8BA888',
};
const DEFAULT_COLOR = '#9B7B6B';

/** Trim "ollama:qwen3.5:27b" → "qwen3.5:27b". */
function shortenModel(label?: string): string {
  if (!label) return '';
  if (label.startsWith('ollama:')) return label.slice(7);
  if (label.startsWith('claude:')) return label.slice(7);
  return label;
}

/**
 * Right-side fixed dock showing one-line core takeaways for every persona,
 * grouped by round. Click a row to scroll/highlight the original card.
 */
export function SummaryDock() {
  const { rounds, sessionId } = useDebateStore();

  if (!sessionId) return null;
  if (rounds.length === 0) return null;

  return (
    <aside
      className="
        hidden xl:flex flex-col
        fixed right-4 top-[136px] bottom-4 w-[320px] z-30
        glass rounded-xl border border-amber-300/35 shadow-glow
        overflow-hidden
      "
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-deep-400/35 bg-gradient-to-b from-amber-300/[0.04] to-transparent">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-mono tracking-[0.22em] text-amber-300/95 uppercase font-semibold">
            ◈ Core Takeaways
          </span>
          <span className="text-[10px] font-mono text-deep-300 tabular-nums">
            {rounds.length} 轮
          </span>
        </div>
        <p className="text-[10px] font-mono text-deep-300 leading-snug">
          每位 persona 的核心观点 · 本地模型实时摘要
        </p>
      </div>

      {/* Scrollable round list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3.5">
        {rounds.map((round) => (
          <div
            key={round.round_number}
            className="rounded-lg bg-deep-800/40 border border-deep-400/35 overflow-hidden"
          >
            {/* Round header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-deep-400/30 bg-deep-700/30">
              <span className="text-[11px] font-mono font-semibold tracking-[0.18em] text-amber-200 uppercase">
                Round {String(round.round_number).padStart(2, '0')}
              </span>
              {round.summaryPending ? (
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-amber-300/80 tracking-wider">
                  <span className="w-2 h-2 border border-amber-300/50 border-t-amber-300 rounded-full animate-spin" />
                  摘要中
                </span>
              ) : round.summarizerModel ? (
                <span
                  className="text-[10px] font-mono text-deep-200/85 tracking-wider"
                  title="本地摘要模型"
                >
                  ◇ {shortenModel(round.summarizerModel)}
                </span>
              ) : null}
            </div>

            {/* Statements list */}
            <div className="divide-y divide-deep-400/20">
              {round.statements.map((stmt) => {
                const color = PERSONA_COLORS[stmt.persona_name] ?? DEFAULT_COLOR;
                const cardId = `card-${round.round_number}-${stmt.persona_id}`;
                const handleJump = () => {
                  const el = document.getElementById(cardId);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('ring-2', 'ring-amber-300/55');
                    setTimeout(() => el.classList.remove('ring-2', 'ring-amber-300/55'), 1600);
                  }
                };
                return (
                  <button
                    key={stmt.persona_id}
                    onClick={handleJump}
                    className="group block w-full text-left px-3 py-2.5 hover:bg-amber-300/[0.04] transition-colors"
                    title="跳转到完整发言"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
                      />
                      <span className="text-[11px] font-medium text-deep-100 truncate">
                        {stmt.persona_name}
                      </span>
                      {stmt.evaluation && (
                        <span
                          className="ml-auto text-[9px] font-mono tabular-nums px-1 py-0.5 rounded"
                          style={{
                            color: stmt.evaluation.stance >= 0 ? '#8BCFA1' : '#D88E6E',
                            backgroundColor: stmt.evaluation.stance >= 0 ? 'rgba(139,207,161,0.10)' : 'rgba(216,142,110,0.10)',
                          }}
                          title="立场强度"
                        >
                          {stmt.evaluation.stance > 0 ? '+' : ''}{stmt.evaluation.stance}
                        </span>
                      )}
                    </div>
                    {stmt.summary ? (
                      <p className="text-[12px] text-deep-100/95 leading-snug pl-3.5 group-hover:text-amber-100 transition-colors">
                        {stmt.summary}
                      </p>
                    ) : stmt.summaryPending ? (
                      <p className="text-[11px] text-deep-300 leading-snug pl-3.5 italic">
                        生成中…
                      </p>
                    ) : stmt.isStreaming ? (
                      <p className="text-[11px] text-deep-300 leading-snug pl-3.5 italic">
                        发言中…
                      </p>
                    ) : (
                      <p className="text-[11px] text-deep-400 leading-snug pl-3.5 italic">
                        待摘要
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
