/**
 * First-run onboarding modal — 30-second "what do you want to do?"
 * picker that routes the user into the right tab with a pre-filled
 * example scenario.
 *
 * Reopens when the user clicks "Tour" in the header (via store.reopen()).
 */
import { useOnboardingStore, type ScenarioDraft } from '../../store/onboardingStore';

interface Path {
  key: string;
  module: 'debate' | 'counterfactual' | 'orchestrator' | 'voting';
  icon: string;
  title: string;
  subtitle: string;
  hint: string;
  draft?: ScenarioDraft;
}

const PATHS: Path[] = [
  {
    key: 'debate',
    module: 'debate',
    icon: '◈',
    title: 'AI 辩论室',
    subtitle: '让 5 个不同立场的角色就一个假设展开辩论',
    hint: '适合：探索一个有争议的政策 / 技术 / 社会问题',
    draft: {
      title: 'AGI 开源',
      hypothesis: '如果通用人工智能在 2027 年被实现并完全开源',
      domain: 'technology',
    },
  },
  {
    key: 'counterfactual',
    module: 'counterfactual',
    icon: '⊜',
    title: '历史反事实',
    subtitle: '修改一个关键历史决策，看蝴蝶效应',
    hint: '适合：理解历史偶然性 / 想推演"如果当年没发生 X"',
  },
  {
    key: 'orchestrator',
    module: 'orchestrator',
    icon: '∞',
    title: '闭环推演',
    subtitle: '把反事实 + 因果图 + 辩论串成一个迭代循环',
    hint: '适合：深入挖掘一个复杂命题，让 AI 自主探索',
  },
];

interface Props {
  onClose: () => void;
  onChoose: (module: Path['module']) => void;
}

export function OnboardingModal({ onClose, onChoose }: Props) {
  const { markSeen, setPendingDraft } = useOnboardingStore();

  const choose = (p: Path) => {
    markSeen();
    if (p.draft) setPendingDraft(p.draft);
    onChoose(p.module);
  };

  const skip = () => {
    markSeen();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="relative max-w-3xl w-full glass border border-amber-300/[0.15] rounded-xl p-8 shadow-glow-lg">
        {/* Close */}
        <button
          onClick={skip}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
          aria-label="跳过引导"
        >
          ✕
        </button>

        {/* Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-4 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span className="status-dot bg-amber-300" />
            欢迎使用 WHAT·IF
          </div>
          <h2 id="onboarding-title" className="text-2xl font-light text-white mb-2 tracking-tight">
            想从哪里开始<span className="text-amber-300">？</span>
          </h2>
          <p className="text-[13px] text-deep-100/75 max-w-md mx-auto leading-relaxed">
            这是一个 AI 驱动的宏观推演平台。选一个起点，我会带你进对应模块并预填好示例。
          </p>
        </div>

        {/* Paths */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PATHS.map((p) => (
            <button
              key={p.key}
              onClick={() => choose(p)}
              className="group text-left p-5 rounded-lg glass-subtle border border-amber-300/[0.08] hover:border-amber-300/40 hover:bg-amber-300/[0.04] transition-all"
            >
              <div className="text-2xl text-amber-300 mb-3 font-mono leading-none">
                {p.icon}
              </div>
              <h3 className="text-[15px] font-medium text-white mb-1 group-hover:text-amber-200 transition-colors">
                {p.title}
              </h3>
              <p className="text-[12px] text-deep-100/80 leading-relaxed mb-3">
                {p.subtitle}
              </p>
              <p className="text-[10px] font-mono text-amber-300/70 uppercase tracking-wider">
                ▸ {p.hint}
              </p>
            </button>
          ))}
        </div>

        {/* Skip */}
        <div className="mt-6 text-center">
          <button
            onClick={skip}
            className="text-[12px] font-mono text-deep-200/65 hover:text-amber-300 tracking-wider transition-colors"
          >
            自己看着办 →
          </button>
        </div>
      </div>
    </div>
  );
}
