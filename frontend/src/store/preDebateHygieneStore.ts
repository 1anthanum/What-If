/**
 * Pre-debate cognitive hygiene — captures user's pre-commitments before a
 * debate runs so we can confront them with their own past self after.
 *
 * Three pieces:
 *  1. mind-change-evidence    "我会被什么证据说服" — Popper-style commitment
 *  2. value-ranking            drag-rank competing values (freedom, equity,
 *                              efficiency, etc.) so persona-vs-user value
 *                              alignment is computable later
 *  3. stance-shape             user picks the *desired* outcome before
 *                              the debate; system shows after how likely
 *                              the desired outcome was (rationalization risk)
 *
 * All entries are persisted per-session-id in localStorage so the
 * SessionBrowser can recall them.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ValueKey =
  | 'freedom' | 'equity' | 'efficiency' | 'tradition'
  | 'truth' | 'compassion' | 'progress' | 'stability'
  | 'autonomy' | 'community';

export const VALUE_LABELS: Record<ValueKey, { label: string; short: string }> = {
  freedom:    { label: '自由',  short: '个体自主选择' },
  equity:     { label: '公正',  short: '机会 / 结果平等' },
  efficiency: { label: '效率',  short: '资源最大化产出' },
  tradition:  { label: '传统',  short: '历史延续 / 礼制' },
  truth:      { label: '真理',  short: '客观知识高于其他' },
  compassion: { label: '慈悲',  short: '减少痛苦优先' },
  progress:   { label: '进步',  short: '改造现状' },
  stability:  { label: '稳定',  short: '可预测 / 秩序' },
  autonomy:   { label: '自决',  short: '群体自决权' },
  community:  { label: '共同体', short: '集体认同感' },
};

export type StanceDirection = 'pro' | 'con' | 'mixed' | 'no_preference';

export interface HygieneRecord {
  /** Session this record is bound to (set when user actually starts debate). */
  session_id?: string;
  hypothesis: string;
  recorded_at: string;
  /** "What evidence would change my mind" — Popper commitment */
  mind_change_evidence?: string;
  /** User's value ordering, most-important first */
  value_ranking?: ValueKey[];
  /** Did the user enter the debate with a preferred outcome? */
  desired_stance?: StanceDirection;
  /** User's prose on why (optional) */
  desired_stance_reason?: string;
}

interface HygieneState {
  /** Working draft — populated by the pre-debate panel; copied into
   *  `bySession` when the auto-loop actually starts. */
  draft: HygieneRecord | null;
  /** Map of session_id → committed hygiene record. */
  bySession: Record<string, HygieneRecord>;

  setDraft: (r: HygieneRecord | null) => void;
  patchDraft: (patch: Partial<HygieneRecord>) => void;
  commitDraftTo: (sessionId: string) => void;
  getFor: (sessionId: string) => HygieneRecord | undefined;
}

export const useHygieneStore = create<HygieneState>()(
  persist(
    (set, get) => ({
      draft: null,
      bySession: {},

      setDraft: (r) => set({ draft: r }),

      patchDraft: (patch) =>
        set((s) => ({
          draft: {
            hypothesis: '',
            recorded_at: new Date().toISOString(),
            ...(s.draft || {}),
            ...patch,
          },
        })),

      commitDraftTo: (sessionId) =>
        set((s) => {
          if (!s.draft) return s;
          const committed: HygieneRecord = {
            ...s.draft,
            session_id: sessionId,
            recorded_at: s.draft.recorded_at || new Date().toISOString(),
          };
          return {
            bySession: { ...s.bySession, [sessionId]: committed },
            draft: null,
          };
        }),

      getFor: (sessionId) => get().bySession[sessionId],
    }),
    { name: 'whatif-hygiene', version: 1 },
  ),
);
