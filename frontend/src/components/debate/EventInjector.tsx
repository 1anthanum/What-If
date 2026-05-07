/**
 * Event injection UI with warm ambient styling.
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
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[14px] font-mono text-earth-rust/50 tracking-widest uppercase">
          ⚡ Event Injection
        </span>
        <span className="flex-1 h-px bg-earth-rust/10" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={event}
            onChange={e => setEvent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInject()}
            placeholder="注入突发事件（如：东南亚遭遇严重旱灾、全球贸易战爆发）"
            className="w-full bg-deep-800/40 border border-earth-rust/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder-deep-300/60 transition-all focus:border-earth-rust/30 focus:shadow-none"
            style={{ boxShadow: 'none' }}
          />
          {event.trim() && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[15px] font-mono text-earth-rust/30">
              ENTER ↵
            </span>
          )}
        </div>
        <button
          onClick={handleInject}
          disabled={!event.trim()}
          className={`
            px-5 py-2.5 rounded-lg text-xs font-mono tracking-wider transition-all
            ${injected
              ? 'bg-earth-green/10 border border-earth-green/30 text-earth-green shadow-glow-green'
              : event.trim()
                ? 'bg-earth-rust/10 border border-earth-rust/20 text-earth-rust hover:bg-earth-rust/15 hover:border-earth-rust/30'
                : 'bg-deep-800/30 border border-deep-400/40 text-deep-300/70 cursor-not-allowed'
            }
          `}
        >
          {injected ? '✓ INJECTED' : '⚡ INJECT'}
        </button>
      </div>
    </div>
  );
}
