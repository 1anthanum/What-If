import { useState, useCallback } from 'react';
import { useDebateStore } from '../../store/debateStore';
import { useSSE } from '../../hooks/useSSE';
import { debateApi } from '../../services/api';
import { PersonaCard } from './PersonaCard';
import { EventInjector } from './EventInjector';

export function DebateRoom() {
  const {
    sessionId,
    scenario,
    personas,
    rounds,
    currentRound,
    status,
    summary,
    startNewRound,
    appendStreamChunk,
    finalizePersona,
    completeRound,
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
      case 'error':
        setError(event.data.message as string);
        break;
    }
  }, [startNewRound, appendStreamChunk, finalizePersona, completeRound, setError]);

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
      setSummary(result.summary);
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
            <span className="text-[10px] font-mono text-amber-300/40 tracking-widest uppercase">
              ▸ Active Scenario
            </span>
            <span className="flex-1 h-px bg-amber-300/10" />
            <span className="text-[10px] font-mono text-deep-200/30">
              SID: {sessionId?.slice(0, 8)}
            </span>
          </div>

          <h2 className="text-lg font-semibold text-white mb-4">{scenario}</h2>

          <div className="flex flex-wrap gap-2">
            {personas.map(p => (
              <span
                key={p.id}
                className="text-[10px] font-mono bg-deep-800/50 border border-deep-400/10 text-deep-200/60 px-2.5 py-1 rounded tracking-wider"
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

      {/* Rounds */}
      {rounds.map((round) => (
        <div key={round.round_number} className="space-y-3">
          {/* Round Header */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-amber-300/40 tracking-widest uppercase">
              Round {String(round.round_number).padStart(2, '0')}
            </span>
            <span className="flex-1 h-px bg-deep-400/10" />
            {round.injected_event && (
              <span className="text-[10px] font-mono bg-earth-rust/5 border border-earth-rust/15 text-earth-rust/80 px-3 py-1 rounded tracking-wider">
                ⚡ {round.injected_event}
              </span>
            )}
          </div>

          {/* Statements */}
          <div className="grid gap-3">
            {round.statements.map((stmt) => (
              <PersonaCard
                key={`${round.round_number}-${stmt.persona_id}`}
                personaName={stmt.persona_name}
                personaRole={stmt.persona_role}
                content={stmt.content}
                isStreaming={stmt.isStreaming}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Summary */}
      {summary && (
        <div className="relative glass rounded-xl p-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-600/[0.03] via-transparent to-amber-300/[0.02] pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-mono text-amber-300/50 tracking-widest uppercase">
                ◈ System Analysis
              </span>
              <span className="flex-1 h-px bg-amber-300/10" />
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
              ? 'bg-amber-300/[0.06] border border-amber-300/15 text-amber-300'
              : 'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow hover:shadow-glow-lg btn-glow'
            }
            disabled:opacity-40 disabled:cursor-not-allowed
          `}
        >
          {isStreaming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-amber-300/30 border-t-amber-300 rounded-full animate-spin" />
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
            className="font-mono text-sm tracking-wider bg-deep-800/50 hover:bg-deep-700/50 border border-deep-400/15 hover:border-amber-300/15 text-deep-100/70 hover:text-amber-300/80 py-3.5 px-6 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSummarizing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-amber-300/30 border-t-amber-300 rounded-full animate-spin" />
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
