import type { ReactNode, HTMLAttributes } from 'react';

type Tone = 'default' | 'subtle' | 'active' | 'danger' | 'cool';
type Size = 'sm' | 'md' | 'lg';

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  tone?: Tone;
  size?: Size;
  className?: string;
  children: ReactNode;
}

const TONE_CLASSES: Record<Tone, string> = {
  default: 'glass tk-border',
  subtle:  'glass-subtle tk-border-faint',
  active:  'glass border-glow-active',
  danger:  'glass border border-earth-rust/45',
  cool:    'glass border border-cool-400/35',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'p-3 rounded-lg',
  md: 'p-5 rounded-lg',
  lg: 'p-6 rounded-xl',
};

/** Unified panel container. Use instead of ad-hoc `glass border border-amber-300/35 rounded-lg p-X`. */
export function Panel({ tone = 'default', size = 'md', className = '', children, ...rest }: PanelProps) {
  return (
    <div className={`${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
