import { useState, useCallback } from 'react';
import { useDebateStore } from '../../store/debateStore';
import { useSSE } from '../../hooks/useSSE';
import { debateApi } from '../../services/api';
import { PersonaCard } from './PersonaCard';
import { EventInjector } from './EventInjector';
import { SummaryDock } from './SummaryDock';

export function DebateRoom() {
  const {
    sessionId,
    scenario,
    personas,
    rounds,
    currentRound,
    status,
    summary,
    judgeModel,
    startNewRound,
    registerPersonaModel,
    appendStreamChunk,
    finalizePersona,
    completeRound,
    markRoundEvalPending,
    applyRoundEval,
    markRoundSummaryPending,
    applyPersonaSummary,
    setSummary,
    setError,
  } = useDebateStore();

  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleEvent = useCallback((event: { type: string; data: Record<string, unknown> }) => {
    switch (event.type) {
      case 'round_start':
        startNewRound(
          event.data.round_number as number,
          (event.data.injected_event as string) || null
        );
        break;
      case 'persona_start':
        registerPersonaModel(
          event.data.persona_id as string,
          event.data.model as string
        );
        break;
      case 'persona_chunk':
        appendStreamChunk(
          event.data.persona_id as string,
          event.data.text as string
        );
        break;
      case 'persona_complete':
        finalizePersona(
          event.data.persona_id as string,
          event.data.persona_name as string,
          event.data.content as string
        );
        break;
      case 'round_complete':
        completeRound(event.data.token_usage as any);
        break;
      case 'round_summary_start':
        markRoundSummaryPending(event.data.round_number as number);
        break;
      case 'persona_summary':
        applyPersonaSummary(
          event.data.round_number as number,
          event.data.persona_id as string,
          (event.data.summary as string) ?? '',
          (event.data.summarizer_model as string) ?? '',
        );
        break;
      case 'round_eval_start':
        markRoundEvalPending(event.data.round_number as number);
        break;
      case 'round_eval':
        applyRoundEval(
          event.data.round_number as number,
          (event.data.evaluations as any[]) ?? [],
          (event.data.judge_model as string) ?? '',
        );
        completeRound(event.data.token_usage as any);
        break;
      case 'error':
        setError(event.data.message as string);
        break;
    }
  }, [startNewRound, registerPersonaModel, appendStreamChunk, finalizePersona, completeRound, markRoundEvalPending, applyRoundEval, markRoundSummaryPending, applyPersonaSummary, setError]);

  const { isStreaming, startStream } = useSSE({ onEvent: handleEvent });

  const handleRunRound = async () => {
    if (!sessionId || isStreaming) return;
    await startStream(debateApi.roundStreamUrl(sessionId));
  };

  const handleSummary = async () => {
    if (!sessionId || isSummarizing) return;
    setIsSummarizing(true);
    try {
      const result = await debateApi.getSummary(sessionId);
      setSummary(result.summary, result.judge_model ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Scenario Header */}
      <div className="relative glass rounded-xl p-6 corner-marks overflow-hidden">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-amber-300/[0.03] via-transparent to-amber-600/[0.02] pointer-events-none" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[14px] font-mono text-amber-300/85 tracking-widest uppercase">
              ▸ Active Scenario
            </span>
            <span className="flex-1 h-px bg-amber-300/10" />
            <span className="text-[14px] font-mono text-deep-200/75">
              SID: {sessionId?.slice(0, 8)}
            </span>
          </div>

          <h2 className="text-lg font-semibold text-white mb-4">{scenario}</h2>

          <div className="flex flex-wrap gap-2">
            {personas.map(p => (
              <span
                key={p.id}
                className="text-[14px] font-mono bg-deep-800/50 border border-deep-400/40 text-deep-200/95 px-2.5 py-1 rounded tracking-wider"
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Event Injector */}
      {sessionId && !isStreaming && (
        <EventInjector sessionId={sessionId} />
      )}

      {/* Rounds — each round = its own card window */}
      {rounds.map((round, rIdx) => {
        const previousRound = rIdx > 0 ? rounds[rIdx - 1] : null;
        return (
          <div
            key={round.round_number}
            className="relative glass rounded-xl p-5 border border-deep-400/35 overflow-hidden"
          >
            {/* Round Header */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-base font-mono font-semibold text-amber-300 tracking-widest uppercase">
                Round {String(round.round_number).padStart(2, '0')}
              </span>
              <span className="text-[11px] font-mono text-deep-300 tracking-wider tabular-nums">
                {round.statements.length} 位 persona
              </span>
              <span className="flex-1 h-px bg-deep-400/30" />
              {round.summaryPending && (
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/85 tracking-wider px-2 py-0.5 rounded border border-amber-300/35 bg-amber-300/[0.04]">
                  <span className="w-2.5 h-2.5 border-2 border-amber-300/50 border-t-amber-300 rounded-full animate-spin" />
                  SUMMARIZING…
                </span>
              )}
              {round.evalPending && (
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300/85 tracking-wider px-2 py-0.5 rounded border border-amber-300/35 bg-amber-300/[0.04]">
                  <span className="w-2.5 h-2.5 border-2 border-amber-300/50 border-t-amber-300 rounded-full animate-spin" />
                  JUDGE EVALUATING…
                </span>
              )}
              {round.evalJudgeModel && !round.evalPending && (
                <span
                  className="text-[11px] font-mono tracking-wider px-2 py-0.5 rounded border border-amber-300/35 bg-amber-300/[0.04] text-amber-300/90"
                  title="本轮评分由该裁判模型给出"
                >
                  ⚖ {round.evalJudgeModel.replace(/^claude:/, '')}
                </span>
              )}
              {round.injected_event && (
                <span className="text-[12px] font-mono bg-earth-rust/10 border border-earth-rust/45 text-earth-rust px-3 py-1 rounded tracking-wider">
                  ⚡ {round.injected_event}
                </span>
              )}
            </div>

            {/* Carry-over summary from previous round */}
            {previousRound && previousRound.statements.some(s => s.summary) && (
              <div className="mb-4 rounded-lg bg-deep-800/50 border border-amber-300/25 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono tracking-[0.20em] text-amber-300/85 uppercase">
                    ◂ 上一轮要点
                  </span>
                  <span className="flex-1 h-px bg-amber-300/15" />
                  <span className="text-[10px] font-mono text-deep-300 tracking-wider">
                    R{String(previousRound.round_number).padStart(2, '0')}
                  </span>
                </div>
                <ul className="space-y-1">
                  {previousRound.statements.map(s => (
                    <li key={s.persona_id} className="flex items-baseline gap-2 text-[13px]">
                      <span className="text-amber-300/85 font-mono shrink-0">·</span>
                      <span className="text-deep-100 font-medium shrink-0">{s.persona_name}</span>
                      <span className="text-deep-200/85 leading-snug">
                        {s.summary || <em className="text-deep-300">（未摘要）</em>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Statements */}
            <div className="grid gap-3">
              {round.statements.map((stmt) => (
                <div
                  key={`${round.round_number}-${stmt.persona_id}`}
                  id={`card-${round.round_number}-${stmt.persona_id}`}
                  className="rounded-lg transition-shadow"
                >
                  <PersonaCard
                    personaName={stmt.persona_name}
                    personaRole={stmt.persona_role}
                    model={stmt.model}
                    content={stmt.content}
                    isStreaming={stmt.isStreaming}
                    evaluation={stmt.evaluation}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Right-side dock with all per-statement summaries */}
      <SummaryDock />

      {/* Summary */}
      {summary && (
        <div className="relative glass rounded-xl p-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-600/[0.03] via-transparent to-amber-300/[0.02] pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[14px] font-mono text-amber-300/90 tracking-widest uppercase">
                ◈ System Analysis
              </span>
              <span className="flex-1 h-px bg-amber-300/10" />
              {judgeModel && (
                <span
                  className="text-[15px] font-mono tracking-wider px-2 py-0.5 rounded border border-amber-300/35 bg-amber-300/[0.04] text-amber-300/90"
                  title="负责综合分析的裁判模型"
                >
                  ⚖ JUDGE: {judgeModel}
                </span>
              )}
            </div>
            <div className="text-sm text-deep-100/75 leading-relaxed whitespace-pre-wrap">
              {summary}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={handleRunRound}
          disabled={isStreaming || status === 'starting'}
          className={`
            flex-1 relative overflow-hidden font-mono text-sm tracking-wider py-3.5 rounded-lg transition-all duration-300
            ${isStreaming
              ? 'bg-amber-300/[0.06] border border-amber-300/45 text-amber-300'
              : 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg btn-glow'
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {isStreaming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
              ROUND {String(currentRound).padStart(2, '0')} IN PROGRESS
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              ▶ EXECUTE ROUND {String(currentRound + 1).padStart(2, '0')}
            </span>
          )}
        </button>

        {rounds.length > 0 && !isStreaming && (
          <button
            onClick={handleSummary}
            disabled={isSummarizing}
            className="font-mono text-sm tracking-wider bg-deep-800/50 hover:bg-deep-700/50 border border-deep-400/45 hover:border-amber-300/45 text-deep-100/70 hover:text-amber-300/80 py-3.5 px-6 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSummarizing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-amber-300/70 border-t-amber-300 rounded-full animate-spin" />
                ANALYZING
              </span>
            ) : (
              '◈ SYNTHESIZE'
            )}
          </button>
        )}
      </div>
    </div>
  );
}
