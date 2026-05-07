/**
 * Sidebar panel for causal graph: node details, perturbation input, propagation results.
 */

import { useState } from 'react';
import { useCausalStore } from '../../store/causalStore';
import { CostBadge } from '../common/CostBadge';

const CATEGORY_LABELS: Record<string, string> = {
  economic: '经济',
  social: '社会',
  environmental: '环境',
  political: '政治',
};

const CATEGORY_COLORS: Record<string, string> = {
  economic: '#C49058',
  social: '#8BA888',
  environmental: '#6EBF8B',
  political: '#8B9FBF',
};

export function CausalPanel() {
  const {
    nodes,
    edges,
    selectedNodeId,
    propagationAnalysis,
    affectedNodeIds,
    status,
    tokenUsage,
    streamingText,
    propagateNode,
    selectNode,
  } = useCausalStore();

  const [perturbation, setPerturbation] = useState('');
  const [depth, setDepth] = useState(4);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  // Find connected edges
  const connectedEdges = edges.filter(
    e => e.source === selectedNodeId || e.target === selectedNodeId
  );

  const handlePropagate = async () => {
    if (!perturbation.trim()) return;
    await propagateNode(perturbation, depth);
  };

  return (
    <div className="w-80 flex-shrink-0 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
      {/* Token Cost */}
      {tokenUsage && (
        <div className="glass rounded-lg p-3 border border-deep-400/40">
          <CostBadge usage={tokenUsage} />
        </div>
      )}

      {/* Empty State */}
      {!selectedNode && (
        <div className="glass rounded-lg p-5 border border-deep-400/40">
          <p className="text-[14px] font-mono text-amber-300/75 tracking-widest uppercase mb-2">
            ◈ Node Inspector
          </p>
          <p className="text-sm text-deep-200/75">
            点击图谱中的节点查看详情并分析传播效应
          </p>

          {/* Quick stats */}
          {nodes.length > 0 && (
            <div className="mt-4 pt-3 border-t border-deep-400/40 flex gap-4">
              <div className="text-center">
                <p className="text-lg font-light text-amber-300">{nodes.length}</p>
                <p className="text-[15px] font-mono text-deep-200/75">节点</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-light text-amber-300">{edges.length}</p>
                <p className="text-[15px] font-mono text-deep-200/75">因果链</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Node Details */}
      {selectedNode && (
        <div className="glass rounded-lg border border-deep-400/40 overflow-hidden">
          {/* Header with category color */}
          <div
            className="px-4 py-3 border-b border-deep-400/40"
            style={{ backgroundColor: `${CATEGORY_COLORS[selectedNode.category]}08` }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[selectedNode.category] }}
                />
                <span className="text-sm font-medium text-white">
                  {selectedNode.label}
                </span>
              </div>
              <button
                onClick={() => selectNode(null)}
                className="text-deep-300/80 hover:text-deep-100 text-xs transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-3 text-[14px] font-mono text-deep-200/85">
              <span>{CATEGORY_LABELS[selectedNode.category] || selectedNode.category}</span>
              <span>·</span>
              <span>重要度 {(selectedNode.importance_score * 100).toFixed(0)}%</span>
            </div>
          </div>

          {/* Description & State */}
          <div className="p-4 space-y-3 text-xs">
            {selectedNode.description && (
              <div>
                <p className="text-[15px] font-mono text-deep-200/75 mb-1 uppercase">描述</p>
                <p className="text-deep-100/95 leading-relaxed">{selectedNode.description}</p>
              </div>
            )}
            {selectedNode.current_state && (
              <div>
                <p className="text-[15px] font-mono text-deep-200/75 mb-1 uppercase">当前状态</p>
                <p className="text-deep-100/95 leading-relaxed">{selectedNode.current_state}</p>
              </div>
            )}

            {/* Connected relationships */}
            {connectedEdges.length > 0 && (
              <div>
                <p className="text-[15px] font-mono text-deep-200/75 mb-2 uppercase">
                  关联关系 ({connectedEdges.length})
                </p>
                <div className="space-y-1.5">
                  {connectedEdges.slice(0, 6).map((e, i) => {
                    const isSource = e.source === selectedNodeId;
                    const otherId = isSource ? e.target : e.source;
                    const otherNode = nodes.find(n => n.id === otherId);
                    const arrow = e.relationship === 'positive' ? '→+' : e.relationship === 'negative' ? '→−' : '→?';

                    return (
                      <button
                        key={i}
                        onClick={() => selectNode(otherId)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-deep-700/30 transition-colors group"
                      >
                        <span className="text-[14px]" style={{ color: CATEGORY_COLORS[otherNode?.category || 'economic'] }}>
                          {isSource ? arrow : '←'}
                        </span>
                        <span className="text-deep-100/50 group-hover:text-deep-100/80 truncate">
                          {otherNode?.label || otherId}
                        </span>
                        <span className="text-[15px] text-deep-300/70 ml-auto">
                          {(e.strength * 100).toFixed(0)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Propagation Input */}
      {selectedNode && (
        <div className="glass rounded-lg border border-deep-400/40 p-4">
          <p className="text-[14px] font-mono text-earth-rust/50 tracking-widest uppercase mb-3">
            ⚡ 扰动传播分析
          </p>

          <textarea
            value={perturbation}
            onChange={(e) => setPerturbation(e.target.value)}
            placeholder={`如果「${selectedNode.label}」发生变化…`}
            className="w-full bg-deep-800/40 border border-deep-400/45 rounded-lg px-3 py-2.5 text-xs text-white placeholder-deep-300/60 resize-none transition-all focus:border-amber-300/55"
            rows={3}
          />

          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[15px] text-deep-200/75 font-mono block mb-1">
                传播深度: {depth}
              </label>
              <input
                type="range"
                min="1"
                max="6"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="w-full h-1 bg-deep-600 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>
          </div>

          <button
            onClick={handlePropagate}
            disabled={status === 'propagating' || !perturbation.trim()}
            className={`
              w-full mt-3 py-2.5 rounded-lg text-xs font-mono tracking-wider transition-all
              ${status === 'propagating'
                ? 'bg-amber-300/[0.06] border border-amber-300/45 text-amber-300'
                : perturbation.trim()
                  ? 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg'
                  : 'bg-deep-700/30 border border-deep-400/40 text-deep-300/70 cursor-not-allowed'
              }
              disabled:opacity-40 disabled:cursor-not-allowed
            `}
          >
            {status === 'propagating' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
                分析中…
              </span>
            ) : (
              '⚡ 开始传播分析'
            )}
          </button>
        </div>
      )}

      {/* Streaming text during propagation */}
      {status === 'propagating' && streamingText && (
        <div className="glass rounded-lg border border-amber-300/40 p-4">
          <p className="text-[14px] font-mono text-amber-300/85 mb-2 tracking-widest uppercase">
            ▸ AI 分析中
          </p>
          <p className="text-[15px] text-deep-100/50 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
            {streamingText.slice(-300)}
            <span className="cursor-blink" />
          </p>
        </div>
      )}

      {/* Propagation Results */}
      {propagationAnalysis && (
        <div className="glass rounded-lg border border-earth-green/15 overflow-hidden">
          <div className="px-4 py-3 border-b border-deep-400/40 bg-earth-green/[0.03]">
            <p className="text-[14px] font-mono text-earth-green tracking-widest uppercase">
              ◈ 级联分析结果
            </p>
            <div className="flex gap-4 mt-1 text-[14px] text-deep-200/85 font-mono">
              <span>影响 {propagationAnalysis.affected_nodes_count} 个节点</span>
              <span>深度 {propagationAnalysis.max_depth_reached} 层</span>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {/* Summary */}
            {propagationAnalysis.summary && (
              <div className="text-xs text-deep-100/95 leading-relaxed pb-3 border-b border-deep-400/40">
                {propagationAnalysis.summary}
              </div>
            )}

            {/* Steps */}
            <div className="space-y-2">
              {propagationAnalysis.steps.map((step, i) => (
                <button
                  key={i}
                  onClick={() => selectNode(step.node_id)}
                  className="w-full text-left group"
                >
                  <div className="flex items-start gap-2 px-2 py-2 rounded hover:bg-deep-700/30 transition-colors">
                    {/* Depth indicator */}
                    <div className="flex-shrink-0 mt-0.5">
                      {Array.from({ length: step.depth }).map((_, j) => (
                        <span
                          key={j}
                          className="inline-block w-1.5 h-1.5 rounded-full mr-0.5"
                          style={{
                            backgroundColor: `${CATEGORY_COLORS[
                              nodes.find(n => n.id === step.node_id)?.category || 'economic'
                            ]}${Math.max(30, 80 - step.depth * 15).toString(16)}`,
                          }}
                        />
                      ))}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] text-deep-100/70 group-hover:text-amber-300/80 truncate">
                          {step.node_label}
                        </span>
                        <span className="text-[15px] text-deep-300/70 font-mono">
                          {(step.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="text-[14px] text-deep-200/85 mt-0.5 line-clamp-2">
                        {step.incoming_effect}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
