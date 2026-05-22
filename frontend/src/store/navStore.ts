/**
 * Active tab — lifted out of App.tsx so any descendant (e.g. portal send
 * buttons) can switch modules without prop-drilling.
 */
import { create } from 'zustand';

export type ModuleKey =
  | 'debate'
  | 'causal'
  | 'counterfactual'
  | 'orchestrator'
  | 'voting';

interface NavState {
  activeModule: ModuleKey;
  setActiveModule: (m: ModuleKey) => void;
}

export const useNavStore = create<NavState>((set) => ({
  activeModule: 'debate',
  setActiveModule: (m) => set({ activeModule: m }),
}));
