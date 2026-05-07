import { useEffect, useRef, useState } from 'react';
import { useSettingsStore, DEFAULT_PARAMS } from '../../store/settingsStore';

interface KnobProps {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  precision?: number;
  onChange: (v: number) => void;
  accent?: 'persona' | 'judge';
}

function Knob({ label, hint, min, max, step, value, precision = 0, onChange, accent = 'persona' }: KnobProps) {
  const isJudge = accent === 'judge';
  const accentColor = isJudge ? '#F5C896' : '#DAD2C8';
  const trackFill = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-mono tracking-[0.10em] text-deep-100">
          {label}
        </span>
        <span
          className="text-[13px] font-mono font-semibold tabular-nums"
          style={{ color: accentColor }}
        >
          {value.toFixed(precision)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 appearance-none rounded-full cursor-pointer bg-transparent settings-range"
        style={{
          background: `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${trackFill}%, rgba(80,75,70,0.45) ${trackFill}%, rgba(80,75,70,0.45) 100%)`,
        }}
      />
      <p className="text-[11px] text-deep-300/85 font-mono leading-snug">{hint}</p>
    </div>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const settings = useSettingsStore();

  // Close on outside click / esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isDirty =
    settings.persona_temperature !== DEFAULT_PARAMS.persona_temperature ||
    settings.persona_max_tokens !== DEFAULT_PARAMS.persona_max_tokens ||
    settings.judge_temperature !== DEFAULT_PARAMS.judge_temperature ||
    settings.judge_max_tokens !== DEFAULT_PARAMS.judge_max_tokens ||
    settings.eval_enabled !== DEFAULT_PARAMS.eval_enabled;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`
          flex items-center gap-1.5 px-3 py-1.5 rounded-md font-mono text-[12px] tracking-[0.18em] transition-all
          border
          ${open
            ? 'bg-amber-300/[0.08] border-amber-300/55 text-amber-200 shadow-glow-sm'
            : 'bg-deep-800/60 border-deep-400/40 text-deep-100 hover:border-amber-300/45 hover:text-amber-300'
          }
        `}
        aria-label="Model settings"
      >
        <span className={`text-[15px] leading-none ${open ? 'animate-spin-slow' : ''}`}>⚙</span>
        <span>PARAMS</span>
        {isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(232,185,136,0.8)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[360px] glass rounded-xl border border-amber-300/35 shadow-glow-lg p-5 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-bold tracking-[0.18em] text-amber-200 uppercase">
                ⚙ Model Parameters
              </p>
              <p className="text-[11px] font-mono text-deep-300 mt-0.5">
                下次创建 session 时生效
              </p>
            </div>
            <button
              onClick={() => settings.reset()}
              disabled={!isDirty}
              className="text-[11px] font-mono tracking-wider px-2 py-1 rounded border border-deep-400/45 text-deep-200 hover:border-amber-300/55 hover:text-amber-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              RESET
            </button>
          </div>

          {/* Persona section */}
          <div className="mb-4 pb-4 border-b border-deep-400/30">
            <p className="text-[11px] font-mono tracking-[0.22em] text-deep-200 uppercase mb-3">
              ◇ Persona · 本地 Ollama 模型池
            </p>
            <div className="space-y-3.5">
              <Knob
                label="Temperature"
                hint="0 = 严谨守规　·　1 = 平衡　·　2 = 发散探索"
                min={0} max={2} step={0.05} precision={2}
                value={settings.persona_temperature}
                onChange={v => settings.set({ persona_temperature: v })}
              />
              <Knob
                label="Max Tokens / persona"
                hint="单个 persona 单轮发言长度上限"
                min={200} max={2000} step={50}
                value={settings.persona_max_tokens}
                onChange={v => settings.set({ persona_max_tokens: v })}
              />
            </div>
          </div>

          {/* Judge section */}
          <div className="mb-4 pb-4 border-b border-deep-400/30">
            <p className="text-[11px] font-mono tracking-[0.22em] text-amber-300/95 uppercase mb-3">
              ⚖ Judge · Claude API 裁判
            </p>
            <div className="space-y-3.5">
              <Knob
                label="Temperature"
                hint="评判 / 综合分析的发散度。建议低值"
                min={0} max={1.5} step={0.05} precision={2}
                value={settings.judge_temperature}
                onChange={v => settings.set({ judge_temperature: v })}
                accent="judge"
              />
              <Knob
                label="Max Tokens / synthesis"
                hint="单次裁判输出的长度上限"
                min={300} max={4000} step={100}
                value={settings.judge_max_tokens}
                onChange={v => settings.set({ judge_max_tokens: v })}
                accent="judge"
              />
            </div>
          </div>

          {/* Evaluation toggle */}
          <div>
            <p className="text-[11px] font-mono tracking-[0.22em] text-amber-300/95 uppercase mb-3">
              ⊛ Per-Round Evaluation · 每轮多维评分
            </p>
            <button
              type="button"
              onClick={() => settings.set({ eval_enabled: !settings.eval_enabled })}
              className={`
                w-full flex items-center justify-between px-3.5 py-2.5 rounded-md border transition-all
                ${settings.eval_enabled
                  ? 'bg-amber-300/[0.06] border-amber-300/55 text-amber-100'
                  : 'bg-deep-800/40 border-deep-400/40 text-deep-200 hover:border-amber-300/30'
                }
              `}
            >
              <div className="text-left">
                <div className="text-[13px] font-mono tracking-[0.10em]">
                  {settings.eval_enabled ? '✓ ENABLED' : '✕ DISABLED'}
                </div>
                <div className="text-[11px] font-mono text-deep-300 mt-0.5">
                  Claude 给每位 persona 打 5 维分（额外 +1 调用 / 轮）
                </div>
              </div>
              <div className={`
                relative w-10 h-5 rounded-full border transition-colors
                ${settings.eval_enabled ? 'bg-amber-400/40 border-amber-300/70' : 'bg-deep-700 border-deep-400/45'}
              `}>
                <span
                  className={`
                    absolute top-0.5 w-3.5 h-3.5 rounded-full bg-amber-100 shadow-glow-sm
                    transition-all ${settings.eval_enabled ? 'left-5' : 'left-0.5'}
                  `}
                />
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
