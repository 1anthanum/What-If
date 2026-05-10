import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'tab' | 'danger';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
  loading?: boolean;
  children: ReactNode;
}

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'px-2 py-1 text-[11px] rounded',
  sm: 'px-3 py-1.5 text-[12px] rounded-md',
  md: 'px-4 py-2 text-[13px] rounded-md',
  lg: 'px-5 py-3 text-[14px] rounded-lg',
};

const VARIANT_CLASSES: Record<Variant, { base: string; active: string }> = {
  primary: {
    base:   'bg-gradient-to-r from-amber-700 to-amber-600 text-white shadow-glow-sm hover:shadow-glow border border-amber-500/40 btn-glow',
    active: '',
  },
  secondary: {
    base:   'bg-deep-800/60 tk-text-primary border tk-border hover:tk-border-strong hover:text-amber-200',
    active: 'bg-amber-300/[0.08] border-amber-300/55 text-amber-200 shadow-glow-sm',
  },
  ghost: {
    base:   'bg-transparent tk-text-muted border border-transparent hover:text-amber-300 hover:border-amber-300/30',
    active: 'text-amber-200 border-amber-300/40 bg-amber-300/[0.04]',
  },
  tab: {
    base:   'bg-deep-800/40 tk-text-secondary border tk-border-faint hover:border-amber-300/35 hover:text-amber-300',
    active: 'bg-amber-300/[0.08] border-amber-300/55 text-amber-200 shadow-glow-sm',
  },
  danger: {
    base:   'bg-earth-rust/10 text-earth-rust border border-earth-rust/40 hover:bg-earth-rust/20',
    active: '',
  },
};

/** Unified button. Replaces the 3+ ad-hoc button styles scattered across components. */
export function Button({
  variant = 'secondary',
  size = 'sm',
  active = false,
  loading = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const v = VARIANT_CLASSES[variant];
  const stateCls = active && v.active ? v.active : v.base;
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-1.5 font-mono tracking-[0.10em] transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40
        disabled:opacity-40 disabled:cursor-not-allowed
        ${SIZE_CLASSES[size]}
        ${stateCls}
        ${className}
      `}
    >
      {loading && (
        <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
}
