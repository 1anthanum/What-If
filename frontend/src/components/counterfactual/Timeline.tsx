import { useCounterfactualStore } from '../../store/counterfactualStore';
import type { VulnerabilityPoint } from '../../services/api';

const CATEGORY_COLORS: Record<string, string> = {
  economic: '#C49058',
  social: '#8BA888',
  environmental: '#6EBF8B',
  political: '#8B9FBF',
  military: '#BF8B8B',
  cultural: '#B8A088',
};

const CONSTRAINT_LABELS: Record<string, string> = {
  factual_error: '事实错误',
  missing_factor: '缺失因素',
  domain_knowledge: '领域知识',
};

export function Timeline() {
  const {
    timelinePoints,
    expandedPointYear,
    setExpandedPoint,
    vulnerabilityPoints,
    falsifyStatus,
    annotations,
    setAnnotatingYear,
  } = useCounterfactualStore();

  // Build lookup maps
  const vulnByYear = new Map<number, VulnerabilityPoint>();
  for (const vp of vulnerabilityPoints) vulnByYear.set(vp.year, vp);
  const annotatedYears = new Set(annotations.map(a => a.year));

  if (!timelinePoints.length) return null;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-deep-300/40 border border-deep-300/30" />
          <span className="text-[14px] font-mono text-deep-200/50 uppercase tracking-wider">
            实际历史
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-300/60 border border-amber-300/40" />
          <span className="text-[14px] font-mono text-amber-300/95 uppercase tracking-wider">
            反事实推演
          </span>
        </div>
      </div>

      {/* Timeline Track */}
      <div className="relative">
        {/* Central spine */}
        <div className="absolute left-[50%] top-0 bottom-0 w-px bg-gradient-to-b from-deep-400/20 via-amber-300/15 to-deep-400/10" />

        {timelinePoints.map((point, idx) => {
          const isExpanded = expandedPointYear === point.year;
          const catColor = CATEGORY_COLORS[point.category] || '#8B9FBF';
          const divergePct = Math.round(point.divergence_level * 100);
          const confPct = Math.round(point.confidence * 100);

          return (
            <div key={`${point.year}-${idx}`} className="relative group">
              {/* Year marker on center spine */}
              <div className="flex items-stretch min-h-[80px]">
                {/* Left: Actual History */}
                <div className="flex-1 pr-6 flex justify-end">
                  <div className="max-w-sm text-right">
                    <p className="text-xs text-deep-200/50 leading-relaxed">
                      {point.actual}
                    </p>
                  </div>
                </div>

                {/* Center: Year Node */}
                <div className="relative flex flex-col items-center z-10 w-20 shrink-0">
                  <button
                    onClick={() =>
                      setExpandedPoint(isExpanded ? null : point.year)
                    }
                    className="relative group/node"
                  >
                    {/* Divergence ring */}
                    <div
                      className="w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 hover:scale-110"
                      style={{
                        borderColor: catColor,
                        backgroundColor: `${catColor}${Math.round(point.divergence_level * 40).toString(16).padStart(2, '0')}`,
                        boxShadow: isExpanded
                          ? `0 0 16px ${catColor}40`
                          : 'none',
                      }}
                    >
                      <span className="text-[14px] font-mono font-bold text-white/80">
                        {point.year}
                      </span>
                    </div>

                    {/* Divergence indicator */}
                    {divergePct > 30 && (
                      <div
                        className="absolute -right-1 -top-1 w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-mono font-bold"
                        style={{
                          backgroundColor: catColor,
                          color: '#1a1520',
                        }}
                      >
                        {divergePct}
                      </div>
                    )}

                    {/* Vulnerability indicator (red warning) */}
                    {vulnByYear.has(point.year) && (
                      <div
                        className="absolute -left-1 -top-1 w-4 h-4 rounded-full flex items-center justify-center text-[14px]"
                        style={{
                          backgroundColor: `rgba(220,80,60,${0.3 + (vulnByYear.get(point.year)!.severity * 0.7)})`,
                          border: '1px solid rgba(220,80,60,0.5)',
                        }}
                        title={`脆弱度 ${Math.round(vulnByYear.get(point.year)!.severity * 100)}%`}
                      >
                        ⚠
                      </div>
                    )}

                    {/* Annotation marker (blue) */}
                    {annotatedYears.has(point.year) && (
                      <div className="absolute -left-1 -bottom-1 w-4 h-4 rounded-full flex items-center justify-center text-[14px] bg-blue-500/50 border border-blue-400/60">
                        ✎
                      </div>
                    )}
                  </button>
                </div>

                {/* Right: Counterfactual */}
                <div className="flex-1 pl-6">
                  <div className="max-w-sm">
                    <p className="text-xs text-amber-300/70 leading-relaxed">
                      {point.counterfactual}
                    </p>
                  </div>
                </div>
              </div>

              {/* Expanded Detail Card */}
              {isExpanded && (
                <div className="mx-auto max-w-2xl my-3 glass border border-amber-300/40 rounded-lg overflow-hidden">
                  {/* Category bar */}
                  <div
                    className="h-1"
                    style={{ backgroundColor: catColor }}
                  />

                  <div className="p-4 space-y-3">
                    {/* Meta row */}
                    <div className="flex items-center gap-3">
                      <span
                        className="px-2 py-0.5 rounded text-[15px] font-mono uppercase tracking-wider"
                        style={{
                          backgroundColor: `${catColor}20`,
                          color: catColor,
                          border: `1px solid ${catColor}30`,
                        }}
                      >
                        {point.category}
                      </span>
                      <span className="text-[15px] font-mono text-deep-200/85">
                        偏离度 {divergePct}%
                      </span>
                      <span className="text-[15px] font-mono text-deep-200/85">
                        置信度 {confPct}%
                      </span>
                    </div>

                    {/* Divergence bar */}
                    <div className="h-1.5 rounded-full bg-deep-600/30 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${divergePct}%`,
                          background: `linear-gradient(90deg, ${catColor}60, ${catColor})`,
                        }}
                      />
                    </div>

                    {/* Reasoning */}
                    <div>
                      <h4 className="text-[14px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
                        推理过程
                      </h4>
                      <p className="text-xs text-deep-100/70 leading-relaxed">
                        {point.reasoning}
                      </p>
                    </div>

                    {/* Side-by-side comparison */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-2.5 rounded bg-deep-700/30 border border-deep-400/40">
                        <h5 className="text-[15px] font-mono text-deep-200/85 uppercase mb-1">
                          实际历史
                        </h5>
                        <p className="text-[15px] text-deep-200/95 leading-relaxed">
                          {point.actual}
                        </p>
                      </div>
                      <div className="p-2.5 rounded bg-amber-300/[0.04] border border-amber-300/40">
                        <h5 className="text-[15px] font-mono text-amber-300/90 uppercase mb-1">
                          反事实
                        </h5>
                        <p className="text-[15px] text-amber-300/70 leading-relaxed">
                          {point.counterfactual}
                        </p>
                      </div>
                    </div>

                    {/* Vulnerability detail (if falsified) */}
                    {(() => {
                      const vuln = vulnByYear.get(point.year);
                      if (!vuln) return null;
                      return (
                        <div className="p-3 rounded bg-red-500/[0.06] border border-red-400/15 space-y-2">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[15px] font-mono text-red-300/70 uppercase tracking-wider">
                              脆弱性分析
                            </h5>
                            <span className="text-[15px] font-mono px-1.5 py-0.5 rounded bg-red-500/15 text-red-300/70">
                              严重度 {Math.round(vuln.severity * 100)}%
                            </span>
                          </div>
                          <div>
                            <p className="text-[14px] text-deep-200/85 mb-0.5">攻击向量</p>
                            <p className="text-[15px] text-red-200/60 leading-relaxed">{vuln.attack_vector}</p>
                          </div>
                          <div>
                            <p className="text-[14px] text-deep-200/85 mb-0.5">反面证据</p>
                            <p className="text-[15px] text-deep-200/95 leading-relaxed">{vuln.counter_evidence}</p>
                          </div>
                          {vuln.alternative_outcome && (
                            <div>
                              <p className="text-[14px] text-deep-200/85 mb-0.5">替代结果</p>
                              <p className="text-[15px] text-deep-200/95 leading-relaxed">{vuln.alternative_outcome}</p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Annotation for this year (if exists) */}
                    {annotations.filter(a => a.year === point.year).map(ann => (
                      <div key={ann.year} className="p-3 rounded bg-blue-500/[0.06] border border-blue-400/15 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <h5 className="text-[15px] font-mono text-blue-300/70 uppercase tracking-wider">
                            用户标注
                          </h5>
                          <span className="text-[15px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300/60">
                            {CONSTRAINT_LABELS[ann.constraint_type] || ann.constraint_type}
                          </span>
                        </div>
                        <p className="text-[15px] text-blue-200/70 leading-relaxed">{ann.correction}</p>
                        {ann.source_description && (
                          <p className="text-[14px] text-deep-200/75 italic">来源: {ann.source_description}</p>
                        )}
                      </div>
                    ))}

                    {/* Annotate button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setAnnotatingYear(point.year); }}
                      className="w-full py-1.5 rounded border border-blue-400/15 bg-blue-500/[0.04] text-[14px] font-mono text-blue-300/50 hover:text-blue-300/80 hover:bg-blue-500/[0.08] transition-colors"
                    >
                      {annotatedYears.has(point.year) ? '✎ 编辑标注' : '✎ 添加标注'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
