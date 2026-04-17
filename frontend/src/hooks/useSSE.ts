/**
 * SSE (Server-Sent Events) hook for streaming debate rounds.
 */

import { useState, useCallback, useRef } from 'react';

export interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

interface UseSSEOptions {
  onEvent?: (event: SSEEvent) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

export function useSSE(options?: UseSSEOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async (url: string, method: string = 'POST') => {
    setIsStreaming(true);
    setEvents([]);
    abortRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Accept': 'text/event-stream' },
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = 'message';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const event: SSEEvent = { type: currentEventType, data };
              setEvents(prev => [...prev, event]);
              options?.onEvent?.(event);

              if (currentEventType === 'done') {
                options?.onComplete?.();
              }
              if (currentEventType === 'error') {
                options?.onError?.(new Error(String(data.error || 'Stream error')));
              }
            } catch {
              // Skip malformed JSON
            }
            currentEventType = 'message';
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        options?.onError?.(err as Error);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [options]);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { isStreaming, events, startStream, stopStream };
}
