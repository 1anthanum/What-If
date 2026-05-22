/**
 * "→ 送往..." dropdown — appears next to any module's result text and
 * lets the user inject that text as input to another module.
 *
 * Usage:
 *   <PortalSendButton text={summary} sourceLabel="辩论室总结" exclude="debate" />
 */
import { useState, useRef, useEffect } from 'react';
import { usePortalStore, type PortalTarget } from '../../store/portalStore';
import { useNavStore } from '../../store/navStore';

interface Props {
  text: string;
  sourceLabel: string;
  /** Module to exclude from the target list (typically the source module
   *  itself — sending text from debate to debate is pointless). */
  exclude?: PortalTarget;
}

const TARGETS: Array<{ key: PortalTarget; label: string; icon: string }> = [
  { key: 'debate',         label: '辩论室',     icon: '◈' },
  { key: 'causal',         label: '因果图谱',   icon: '◇' },
  { key: 'counterfactual', label: '反事实',     icon: '⊜' },
  { key: 'orchestrator',   label: '闭环推演',   icon: '∞' },
];

export function PortalSendButton({ text, sourceLabel, exclude }: Props) {
  const [open, setOpen] = useState(false);
  const send = usePortalStore((s) => s.send);
  const setActiveModule = useNavStore((s) => s.setActiveModule);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const disabled = !text || !text.trim();
  const visible = TARGETS.filter((t) => t.key !== exclude);

  const handleSend = (target: PortalTarget) => {
    send({ text: text.trim(), sourceLabel, target });
    setActiveModule(target);
    setOpen(false);
  };

  return (
    <div ref={popoverRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`
          text-[11px] font-mono uppercase tracking-[0.18em] px-2.5 py-1.5 rounded
          border transition-colors
          ${disabled
            ? 'border-deep-400/15 text-deep-200/30 cursor-not-allowed'
            : 'border-amber-300/30 text-amber-300/90 hover:border-amber-300/65 hover:bg-amber-300/[0.05]'
          }
        `}
        title={disabled ? '没有可发送的内容' : '把这段文本作为输入送往另一个模块'}
      >
        → 送往
      </button>

      {open && !disabled && (
        <div className="absolute right-0 top-full mt-1.5 z-30 min-w-[180px] glass border border-amber-300/25 rounded-lg shadow-glow p-1.5 animate-fade-in">
          <div className="px-2 py-1.5 text-[9px] font-mono text-amber-300/65 uppercase tracking-wider border-b border-amber-300/10 mb-1">
            发送到模块
          </div>
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleSend(t.key)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-[12px] text-deep-50 hover:bg-amber-300/[0.07] hover:text-amber-200 transition-colors"
            >
              <span className="text-amber-300/85 font-mono w-4">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
