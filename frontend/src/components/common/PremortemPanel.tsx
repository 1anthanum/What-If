/**
 * Pre-mortem panel — input a concrete personal decision (not a question),
 * 5 personas each write the most plausible failure scenario after a
 * specified time horizon.
 *
 * Different from a what-if debate: this is for **before you commit**.
 * Output is actionable warnings, not philosophical positions.
 *
 * Triggered from header "🩺 Pre-mortem" button.
 */
import { useState } from 'react';
import { autoLoopApi, type PremortemResponse, type PremortemResult } from '../../services/api';

interface Props {
  onClose: () => void;
}

const PERSONA_COLORS: Record<string, string> = {
  rationalist:         'border-blue-400/45 bg-blue-400/[0.04]',
  existentialist:      'border-rose-400/45 bg-rose-400/[0.04]',
  pragmatist:          'border-emerald-400/45 bg-emerald-400/[0.04]',
  eastern_philosopher: 'border-amber-400/45 bg-amber-400/[0.04]',
  critical_theorist:   'border-purple-400/45 bg-purple-400/[0.04]',
};

const TIME_HORIZONS = ['6 个月', '1 年', '2 年', '5 年', '10 年'];

export function PremortemPanel({ onClose }: Props) {
  const [decision, setDecision] = useState('');
  const [horizon, setHorizon] = useState('2 年');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PremortemResponse | null>(null);

  const run = async () => {
    if (decision.trim().length < 20) return;
    setRunning(true); setError(null); setResult(null);
    try { setResult(await autoLoopApi.premortem({ decision: decision.trim(), time_horizon: horizon })); }
    catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  };

  const severityTone = (s: number) =>
    s >= 4 ? 'text-earth-rust/95'
    : s >= 3 ? 'text-amber-300/95'
    : 'text-earth-green/85';

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>🩺</span>
            Pre-mortem
          </div>
          <h2 className="text-lg font-light text-white">
            做决定前：5 个传统各写一份<span className="text-amber-300">失败剧本</span>
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed max-w-2xl">
            不是 what-if 辩论 — 输入**具体决定**（接 offer / 分手 / 创业 / 搬城 / 换专业…）。
            每个 persona 假设它 X 时间后失败了，从自己的传统视角写出最可能的失败路径
            + 关键预警信号 + 你当下没意识到的隐含预设。研究表明 pre-mortem 让决策质量提升 30%。
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
          <div>
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider block mb-1">
              你要做的决定（具体描述，≥ 20 字）
            </label>
            <textarea
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder={'例：「下个月辞掉现在的 senior engineer 工作，全职做自己的 SaaS 产品。\n现有储蓄能撑 14 个月。妻子支持但有担忧。我有 2 个早期付费客户和约 500 个邮件列表订阅者。」'}
              rows={5}
              className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[13px] text-deep-50 leading-relaxed placeholder-deep-300/50 resize-none focus:border-amber-300/55"
              maxLength={2000}
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">失败时点</label>
            <div className="flex gap-1">
              {TIME_HORIZONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                    horizon === h
                      ? 'border-amber-300/65 bg-amber-300/[0.10] text-amber-200'
                      : 'border-deep-400/40 text-deep-100/85 hover:border-amber-300/45'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[10px] font-mono text-deep-300/65 tabular-nums">{decision.length}/2000</span>
          </div>

          {error && (
            <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded border border-amber-300/35 bg-amber-300/[0.04] p-2.5 flex items-baseline gap-3">
                <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                  五位平均严重度
                </span>
                <span className={`text-2xl font-mono font-bold tabular-nums ${severityTone(Math.round(result.avg_severity))}`}>
                  {result.avg_severity}<span className="text-[12px] text-deep-200/55">/5</span>
                </span>
                <span className="text-[11px] text-deep-200/80">
                  {result.avg_severity >= 3.5 ? '⚠ 高警示 — 慎重决定' : result.avg_severity >= 2.5 ? '◐ 中度警示 — 注意预警' : '✓ 低警示 — 风险可控'}
                </span>
              </div>

              <div className="space-y-2">
                {result.results.map((r: PremortemResult) => {
                  const tone = PERSONA_COLORS[r.persona_id] || 'border-deep-400/30 bg-deep-700/20';
                  return (
                    <div key={r.persona_id} className={`rounded border p-3 ${tone}`}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[12px] font-mono text-deep-50">{r.persona_name}</span>
                        {r.error ? (
                          <span className="text-[10px] font-mono text-earth-rust/85">{r.error}</span>
                        ) : (
                          <span className={`text-[11px] font-mono tabular-nums ${severityTone(r.severity || 3)}`}>
                            严重度 {r.severity}/5
                          </span>
                        )}
                      </div>
                      {!r.error && (
                        <div className="space-y-2 text-[12px] leading-snug">
                          {r.failure_path && (
                            <div>
                              <span className="text-[9px] font-mono text-amber-300/85 uppercase mr-1.5">失败路径</span>
                              <span className="text-deep-50 whitespace-pre-wrap">{r.failure_path}</span>
                            </div>
                          )}
                          {r.hidden_assumption && (
                            <div className="rounded bg-purple-400/[0.05] border border-purple-400/30 px-2 py-1.5">
                              <span className="text-[9px] font-mono text-purple-400/95 uppercase mr-1.5">隐含预设</span>
                              <span className="text-deep-50">{r.hidden_assumption}</span>
                            </div>
                          )}
                          {r.key_warning && (
                            <div className="rounded bg-earth-rust/[0.05] border border-earth-rust/30 px-2 py-1.5">
                              <span className="text-[9px] font-mono text-earth-rust/95 uppercase mr-1.5">预警信号</span>
                              <span className="text-deep-50">{r.key_warning}</span>
                            </div>
                          )}
                          {r.early_check && (
                            <div className="rounded bg-earth-green/[0.05] border border-earth-green/30 px-2 py-1.5">
                              <span className="text-[9px] font-mono text-earth-green/95 uppercase mr-1.5">决前测试</span>
                              <span className="text-deep-50">{r.early_check}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45"
          >
            关闭
          </button>
          <button
            onClick={run}
            disabled={decision.trim().length < 20 || running}
            className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              decision.trim().length < 20 || running
                ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
            }`}
          >
            {running ? '5 个传统在写失败剧本…' : (result ? '↻ 重跑' : '▶ 开始 Pre-mortem')}
          </button>
        </div>
      </div>
    </div>
  );
}
