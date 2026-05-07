/**
 * Right-side timeline panel for the Autonomous Topic Explorer.
 * Each event in the run becomes a node on a vertical timeline.
 * Click any node → scrolls to its corresponding card in the main view.
 */

export interface TimelineEvent {
  id: string;            // unique key, also DOM id of target card
  kind: 'cycle' | 'branch' | 'decision' | 'final' | 'inject';
  label: string;
  detail?: string;
  ts: number;            // ms since session start
  payload?: Record<string, unknown>;
}

const KIND_THEME: Record<TimelineEvent['kind'], { color: string; icon: string }> = {
  cycle:    { color: '#E8B988', icon: '◐' },
  inject:   { color: '#A8BCD8', icon: '🌿' },
  branch:   { color: '#8BA888', icon: '◈' },
  decision: { color: '#F5C896', icon: '⚖' },
  final:    { color: '#F0EDEA', icon: '◆' },
};

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export function DebateTimeline({
  events,
  activeId,
  onJump,
}: {
  events: TimelineEvent[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  if (events.length === 0) return null;

  return (
    <aside
      className="
        hidden xl:flex flex-col
        fixed right-4 top-[136px] bottom-4 w-[300px] z-30
        glass rounded-xl border border-amber-300/35 shadow-glow
        overflow-hidden
      "
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-deep-400/35 bg-gradient-to-b from-amber-300/[0.04] to-transparent">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-mono tracking-[0.22em] text-amber-300/95 uppercase font-semibold">
            ⊜ TIMELINE
          </span>
          <span className="text-[10px] font-mono text-deep-300 tabular-nums">
            {events.length} 事件
          </span>
        </div>
        <p className="text-[10px] font-mono text-deep-300 leading-snug">
          按时间顺序的辩论进展 · 点击节点回溯
        </p>
      </div>

      {/* Vertical scrollable timeline */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="relative pl-6">
          {/* Vertical spine */}
          <span className="absolute left-[14px] top-2 bottom-2 w-px bg-gradient-to-b from-amber-300/45 via-deep-400/45 to-deep-400/15" />

          <ul className="space-y-1.5 fade-stagger" style={{ ['--stagger-step' as any]: '40ms' }}>
            {events.map((ev) => {
              const theme = KIND_THEME[ev.kind];
              const active = ev.id === activeId;
              return (
                <li key={ev.id} className="relative">
                  {/* Node dot */}
                  <span
                    className={`
                      absolute -left-[18px] top-2 w-2.5 h-2.5 rounded-full
                      ${active ? 'animate-pulse-slow' : ''}
                    `}
                    style={{
                      background: theme.color,
                      boxShadow: active
                        ? `0 0 12px ${theme.color}, 0 0 0 3px ${theme.color}33`
                        : `0 0 4px ${theme.color}88`,
                    }}
                  />
                  <button
                    onClick={() => onJump(ev.id)}
                    className={`
                      group block w-full text-left px-2 py-1.5 rounded transition-all
                      ${active
                        ? 'bg-amber-300/[0.06] border border-amber-300/55'
                        : 'hover:bg-deep-700/30 border border-transparent'}
                    `}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ color: theme.color }} className="text-[12px]">
                        {theme.icon}
                      </span>
                      <span className="text-[11px] font-mono font-medium text-deep-50 truncate flex-1">
                        {ev.label}
                      </span>
                      <span className="text-[10px] font-mono text-deep-300 tabular-nums shrink-0">
                        {fmtMs(ev.ts)}
                      </span>
                    </div>
                    {ev.detail && (
                      <p className="text-[11px] text-deep-200/85 leading-snug pl-5 line-clamp-2 group-hover:text-deep-100">
                        {ev.detail}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-deep-400/30 text-[10px] font-mono text-deep-300 leading-snug">
        ◐ cycle · 🌿 注入 · ◈ 分支 · ⚖ 决策 · ◆ 终评
      </div>
    </aside>
  );
}
