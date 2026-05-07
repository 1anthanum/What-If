import { useEffect, useRef, useState } from 'react';
import { autonomousDebateApi, type AutonomousDebateConfig } from '../../services/api';
import { DebateTimeline, type TimelineEvent } from './DebateTimeline';
import { DecisionTreeView } from './DecisionTreeView';

interface PersonaStatement {
  persona_id: string;
  persona_name: string;
  model?: string;
  content: string;
  round: number;
  isStreaming?: boolean;
}

interface BranchEval {
  confidence: number;
  coherence: number;
  novelty: number;
  risk_signal: number;
  one_line_takeaway: string;
  notable_disagreement: string;
}

interface BranchData {
  branch_id: string;
  cycle: number;
  injection: string;
  rounds_run: number;
  persona_summaries: { persona_id: string; persona_name: string; summary: string }[];
  eval: BranchEval | null;
}

interface DecisionData {
  cycle: number;
  verdict: {
    action: 'deepen' | 'diverge' | 'converge';
    target_branch_id: string | null;
    next_injection_seeds: string[];
    rationale: string;
    overall_confidence: number;
  };
  elapsed_s: number;
  cost_usd: number;
}

const ACTION_THEME: Record<string, { bg: string; color: string; label: string }> = {
  deepen: { bg: 'rgba(110,191,139,0.10)', color: '#8BCFA1', label: '深挖' },
  diverge: { bg: 'rgba(139,159,191,0.10)', color: '#A8BCD8', label: '换向' },
  converge: { bg: 'rgba(232,185,136,0.12)', color: '#F5C896', label: '收敛' },
};

function fmtTime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

export function AutonomousDebateView() {
  const [config, setConfig] = useState<AutonomousDebateConfig>({
    seed_topic: '',
    domain: 'general',
    max_cycles: 3,
    time_budget_seconds: 1800,
    cost_budget_usd: 0.30,
    rounds_per_branch: 1,
    branches_per_cycle: 2,
    confidence_threshold: 80,
  });
  // #7 Structured topic — user fills these and we compose seed_topic on submit
  const [coreVar, setCoreVar] = useState('');
  const [premise, setPremise] = useState('');
  const [focusQ, setFocusQ] = useState('');
  // #3 History
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Array<{ session_id: string; topic: string; branches: number; cost_usd: number; mtime: number }>>([]);
  // #8 Runtime injection box
  const [injectText, setInjectText] = useState('');
  // #5 Persona evolution drawer
  const [personaCompareName, setPersonaCompareName] = useState<string | null>(null);
  // #12 Briefing
  const [briefingMd, setBriefingMd] = useState<string | null>(null);
  // #6 Decision tree toggle
  const [treeOpen, setTreeOpen] = useState(false);
  // #9 Multi-session compare
  const [compareSet, setCompareSet] = useState<Set<string>>(new Set());
  const [compareData, setCompareData] = useState<Awaited<ReturnType<typeof autonomousDebateApi.compareSessions>>['sessions'] | null>(null);
  // Branch sort + filter + global search
  const [sortBy, setSortBy] = useState<'order' | 'confidence' | 'novelty' | 'risk'>('order');
  const [minConfidence, setMinConfidence] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  // Reading mode (focused full-screen branch view)
  const [readingBranchId, setReadingBranchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchData[]>([]);
  const [decisions, setDecisions] = useState<DecisionData[]>([]);
  const [currentInjections, setCurrentInjections] = useState<string[]>([]);
  const [thinking, setThinking] = useState<string | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<{ persona: string; branch: string } | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [finalSynth, setFinalSynth] = useState<string>('');
  const [elapsed, setElapsed] = useState(0);
  const [cost, setCost] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [branchStatements, setBranchStatements] = useState<Record<string, PersonaStatement[]>>({});
  const [expandedBranchId, setExpandedBranchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startTsRef = useRef<number>(0);

  const pushTimeline = (ev: TimelineEvent) => {
    setTimelineEvents(prev => [...prev, ev]);
  };
  const branchDomId = (id: string) => `auto-branch-${id}`;
  const decisionDomId = (i: number) => `auto-decision-${i}`;
  const handleJump = (id: string) => {
    setActiveTimelineId(id);
    // Map timeline event id → DOM id
    let domId = id;
    if (id.startsWith('branch:')) domId = branchDomId(id.slice(7));
    else if (id.startsWith('decision:')) domId = decisionDomId(parseInt(id.slice(9), 10));
    else if (id === 'final') domId = 'auto-final-synth';
    else if (id.startsWith('inject:')) domId = `auto-inject-${id.slice(7)}`;
    else if (id.startsWith('cycle:')) {
      // Jump to first branch of that cycle
      const cycle = parseInt(id.slice(6), 10);
      const first = branches.find(b => b.cycle === cycle);
      if (first) domId = branchDomId(first.branch_id);
    }
    const el = document.getElementById(domId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-amber-300/65');
      setTimeout(() => el.classList.remove('ring-2', 'ring-amber-300/65'), 1600);
    }
  };

  // Tick the elapsed counter while running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTsRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // Keyboard shortcuts: Esc closes any open modal, Cmd/Ctrl+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (briefingMd !== null) setBriefingMd(null);
        else if (compareData) setCompareData(null);
        else if (personaCompareName) setPersonaCompareName(null);
        else if (historyOpen) setHistoryOpen(false);
        else if (readingBranchId) setReadingBranchId(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>('input[data-search-input]');
        if (el) el.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [briefingMd, compareData, personaCompareName, historyOpen, readingBranchId]);

  const composeSeedTopic = (): string => {
    if (config.seed_topic.trim()) return config.seed_topic.trim();
    const parts: string[] = [];
    if (coreVar.trim()) parts.push(`核心变量：${coreVar.trim()}`);
    if (premise.trim()) parts.push(`前提约束：${premise.trim()}`);
    if (focusQ.trim()) parts.push(`关注问题：${focusQ.trim()}`);
    return parts.join('；');
  };

  const handleStart = async () => {
    const composed = composeSeedTopic();
    if (!composed || running) return;
    config.seed_topic = composed;

    setBranches([]);
    setDecisions([]);
    setCurrentInjections([]);
    setFinalSynth('');
    setStopReason(null);
    setSessionId(null);
    setActiveBranchId(null);
    setActiveRound(null);
    setThinking(null);
    setElapsed(0);
    setCost(0);
    setTokens(0);
    setBranchStatements({});
    setExpandedBranchId(null);
    setTimelineEvents([]);
    setActiveTimelineId(null);
    startTsRef.current = Date.now();
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const stream = autonomousDebateApi.startStream(config);
      for await (const ev of stream.events) {
        if (controller.signal.aborted) break;
        switch (ev.type) {
          case 'auto_session_start':
            setSessionId(ev.data.session_id as string);
            break;
          case 'auto_persona_start': {
            const branchId = ev.data.branch_id as string;
            const personaId = ev.data.persona_id as string;
            const personaName = ev.data.persona_name as string;
            const round = ev.data.round as number;
            const model = ev.data.model as string;
            setActiveRound({ persona: personaName, branch: branchId });
            setActiveBranchId(branchId);
            // Auto-expand the active branch so the user sees streaming content live
            setExpandedBranchId(branchId);
            // Add a placeholder branch row immediately if we haven't seen this one
            // before — otherwise nothing appears until the eval lands
            setBranches(prev => {
              if (prev.some(b => b.branch_id === branchId)) return prev;
              const cycleN = parseInt(branchId.split('-')[0].slice(1), 10) || 0;
              return [
                ...prev,
                {
                  branch_id: branchId,
                  cycle: cycleN,
                  injection: '',
                  rounds_run: 0,
                  persona_summaries: [],
                  eval: null,
                },
              ];
            });
            setBranchStatements(prev => {
              const list = prev[branchId] ? [...prev[branchId]] : [];
              const idx = list.findIndex(s => s.persona_id === personaId && s.round === round);
              const stub: PersonaStatement = {
                persona_id: personaId,
                persona_name: personaName,
                model,
                round,
                content: '',
                isStreaming: true,
              };
              if (idx >= 0) list[idx] = stub;
              else list.push(stub);
              return { ...prev, [branchId]: list };
            });
            break;
          }
          case 'auto_persona_chunk': {
            const branchId = ev.data.branch_id as string;
            const personaId = ev.data.persona_id as string;
            const text = (ev.data.text as string) ?? '';
            setBranchStatements(prev => {
              const list = prev[branchId] ? [...prev[branchId]] : [];
              const idx = list.findIndex(s => s.persona_id === personaId && s.isStreaming);
              if (idx >= 0) {
                list[idx] = { ...list[idx], content: list[idx].content + text };
              }
              return { ...prev, [branchId]: list };
            });
            break;
          }
          case 'auto_persona_complete': {
            const branchId = ev.data.branch_id as string;
            const personaId = ev.data.persona_id as string;
            const content = (ev.data.content as string) ?? '';
            setBranchStatements(prev => {
              const list = prev[branchId] ? [...prev[branchId]] : [];
              const idx = list.findIndex(s => s.persona_id === personaId && s.isStreaming);
              if (idx >= 0) {
                list[idx] = { ...list[idx], content, isStreaming: false };
              }
              return { ...prev, [branchId]: list };
            });
            setActiveRound(null);
            break;
          }
          case 'auto_branch_summary':
            // branch summaries arrive piece-by-piece; we wait for __branch_done
            break;
          case 'auto_branch_eval':
          case '__branch_done': {
            const data = ev.data as any;
            const branch_id = data.branch_id as string;
            const incomingRounds = typeof data.rounds_run === 'number' ? data.rounds_run : undefined;
            setBranches(prev => {
              const existing = prev.find(b => b.branch_id === branch_id);
              if (existing) {
                return prev.map(b =>
                  b.branch_id === branch_id
                    ? {
                        ...b,
                        eval: data.eval ?? b.eval,
                        injection: data.injection ?? b.injection,
                        // Only overwrite rounds_run if the new value is meaningful;
                        // otherwise keep the existing (don't reset to 0).
                        rounds_run: incomingRounds && incomingRounds > 0 ? incomingRounds : b.rounds_run,
                        persona_summaries: data.persona_summaries?.length ? data.persona_summaries : b.persona_summaries,
                      }
                    : b
                );
              }
              return [
                ...prev,
                {
                  branch_id,
                  cycle: data.cycle ?? 0,
                  injection: data.injection ?? '',
                  rounds_run: incomingRounds ?? config.rounds_per_branch ?? 2,
                  persona_summaries: data.persona_summaries ?? [],
                  eval: data.eval ?? null,
                },
              ];
            });
            // Push timeline event only once per branch (first time we see this id)
            if (ev.type === 'auto_branch_eval') {
              setTimelineEvents(prev => {
                if (prev.some(e => e.id === `branch:${branch_id}`)) return prev;
                const evalObj = data.eval as BranchEval | null;
                return [
                  ...prev,
                  {
                    id: `branch:${branch_id}`,
                    kind: 'branch',
                    label: `${branch_id} · ${data.injection ? '注入分支' : '基线'}`,
                    detail: evalObj?.one_line_takeaway || (data.injection as string) || '',
                    ts: Date.now() - startTsRef.current,
                  },
                ];
              });
            }
            break;
          }
          case 'auto_cycle_start': {
            const cycleN = ev.data.cycle as number;
            setThinking(`Cycle ${cycleN} 启动`);
            setCost(ev.data.cost_usd as number);
            pushTimeline({
              id: `cycle:${cycleN}`,
              kind: 'cycle',
              label: `Cycle ${cycleN} 开始`,
              detail: `已花费 $${(ev.data.cost_usd as number).toFixed(3)} · ${ev.data.branches_so_far} 分支`,
              ts: Date.now() - startTsRef.current,
            });
            break;
          }
          case 'auto_decider_thinking':
            setThinking(
              ev.data.phase === 'haiku_injections'
                ? '🌿 生成注入变种…'
                : '🧠 决策中…'
            );
            break;
          case 'auto_injections_proposed': {
            const cycleN = ev.data.cycle as number;
            const injs = ev.data.injections as string[];
            setCurrentInjections(injs);
            setThinking(null);
            pushTimeline({
              id: `inject:${cycleN}`,
              kind: 'inject',
              label: `Cycle ${cycleN} 注入 × ${injs.length}`,
              detail: injs.slice(0, 2).join(' / ') + (injs.length > 2 ? '…' : ''),
              ts: Date.now() - startTsRef.current,
            });
            break;
          }
          case 'auto_decision': {
            const data = ev.data as DecisionData;
            // Dedupe by cycle: each cycle should produce exactly one decision
            setDecisions(prev => {
              if (prev.some(d => d.cycle === data.cycle)) return prev;
              const next = [...prev, data];
              const decisionIdx = next.length - 1;
              setTimelineEvents(tprev => {
                if (tprev.some(e => e.id === `decision:cycle-${data.cycle}`)) return tprev;
                return [
                  ...tprev,
                  {
                    id: `decision:cycle-${data.cycle}`,
                    kind: 'decision',
                    label: `决策 cycle ${data.cycle} · ${data.verdict.action}`,
                    detail: `${data.verdict.overall_confidence}% — ${data.verdict.rationale}`,
                    ts: Date.now() - startTsRef.current,
                    payload: { decisionIdx },
                  },
                ];
              });
              return next;
            });
            setCost(ev.data.cost_usd as number);
            setThinking(null);
            break;
          }
          case 'auto_final_synth_start':
            setThinking('🧠 撰写终评…');
            setStopReason(ev.data.stop_reason as string);
            break;
          case 'auto_final_synth':
            setFinalSynth(ev.data.text as string);
            setThinking(null);
            if (ev.data.token_usage) {
              const t = ev.data.token_usage as any;
              setCost(t.estimated_cost_usd ?? cost);
              setTokens((t.total_input_tokens ?? 0) + (t.total_output_tokens ?? 0));
            }
            pushTimeline({
              id: 'final',
              kind: 'final',
              label: '终评完成',
              detail: ev.data.stop_reason as string,
              ts: Date.now() - startTsRef.current,
            });
            break;
          case 'auto_session_end':
            setRunning(false);
            setActiveRound(null);
            setActiveBranchId(null);
            break;
        }
      }
    } catch (e) {
      console.error('autonomous debate stream error', e);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = async () => {
    if (sessionId) {
      try {
        await autonomousDebateApi.cancel(sessionId);
      } catch (e) {
        console.error('cancel failed', e);
      }
    }
    abortRef.current?.abort();
    setRunning(false);
  };

  const handleKillBranch = async (branchId: string) => {
    if (!sessionId) return;
    try {
      await autonomousDebateApi.killBranch(sessionId, branchId);
    } catch (e) {
      console.error('kill branch failed', e);
    }
  };

  const handleInjectSeed = async () => {
    if (!sessionId || !injectText.trim()) return;
    try {
      await autonomousDebateApi.injectSeed(sessionId, injectText.trim());
      setInjectText('');
    } catch (e) {
      console.error('inject failed', e);
    }
  };

  const handleOpenHistory = async () => {
    setHistoryOpen(true);
    try {
      const r = await autonomousDebateApi.listSessions();
      setHistory(r.sessions);
    } catch (e) {
      console.error('history list failed', e);
    }
  };

  const handleExportBriefing = async () => {
    if (!sessionId) return;
    try {
      const r = await autonomousDebateApi.getBriefing(sessionId);
      setBriefingMd(r.markdown);
    } catch (e) {
      console.error('briefing failed', e);
    }
  };

  const toggleCompare = (sid: string) => {
    setCompareSet(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else if (next.size < 6) next.add(sid);
      return next;
    });
  };

  const handleCompare = async () => {
    if (compareSet.size < 2) return;
    try {
      const r = await autonomousDebateApi.compareSessions(Array.from(compareSet));
      setCompareData(r.sessions);
      setHistoryOpen(false);
    } catch (e) {
      console.error('compare failed', e);
    }
  };

  const timePct = Math.min(100, (elapsed / (config.time_budget_seconds ?? 7200)) * 100);
  const costPct = Math.min(100, (cost / (config.cost_budget_usd ?? 5)) * 100);
  const cyclesDone = Math.max(...branches.map(b => b.cycle), 0);
  const cyclePct = Math.min(100, (cyclesDone / (config.max_cycles ?? 6)) * 100);

  return (
    <div className="space-y-6">
      {/* Config form (only when idle) */}
      {!running && branches.length === 0 && (
        <div className="glass border border-amber-300/35 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium text-white/95 mb-1">🌳 自主议题探索</h2>
              <p className="text-[14px] text-deep-200/85 leading-relaxed">
                围绕一个议题持续辩论 ~30 分钟–2 小时。Haiku 生成注入变种，Sonnet 给每个分支多维评分，
                Opus 在关键节点决定深挖 / 换向 / 收敛。
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenHistory}
              className="text-[12px] font-mono tracking-[0.18em] text-amber-300/95 hover:text-amber-200 px-3 py-1.5 rounded border border-amber-300/45 hover:border-amber-300/65 hover:bg-amber-300/[0.04] transition-all"
              title="查看过往会话"
            >
              📜 HISTORY
            </button>
          </div>

          {/* Structured topic — three short fields, or fall back to free-form below */}
          <div className="space-y-3">
            <label className="block text-[12px] font-mono tracking-[0.20em] text-amber-300/85 uppercase">
              议题（结构化输入，留空则用下面的自由文本）
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input
                type="text" value={coreVar}
                onChange={e => setCoreVar(e.target.value)}
                placeholder="核心变量（X 改变）"
                className="bg-deep-700/40 border border-deep-400/45 rounded-lg px-3 py-2 text-[14px] text-white placeholder-deep-300/55 focus:border-amber-300/55 transition-all"
              />
              <input
                type="text" value={premise}
                onChange={e => setPremise(e.target.value)}
                placeholder="前提约束（这些为真）"
                className="bg-deep-700/40 border border-deep-400/45 rounded-lg px-3 py-2 text-[14px] text-white placeholder-deep-300/55 focus:border-amber-300/55 transition-all"
              />
              <input
                type="text" value={focusQ}
                onChange={e => setFocusQ(e.target.value)}
                placeholder="关注问题（你最想答的）"
                className="bg-deep-700/40 border border-deep-400/45 rounded-lg px-3 py-2 text-[14px] text-white placeholder-deep-300/55 focus:border-amber-300/55 transition-all"
              />
            </div>
            <textarea
              value={config.seed_topic}
              onChange={e => setConfig({ ...config, seed_topic: e.target.value })}
              placeholder="或：自由文本议题（会覆盖上面三栏）"
              rows={2}
              className="w-full bg-deep-700/40 border border-deep-400/45 rounded-lg px-4 py-3 text-[15px] text-white placeholder-deep-300/55 focus:border-amber-300/55 transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                时间预算（小时）<span className="text-amber-300/85">{((config.time_budget_seconds ?? 7200) / 3600).toFixed(1)}h</span>
              </label>
              <input type="range" min={600} max={14400} step={300}
                value={config.time_budget_seconds}
                onChange={e => setConfig({ ...config, time_budget_seconds: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${((config.time_budget_seconds ?? 7200) - 600) / 138}%, rgba(80,75,70,0.45) ${((config.time_budget_seconds ?? 7200) - 600) / 138}%)` }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                成本预算 USD <span className="text-amber-300/85">${config.cost_budget_usd?.toFixed(2)}</span>
              </label>
              <input type="range" min={0.5} max={20} step={0.5}
                value={config.cost_budget_usd}
                onChange={e => setConfig({ ...config, cost_budget_usd: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${(((config.cost_budget_usd ?? 5) - 0.5) / 19.5) * 100}%, rgba(80,75,70,0.45) ${(((config.cost_budget_usd ?? 5) - 0.5) / 19.5) * 100}%)` }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                最大 cycle <span className="text-amber-300/85">{config.max_cycles}</span>
              </label>
              <input type="range" min={1} max={20} step={1}
                value={config.max_cycles}
                onChange={e => setConfig({ ...config, max_cycles: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${((config.max_cycles ?? 6) / 20) * 100}%, rgba(80,75,70,0.45) ${((config.max_cycles ?? 6) / 20) * 100}%)` }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                每 cycle 分支数 <span className="text-amber-300/85">{config.branches_per_cycle}</span>
              </label>
              <input type="range" min={1} max={6} step={1}
                value={config.branches_per_cycle}
                onChange={e => setConfig({ ...config, branches_per_cycle: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${((config.branches_per_cycle ?? 3) / 6) * 100}%, rgba(80,75,70,0.45) ${((config.branches_per_cycle ?? 3) / 6) * 100}%)` }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                每分支轮数 <span className="text-amber-300/85">{config.rounds_per_branch}</span>
              </label>
              <input type="range" min={1} max={5} step={1}
                value={config.rounds_per_branch}
                onChange={e => setConfig({ ...config, rounds_per_branch: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${((config.rounds_per_branch ?? 2) / 5) * 100}%, rgba(80,75,70,0.45) ${((config.rounds_per_branch ?? 2) / 5) * 100}%)` }}
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono tracking-wider text-deep-200 mb-1.5">
                收敛信心阈值 <span className="text-amber-300/85">{config.confidence_threshold}</span>
              </label>
              <input type="range" min={50} max={100} step={5}
                value={config.confidence_threshold}
                onChange={e => setConfig({ ...config, confidence_threshold: Number(e.target.value) })}
                className="w-full settings-range"
                style={{ background: `linear-gradient(to right, #E8B988 ${(((config.confidence_threshold ?? 85) - 50) / 50) * 100}%, rgba(80,75,70,0.45) ${(((config.confidence_threshold ?? 85) - 50) / 50) * 100}%)` }}
              />
            </div>
          </div>

          <div className="text-[11px] font-mono text-deep-300 leading-relaxed bg-deep-800/40 border border-deep-400/30 rounded p-3">
            <span className="text-amber-300/85">分级模型（预算友好默认）：</span>
            persona 5x 本地 Ollama · 摘要 qwen3.5:27b · 注入变种 DeepSeek-flash · 分支评分 DeepSeek-pro · 决策与终评 Sonnet 4.6
            <br />
            <span className="text-deep-400/85 mt-1 inline-block">
              全程本地 + DeepSeek + 1 次 Sonnet 调用，预计 ~$0.10–0.30 / 会话
            </span>
          </div>

          <button
            onClick={handleStart}
            disabled={!composeSeedTopic()}
            className="w-full py-3.5 rounded-lg bg-gradient-to-r from-amber-700 to-amber-600 text-white font-medium shadow-glow hover:shadow-glow-lg disabled:opacity-40 disabled:cursor-not-allowed btn-glow tracking-wide"
          >
            ▶ 启动自主探索
          </button>
        </div>
      )}

      {/* Live progress bar */}
      {(running || branches.length > 0) && (
        <div className="glass border border-amber-300/35 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                🌳 议题：{config.seed_topic.slice(0, 40)}{config.seed_topic.length > 40 ? '…' : ''}
              </span>
              {running && (
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/85 px-2 py-0.5 rounded border border-amber-300/45 bg-amber-300/[0.05]">
                  <span className="w-2 h-2 border border-amber-300/50 border-t-amber-300 rounded-full animate-spin" />
                  RUNNING
                </span>
              )}
              {!running && stopReason && (
                <span className="text-[11px] font-mono text-deep-200 px-2 py-0.5 rounded border border-deep-400/45 bg-deep-800/50">
                  ⏹ {stopReason}
                </span>
              )}
            </div>
            {running && (
              <button
                onClick={handleCancel}
                className="text-[12px] font-mono tracking-[0.18em] text-earth-rust hover:text-earth-rust px-3 py-1 rounded border border-earth-rust/45 hover:border-earth-rust/70 hover:bg-earth-rust/[0.06] transition-all"
              >
                ⏹ STOP
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                <span className="text-deep-200 tracking-wider">⏱ 时间</span>
                <span className="text-amber-300 tabular-nums">{fmtTime(elapsed)} / {fmtTime(config.time_budget_seconds ?? 7200)}</span>
              </div>
              <div className="h-1.5 bg-deep-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400/85" style={{ width: `${timePct}%`, boxShadow: '0 0 6px rgba(232,185,136,0.5)' }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                <span className="text-deep-200 tracking-wider">$ 成本</span>
                <span className={costPct > 80 ? 'text-earth-rust tabular-nums' : 'text-amber-300 tabular-nums'}>
                  ${cost.toFixed(3)} / ${(config.cost_budget_usd ?? 5).toFixed(2)}
                </span>
              </div>
              <div className="h-1.5 bg-deep-700 rounded-full overflow-hidden">
                <div className={`h-full ${costPct > 80 ? 'bg-earth-rust' : 'bg-amber-400/85'}`} style={{ width: `${costPct}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                <span className="text-deep-200 tracking-wider">⊜ Cycles</span>
                <span className="text-amber-300 tabular-nums">{cyclesDone} / {config.max_cycles}</span>
              </div>
              <div className="h-1.5 bg-deep-700 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400/85" style={{ width: `${cyclePct}%` }} />
              </div>
            </div>
          </div>

          {(thinking || activeRound) && (
            <div className="text-[11px] font-mono text-amber-300/85 italic flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
              {activeRound
                ? `${activeRound.branch} → ${activeRound.persona} 发言中…`
                : thinking}
            </div>
          )}

          {/* #8 Runtime injection — give Opus a hint for the next cycle */}
          {running && (
            <div className="mt-3 pt-3 border-t border-deep-400/30 flex items-center gap-2">
              <span className="text-[11px] font-mono tracking-wider text-amber-300/85 shrink-0">
                + 注入种子
              </span>
              <input
                type="text"
                value={injectText}
                onChange={e => setInjectText(e.target.value)}
                placeholder="给下一 cycle 的 Haiku 一个方向（≤30 字）"
                className="flex-1 bg-deep-700/40 border border-deep-400/45 rounded px-3 py-1.5 text-[13px] text-white placeholder-deep-300/55 focus:border-amber-300/55"
                onKeyDown={e => { if (e.key === 'Enter') handleInjectSeed(); }}
              />
              <button
                onClick={handleInjectSeed}
                disabled={!injectText.trim()}
                className="text-[11px] font-mono tracking-wider px-3 py-1.5 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06] transition-all disabled:opacity-40"
              >
                ▶ 入队
              </button>
            </div>
          )}

          {/* #12 Briefing export — show only after final synth */}
          {!running && finalSynth && sessionId && (
            <div className="mt-3 pt-3 border-t border-deep-400/30 flex justify-end">
              <button
                onClick={handleExportBriefing}
                className="text-[11px] font-mono tracking-[0.18em] px-3 py-1.5 rounded border border-amber-300/45 text-amber-300 hover:border-amber-300/70 hover:bg-amber-300/[0.06] transition-all"
              >
                📄 EXPORT BRIEFING
              </button>
            </div>
          )}
        </div>
      )}

      {/* Current proposed injections */}
      {currentInjections.length > 0 && running && (
        <div
          key={`inj-${currentInjections.join('|')}`}
          className="glass-subtle rounded-lg p-4 border border-deep-400/35 animate-fade-in-up"
        >
          <p className="text-[11px] font-mono tracking-[0.20em] text-amber-300/85 uppercase mb-2">
            🌿 本 cycle 注入变种
          </p>
          <ul className="space-y-1 fade-stagger" style={{ ['--stagger-step' as any]: '120ms' }}>
            {currentInjections.map((inj, i) => (
              <li key={i} className="text-[13px] text-deep-100 leading-snug pl-3 border-l-2 border-amber-300/35">
                {inj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Decisions log */}
      {decisions.length > 0 && (
        <div className="space-y-2">
          {decisions.map((d, i) => {
            const theme = ACTION_THEME[d.verdict.action];
            return (
              <div
                key={i}
                id={decisionDomId(i)}
                className="rounded-lg border px-4 py-3 flex items-start gap-3 animate-fade-in-scale"
                style={{ background: theme.bg, borderColor: `${theme.color}55` }}
              >
                <div
                  className="text-[11px] font-mono px-2 py-0.5 rounded font-bold tracking-wider"
                  style={{ color: theme.color, background: `${theme.color}22`, border: `1px solid ${theme.color}55` }}
                >
                  {theme.label} · {d.verdict.overall_confidence}%
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono text-deep-300 mb-1">
                    Cycle {d.cycle} · {fmtTime(d.elapsed_s)} · ${d.cost_usd.toFixed(3)}
                  </div>
                  <p className="text-[13px] text-deep-100/95 leading-snug">{d.verdict.rationale}</p>
                  {d.verdict.next_injection_seeds.length > 0 && (
                    <p className="text-[11px] font-mono text-deep-300 mt-1">
                      下一步种子：{d.verdict.next_injection_seeds.join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* #6 Decision tree (toggle, opens above branches grid) */}
      {branches.length > 0 && treeOpen && (
        <div className="animate-fade-in-up">
          <p className="text-[12px] font-mono tracking-[0.20em] text-amber-300/85 uppercase mb-2">
            🌲 决策树 · 节点 = 分支，连线 = 父子（deepen）/ 平级（diverge）
          </p>
          <DecisionTreeView
            topic={config.seed_topic}
            branches={branches as any}
            decisions={decisions as any}
            activeBranchId={activeBranchId}
            onSelect={(id) => handleJump(`branch:${id}`)}
          />
        </div>
      )}

      {/* Branches grid */}
      {branches.length > 0 && (() => {
        const q = searchQuery.trim().toLowerCase();
        const sortedFiltered = [...branches]
          .filter(b => {
            // confidence threshold filter
            const conf = b.eval?.confidence ?? 0;
            if (b.eval && conf < minConfidence) return false;
            // text search across injection / takeaway / statements
            if (q) {
              const haystack = [
                b.injection,
                b.eval?.one_line_takeaway ?? '',
                b.eval?.notable_disagreement ?? '',
                ...(branchStatements[b.branch_id] ?? []).map(s => s.content),
              ].join(' ').toLowerCase();
              if (!haystack.includes(q)) return false;
            }
            return true;
          })
          .sort((a, b) => {
            if (sortBy === 'order') return 0;
            const va = (a.eval as any)?.[sortBy === 'risk' ? 'risk_signal' : sortBy] ?? -1;
            const vb = (b.eval as any)?.[sortBy === 'risk' ? 'risk_signal' : sortBy] ?? -1;
            return vb - va;
          });
        const filteredCount = sortedFiltered.length;
        return (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[12px] font-mono tracking-[0.20em] text-amber-300/85 uppercase">
              ⊕ 已探索分支 · {filteredCount}{filteredCount !== branches.length && ` / ${branches.length}`}
            </p>
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-300/60 text-[12px] pointer-events-none">⌕</span>
                <input
                  data-search-input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索发言/洞见  ⌘K"
                  className="w-44 pl-7 pr-7 py-1 bg-deep-800/60 border border-deep-400/45 rounded text-[12px] text-deep-50 placeholder-deep-300/55 focus:border-amber-300/55 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-deep-300 hover:text-amber-300 text-[11px] px-1"
                    title="清空"
                  >✕</button>
                )}
              </div>
              {/* Sort */}
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="text-[11px] font-mono tracking-wider bg-deep-800/60 border border-deep-400/45 text-deep-100 rounded px-2 py-1 focus:border-amber-300/55"
                title="排序"
              >
                <option value="order">↕ 顺序</option>
                <option value="confidence">↓ 信心</option>
                <option value="novelty">↓ 新颖</option>
                <option value="risk">↓ 风险</option>
              </select>
              {/* Min confidence filter */}
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-deep-400/45 bg-deep-800/60">
                <span className="text-[10px] font-mono text-deep-300 tracking-wider">conf ≥</span>
                <input
                  type="range" min={0} max={100} step={5}
                  value={minConfidence}
                  onChange={e => setMinConfidence(Number(e.target.value))}
                  className="w-16 settings-range"
                  style={{
                    background: `linear-gradient(to right, #E8B988 ${minConfidence}%, rgba(80,75,70,0.45) ${minConfidence}%)`,
                  }}
                />
                <span className="text-[10px] font-mono text-amber-300/95 tabular-nums w-5 text-right">{minConfidence}</span>
              </div>
              <button
                onClick={() => setTreeOpen(!treeOpen)}
                className={`text-[11px] font-mono tracking-[0.18em] px-3 py-1 rounded border transition-all ${
                  treeOpen
                    ? 'border-amber-300/65 bg-amber-300/[0.08] text-amber-200'
                    : 'border-amber-300/35 text-amber-300/95 hover:border-amber-300/55 hover:bg-amber-300/[0.04]'
                }`}
              >
                {treeOpen ? '🌲 隐藏树' : '🌲 决策树'}
              </button>
            </div>
          </div>
          {filteredCount === 0 && (
            <div className="glass-subtle rounded-lg p-8 text-center text-[13px] text-deep-300">
              当前筛选条件下无分支匹配 · 调整 ⌕ 搜索词或 conf 阈值
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 fade-stagger" style={{ ['--stagger-step' as any]: '60ms' }}>
            {sortedFiltered.map(b => {
              const isActive = activeBranchId === b.branch_id;
              const isExpanded = expandedBranchId === b.branch_id;
              const statements = branchStatements[b.branch_id] ?? [];
              return (
                <div
                  key={b.branch_id}
                  id={branchDomId(b.branch_id)}
                  className={`
                    rounded-lg border p-4 transition-all duration-300
                    ${isActive ? 'border-amber-300/65 bg-amber-300/[0.04] shadow-glow-sm' : 'border-deep-400/40 bg-deep-800/40'}
                  `}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono tracking-wider text-amber-300/95">
                      {b.branch_id}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-deep-300 tabular-nums">
                        cycle {b.cycle} · {b.rounds_run} 轮 · {statements.length} 发言
                      </span>
                      {running && !b.eval && (
                        <button
                          type="button"
                          onClick={() => handleKillBranch(b.branch_id)}
                          className="text-[10px] font-mono text-earth-rust hover:text-earth-rust/95 px-1.5 py-0.5 rounded border border-earth-rust/45 hover:border-earth-rust/70 hover:bg-earth-rust/[0.06] transition-all"
                          title="终止当前分支节省预算"
                        >
                          ⏹ KILL
                        </button>
                      )}
                      {statements.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setReadingBranchId(b.branch_id)}
                          className="text-[10px] font-mono text-amber-300/95 hover:text-amber-200 px-1.5 py-0.5 rounded border border-amber-300/35 hover:border-amber-300/65 transition-all"
                          title="进入阅读模式（全屏聚焦）"
                        >
                          📖 阅读
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpandedBranchId(isExpanded ? null : b.branch_id)}
                        className="text-[10px] font-mono text-amber-300/95 hover:text-amber-200 px-1.5 py-0.5 rounded border border-amber-300/35 hover:border-amber-300/65 transition-all"
                        title={isExpanded ? '收起' : '展开全部发言'}
                      >
                        {isExpanded ? '▲ 收起' : '▼ 展开'}
                      </button>
                    </div>
                  </div>
                  <p className="text-[13px] font-medium text-deep-50 mb-2 leading-snug">
                    {b.injection || <em className="text-deep-300">(基线 — 无注入)</em>}
                  </p>
                  {b.eval && (
                    <>
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {[
                          { label: '置信', v: b.eval.confidence, color: '#E8B988' },
                          { label: '一致', v: b.eval.coherence, color: '#8BA888' },
                          { label: '新颖', v: b.eval.novelty, color: '#A8BCD8' },
                          { label: '风险', v: b.eval.risk_signal, color: '#D88E6E' },
                        ].map(d => (
                          <div key={d.label}>
                            <div className="text-[9px] font-mono text-deep-300 mb-0.5 tracking-wider">{d.label}</div>
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1 rounded-full bg-deep-700 overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${d.v}%`, background: d.color }} />
                              </div>
                              <span className="text-[10px] font-mono tabular-nums" style={{ color: d.color }}>{d.v}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-[12px] text-deep-100/95 leading-snug italic">
                        — {b.eval.one_line_takeaway}
                      </p>
                      {b.eval.notable_disagreement && (
                        <p className="text-[11px] text-earth-rust/85 leading-snug mt-1">
                          ⚡ 分歧：{b.eval.notable_disagreement}
                        </p>
                      )}
                    </>
                  )}

                  {/* Expanded full-statement list */}
                  {isExpanded && statements.length > 0 && (
                    <div
                      className="mt-3 pt-3 border-t border-amber-300/25 space-y-2.5 animate-fade-in-up"
                      key={`stmts-${b.branch_id}-${statements.length}`}
                    >
                      <p className="text-[10px] font-mono tracking-[0.20em] text-amber-300/85 uppercase">
                        ◇ 完整发言
                      </p>
                      {statements.map((s, i) => (
                        <div
                          key={`${s.persona_id}-${s.round}-${i}`}
                          className="rounded bg-deep-900/40 border border-deep-400/30 px-3 py-2 animate-fade-in"
                        >
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-[12px] font-medium text-deep-50">
                              {s.persona_name}
                              <span className="ml-2 text-[10px] font-mono text-deep-300">R{s.round}</span>
                            </span>
                            {s.model && (
                              <span className="text-[9px] font-mono text-amber-300/85 tracking-wider">
                                ◇ {s.model.replace(/^ollama:/, '').replace(/^claude:/, '')}
                              </span>
                            )}
                          </div>
                          <p className={`text-[12px] text-deep-100/95 leading-relaxed whitespace-pre-wrap ${s.isStreaming ? 'stream-active' : ''}`}>
                            {s.content || <em className="text-deep-300">…</em>}
                            {s.isStreaming && <span className="cursor-blink" />}
                          </p>
                          <button
                            onClick={() => setPersonaCompareName(s.persona_name)}
                            className="mt-1 text-[10px] font-mono text-amber-300/85 hover:text-amber-200 tracking-wider"
                            title="跨分支查看该 persona 的所有发言"
                          >
                            ⇆ 跨分支对比
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* Final synthesis */}
      {finalSynth && (
        <div id="auto-final-synth" className="glass border border-amber-300/55 rounded-xl p-6 shadow-glow-lg animate-fade-in-up">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[12px] font-mono tracking-[0.22em] text-amber-300 uppercase font-semibold">
              ⚖ Opus 终评
            </span>
            <span className="flex-1 h-px bg-amber-300/30" />
            <span className="text-[11px] font-mono text-deep-300 tabular-nums">
              {fmtTime(elapsed)} · ${cost.toFixed(3)} · {(tokens / 1000).toFixed(1)}K tokens · {branches.length} 分支
            </span>
          </div>
          <div className="text-[15px] text-deep-50 leading-relaxed whitespace-pre-wrap">{finalSynth}</div>
        </div>
      )}

      {/* Right-side fixed timeline (≥xl) */}
      <DebateTimeline
        events={timelineEvents}
        activeId={activeTimelineId}
        onJump={handleJump}
      />

      {/* #3 History drawer */}
      {historyOpen && (
        <div
          onClick={() => setHistoryOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col animate-fade-in-scale"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-deep-400/35">
              <h3 className="text-[14px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                📜 会话历史 · {history.length}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCompare}
                  disabled={compareSet.size < 2}
                  className="text-[11px] font-mono tracking-[0.18em] px-3 py-1.5 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="选择 2-6 个会话做横向对比"
                >
                  ⇆ 对比 {compareSet.size > 0 ? `(${compareSet.size})` : ''}
                </button>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-deep-200 hover:text-amber-300 text-lg"
                >✕</button>
              </div>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {history.length === 0 && (
                <p className="text-[13px] text-deep-300 text-center py-8">尚无历史会话</p>
              )}
              {history.map(h => {
                const checked = compareSet.has(h.session_id);
                return (
                  <div
                    key={h.session_id}
                    className={`rounded border px-4 py-3 transition-all ${
                      checked
                        ? 'border-amber-300/65 bg-amber-300/[0.06]'
                        : 'border-deep-400/35 bg-deep-800/40 hover:bg-amber-300/[0.04] hover:border-amber-300/55'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCompare(h.session_id)}
                          className="accent-amber-500 cursor-pointer"
                          title="加入对比"
                        />
                        <code className="text-[11px] font-mono text-amber-300/95">{h.session_id}</code>
                      </div>
                      <span className="text-[10px] font-mono text-deep-300 tabular-nums">
                        {h.branches} 分支 · ${h.cost_usd.toFixed(3)} · {new Date(h.mtime * 1000).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[13px] text-deep-100 leading-snug mb-2 pl-6">
                      {h.topic || <em className="text-deep-300">(无议题)</em>}
                    </p>
                    <div className="flex gap-2 pl-6">
                      <button
                        onClick={async () => {
                          try {
                            const r = await autonomousDebateApi.getBriefing(h.session_id);
                            setBriefingMd(r.markdown);
                            setHistoryOpen(false);
                          } catch (e) { console.error(e); }
                        }}
                        className="text-[11px] font-mono px-2 py-1 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06]"
                      >
                        📄 简报
                      </button>
                      <a
                        href={`/api/orchestrator/autonomous-debate/${h.session_id}/log`}
                        target="_blank" rel="noreferrer"
                        className="text-[11px] font-mono px-2 py-1 rounded border border-deep-400/45 hover:border-amber-300/55 text-deep-200 hover:text-amber-300"
                      >
                        ↗ 原始 log
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* #5 Persona evolution drawer — same persona across all branches */}
      {personaCompareName && (
        <div
          onClick={() => setPersonaCompareName(null)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-fade-in-scale"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-deep-400/35">
              <h3 className="text-[14px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                ⇆ {personaCompareName} · 跨分支演化
              </h3>
              <button
                onClick={() => setPersonaCompareName(null)}
                className="text-deep-200 hover:text-amber-300 text-lg"
              >✕</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-3">
              {Object.entries(branchStatements).map(([bid, stmts]) => {
                const own = stmts.filter(s => s.persona_name === personaCompareName);
                if (own.length === 0) return null;
                const branch = branches.find(b => b.branch_id === bid);
                return (
                  <div key={bid} className="rounded border border-deep-400/35 bg-deep-800/40 p-3">
                    <div className="flex items-baseline gap-2 mb-2">
                      <code className="text-[11px] font-mono text-amber-300/95">{bid}</code>
                      <span className="text-[12px] text-deep-200 truncate">
                        {branch?.injection || <em className="text-deep-300">(基线)</em>}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {own.map((s, i) => (
                        <div key={i} className="text-[12px] text-deep-100/95 leading-snug pl-2 border-l-2 border-amber-300/35">
                          <span className="text-[10px] font-mono text-deep-300 mr-1">R{s.round}</span>
                          {s.content.slice(0, 240)}{s.content.length > 240 && '…'}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* #9 Multi-session comparison modal */}
      {compareData && (
        <div
          onClick={() => setCompareData(null)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-[95vw] w-full max-h-[90vh] overflow-hidden flex flex-col animate-fade-in-scale"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-deep-400/35">
              <h3 className="text-[14px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                ⇆ 会话对比 · {compareData.length} 个
              </h3>
              <button
                onClick={() => setCompareData(null)}
                className="text-deep-200 hover:text-amber-300 text-lg"
              >✕</button>
            </div>
            <div className="overflow-x-auto overflow-y-hidden flex-1">
              <div className="flex gap-3 p-4 h-full" style={{ minWidth: 'fit-content' }}>
                {compareData.map(s => {
                  if (s.missing) {
                    return (
                      <div key={s.session_id} className="w-[320px] shrink-0 rounded-lg border border-earth-rust/45 bg-earth-rust/[0.06] p-4">
                        <p className="text-[12px] text-earth-rust">⚠ {s.session_id} log 缺失</p>
                      </div>
                    );
                  }
                  if (s.error) {
                    return (
                      <div key={s.session_id} className="w-[320px] shrink-0 rounded-lg border border-earth-rust/45 bg-earth-rust/[0.06] p-4">
                        <p className="text-[12px] text-earth-rust">⚠ {s.error}</p>
                      </div>
                    );
                  }
                  const elapsed = s.elapsed_s || 0;
                  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;
                  return (
                    <div
                      key={s.session_id}
                      className="w-[340px] shrink-0 rounded-lg border border-deep-400/45 bg-deep-800/40 overflow-y-auto p-4 space-y-3"
                    >
                      <div>
                        <code className="text-[10px] font-mono text-amber-300/95">{s.session_id}</code>
                        <p className="text-[14px] font-medium text-deep-50 leading-snug mt-1">
                          {(s.topic || '(无议题)').slice(0, 70)}
                          {(s.topic || '').length > 70 ? '…' : ''}
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded bg-deep-900/60 border border-deep-400/30 px-2 py-1.5">
                          <div className="text-[10px] font-mono text-deep-300 tracking-wider">分支</div>
                          <div className="text-[14px] font-bold text-amber-200 tabular-nums">{s.branches_count}</div>
                        </div>
                        <div className="rounded bg-deep-900/60 border border-deep-400/30 px-2 py-1.5">
                          <div className="text-[10px] font-mono text-deep-300 tracking-wider">用时</div>
                          <div className="text-[14px] font-bold text-amber-200 tabular-nums">{elapsedStr}</div>
                        </div>
                        <div className="rounded bg-deep-900/60 border border-deep-400/30 px-2 py-1.5">
                          <div className="text-[10px] font-mono text-deep-300 tracking-wider">花费</div>
                          <div className="text-[14px] font-bold text-amber-200 tabular-nums">${(s.cost_usd ?? 0).toFixed(3)}</div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-mono tracking-[0.20em] text-amber-300/85 uppercase mb-1.5">
                          ⊕ Top-3 分支（按信心）
                        </p>
                        <div className="space-y-1.5">
                          {(s.top_branches || []).map(b => {
                            const ev = b.eval || { confidence: 0, novelty: 0, risk_signal: 0, one_line_takeaway: '', coherence: 0 };
                            return (
                              <div key={b.branch_id} className="rounded bg-deep-900/40 border border-deep-400/30 px-2 py-1.5">
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <code className="text-amber-300/95">{b.branch_id}</code>
                                  <div className="flex gap-2">
                                    <span style={{ color: '#E8B988' }}>c{ev.confidence}</span>
                                    <span style={{ color: '#A8BCD8' }}>n{ev.novelty}</span>
                                    <span style={{ color: '#D88E6E' }}>r{ev.risk_signal}</span>
                                  </div>
                                </div>
                                <div className="text-[11px] text-deep-100/95 leading-snug">
                                  {b.injection || <em className="text-deep-300">基线</em>}
                                </div>
                                {ev.one_line_takeaway && (
                                  <div className="text-[10px] text-deep-200/85 italic leading-snug mt-0.5">
                                    — {ev.one_line_takeaway}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-mono tracking-[0.20em] text-amber-300/85 uppercase mb-1.5">
                          ⚖ 终评（前 600 字）
                        </p>
                        <div className="text-[11px] text-deep-100/95 leading-relaxed whitespace-pre-wrap">
                          {(s.final_synthesis_preview || '').slice(0, 600) || <em className="text-deep-300">(无)</em>}
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          try {
                            const r = await autonomousDebateApi.getBriefing(s.session_id);
                            setBriefingMd(r.markdown);
                          } catch (e) { console.error(e); }
                        }}
                        className="w-full text-[11px] font-mono tracking-wider py-1.5 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06]"
                      >
                        📄 完整简报
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reading mode — full-screen focused single-branch viewer */}
      {readingBranchId && (() => {
        const b = branches.find(x => x.branch_id === readingBranchId);
        const stmts = branchStatements[readingBranchId] ?? [];
        if (!b) return null;
        return (
          <div
            onClick={() => setReadingBranchId(null)}
            className="fixed inset-0 bg-deep-950/90 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-fade-in"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col animate-fade-in-up"
            >
              <div className="px-6 py-4 border-b border-deep-400/35 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-[11px] font-mono text-amber-300/95">{b.branch_id}</code>
                    <span className="text-[10px] font-mono text-deep-300 tracking-wider">
                      cycle {b.cycle} · {b.rounds_run} 轮 · {stmts.length} 发言
                    </span>
                  </div>
                  <p className="text-[16px] font-medium text-deep-50 leading-snug">
                    {b.injection || <em className="text-deep-300">(基线 — 无注入)</em>}
                  </p>
                </div>
                <button
                  onClick={() => setReadingBranchId(null)}
                  className="text-deep-200 hover:text-amber-300 text-2xl px-2 leading-none shrink-0"
                  title="Esc 关闭"
                >✕</button>
              </div>
              {b.eval && (
                <div className="px-6 py-3 border-b border-deep-400/30 bg-amber-300/[0.03]">
                  <p className="text-[14px] text-deep-50 leading-relaxed italic">
                    "{b.eval.one_line_takeaway}"
                  </p>
                  {b.eval.notable_disagreement && (
                    <p className="text-[12px] text-earth-rust/85 leading-snug mt-1.5">
                      ⚡ 分歧：{b.eval.notable_disagreement}
                    </p>
                  )}
                  <div className="flex gap-4 mt-2 text-[11px] font-mono">
                    <span style={{ color: '#E8B988' }}>信心 {b.eval.confidence}</span>
                    <span style={{ color: '#8BA888' }}>一致 {b.eval.coherence}</span>
                    <span style={{ color: '#A8BCD8' }}>新颖 {b.eval.novelty}</span>
                    <span style={{ color: '#D88E6E' }}>风险 {b.eval.risk_signal}</span>
                  </div>
                </div>
              )}
              <div className="overflow-y-auto px-6 py-4 space-y-5">
                {stmts.map((s, i) => (
                  <article
                    key={`${s.persona_id}-${s.round}-${i}`}
                    className="border-l-2 border-amber-300/35 pl-4 animate-fade-in-up"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <header className="flex items-baseline justify-between mb-2">
                      <h4 className="text-[15px] font-semibold text-deep-50">
                        {s.persona_name}
                        <span className="ml-2 text-[11px] font-mono text-deep-300">R{s.round}</span>
                      </h4>
                      {s.model && (
                        <span className="text-[10px] font-mono text-amber-300/85 tracking-wider">
                          ◇ {s.model.replace(/^ollama:/, '').replace(/^claude:/, '').replace(/^openai:/, '').replace(/^glm:/, '').replace(/^deepseek:/, '')}
                        </span>
                      )}
                    </header>
                    <p
                      className={`text-[15px] text-deep-100 leading-loose whitespace-pre-wrap ${s.isStreaming ? 'stream-active' : ''}`}
                      style={{ lineHeight: 1.85 }}
                    >
                      {s.content || <em className="text-deep-300">…</em>}
                      {s.isStreaming && <span className="cursor-blink" />}
                    </p>
                  </article>
                ))}
              </div>
              <div className="px-6 py-3 border-t border-deep-400/30 flex items-center justify-between text-[10px] font-mono text-deep-300 tracking-wider">
                <span>📖 阅读模式 · Esc 退出</span>
                <button
                  onClick={() => {
                    setReadingBranchId(null);
                    handleJump(`branch:${readingBranchId}`);
                  }}
                  className="text-amber-300/95 hover:text-amber-200 px-2 py-0.5 rounded border border-amber-300/35 hover:border-amber-300/65"
                >
                  ↗ 回到列表位置
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* #12 Briefing modal */}
      {briefingMd !== null && (
        <div
          onClick={() => setBriefingMd(null)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fade-in"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="glass border border-amber-300/55 rounded-xl shadow-glow-lg max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-fade-in-scale"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-deep-400/35">
              <h3 className="text-[14px] font-mono tracking-[0.20em] text-amber-300 uppercase">
                📄 BRIEFING · Markdown
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(briefingMd)}
                  className="text-[11px] font-mono px-2 py-1 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06]"
                >
                  ⎘ 复制
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([briefingMd], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `whatif-${sessionId || 'briefing'}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-[11px] font-mono px-2 py-1 rounded border border-amber-300/45 hover:border-amber-300/70 text-amber-300 hover:bg-amber-300/[0.06]"
                >
                  ⬇ 下载
                </button>
                <button
                  onClick={() => setBriefingMd(null)}
                  className="text-deep-200 hover:text-amber-300 text-lg ml-2"
                >✕</button>
              </div>
            </div>
            <pre className="overflow-y-auto p-5 text-[13px] text-deep-50 leading-relaxed font-mono whitespace-pre-wrap">
              {briefingMd}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
