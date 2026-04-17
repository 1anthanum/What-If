/**
 * UI for injecting events mid-debate.
 */

import { useState } from 'react';
import { debateApi } from '../../services/api';

interface EventInjectorProps {
  sessionId: string;
}

export function EventInjector({ sessionId }: EventInjectorProps) {
  const [event, setEvent] = useState('');
  const [injected, setInjected] = useState(false);

  const handleInject = async () => {
    if (!event.trim()) return;
    try {
      await debateApi.injectEvent(sessionId, event.trim());
      setInjected(true);
      setTimeout(() => setInjected(false), 3000);
      setEvent('');
    } catch (err) {
      console.error('Failed to inject event:', err);
    }
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={event}
        onChange={e => setEvent(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleInject()}
        placeholder="注入突发事件（如：东南亚遭遇严重旱灾）"
        className="flex-1 bg-surface-800 border border-surface-200/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-yellow-400/50 placeholder-surface-200/30"
      />
      <button
        onClick={handleInject}
        disabled={!event.trim()}
        className="bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 hover:bg-yellow-400/20 disabled:opacity-30 disabled:cursor-not-allowed px-4 py-2 rounded-lg text-sm transition-colors"
      >
        {injected ? '✓ 已注入' : '⚡ 注入'}
      </button>
    </div>
  );
}
