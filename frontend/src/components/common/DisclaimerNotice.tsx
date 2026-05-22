/**
 * AI disclaimer surface — three views:
 *
 *  • DisclaimerBanner   — dismissible top strip, shown until user closes it
 *  • DisclaimerFooter   — always-visible compact line at the bottom
 *  • DisclaimerModal    — full-text modal opened from header / footer link
 */
import { useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DisclaimerState {
  bannerDismissed: boolean;
  dismissBanner: () => void;
  restoreBanner: () => void;
}

export const useDisclaimerStore = create<DisclaimerState>()(
  persist(
    (set) => ({
      bannerDismissed: false,
      dismissBanner: () => set({ bannerDismissed: true }),
      restoreBanner: () => set({ bannerDismissed: false }),
    }),
    { name: 'whatif-disclaimer', version: 1 },
  ),
);

/** Key warnings — kept as data so all three surfaces stay in sync. */
const POINTS: { icon: string; text: string }[] = [
  {
    icon: '◈',
    text: 'AI persona 不代表任何真实哲学家、学者或机构的立场 — 它们是 LLM 模拟的思考过程',
  },
  {
    icon: '◇',
    text: '内容由大语言模型生成，可能包含事实错误、过时信息或幻觉 — 关键决策前请独立核实',
  },
  {
    icon: '⊗',
    text: '不构成医疗、法律、金融、心理学或其他领域的专业建议',
  },
  {
    icon: '⊜',
    text: '涉及政治、伦理、文化的辩论结果反映的是模型训练数据中的偏好分布，非客观真理',
  },
];

/* ────── 1. Dismissible top banner (first-load) ────── */

export function DisclaimerBanner() {
  const { bannerDismissed, dismissBanner } = useDisclaimerStore();
  if (bannerDismissed) return null;
  return (
    <div className="relative z-20 border-b border-amber-300/[0.15] bg-amber-300/[0.04]">
      <div className="max-w-7xl mx-auto px-7 py-2.5 flex items-center gap-3">
        <span className="text-[14px] text-amber-300/85 font-mono leading-none">ⓘ</span>
        <p className="flex-1 text-[12px] text-amber-100/85 leading-snug">
          所有 persona 发言由 LLM 模拟生成，<span className="text-amber-200">不代表真实哲学家立场</span>，
          也<span className="text-amber-200">不构成专业建议</span>。
        </p>
        <button
          onClick={dismissBanner}
          className="text-[11px] font-mono uppercase tracking-wider text-amber-300/70 hover:text-amber-200 px-2 py-1 rounded border border-amber-300/30 hover:border-amber-300/55 transition-colors"
          title="不再显示此提示"
        >
          知道了 ✕
        </button>
      </div>
    </div>
  );
}

/* ────── 2. Persistent footer line + "查看完整" link ────── */

export function DisclaimerFooter() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <footer className="relative z-10 border-t tk-border-faint py-4">
        <div className="max-w-7xl mx-auto px-7 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
          <p className="text-[10px] font-mono tk-text-faint tracking-[0.22em]">
            POWERED BY CLAUDE API · REAL-TIME TOKEN TRACKING
          </p>
          <span className="hidden sm:inline text-[10px] tk-text-faint">·</span>
          <button
            onClick={() => setModalOpen(true)}
            className="text-[10px] font-mono tk-text-faint hover:text-amber-300 tracking-[0.18em] uppercase transition-colors"
          >
            ⓘ AI 免责声明
          </button>
        </div>
      </footer>
      {modalOpen && <DisclaimerModal onClose={() => setModalOpen(false)} />}
    </>
  );
}

/* ────── 3. Full-text modal ────── */

export function DisclaimerModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disclaimer-title"
      onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full glass border border-amber-300/[0.15] rounded-xl p-7 shadow-glow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
          aria-label="关闭"
        >
          ✕
        </button>

        <div className="mb-5">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-3 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>ⓘ</span>
            AI 免责声明
          </div>
          <h2 id="disclaimer-title" className="text-xl font-light text-white tracking-tight">
            关于本工具生成内容的<span className="text-amber-300">边界</span>
          </h2>
        </div>

        <ul className="space-y-3 mb-5">
          {POINTS.map((p, i) => (
            <li key={i} className="flex items-start gap-3 text-[13px] text-deep-100/85 leading-relaxed">
              <span className="text-amber-300/85 font-mono shrink-0 mt-0.5">{p.icon}</span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-deep-200/65 leading-relaxed border-t border-amber-300/[0.08] pt-3 mt-3">
          学术引用、媒体报道、教学使用本工具产出的内容时，请在文本中明确标注「由 AI 哲学辩论模拟生成」，
          并保留原始 session ID 以便复现 / 审计。
        </p>
      </div>
    </div>
  );
}
