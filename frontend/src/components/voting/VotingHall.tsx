import { useState } from 'react';
import { votingApi, type VotingConfig } from '../../services/api';
import { Button } from '../common/ui';

interface VoteResult {
  model: string;
  temperature: number;
  vote: string;
  confidence: number;
  rationale: string;
  duration_ms: number;
  raw?: string;
}

interface AggregateBinary {
  type: 'binary';
  counts: Record<string, number>;
  winner: string;
  consensus: number;
  avg_confidence: number;
}
interface AggregateScale10 {
  type: 'scale10';
  n: number;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  histogram: Record<string, number>;
  avg_confidence: number;
}
type Aggregate = AggregateBinary | AggregateScale10;

const VOTE_COLOR: Record<string, string> = {
  yes: '#6EBF8B',
  no: '#C47D5A',
  uncertain: '#A8BCD8',
  ERROR: '#3D3835',
  PARSE_ERROR: '#7A736C',
};

function shortenModel(s: string) {
  return s.replace(/^ollama:/, '').replace(/^claude:/, '').replace(/^openai:/, '').replace(/^glm:/, '').replace(/^deepseek:/, '');
}

/** Internal selector tile — used for mode, vote-type, and method toggles.
 *  Shared component so all three rows have identical visual rhythm. */
function SelectorTile({
  active, onClick, icon, label, hint,
}: { active: boolean; onClick: () => void; icon: string; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-2.5 py-2 rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40
        ${active
          ? 'border border-amber-300/55 bg-amber-300/[0.08] text-amber-200 shadow-glow-sm'
          : 'border tk-border-faint bg-deep-800/40 tk-text-secondary hover:border-amber-300/35 hover:text-amber-300'
        }`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-[12px] ${active ? 'text-amber-300' : 'tk-text-muted'}`}>{icon}</span>
        <span className="text-[12px] font-medium">{label}</span>
      </div>
      <div className="text-[10px] font-mono tk-text-muted mt-0.5">{hint}</div>
    </button>
  );
}

export function VotingHall() {
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [voteType, setVoteType] = useState<'binary' | 'scale10'>('binary');
  const [mode, setMode] = useState<'panel' | 'calibration' | 'matrix'>('panel');
  const [calibrationModel, setCalibrationModel] = useState('claude:claude-sonnet-4-6');
  const [votesPerModel, setVotesPerModel] = useState(5);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<VoteResult[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);

  // Method flags
  const [framingFlip, setFramingFlip] = useState(false);
  const [superForecaster, setSuperForecaster] = useState(false);
  const [roleFraming, setRoleFraming] = useState(false);
  const [delphi, setDelphi] = useState(false);
  const [humanBaseline, setHumanBaseline] = useState(false);
  const [humanPreVote, setHumanPreVote] = useState('');

  // Method outputs
  const [phaseLabel, setPhaseLabel] = useState<string>('');
  const [flippedAgg, setFlippedAgg] = useState<Aggregate | null>(null);
  const [revoteAgg, setRevoteAgg] = useState<Aggregate | null>(null);
  const [distillation, setDistillation] = useState('');
  const [strongDisagreements, setStrongDisagreements] = useState<any[]>([]);
  const [delphiReactions, setDelphiReactions] = useState<{ model: string; reaction: string }[]>([]);
  const [delphiShifts, setDelphiShifts] = useState<any[]>([]);

  // Profile
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState<any[]>([]);

  const reset = () => {
    setResults([]);
    setAggregate(null);
    setCompleted(0);
    setTotal(0);
    setPhaseLabel('');
    setFlippedAgg(null);
    setRevoteAgg(null);
    setDistillation('');
    setStrongDisagreements([]);
    setDelphiReactions([]);
    setDelphiShifts([]);
  };

  const handleRun = async () => {
    if (!question.trim() || running) return;
    reset();
    setRunning(true);
    const cfg: VotingConfig = {
      question: question.trim(),
      context: context.trim() || undefined,
      vote_type: voteType,
      mode,
      calibration_model: calibrationModel,
      votes_per_model: votesPerModel,
      max_tokens: 200,
      framing_flip: framingFlip,
      super_forecaster: superForecaster,
      role_framing: roleFraming,
      delphi,
      human_baseline: humanBaseline,
      human_pre_vote: humanBaseline ? humanPreVote : '',
    };
    try {
      const stream = votingApi.runStream(cfg);
      for await (const ev of stream.events) {
        switch (ev.type) {
          case 'vote_session_start':
            setTotal(ev.data.total_votes as number);
            break;
          case 'vote_phase':
            setPhaseLabel((ev.data.label as string) || '');
            setCompleted(0);
            break;
          case 'vote_received':
            setCompleted(ev.data.completed as number);
            setResults(prev => [...prev, ev.data.result as VoteResult]);
            break;
          case 'vote_aggregate': {
            const ch = ev.data.channel as string;
            const agg = ev.data.aggregate as Aggregate;
            const sd = (ev.data.strong_disagreements as any[]) || [];
            if (ch === 'original') { setAggregate(agg); setStrongDisagreements(sd); }
            else if (ch === 'flipped') setFlippedAgg(agg);
            else if (ch === 'revote') setRevoteAgg(agg);
            break;
          }
          case 'vote_distillation':
            setDistillation((ev.data.distillation as string) || '');
            break;
          case 'delphi_reaction':
            setDelphiReactions(prev => [...prev, ev.data as any]);
            break;
          case 'delphi_shifts':
            setDelphiShifts(((ev.data.shifts as any[]) || []));
            break;
          case 'vote_complete':
            // Final aggregate already set per channel during phases.
            break;
          case 'vote_error':
            console.error('vote error', ev.data);
            break;
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
      setPhaseLabel('');
    }
  };

  const openProfile = async () => {
    setProfileOpen(true);
    try {
      const r = await votingApi.getProfile();
      setProfileData(r.models);
    } catch (e) { console.error(e); }
  };

  const groupedByModel: Record<string, VoteResult[]> = {};
  results.forEach(r => {
    (groupedByModel[r.model] = groupedByModel[r.model] || []).push(r);
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-5 px-3 py-1.5 border border-amber-300/40 rounded-full">
          <span className="status-dot bg-amber-300 text-amber-300" />
          MODEL VOTING HALL · 模型投票厅
        </div>
        <h2 className="text-3xl font-light text-white mb-4 tracking-tight">
          一个命题<span className="text-amber-300">·</span>众模一票
        </h2>
        <p className="text-[13px] tk-text-secondary max-w-xl mx-auto leading-relaxed">
          把命题摆给一池模型投票 —— 看跨 provider 共识度、单模型校准方差、模型 × 温度热力图。
        </p>
      </div>

      {/* Config */}
      {!running && results.length === 0 && (
        <div className="glass tk-border-strong rounded-lg p-6 space-y-5">
          <div>
            <label className="block text-[11px] font-mono tracking-[0.22em] text-amber-300/95 uppercase mb-2">
              命题
            </label>
            <textarea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="例如：AGI 会在 2030 年前出现 / 加密货币 10 年内会成为主要支付方式 / 远程工作会成为主流..."
              rows={2}
              className="w-full bg-deep-700/40 border tk-border-faint rounded-lg px-4 py-3 text-sm tk-text-primary placeholder-deep-300/55 focus:border-amber-300/55 transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-mono tracking-[0.22em] tk-text-muted uppercase mb-2">
              背景说明（可选）
            </label>
            <input
              type="text"
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="一句话，给模型补充必要上下文"
              className="w-full bg-deep-700/40 border tk-border-faint rounded-lg px-3 py-2 text-[13px] tk-text-primary placeholder-deep-300/55 focus:border-amber-300/55 transition-all"
            />
          </div>

          {/* Mode + vote type selector */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono tracking-[0.22em] tk-text-muted uppercase mb-2">
                投票模式
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { v: 'panel',       label: 'Panel',        icon: '🏛', hint: '池内每模型 1 票' },
                  { v: 'calibration', label: 'Calibration',  icon: '🎲', hint: '单模型多温度' },
                  { v: 'matrix',      label: 'Matrix',       icon: '🔥', hint: '全部 × N 全景' },
                ].map(o => (
                  <SelectorTile
                    key={o.v}
                    active={mode === o.v}
                    onClick={() => setMode(o.v as any)}
                    icon={o.icon}
                    label={o.label}
                    hint={o.hint}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono tracking-[0.22em] tk-text-muted uppercase mb-2">
                投票类型
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { v: 'binary',  label: '三值',     icon: '✓/✗', hint: '是 / 否 / 不确定' },
                  { v: 'scale10', label: '1–10 分',  icon: '◑',   hint: '可分布、可算方差' },
                ].map(o => (
                  <SelectorTile
                    key={o.v}
                    active={voteType === o.v}
                    onClick={() => setVoteType(o.v as any)}
                    icon={o.icon}
                    label={o.label}
                    hint={o.hint}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Calibration / Matrix specific controls */}
          {(mode === 'calibration' || mode === 'matrix') && (
            <div className="grid grid-cols-2 gap-4">
              {mode === 'calibration' && (
                <div>
                  <label className="block text-[11px] font-mono tracking-[0.18em] text-deep-200 uppercase mb-2">
                    校准模型
                  </label>
                  <select
                    value={calibrationModel}
                    onChange={e => setCalibrationModel(e.target.value)}
                    className="w-full bg-deep-700/40 border border-deep-400/45 rounded-lg px-3 py-2 text-[13px] text-white"
                  >
                    <option value="claude:claude-sonnet-4-6">claude-sonnet-4-6</option>
                    <option value="claude:claude-haiku-4-5-20251001">claude-haiku-4-5</option>
                    <option value="claude:claude-opus-4-7">claude-opus-4-7</option>
                    <option value="openai:gpt-5-mini">openai:gpt-5-mini</option>
                    <option value="deepseek:deepseek-chat">deepseek-chat</option>
                    <option value="glm:glm-4-plus">glm-4-plus</option>
                    <option value="ollama:qwen2.5:7b">ollama:qwen2.5:7b</option>
                    <option value="ollama:gemma2:9b">ollama:gemma2:9b</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-mono tracking-[0.18em] text-deep-200 uppercase mb-2">
                  每模型投票次数（温度 0.2 → 1.0 均匀分布）<span className="text-amber-300 ml-1">{votesPerModel}</span>
                </label>
                <input
                  type="range" min={1} max={10} step={1}
                  value={votesPerModel}
                  onChange={e => setVotesPerModel(Number(e.target.value))}
                  className="w-full settings-range"
                  style={{
                    background: `linear-gradient(to right, #E8B988 ${(votesPerModel / 10) * 100}%, rgba(80,75,70,0.45) ${(votesPerModel / 10) * 100}%)`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Method multi-select — stack any combination */}
          <div>
            <label className="block text-[11px] font-mono tracking-[0.20em] text-amber-300/95 uppercase mb-2">
              分析方法（可多选 · 正交叠加）
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {[
                { key: 'framing_flip', icon: '🪞', label: 'Framing Flip', hint: '反向 framing 再投，蒸馏对比结论', state: framingFlip, set: setFramingFlip },
                { key: 'super_forecaster', icon: '🎯', label: '超级预测员', hint: 'base rate → adjustments → final', state: superForecaster, set: setSuperForecaster },
                { key: 'role_framing', icon: '🎭', label: '角色框架', hint: '每模型分别以乐观/悲观/中性各投 1 票', state: roleFraming, set: setRoleFraming },
                { key: 'delphi', icon: '🔁', label: 'Delphi 三段', hint: '先盲投 → 互看反应 → 重投 (小心解读)', state: delphi, set: setDelphi },
                { key: 'human_baseline', icon: '👥', label: '人机对照', hint: '你先盲投，对比模型集体智慧', state: humanBaseline, set: setHumanBaseline },
              ].map(m => {
                const on = m.state;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => m.set(!on)}
                    className={`text-left px-3 py-2 rounded-md text-[12px] transition-all ${
                      on
                        ? 'border border-amber-300/65 bg-amber-300/[0.06] text-amber-200'
                        : 'border border-deep-400/35 bg-deep-800/40 text-deep-200 hover:border-amber-300/35'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium"><span className="mr-1">{m.icon}</span>{m.label}</span>
                      <span className={on ? 'text-amber-300' : 'text-deep-400'}>{on ? '✓' : ''}</span>
                    </div>
                    <div className="text-[10px] font-mono text-deep-300">{m.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Human baseline pre-vote (visible only when method enabled) */}
          {humanBaseline && (
            <div className="rounded-lg border border-amber-300/45 bg-amber-300/[0.04] p-3 animate-fade-in">
              <p className="text-[11px] font-mono tracking-[0.18em] text-amber-300/95 uppercase mb-2">
                👥 你先投 — 之后会和模型集体对比
              </p>
              {voteType === 'binary' ? (
                <div className="flex gap-2">
                  {(['yes', 'no', 'uncertain'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setHumanPreVote(v)}
                      className={`flex-1 py-2 rounded font-mono text-[12px] tracking-wider transition-all ${
                        humanPreVote === v
                          ? v === 'yes' ? 'bg-earth-green/20 border border-earth-green/55 text-earth-green'
                          : v === 'no' ? 'bg-earth-rust/20 border border-earth-rust/55 text-earth-rust'
                          : 'bg-deep-700/60 border border-deep-400/55 text-deep-100'
                          : 'bg-deep-800/40 border border-deep-400/35 text-deep-200 hover:border-amber-300/35'
                      }`}
                    >{v.toUpperCase()}</button>
                  ))}
                </div>
              ) : (
                <input
                  type="number" min={1} max={10}
                  value={humanPreVote}
                  onChange={e => setHumanPreVote(e.target.value)}
                  placeholder="1–10"
                  className="w-24 px-3 py-2 rounded bg-deep-800/60 border border-deep-400/45 text-amber-200 text-[14px]"
                />
              )}
            </div>
          )}

          <div className="text-[11px] font-mono text-deep-300 leading-relaxed bg-deep-800/40 border border-deep-400/30 rounded p-3">
            <span className="text-amber-300/95">提示：</span>
            Panel 读 .env.local 的 persona_pool。Matrix 投票封顶 30。Framing Flip × Role Framing × Delphi 全开会让总投票数 ×6（注意成本）。
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={!question.trim() || (humanBaseline && !humanPreVote)}
              className="flex-1 py-3 rounded-lg bg-gradient-to-r from-amber-700 to-amber-600 text-white font-medium shadow-glow hover:shadow-glow-lg disabled:opacity-40 disabled:cursor-not-allowed btn-glow tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40 text-sm"
            >
              ▶ 启动投票
            </button>
            <Button
              type="button"
              onClick={openProfile}
              variant="secondary"
              size="lg"
              title="查看跨会话的模型行为档案"
            >
              📊 模型档案
            </Button>
          </div>
        </div>
      )}

      {/* Live progress */}
      {(running || results.length > 0) && (
        <div className="glass border border-amber-300/35 rounded-lg p-5 animate-fade-in-up">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="text-[12px] font-mono tracking-[0.20em] text-amber-300 uppercase truncate">
                🗳 {question.slice(0, 50)}{question.length > 50 ? '…' : ''}
              </span>
              {running && (
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/95 px-2 py-0.5 rounded border border-amber-300/45 bg-amber-300/[0.05] shrink-0">
                  <span className="w-2 h-2 border border-amber-300/55 border-t-amber-300 rounded-full animate-spin" />
                  {phaseLabel || 'RUNNING'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-mono text-deep-200 tabular-nums">
                {completed} / {total}
              </span>
              {!running && (
                <button
                  onClick={reset}
                  className="text-[12px] font-mono text-deep-100 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/45 hover:border-amber-300/55"
                >
                  ✕ 新投票
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-deep-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400/85 transition-all duration-300"
              style={{ width: `${(completed / Math.max(1, total)) * 100}%`, boxShadow: '0 0 6px rgba(232,185,136,0.5)' }}
            />
          </div>
        </div>
      )}

      {/* Aggregate visualization */}
      {aggregate && (
        <div className="glass border border-amber-300/55 rounded-lg p-5 animate-fade-in-up">
          <p className="text-[11px] font-mono tracking-[0.22em] text-amber-300/95 uppercase mb-3">
            📊 聚合结果
          </p>
          {aggregate.type === 'binary' ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-3xl font-bold" style={{ color: VOTE_COLOR[aggregate.winner] || '#F2EDE7' }}>
                  {aggregate.winner === 'yes' ? '✓ YES' :
                   aggregate.winner === 'no' ? '✗ NO' :
                   aggregate.winner === 'uncertain' ? '? UNCERTAIN' : aggregate.winner.toUpperCase()}
                </span>
                <span className="text-[14px] text-deep-200">·  共识 {(aggregate.consensus * 100).toFixed(0)}%</span>
                <span className="text-[12px] text-deep-300 ml-auto">avg conf {aggregate.avg_confidence}</span>
              </div>
              <div className="space-y-1.5">
                {(['yes', 'no', 'uncertain'] as const).map(k => {
                  const count = aggregate.counts[k] || 0;
                  const total = Object.values(aggregate.counts).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-[12px] font-mono text-deep-100 w-20 shrink-0 uppercase tracking-wider">
                        {k}
                      </span>
                      <div className="flex-1 h-3 bg-deep-700 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: VOTE_COLOR[k], boxShadow: `0 0 6px ${VOTE_COLOR[k]}55` }}
                        />
                      </div>
                      <span className="text-[12px] font-mono tabular-nums text-deep-100 w-14 text-right">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-3 mb-3">
                <span className="text-3xl font-bold text-amber-200 tabular-nums">{aggregate.mean}</span>
                <span className="text-[14px] text-deep-200">/ 10</span>
                <span className="text-[12px] text-deep-300 ml-auto">
                  σ {aggregate.stddev} · 范围 {aggregate.min}–{aggregate.max} · n {aggregate.n}
                </span>
              </div>
              <div className="grid grid-cols-10 gap-1 h-16 items-end">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(i => {
                  const count = aggregate.histogram[String(i)] || 0;
                  const max = Math.max(...Object.values(aggregate.histogram));
                  const pct = max > 0 ? (count / max) * 100 : 0;
                  return (
                    <div key={i} className="flex flex-col items-center justify-end h-full">
                      <span className="text-[9px] font-mono text-deep-300 mb-0.5 tabular-nums">{count || ''}</span>
                      <div
                        className="w-full rounded-t transition-all duration-500"
                        style={{
                          height: `${pct}%`,
                          background: i <= 4 ? '#C47D5A' : i >= 7 ? '#6EBF8B' : '#A8BCD8',
                          minHeight: count > 0 ? '4px' : '0',
                          boxShadow: count > 0 ? `0 0 6px currentColor` : 'none',
                        }}
                      />
                      <span className="text-[10px] font-mono text-deep-200 mt-0.5 tabular-nums">{i}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Human vs models comparison */}
      {humanBaseline && humanPreVote && aggregate?.type === 'binary' && (
        <div className="glass border border-amber-300/45 rounded-lg p-4 animate-fade-in-up">
          <p className="text-[11px] font-mono tracking-[0.20em] text-amber-300/95 uppercase mb-2">
            👥 人机对照
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-[10px] font-mono text-deep-300 mb-0.5">你的盲投</div>
              <div className="text-2xl font-bold" style={{ color: VOTE_COLOR[humanPreVote] || '#F2EDE7' }}>
                {humanPreVote.toUpperCase()}
              </div>
            </div>
            <span className={aggregate.winner === humanPreVote
              ? 'text-2xl text-earth-green'
              : 'text-2xl text-earth-rust'}>
              {aggregate.winner === humanPreVote ? '↔' : '⇌'}
            </span>
            <div className="flex-1">
              <div className="text-[10px] font-mono text-deep-300 mb-0.5">模型集体</div>
              <div className="text-2xl font-bold" style={{ color: VOTE_COLOR[aggregate.winner] || '#F2EDE7' }}>
                {aggregate.winner.toUpperCase()} <span className="text-[12px] font-normal text-deep-200">{(aggregate.consensus * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-deep-200 italic mt-2">
            {aggregate.winner === humanPreVote
              ? '✓ 你的直觉与模型集体一致 — 是真共识，还是大家都被同样的直觉误导？'
              : '⚡ 你的直觉与模型集体相反 — 一方在错，是哪一方？这是反思的好机会。'}
          </p>
        </div>
      )}

      {/* Strong disagreement detector */}
      {strongDisagreements.length > 0 && (
        <div className="glass border border-earth-rust/55 rounded-lg p-4 animate-fade-in-up">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[11px] font-mono tracking-[0.20em] text-earth-rust/95 uppercase">
              🪤 强分歧警报 · {strongDisagreements.length}
            </p>
            <span className="text-[10px] font-mono text-deep-300">双方信心 ≥75 且立场对立</span>
          </div>
          <div className="space-y-1.5">
            {strongDisagreements.slice(0, 5).map((d, i) => (
              <div key={i} className="rounded bg-deep-900/50 border border-earth-rust/35 px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-amber-300/95 truncate flex-1">{shortenModel(d.model_a)}</span>
                  <span className="font-bold text-[13px]" style={{ color: VOTE_COLOR[d.vote_a] }}>{d.vote_a.toUpperCase()}</span>
                  <span className="font-mono text-deep-300 text-[11px]">{d.conf_a}%</span>
                  <span className="text-earth-rust">⇌</span>
                  <span className="font-bold text-[13px]" style={{ color: VOTE_COLOR[d.vote_b] }}>{d.vote_b.toUpperCase()}</span>
                  <span className="font-mono text-deep-300 text-[11px]">{d.conf_b}%</span>
                  <span className="font-mono text-amber-300/95 truncate flex-1 text-right">{shortenModel(d.model_b)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-deep-200/95">
                  <div className="leading-snug pl-1">{d.rationale_a}</div>
                  <div className="leading-snug pl-1 text-right">{d.rationale_b}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Framing flip distillation */}
      {(flippedAgg || distillation) && (
        <div className="glass border border-blue-400/45 rounded-lg p-4 animate-fade-in-up">
          <p className="text-[11px] font-mono tracking-[0.20em] text-blue-400/95 uppercase mb-3">
            🪞 Framing Flip · 正反对照
          </p>
          {flippedAgg?.type === 'binary' && aggregate?.type === 'binary' && (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="rounded bg-deep-900/40 border border-deep-400/30 p-3">
                <div className="text-[10px] font-mono text-deep-300 mb-1">正向</div>
                <div className="text-lg font-bold" style={{ color: VOTE_COLOR[aggregate.winner] }}>
                  {aggregate.winner.toUpperCase()} {(aggregate.consensus * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] font-mono text-deep-300 mt-0.5">avg conf {aggregate.avg_confidence}</div>
              </div>
              <div className="rounded bg-deep-900/40 border border-deep-400/30 p-3">
                <div className="text-[10px] font-mono text-deep-300 mb-1">反向</div>
                <div className="text-lg font-bold" style={{ color: VOTE_COLOR[flippedAgg.winner] }}>
                  {flippedAgg.winner.toUpperCase()} {(flippedAgg.consensus * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] font-mono text-deep-300 mt-0.5">avg conf {flippedAgg.avg_confidence}</div>
              </div>
            </div>
          )}
          {distillation && (
            <div className="border-t border-blue-400/25 pt-2">
              <div className="text-[10px] font-mono text-blue-400/85 tracking-wider uppercase mb-1">⊜ 蒸馏结论</div>
              <p className="text-[13px] text-deep-50 leading-relaxed whitespace-pre-wrap">{distillation}</p>
            </div>
          )}
        </div>
      )}

      {/* Delphi: reactions + stance shifts */}
      {(delphiReactions.length > 0 || delphiShifts.length > 0) && (
        <div className="glass border border-purple-400/45 rounded-lg p-4 animate-fade-in-up">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[11px] font-mono tracking-[0.20em] text-purple-400/95 uppercase">
              🔁 Delphi · 互看 + 重投
            </p>
            <span className="text-[10px] font-mono text-amber-300/85">⚠ 立场迁移可能是真心改变，也可能是从众</span>
          </div>
          {delphiReactions.length > 0 && (
            <div className="mb-3 space-y-1">
              <div className="text-[10px] font-mono text-deep-300 tracking-wider uppercase mb-1">辩论反应</div>
              {delphiReactions.map((r, i) => (
                <div key={i} className="rounded bg-deep-900/40 border border-deep-400/30 px-3 py-1.5 text-[12px]">
                  <span className="font-mono text-purple-400/95 mr-2">{shortenModel(r.model)}</span>
                  <span className="text-deep-100">{r.reaction}</span>
                </div>
              ))}
            </div>
          )}
          {delphiShifts.length > 0 && revoteAgg && (
            <div>
              <div className="text-[10px] font-mono text-deep-300 tracking-wider uppercase mb-1">立场迁移图</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {delphiShifts.map((s, i) => (
                  <div
                    key={i}
                    className={`rounded px-3 py-1.5 text-[12px] flex items-center gap-2 ${
                      s.shifted
                        ? 'bg-purple-400/[0.08] border border-purple-400/45'
                        : 'bg-deep-900/40 border border-deep-400/30'
                    }`}
                  >
                    <span className="font-mono text-deep-100 truncate flex-1">{shortenModel(s.model)}</span>
                    <span className="font-bold" style={{ color: VOTE_COLOR[s.before] }}>{s.before.toUpperCase()}</span>
                    <span className={s.shifted ? 'text-purple-400' : 'text-deep-400'}>→</span>
                    <span className="font-bold" style={{ color: VOTE_COLOR[s.after] }}>{s.after.toUpperCase()}</span>
                    {s.shifted && <span className="text-[10px] font-mono text-purple-400/85">迁移</span>}
                  </div>
                ))}
              </div>
              {revoteAgg.type === 'binary' && aggregate?.type === 'binary' && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="rounded bg-deep-900/40 border border-deep-400/30 px-2 py-1">
                    <span className="text-deep-300">初投：</span>
                    <span className="font-bold" style={{ color: VOTE_COLOR[aggregate.winner] }}>
                      {aggregate.winner.toUpperCase()} {(aggregate.consensus * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="rounded bg-deep-900/40 border border-purple-400/45 px-2 py-1">
                    <span className="text-deep-300">重投：</span>
                    <span className="font-bold" style={{ color: VOTE_COLOR[revoteAgg.winner] }}>
                      {revoteAgg.winner.toUpperCase()} {(revoteAgg.consensus * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Per-model votes (grouped) */}
      {/* Profile modal */}
      {profileOpen && (
        <div onClick={() => setProfileOpen(false)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in">
          <div onClick={e => e.stopPropagation()} className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-fade-in-scale">
            <div className="flex items-center justify-between px-5 py-3 border-b border-deep-400/35">
              <h3 className="text-[14px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                📊 模型行为档案 · 跨会话长效跟踪
              </h3>
              <button onClick={() => setProfileOpen(false)} className="text-deep-200 hover:text-amber-300 text-lg">✕</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {profileData.length === 0 && (
                <p className="text-[13px] text-deep-300 text-center py-6">尚无投票历史 — 跑一次后再来看</p>
              )}
              {profileData.map((p: any) => {
                const styleColor =
                  p.style === '果断' ? '#6EBF8B' :
                  p.style === '保守' ? '#A8BCD8' :
                  p.style === '犹豫' ? '#C47D5A' :
                  '#E8B988';
                return (
                  <div key={p.model} className="rounded-lg border border-deep-400/45 bg-deep-800/40 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <code className="text-[12px] font-mono text-amber-300/95">{shortenModel(p.model)}</code>
                      <span
                        className="text-[10px] font-mono px-2 py-0.5 rounded font-bold"
                        style={{ color: styleColor, background: `${styleColor}1c`, border: `1px solid ${styleColor}55` }}
                      >
                        {p.style}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2 text-[11px] font-mono">
                      <div>
                        <div className="text-deep-300 tracking-wider">总票数</div>
                        <div className="text-amber-200 text-[14px] font-bold tabular-nums">{p.total_votes}</div>
                      </div>
                      <div>
                        <div className="text-deep-300 tracking-wider">avg conf</div>
                        <div className="text-amber-200 text-[14px] font-bold tabular-nums">{p.avg_confidence}</div>
                      </div>
                      <div>
                        <div className="text-deep-300 tracking-wider">不确定率</div>
                        <div className="text-deep-100 text-[14px] tabular-nums">{(p.uncertain_rate * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-deep-300 tracking-wider">迁移率</div>
                        <div className="text-deep-100 text-[14px] tabular-nums">
                          {p.stance_shift_rate !== null && p.stance_shift_rate !== undefined
                            ? `${(p.stance_shift_rate * 100).toFixed(0)}%`
                            : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-deep-900">
                      {p.yes > 0 && (
                        <div className="h-full" style={{ width: `${p.yes_rate * 100}%`, background: '#6EBF8B' }} title={`yes ${(p.yes_rate*100).toFixed(0)}%`} />
                      )}
                      {p.no > 0 && (
                        <div className="h-full" style={{ width: `${p.no_rate * 100}%`, background: '#C47D5A' }} title={`no ${(p.no_rate*100).toFixed(0)}%`} />
                      )}
                      {p.uncertain > 0 && (
                        <div className="h-full" style={{ width: `${p.uncertain_rate * 100}%`, background: '#A8BCD8' }} title={`uncertain ${(p.uncertain_rate*100).toFixed(0)}%`} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-2 border-t border-deep-400/30 text-[10px] font-mono text-deep-300 tracking-wider">
              风格分类：果断（高 yes/no、高信心）· 保守（高不确定率）· 犹豫（低信心）· 均衡
            </div>
          </div>
        </div>
      )}

      {Object.keys(groupedByModel).length > 0 && (
        <div className="space-y-3">
          <p className="text-[12px] font-mono tracking-[0.20em] text-amber-300/95 uppercase">
            🗳 票详情 · {results.length}
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 fade-stagger" style={{ ['--stagger-step' as any]: '60ms' }}>
            {Object.entries(groupedByModel).map(([model, votes]) => {
              return (
                <div
                  key={model}
                  className="rounded-lg border border-deep-400/45 bg-deep-800/40 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-mono text-amber-300/95">
                      ◇ {shortenModel(model)}
                    </span>
                    <span className="text-[10px] font-mono text-deep-300 tabular-nums">
                      {votes.length} 票 · avg {Math.round(votes.reduce((s, v) => s + v.confidence, 0) / votes.length)}% conf
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {votes.map((v, i) => {
                      const anyV = v as any;
                      const role = anyV.role;
                      const channel = anyV.channel;
                      const baseRate = anyV.base_rate;
                      const adjustments = anyV.adjustments as string[] | undefined;
                      const roleColor =
                        role === 'optimist' ? '#6EBF8B' :
                        role === 'pessimist' ? '#C47D5A' :
                        role === 'neutral' ? '#A8BCD8' :
                        '#7A736C';
                      const channelColor =
                        channel === 'flipped' ? '#A8BCD8' :
                        channel === 'revote' ? '#B58FBF' :
                        '#7A736C';
                      return (
                        <div
                          key={i}
                          className="rounded bg-deep-900/40 border border-deep-400/30 px-2 py-1.5"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 font-bold"
                              style={{
                                color: VOTE_COLOR[v.vote] || '#F2EDE7',
                                background: `${VOTE_COLOR[v.vote] || '#3D3835'}22`,
                                border: `1px solid ${VOTE_COLOR[v.vote] || '#7A736C'}55`,
                              }}
                            >
                              {v.vote.toUpperCase()}
                            </span>
                            <span className="text-[10px] font-mono text-deep-300 shrink-0 mt-0.5">
                              T{v.temperature}
                            </span>
                            {role && (
                              <span
                                className="text-[9px] font-mono shrink-0 mt-0.5 px-1 py-0.5 rounded"
                                style={{ color: roleColor, background: `${roleColor}1c`, border: `1px solid ${roleColor}55` }}
                                title="角色框架"
                              >
                                {role === 'optimist' ? '乐观' : role === 'pessimist' ? '悲观' : '中性'}
                              </span>
                            )}
                            {channel && channel !== 'original' && (
                              <span
                                className="text-[9px] font-mono shrink-0 mt-0.5 px-1 py-0.5 rounded"
                                style={{ color: channelColor, background: `${channelColor}1c`, border: `1px solid ${channelColor}55` }}
                              >
                                {channel === 'flipped' ? '反向' : '重投'}
                              </span>
                            )}
                            <span className="text-[12px] text-deep-100 leading-snug flex-1">
                              {v.rationale}
                            </span>
                            <span className="text-[10px] font-mono text-amber-300/85 shrink-0 mt-0.5">
                              {v.confidence}%
                            </span>
                          </div>
                          {(baseRate || (adjustments && adjustments.length > 0)) && (
                            <div className="mt-1 ml-4 pl-2 border-l border-amber-300/25 text-[10px] font-mono text-deep-300 leading-relaxed">
                              {baseRate && <div>base: {baseRate}</div>}
                              {adjustments && adjustments.length > 0 && (
                                <div>+ {adjustments.join(' · ')}</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
