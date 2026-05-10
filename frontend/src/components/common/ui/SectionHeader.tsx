import type { ReactNode } from 'react';

interface SectionHeaderProps {
  /** Mono-uppercase eyebrow (e.g. "PERSONA · 本地 Ollama 模型池") */
  eyebrow?: string;
  /** Main title text */
  title?: string;
  /** Right-aligned slot for buttons / counts / actions */
  actions?: ReactNode;
  /** Tone of eyebrow */
  tone?: 'amber' | 'cool' | 'muted';
  className?: string;
}

const TONE_CLASSES = {
  amber:  'text-amber-300/95',
  cool:   'text-cool-400',
  muted:  'tk-text-muted',
};

/** Unified section header — eyebrow + optional title + optional actions row.
 *  Replaces the dozens of ad-hoc `<p className="text-[11px] font-mono ...uppercase tracking-...">`
 *  patterns scattered across panels. */
export function SectionHeader({
  eyebrow,
  title,
  actions,
  tone = 'amber',
  className = '',
}: SectionHeaderProps) {
  const hasActions = !!actions;
  return (
    <div className={`${hasActions ? 'flex items-baseline justify-between gap-3' : ''} ${className}`}>
      <div>
        {eyebrow && (
          <p className={`text-[11px] font-mono tracking-[0.22em] uppercase ${TONE_CLASSES[tone]}`}>
            {eyebrow}
          </p>
        )}
        {title && (
          <p className="mt-0.5 text-[13px] font-medium tk-text-primary">
            {title}
          </p>
        )}
      </div>
      {hasActions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
