/**
 * Interactive D3 force-directed causal graph visualization.
 * Deep-space-warm theme: amber/earth tones on dark background.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useCausalStore } from '../../store/causalStore';

// D3 will be imported dynamically to avoid SSR issues
let d3: typeof import('d3');

const CATEGORY_COLORS: Record<string, string> = {
  economic: '#C49058',
  social: '#8BA888',
  environmental: '#6EBF8B',
  political: '#8B9FBF',
};

const EDGE_COLORS: Record<string, string> = {
  positive: '#6EBF8B',
  negative: '#C47D5A',
  complex: '#8B9FBF',
};

interface D3Node {
  id: string;
  label: string;
  category: string;
  importance_score: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link {
  source: string | D3Node;
  target: string | D3Node;
  relationship: string;
  strength: number;
  mechanism: string;
}

export function CausalGraphView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<any>(null);

  const { nodes, edges, selectedNodeId, affectedNodeIds, selectNode } = useCausalStore();

  const setupGraph = useCallback(async () => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    // Dynamic import of d3
    if (!d3) {
      d3 = await import('d3');
    }

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = Math.max(500, container.clientHeight);

    // Prepare data (deep copy to avoid mutation)
    const d3Nodes: D3Node[] = nodes.map(n => ({
      id: n.id,
      label: n.label,
      category: n.category,
      importance_score: n.importance_score,
    }));

    const d3Links: D3Link[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      relationship: e.relationship,
      strength: e.strength,
      mechanism: e.mechanism,
    }));

    // Clear previous
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Root group for zoom/pan
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Arrow markers for directed edges
    const defs = svg.append('defs');
    ['positive', 'negative', 'complex'].forEach(rel => {
      defs.append('marker')
        .attr('id', `arrow-${rel}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 25)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', EDGE_COLORS[rel] || '#8B9FBF');
    });

    // Links
    const linkGroup = g.append('g').attr('class', 'links');
    const links = linkGroup
      .selectAll('line')
      .data(d3Links)
      .enter()
      .append('line')
      .attr('stroke', d => EDGE_COLORS[d.relationship] || '#8B9FBF')
      .attr('stroke-width', d => 1 + d.strength * 2.5)
      .attr('stroke-opacity', 0.25)
      .attr('stroke-dasharray', d => d.relationship === 'complex' ? '6,4' : '0')
      .attr('marker-end', d => `url(#arrow-${d.relationship})`);

    // Link hover labels (hidden by default)
    const linkLabels = g.append('g').attr('class', 'link-labels');
    const linkTexts = linkLabels
      .selectAll('text')
      .data(d3Links)
      .enter()
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', '#A8A29E')
      .attr('opacity', 0)
      .text(d => d.mechanism.substring(0, 24));

    // Node groups
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeGs = nodeGroup
      .selectAll('g')
      .data(d3Nodes)
      .enter()
      .append('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => {
        selectNode(d.id === selectedNodeId ? null : d.id);
      })
      .on('mouseenter', function (_, d) {
        // Highlight connected edges
        links
          .attr('stroke-opacity', l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return src === d.id || tgt === d.id ? 0.7 : 0.1;
          });
        linkTexts
          .attr('opacity', l => {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            return src === d.id || tgt === d.id ? 1 : 0;
          });
      })
      .on('mouseleave', function () {
        links.attr('stroke-opacity', 0.25);
        linkTexts.attr('opacity', 0);
      });

    // Drag behavior
    const drag = d3.drag<SVGGElement, D3Node>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeGs.call(drag);

    // Node outer glow (for affected nodes)
    nodeGs.append('circle')
      .attr('r', d => 20 + d.importance_score * 12)
      .attr('fill', 'none')
      .attr('stroke', d => CATEGORY_COLORS[d.category] || '#8B9FBF')
      .attr('stroke-width', 0)
      .attr('stroke-opacity', 0.3)
      .attr('class', 'node-glow');

    // Node circle
    nodeGs.append('circle')
      .attr('r', d => 12 + d.importance_score * 10)
      .attr('fill', d => {
        const color = CATEGORY_COLORS[d.category] || '#8B9FBF';
        return color + '30'; // 19% opacity fill
      })
      .attr('stroke', d => CATEGORY_COLORS[d.category] || '#8B9FBF')
      .attr('stroke-width', 1.5)
      .attr('class', 'node-circle');

    // Node label
    nodeGs.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', d => (12 + d.importance_score * 10) + 14)
      .attr('font-size', 10)
      .attr('fill', '#D4D0CC')
      .attr('pointer-events', 'none')
      .text(d => d.label.length > 10 ? d.label.substring(0, 10) + '…' : d.label);

    // Importance indicator (small inner dot)
    nodeGs.append('circle')
      .attr('r', d => 2 + d.importance_score * 3)
      .attr('fill', d => CATEGORY_COLORS[d.category] || '#8B9FBF')
      .attr('opacity', 0.8);

    // Simulation
    const simulation = d3.forceSimulation(d3Nodes)
      .force('link', d3.forceLink(d3Links)
        .id((d: any) => d.id)
        .distance(120)
        .strength(0.08)
      )
      .force('charge', d3.forceManyBody().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03));

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      links
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      linkTexts
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 6);

      nodeGs.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Center the graph after initial stabilization
    simulation.on('end', () => {
      const bounds = (g.node() as SVGGElement)?.getBBox();
      if (bounds) {
        const dx = bounds.width;
        const dy = bounds.height;
        const x = bounds.x + dx / 2;
        const y = bounds.y + dy / 2;
        const scale = 0.85 / Math.max(dx / width, dy / height);
        const tx = width / 2 - scale * x;
        const ty = height / 2 - scale * y;
        svg.transition().duration(750).call(
          zoom.transform,
          d3.zoomIdentity.translate(tx, ty).scale(scale)
        );
      }
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges]);

  // Update visual state for selection and propagation effects
  useEffect(() => {
    if (!svgRef.current || !d3) return;

    const svg = d3.select(svgRef.current);

    // Update node selection state
    svg.selectAll('.node-circle')
      .attr('stroke-width', (d: any) =>
        d.id === selectedNodeId ? 3 : 1.5
      )
      .attr('stroke', (d: any) => {
        if (d.id === selectedNodeId) return '#D4A574';
        return CATEGORY_COLORS[d.category] || '#8B9FBF';
      });

    // Update glow for affected nodes
    svg.selectAll('.node-glow')
      .attr('stroke-width', (d: any) =>
        affectedNodeIds.has(d.id) ? 4 : 0
      )
      .attr('stroke', (d: any) => {
        if (d.id === selectedNodeId) return '#D4A574';
        if (affectedNodeIds.has(d.id)) return EDGE_COLORS.positive;
        return 'none';
      });
  }, [selectedNodeId, affectedNodeIds]);

  // Initial setup
  useEffect(() => {
    const cleanup = setupGraph();
    return () => {
      cleanup?.then(fn => fn?.());
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [setupGraph]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[500px] relative">
      <svg
        ref={svgRef}
        className="w-full h-full rounded-lg border border-deep-400/40 bg-deep-950"
        style={{ minHeight: '500px' }}
      />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex gap-4 text-[15px] font-mono text-deep-200/85">
        {Object.entries(CATEGORY_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span>
              {key === 'economic' ? '经济' :
               key === 'social' ? '社会' :
               key === 'environmental' ? '环境' : '政治'}
            </span>
          </div>
        ))}
      </div>

      {/* Edge legend */}
      <div className="absolute bottom-3 right-3 flex gap-3 text-[15px] font-mono text-deep-200/85">
        <span className="flex items-center gap-1">
          <span className="w-4 h-px" style={{ backgroundColor: EDGE_COLORS.positive }} /> 正向
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-px" style={{ backgroundColor: EDGE_COLORS.negative }} /> 负向
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-0 border-t border-dashed" style={{ borderColor: EDGE_COLORS.complex }} /> 复杂
        </span>
      </div>
    </div>
  );
}
