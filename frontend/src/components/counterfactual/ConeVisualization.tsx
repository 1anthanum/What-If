import { useState, useRef, useMemo, useCallback } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import {
  computeConeGeometry,
  getYearSlice,
  type YearSlice,
} from '../../lib/coneRenderer';

const PADDING = 50;
const SVG_HEIGHT = 420;

export function ConeVisualization() {
  const { possibilityBranches, modification, tokenUsage } = useCounterfactualStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const svgWidth = 800; // fixed; container will scroll horizontally if narrow

  const geometry = useMemo(
    () => computeConeGeometry(possibilityBranches, svgWidth, SVG_HEIGHT, PADDING),
    [possibilityBranches],
  );

  const yearSlice: YearSlice | null = useMemo(
    () => (hoveredYear !== null ? getYearSlice(possibilityBranches, hoveredYear) : null),
    [possibilityBranches, hoveredYear],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!geometry.bands.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const [minYear, maxYear] = geometry.yearRange;
      const yearSpan = maxYear - minYear || 1;
      const plotWidth = svgWidth - PADDING * 2;

      const year = Math.round(minYear + ((x - PADDING) / plotWidth) * yearSpan);
      if (year >= minYear && year <= maxYear) {
        setHoveredYear(year);
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setHoveredYear(null);
        setTooltipPos(null);
      }
    },
    [geometry],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredYear(null);
    setTooltipPos(null);
  }, []);

  if (!possibilityBranches.length) return null;

  const [minYear, maxYear] = geometry.yearRange;
  const yearSpan = maxYear - minYear || 1;
  const plotWidth = svgWidth - PADDING * 2;

  // Generate year tick marks
  const yearStep = yearSpan <= 20 ? 5 : yearSpan <= 50 ? 10 : 20;
  const yearTicks: number[] = [];
  const startTick = Math.ceil(minYear / yearStep) * yearStep;
  for (let y = startTick; y <= maxYear; y += yearStep) {
    yearTicks.push(y);
  }

  const xScale = (year: number) => PADDING + ((year - minYear) / yearSpan) * plotWidth;
  const yCenter = SVG_HEIGHT / 2;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="glass border border-amber-300/8 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-amber-300/20 to-amber-600/20 flex items-center justify-center border border-amber-300/20">
              <span className="text-amber-300/80 text-sm">▽</span>
            </div>
            <div>
              <h3 className="text-xs font-mono text-amber-300/80 uppercase tracking-wider">
                概率锥视图
              </h3>
              <p className="text-[9px] font-mono text-deep-200/40 mt-0.5">
                {possibilityBranches.length} 个分支叠加 · 透明度 ∝ 共识度
              </p>
            </div>
          </div>
          {tokenUsage && (
            <span className="text-[9px] font-mono text-deep-200/30 border border-deep-400/10 px-2 py-1 rounded">
              ${tokenUsage.estimated_cost_usd.toFixed(3)}
            </span>
          )}
        </div>
        <div className="text-[10px] text-deep-200/50 bg-deep-700/30 rounded px-3 py-2 mt-3 border border-deep-400/10">
          假设：「{modification}」
        </div>
      </div>

      {/* SVG Cone */}
      <div
        ref={containerRef}
        className="glass border border-deep-400/8 rounded-lg p-4 overflow-x-auto relative"
      >
        <svg
          width={svgWidth}
          height={SVG_HEIGHT}
          className="block mx-auto"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background grid */}
          <defs>
            <linearGradient id="cone-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(196,144,88,0.02)" />
              <stop offset="50%" stopColor="rgba(196,144,88,0.04)" />
              <stop offset="100%" stopColor="rgba(196,144,88,0.02)" />
            </linearGradient>
          </defs>

          {/* Plot background */}
          <rect
            x={PADDING}
            y={PADDING}
            width={plotWidth}
            height={SVG_HEIGHT - PADDING * 2}
            fill="url(#cone-bg)"
            rx={4}
          />

          {/* Center line (actual history) */}
          <line
            x1={PADDING}
            y1={yCenter}
            x2={svgWidth - PADDING}
            y2={yCenter}
            stroke="rgba(196,144,88,0.2)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={PADDING - 4}
            y={yCenter + 3}
            textAnchor="end"
            className="text-[8px] font-mono"
            fill="rgba(196,144,88,0.3)"
          >
            实际
          </text>

          {/* Year ticks */}
          {yearTicks.map((year) => {
            const x = xScale(year);
            return (
              <g key={year}>
                <line
                  x1={x}
                  y1={PADDING}
                  x2={x}
                  y2={SVG_HEIGHT - PADDING}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={SVG_HEIGHT - PADDING + 16}
                  textAnchor="middle"
                  className="text-[9px] font-mono"
                  fill="rgba(255,255,255,0.2)"
                >
                  {year}
                </text>
              </g>
            );
          })}

          {/* Divergence labels */}
          {[0.25, 0.5, 0.75].map((level) => {
            const yUp = yCenter - (level * (SVG_HEIGHT - PADDING * 2)) / 2 / geometry.maxDivergence;
            const yDown = yCenter + (level * (SVG_HEIGHT - PADDING * 2)) / 2 / geometry.maxDivergence;
            return (
              <g key={level}>
                <line
                  x1={PADDING}
                  y1={yUp}
                  x2={svgWidth - PADDING}
                  y2={yUp}
                  stroke="rgba(255,255,255,0.02)"
                  strokeWidth={0.5}
                />
                <line
                  x1={PADDING}
                  y1={yDown}
                  x2={svgWidth - PADDING}
                  y2={yDown}
                  stroke="rgba(255,255,255,0.02)"
                  strokeWidth={0.5}
                />
              </g>
            );
          })}

          {/* Cone bands (rendered with screen blend for overlapping areas) */}
          <g style={{ mixBlendMode: 'screen' }}>
            {geometry.bands.map((band) => (
              <path
                key={band.clusterId}
                d={band.areaPath}
                fill={band.color}
                fillOpacity={band.opacity}
                stroke={band.color}
                strokeOpacity={band.opacity * 0.6}
                strokeWidth={0.5}
              />
            ))}
          </g>

          {/* Center lines per band (narrative trace) */}
          {geometry.bands.map((band) => {
            const centerPoints = band.points
              .map((pt) => {
                const x = PADDING + ((pt.year - minYear) / yearSpan) * plotWidth;
                const y = yCenter - (pt.divergence * (SVG_HEIGHT - PADDING * 2)) / 2 / geometry.maxDivergence;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' L ');
            return (
              <path
                key={`center-${band.clusterId}`}
                d={`M ${centerPoints}`}
                fill="none"
                stroke={band.color}
                strokeOpacity={band.opacity * 1.2}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            );
          })}

          {/* Hover line */}
          {hoveredYear !== null && (
            <line
              x1={xScale(hoveredYear)}
              y1={PADDING}
              x2={xScale(hoveredYear)}
              y2={SVG_HEIGHT - PADDING}
              stroke="rgba(196,144,88,0.5)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* Origin point */}
          <circle
            cx={PADDING}
            cy={yCenter}
            r={4}
            fill="rgba(196,144,88,0.8)"
            stroke="rgba(196,144,88,0.4)"
            strokeWidth={2}
          />
        </svg>

        {/* Tooltip */}
        {yearSlice && tooltipPos && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{
              left: Math.min(tooltipPos.x + 12, svgWidth - 260),
              top: Math.max(tooltipPos.y - 20, 8),
            }}
          >
            <div className="glass border border-amber-300/15 rounded-lg p-3 shadow-lg min-w-[220px] max-w-[280px]">
              <div className="text-[10px] font-mono text-amber-300/60 mb-2">
                {yearSlice.year} 年
              </div>
              <div className="space-y-2">
                {yearSlice.branches
                  .sort((a, b) => b.consensusStrength - a.consensusStrength)
                  .map((b) => (
                    <div key={b.branchIndex} className="flex items-start gap-2">
                      <span
                        className="w-2 h-2 rounded-full mt-1 shrink-0"
                        style={{ backgroundColor: b.color, opacity: 0.8 }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-white/60 truncate">
                            {b.narrativeDirection}
                          </span>
                          <span className="text-[8px] font-mono text-amber-300/40">
                            {Math.round(b.consensusStrength * 100)}%
                          </span>
                        </div>
                        <p className="text-[9px] text-deep-200/45 leading-snug mt-0.5">
                          {b.counterfactual.length > 80
                            ? b.counterfactual.slice(0, 80) + '…'
                            : b.counterfactual}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-[9px] font-mono text-deep-200/30">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: 'rgb(226,164,68)', opacity: 0.6 }} />
          <span>高共识</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: 'rgb(139,159,191)', opacity: 0.4 }} />
          <span>中共识</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-1.5 rounded-sm" style={{ backgroundColor: 'rgb(100,120,175)', opacity: 0.3 }} />
          <span>低共识</span>
        </div>
        <span className="text-deep-400/20">|</span>
        <span>带宽 ∝ 置信度 · 透明度 ∝ 共识度</span>
      </div>
    </div>
  );
}
