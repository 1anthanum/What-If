/**
 * Vertical decision-tree view for the autonomous topic explorer.
 * Root  = 议题
 * Level 1 = baseline branch (b0-base)
 * Level N = cycle-N branches; if cycle N-1 was a "deepen" decision, they
 *           hang under the target branch — otherwise they're root siblings.
 *
 * Click a node → onSelect(branch_id) so the parent view can scroll/highlight.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

export interface TreeBranchEval {
  confidence: number;
  coherence: number;
  novelty: number;
  risk_signal: number;
  one_line_takeaway: string;
}
export interface TreeBranch {
  branch_id: string;
  cycle: number;
  injection: string;
  eval: TreeBranchEval | null;
}
export interface TreeDecision {
  cycle: number;
  verdict: {
    action: 'deepen' | 'diverge' | 'converge';
    target_branch_id: string | null;
  };
}

interface RawNode {
  id: string;
  branch?: TreeBranch;
  topic?: string;
  children: RawNode[];
}

function buildTree(topic: string, branches: TreeBranch[], decisions: TreeDecision[]): RawNode {
  const byCycle: Record<number, TreeBranch[]> = {};
  branches.forEach(b => {
    (byCycle[b.cycle] = byCycle[b.cycle] || []).push(b);
  });

  const root: RawNode = { id: 'topic', topic, children: [] };

  // Cycle 0 = direct children of topic
  (byCycle[0] || []).forEach(b => {
    root.children.push({ id: b.branch_id, branch: b, children: [] });
  });

  const findNode = (n: RawNode, id: string): RawNode | null => {
    if (n.id === id) return n;
    for (const c of n.children) {
      const f = findNode(c, id);
      if (f) return f;
    }
    return null;
  };

  const maxCycle = branches.reduce((m, b) => Math.max(m, b.cycle), 0);
  for (let c = 1; c <= maxCycle; c++) {
    const decision = decisions.find(d => d.cycle === c - 1);
    const target =
      decision?.verdict.action === 'deepen' ? decision.verdict.target_branch_id : null;
    const parent = (target && findNode(root, target)) || root;
    (byCycle[c] || []).forEach(b => {
      parent.children.push({ id: b.branch_id, branch: b, children: [] });
    });
  }
  return root;
}

function nodeFill(b: TreeBranch | undefined): { color: string; ring: string } {
  if (!b || !b.eval) return { color: '#3A3633', ring: '#7A736C' };
  const c = b.eval.confidence;
  if (c >= 80) return { color: '#6EBF8B', ring: '#8BCFA1' };
  if (c >= 60) return { color: '#D4A574', ring: '#E8B988' };
  if (c >= 40) return { color: '#9B7B6B', ring: '#C49058' };
  return { color: '#C47D5A', ring: '#D88E6E' };
}

export function DecisionTreeView({
  topic,
  branches,
  decisions,
  activeBranchId,
  onSelect,
}: {
  topic: string;
  branches: TreeBranch[];
  decisions: TreeDecision[];
  activeBranchId: string | null;
  onSelect: (id: string) => void;
}) {
  const layout = useMemo(() => {
    if (branches.length === 0) return null;
    const raw = buildTree(topic, branches, decisions);
    const root = d3.hierarchy<RawNode>(raw, n => n.children);
    const w = Math.max(640, root.leaves().length * 200);
    const h = (root.height + 1) * 130;
    return d3.tree<RawNode>().size([w, h])(root);
  }, [topic, branches, decisions]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const [transformLabel, setTransformLabel] = useState('100%');

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 2.5])
      .on('zoom', (ev) => {
        g.attr('transform', ev.transform.toString());
        setTransformLabel(`${Math.round(ev.transform.k * 100)}%`);
      });
    svg.call(zoom);
    // Reset zoom on layout change
    svg.call(zoom.transform, d3.zoomIdentity);
    return () => { svg.on('.zoom', null); };
  }, [layout]);

  const handleResetZoom = () => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(
      d3.zoom<SVGSVGElement, unknown>().transform as any,
      d3.zoomIdentity,
    );
  };

  if (!layout) {
    return (
      <div className="glass-subtle rounded-lg p-8 text-center">
        <p className="text-[13px] text-deep-300">尚无分支可绘制</p>
      </div>
    );
  }

  const nodes = layout.descendants();
  const links = layout.links();
  const padX = 60;
  const padY = 40;
  const xs = nodes.map(n => n.x);
  const ys = nodes.map(n => n.y);
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - padY;
  const maxY = Math.max(...ys) + padY;
  const w = maxX - minX;
  const h = maxY - minY;

  const linkPath = d3
    .linkVertical<d3.HierarchyPointLink<RawNode>, d3.HierarchyPointNode<RawNode>>()
    .x(n => n.x)
    .y(n => n.y);

  return (
    <div className="glass-subtle rounded-lg p-3 overflow-hidden relative">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-deep-900/80 border border-deep-400/45 rounded px-2 py-1 backdrop-blur-sm">
        <span className="text-[10px] font-mono text-amber-300/95 tabular-nums">{transformLabel}</span>
        <button
          onClick={handleResetZoom}
          className="text-[10px] font-mono text-deep-200 hover:text-amber-300 px-1.5 py-0.5 ml-1 rounded border border-deep-400/45 hover:border-amber-300/55"
          title="重置缩放"
        >⟲</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${minX} ${minY} ${w} ${h}`}
        style={{ minWidth: 640, width: '100%', height: Math.max(360, h * 0.85), cursor: 'grab' }}
        className="block"
      >
        <g ref={gRef}>
        {/* Soft grid background */}
        <defs>
          <pattern id="treegrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(232,185,136,0.04)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={minX} y={minY} width={w} height={h} fill="url(#treegrid)" />

        {/* Links */}
        {links.map((l, i) => (
          <path
            key={i}
            d={linkPath(l) || ''}
            fill="none"
            stroke="rgba(232,185,136,0.30)"
            strokeWidth={1.5}
          />
        ))}

        {/* Nodes */}
        {nodes.map((n, i) => {
          const isTopic = n.data.id === 'topic';
          const branch = n.data.branch;
          const active = activeBranchId === n.data.id;
          const fill = nodeFill(branch);
          const w0 = isTopic ? 200 : 160;
          const h0 = isTopic ? 56 : 70;
          const conf = branch?.eval?.confidence ?? null;
          const novelty = branch?.eval?.novelty ?? null;
          const risk = branch?.eval?.risk_signal ?? null;
          const takeaway = branch?.eval?.one_line_takeaway || branch?.injection || '';
          return (
            <g
              key={i}
              transform={`translate(${n.x - w0 / 2}, ${n.y - h0 / 2})`}
              onClick={() => !isTopic && onSelect(n.data.id)}
              style={{ cursor: isTopic ? 'default' : 'pointer' }}
            >
              <rect
                width={w0}
                height={h0}
                rx={8}
                fill={isTopic ? 'rgba(20,17,15,0.95)' : `${fill.color}22`}
                stroke={active ? '#F5C896' : isTopic ? '#F5C896' : fill.ring}
                strokeWidth={active ? 2.5 : isTopic ? 2 : 1.5}
                style={{
                  filter: active ? `drop-shadow(0 0 8px ${fill.ring}88)` : undefined,
                }}
              />
              {isTopic ? (
                <>
                  <text
                    x={w0 / 2} y={20}
                    textAnchor="middle"
                    fontFamily="JetBrains Mono, monospace"
                    fontSize={10}
                    fill="#F5C896"
                    letterSpacing="0.20em"
                  >议题</text>
                  <text
                    x={w0 / 2} y={42}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#F2EDE7"
                  >
                    {(n.data.topic || '').slice(0, 24)}
                    {(n.data.topic || '').length > 24 ? '…' : ''}
                  </text>
                </>
              ) : (
                <>
                  <text
                    x={8} y={14}
                    fontFamily="JetBrains Mono, monospace"
                    fontSize={10}
                    fill={fill.ring}
                    letterSpacing="0.10em"
                  >{n.data.id}</text>
                  {conf !== null && (
                    <text
                      x={w0 - 8} y={14}
                      textAnchor="end"
                      fontFamily="JetBrains Mono, monospace"
                      fontSize={10}
                      fill="#DAD2C8"
                    >conf {conf}</text>
                  )}
                  <text x={8} y={32} fontSize={11} fill="#F2EDE7">
                    {(branch?.injection || '基线').slice(0, 22)}
                    {(branch?.injection || '').length > 22 ? '…' : ''}
                  </text>
                  <text x={8} y={50} fontSize={10} fill="rgba(218,210,200,0.85)">
                    {takeaway.slice(0, 24)}{takeaway.length > 24 ? '…' : ''}
                  </text>
                  {novelty !== null && risk !== null && (
                    <g transform={`translate(8, ${h0 - 8})`}>
                      <text fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#A8BCD8">
                        nov {novelty}
                      </text>
                      <text x={50} fontFamily="JetBrains Mono, monospace" fontSize={9} fill="#D88E6E">
                        risk {risk}
                      </text>
                    </g>
                  )}
                </>
              )}
            </g>
          );
        })}
        </g>
      </svg>
      <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-deep-300 tracking-wider">
        <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#6EBF8B' }} /> 高信心 ≥80</span>
        <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#D4A574' }} /> 60–79</span>
        <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#9B7B6B' }} /> 40–59</span>
        <span><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#C47D5A' }} /> &lt;40</span>
        <span className="ml-auto">滚轮缩放 · 拖拽平移 · 点击节点跳转</span>
      </div>
    </div>
  );
}
