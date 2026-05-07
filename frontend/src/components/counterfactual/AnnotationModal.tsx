import { useState, useEffect } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';
import type { UserAnnotation } from '../../services/api';

const CONSTRAINT_TYPES = [
  { value: 'factual_error', label: '事实错误', desc: 'AI 的推演与已知历史事实不符' },
  { value: 'missing_factor', label: '缺失因素', desc: 'AI 忽略了一个重要的影响因素' },
  { value: 'domain_knowledge', label: '领域知识', desc: '你拥有该领域的专业知识' },
] as const;

export function AnnotationModal() {
  const {
    annotatingYear,
    setAnnotatingYear,
    addAnnotation,
    timelinePoints,
    annotations,
  } = useCounterfactualStore();

  // Find existing annotation for this year
  const existing = annotations.find(a => a.year === annotatingYear);
  const point = timelinePoints.find(p => p.year === annotatingYear);

  const [constraintType, setConstraintType] = useState<string>('domain_knowledge');
  const [correction, setCorrection] = useState('');
  const [sourceDescription, setSourceDescription] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (annotatingYear !== null) {
      if (existing) {
        setConstraintType(existing.constraint_type);
        setCorrection(existing.correction);
        setSourceDescription(existing.source_description);
      } else {
        setConstraintType('domain_knowledge');
        setCorrection('');
        setSourceDescription('');
      }
    }
  }, [annotatingYear]);

  if (annotatingYear === null || !point) return null;

  const handleSubmit = () => {
    if (!correction.trim()) return;
    const annotation: UserAnnotation = {
      year: annotatingYear,
      original_claim: point.counterfactual,
      correction: correction.trim(),
      source_description: sourceDescription.trim(),
      constraint_type: constraintType as UserAnnotation['constraint_type'],
    };
    addAnnotation(annotation);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-deep-950/70 backdrop-blur-sm"
        onClick={() => setAnnotatingYear(null)}
      />

      {/* Modal */}
      <div className="relative glass border border-amber-300/45 rounded-xl p-6 w-full max-w-lg mx-4 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white/90">
            标注 · {annotatingYear} 年
          </h3>
          <button
            onClick={() => setAnnotatingYear(null)}
            className="w-6 h-6 rounded-full flex items-center justify-center text-deep-200/85 hover:text-white/80 hover:bg-deep-400/20 transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Original claim */}
        <div className="p-3 rounded bg-amber-300/[0.04] border border-amber-300/40">
          <p className="text-[15px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">
            AI 原始推演
          </p>
          <p className="text-[15px] text-amber-300/95 leading-relaxed">
            {point.counterfactual}
          </p>
        </div>

        {/* Constraint type */}
        <div>
          <p className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider mb-2">
            标注类型
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CONSTRAINT_TYPES.map(ct => (
              <button
                key={ct.value}
                onClick={() => setConstraintType(ct.value)}
                className={`p-2 rounded border text-center transition-all ${
                  constraintType === ct.value
                    ? 'border-blue-400/30 bg-blue-500/[0.08] text-blue-300/80'
                    : 'border-deep-400/40 bg-deep-700/20 text-deep-200/85 hover:text-deep-200/95'
                }`}
              >
                <p className="text-[14px] font-medium">{ct.label}</p>
                <p className="text-[14px] mt-0.5 opacity-60">{ct.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Correction input */}
        <div>
          <p className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider mb-2">
            你的修正
          </p>
          <textarea
            value={correction}
            onChange={e => setCorrection(e.target.value)}
            placeholder="描述你认为更准确的情况..."
            rows={3}
            className="w-full bg-deep-700/30 border border-deep-400/45 rounded-lg px-4 py-3 text-sm text-white/80 placeholder:text-deep-300/65 focus:outline-none focus:border-blue-400/25 resize-none"
          />
        </div>

        {/* Source */}
        <div>
          <p className="text-[14px] font-mono text-deep-200/85 uppercase tracking-wider mb-2">
            来源 <span className="text-deep-200/65">（可选）</span>
          </p>
          <input
            type="text"
            value={sourceDescription}
            onChange={e => setSourceDescription(e.target.value)}
            placeholder="例如: World Bank Open Data, 学术论文..."
            className="w-full bg-deep-700/30 border border-deep-400/45 rounded-lg px-4 py-2.5 text-sm text-white/80 placeholder:text-deep-300/65 focus:outline-none focus:border-blue-400/25"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={() => setAnnotatingYear(null)}
            className="px-4 py-2 text-xs font-mono text-deep-200/85 hover:text-deep-200/95 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!correction.trim()}
            className="px-5 py-2 bg-gradient-to-r from-blue-500/80 to-blue-600/80 text-white text-xs font-semibold rounded-lg hover:from-blue-500 hover:to-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {existing ? '更新标注' : '添加标注'}
          </button>
        </div>
      </div>
    </div>
  );
}
