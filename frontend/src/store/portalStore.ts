/**
 * Cross-module data portal — any module's output can be "sent" as input
 * to another module. The destination module's input form consumes the
 * pending payload on mount.
 *
 * Not persisted: a portal handoff is a single transient action, not a
 * long-lived state.
 */
import { create } from 'zustand';
import type { ModuleKey } from './navStore';

export type PortalTarget = Exclude<ModuleKey, 'voting'>;  // voting has no hypothesis input

export interface PortalPayload {
  text: string;
  /** Where the payload came from — shown in the receiving form so the
   *  user knows what's being injected. */
  sourceLabel: string;
  target: PortalTarget;
}

interface PortalState {
  pending: PortalPayload | null;
  send: (payload: PortalPayload) => void;
  consume: (target: PortalTarget) => PortalPayload | null;
  clear: () => void;
}

export const usePortalStore = create<PortalState>((set, get) => ({
  pending: null,
  send: (payload) => set({ pending: payload }),
  consume: (target) => {
    const p = get().pending;
    if (!p || p.target !== target) return null;
    set({ pending: null });
    return p;
  },
  clear: () => set({ pending: null }),
}));
