/**
 * Propagation network viewer — visualizes how individual arguments
 * propagate across debate cycles (cited / extended / refuted / modified /
 * ignored). Triggered from SessionBrowser → SessionDetailView.
 *
 * Layout: column per cycle, nodes stacked vertically per cycle, edges
 * drawn as colored SVG paths. Read left-to-right.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  sessionsApi,
  type PropagationReport,
  type PropagationArgument,
  type PropagationEdge,
  type PropagationEdgeKind,
} from '../../services/sessionsApi';

interface Props {
  sessionId: string;
  onClose: () => void;
}

const EDGE_COLOR: Record<PropagationEdgeKind, string> = {
  cites:   '#6EBF8B',                    // earth-green
  extends: '#8B9FBF',                    // info blue
  refutes: '#C47D5A',                    // earth-rust
  modifies: '#D4A574',                   // amber-300
  ignores_despite_relevance: '#6b7280',  // gray
};

const EDGE_LABEL: Record<PropagationEdgeKind, string> = {
  cites: '引用', extends: '扩展', refutes: '反驳',
  modifies: '修正', ignores_despite_relevance: '回避',
};

const PERSONA_COLOR: Record<string, string> = {
  rationalist:         '#60a5fa',
  existentialist:      '#fb7185',
  pragmatist:          '#34d399',
  eastern_philosopher: '#fbbf24',
  critical_theorist:   '#c084fc',
  adversary:           '#ef4444',
};

export function PropagationView({ sessionId, onClose }: Props) {
  const [data, setData] = useState<PropagationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [filterKind, setFilterKind] = useState<PropagationEdgeKind | 'all'>('all');

  useEffect(() => {
    (async () => {
      try { setData(await sessionsApi.propagation(sessionId)); }
      catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, [sessionId]);

  // Compute layout
  const layout = useMemo(() => {
    if (!data || !data.arguments.length) return null;
    const byCycle = new Map<number, PropagationArgument[]>();
    for (const arg of data.arguments) {
      const list = byCycle.get(arg.cycle) || [];
      list.push(arg);
      byCycle.set(arg.cycle, list);
    }
    const cycles = Array.from(byCycle.keys()).sort((a, b) => a - b);
    const columnWidth = 220;
    const nodeHeight = 64;
    const nodeGap = 14;
    const padX = 20;
    const padY = 30;
    const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
    cycles.forEach((cycle, colIdx) => {
      const args = byCycle.get(cycle) || [];
      args.forEach((arg, rowIdx) => {
        positions.set(arg.id, {
          x: padX + colIdx * columnWidth,
          y: padY + rowIdx * (nodeHeight + nodeGap),
          w: columnWidth - 30,
          h: nodeHeight,
        });
      });
    });
    const totalWidth = padX * 2 + cycles.length * columnWidth;
    const maxRows = Math.max(...Array.from(byCycle.values(), (l) => l.length));
    const totalHeight = padY * 2 + maxRows * (nodeHeight + nodeGap);
    return { cycles, byCycle, positions, totalWidth, totalHeight, columnWidth, nodeHeight };
  }, [data]);

  const visibleEdges = useMemo(() => {
    if (!data) return [];
    return data.edges.filter((e) => filterKind === 'all' || e.kind === filterKind);
  }, [data, filterKind]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-deep-950/90 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-6xl w-full glass border border-purple-400/30 rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-purple-400/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-purple-400/45 rounded-full">
            <span>🕸</span>
            论点扩散网络
          </div>
          <h2 className="text-lg font-light text-white">
            session <span className="text-amber-300">#{sessionId}</span> 论点流动图
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            每个节点 = 一个独立论点。每条边 = 后续 persona 如何处理它（引用 / 扩展 / 反驳 / 修正 / 回避）。
            列从左到右是时间（cycle）。粗体的「主线」是贯穿多 cycle 的论点链。
          </p>
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-deep-200/65 italic">
            LLM 正在识别论点单元 + 跨 cycle 关系…
          </div>
        ) : data ? (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            {/* Legend + filter */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="text-deep-300/85">边类型:</span>
              {(['all', 'cites', 'extends', 'refutes', 'modifies', 'ignores_despite_relevance'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilterKind(k)}
                  className={`px-1.5 py-0.5 rounded border tabular-nums ${
                    filterKind === k
                      ? 'border-amber-300/65 bg-amber-300/[0.10] text-amber-200'
                      : 'border-deep-400/40 text-deep-100/85 hover:border-amber-300/45'
                  }`}
                  style={k !== 'all' ? { borderLeftColor: EDGE_COLOR[k as PropagationEdgeKind], borderLeftWidth: 3 } : undefined}
                >
                  {k === 'all' ? '全部' : EDGE_LABEL[k as PropagationEdgeKind]}
                  {k !== 'all' && (
                    <span className="ml-1 text-deep-300/65">
                      {data.edges.filter((e) => e.kind === k).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Network SVG */}
            {layout && (
              <div className="rounded border border-deep-400/30 bg-deep-800/40 overflow-x-auto">
                <svg
                  width={layout.totalWidth}
                  height={Math.max(300, layout.totalHeight)}
                  className="block"
                >
                  {/* Cycle column headers */}
                  {layout.cycles.map((cycle, i) => (
                    <text
                      key={`hdr-${cycle}`}
                      x={20 + i * layout.columnWidth + (layout.columnWidth - 30) / 2}
                      y={18}
                      fill="#D4A574"
                      fontSize={11}
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                    >
                      Cycle {cycle}
                    </text>
                  ))}

                  {/* Edges */}
                  {visibleEdges.map((edge: PropagationEdge, i) => {
                    const from = layout.positions.get(edge.from);
                    const to = layout.positions.get(edge.to);
                    if (!from || !to) return null;
                    const x1 = from.x + from.w;
                    const y1 = from.y + from.h / 2;
                    const x2 = to.x;
                    const y2 = to.y + to.h / 2;
                    const midX = (x1 + x2) / 2;
                    const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                    const isHover = hoverEdge === i;
                    return (
                      <g key={`edge-${i}`} onMouseEnter={() => setHoverEdge(i)} onMouseLeave={() => setHoverEdge(null)}>
                        <path
                          d={path}
                          stroke={EDGE_COLOR[edge.kind]}
                          strokeWidth={isHover ? 2.5 : 1.4}
                          opacity={isHover ? 1 : 0.5}
                          fill="none"
                          strokeDasharray={edge.kind === 'ignores_despite_relevance' ? '4 3' : undefined}
                        />
                        {isHover && (
                          <g>
                            <rect
                              x={midX - 60} y={(y1 + y2) / 2 - 12}
                              width={120} height={22} rx={3}
                              fill="#0C0A09" stroke={EDGE_COLOR[edge.kind]} strokeWidth={1}
                            />
                            <text
                              x={midX} y={(y1 + y2) / 2 + 4}
                              fill={EDGE_COLOR[edge.kind]} fontSize={10}
                              fontFamily="JetBrains Mono, monospace" textAnchor="middle"
                            >
                              {EDGE_LABEL[edge.kind]}: {edge.note}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* Nodes */}
                  {data.arguments.map((arg) => {
                    const pos = layout.positions.get(arg.id);
                    if (!pos) return null;
                    const isDead = data.dead_ends.includes(arg.id);
                    const color = PERSONA_COLOR[arg.persona_id] || '#a8a29e';
                    return (
                      <g key={arg.id}>
                        <rect
                          x={pos.x} y={pos.y} width={pos.w} height={pos.h}
                          rx={4}
                          fill="rgba(28,25,23,0.85)"
                          stroke={color}
                          strokeWidth={1.4}
                          opacity={isDead ? 0.45 : 1}
                          strokeDasharray={isDead ? '4 3' : undefined}
                        />
                        <text
                          x={pos.x + 8} y={pos.y + 14}
                          fill={color} fontSize={9}
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {arg.persona_name}
                        </text>
                        <foreignObject
                          x={pos.x + 6} y={pos.y + 18}
                          width={pos.w - 12} height={pos.h - 22}
                        >
                          <div
                            style={{ fontSize: 11, color: '#f5f5f4', lineHeight: 1.3, overflow: 'hidden' }}
                          >
                            {arg.summary}
                          </div>
                        </foreignObject>
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}

            {/* Key threads */}
            {data.key_threads.length > 0 && (
              <div className="rounded border border-amber-300/35 bg-amber-300/[0.04] p-3">
                <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
                  跨 cycle 主线
                </p>
                <ul className="space-y-1 text-[12px] text-deep-50">
                  {data.key_threads.map((t, i) => (
                    <li key={i}>· {t}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Dead ends */}
            {data.dead_ends.length > 0 && (
              <div className="rounded border border-deep-400/30 bg-deep-700/20 p-3">
                <p className="text-[10px] font-mono text-deep-300/85 uppercase tracking-wider mb-1.5">
                  被忽略的论点（共 {data.dead_ends.length}）
                </p>
                <ul className="space-y-0.5 text-[11px] text-deep-200/75">
                  {data.dead_ends.map((id) => {
                    const arg = data.arguments.find((a) => a.id === id);
                    if (!arg) return null;
                    return (
                      <li key={id} className="italic">
                        · Cycle {arg.cycle} {arg.persona_name}：{arg.summary}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="text-[10px] font-mono text-deep-300/65">
              {data.arguments.length} 节点 · {data.edges.length} 边
              {data.model ? ` · model: ${data.model}` : ''}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
