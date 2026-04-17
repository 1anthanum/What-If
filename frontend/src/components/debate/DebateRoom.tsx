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
    <div className="space-y-6">
      {/* Scenario Header */}
      <div className="bg-surface-800/50 border border-surface-200/10 rounded-xl p-5">
        <p className="text-xs text-primary-500 uppercase tracking-wider mb-1">当前场景</p>
        <h2 className="text-lg font-semibold">{scenario}</h2>
        <div className="flex gap-2 mt-3">
          {personas.map(p => (
            <span
              key={p.id}
              className="text-xs bg-surface-200/5 border border-surface-200/10 px-2 py-1 rounded"
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>

      {/* Event Injector */}
      {sessionId && !isStreaming && (
        <EventInjector sessionId={sessionId} />
      )}

      {/* Rounds */}
      {rounds.map((round) => (
        <div key={round.round_number} className="space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-medium text-surface-200/60">
              第 {round.round_number} 轮
            </h3>
            {round.injected_event && (
              <span className="text-xs bg-yellow-400/10 text-yellow-400 px-2 py-0.5 rounded">
                ⚡ {round.injected_event}
              </span>
            )}
          </div>
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
        <div className="bg-surface-800/50 border border-primary-500/20 rounded-xl p-5">
          <p className="text-xs text-primary-500 uppercase tracking-wider mb-2">分析师摘要</p>
          <div className="text-sm text-surface-200/80 whitespace-pre-wrap">{summary}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleRunRound}
          disabled={isStreaming || status === 'starting'}
          className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors"
        >
          {isStreaming
            ? `第 ${currentRound} 轮进行中…`
            : `开始第 ${currentRound + 1} 轮辩论`}
        </button>
        {rounds.length > 0 && !isStreaming && (
          <button
            onClick={handleSummary}
            disabled={isSummarizing}
            className="bg-surface-800 hover:bg-surface-200/10 border border-surface-200/10 text-white font-medium py-3 px-6 rounded-lg transition-colors disabled:opacity-40"
          >
            {isSummarizing ? '生成中…' : '生成摘要'}
          </button>
        )}
      </div>
    </div>
  );
}
