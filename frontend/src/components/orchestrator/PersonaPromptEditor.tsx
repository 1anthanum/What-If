/**
 * Persona prompt editor — open from AutoLoopView's "✎ 编辑 persona" button.
 *
 * Lets the user override each philosophical persona's system prompt. Edits
 * are saved per-user in localStorage and sent with every auto-loop start
 * as `persona_overrides`. Original prompts always reachable via "重置".
 */
import { useEffect, useState } from 'react';
import { usePersonaPromptStore, type PersonaDefault } from '../../store/personaPromptStore';

interface Props {
  onClose: () => void;
}

const PERSONA_ICONS: Record<string, string> = {
  rationalist: '⟐',
  existentialist: '◈',
  pragmatist: '◆',
  eastern_philosopher: '☯',
  critical_theorist: '⚡',
  adversary: '🗡',
  virtue_ethicist: '✦',
  utilitarian: '∑',
  feminist_theorist: '♀',
  religious_traditionalist: '⛪',
  complexity_theorist: '※',
};

export function PersonaPromptEditor({ onClose }: Props) {
  const { defaults, fetchingDefaults, edits, loadDefaults, setEdit, clearEdit, clearAll } = usePersonaPromptStore();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  useEffect(() => {
    if (defaults && defaults.length > 0 && !activeId) {
      setActiveId(defaults[0].id);
    }
  }, [defaults, activeId]);

  const active: PersonaDefault | undefined = defaults?.find((p) => p.id === activeId);
  // Pull draft from store whenever the active persona changes, so switching tabs
  // doesn't drop edits-in-progress on other personas.
  useEffect(() => {
    if (!active) return;
    setDraftText(edits[active.id] ?? active.system_prompt);
  }, [active, edits]);

  const handleSave = () => {
    if (!active) return;
    const trimmed = draftText.trim();
    // If user reset to default text, clear the override entry.
    if (trimmed === active.system_prompt.trim() || trimmed === '') {
      clearEdit(active.id);
    } else {
      setEdit(active.id, trimmed);
    }
  };

  const handleReset = () => {
    if (!active) return;
    setDraftText(active.system_prompt);
    clearEdit(active.id);
  };

  const isDirty = active ? draftText.trim() !== (edits[active.id] ?? active.system_prompt).trim() : false;
  const isEdited = active ? !!edits[active.id] : false;

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
          aria-label="关闭"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>✎</span>
            编辑 persona
          </div>
          <h2 className="text-lg font-light text-white tracking-tight">
            自定义 persona 的<span className="text-amber-300"> system prompt</span>
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed">
            修改后的 prompt 会在你下次开始辩论时生效。你怎么定义「理性主义」决定了它会说什么 —
            这本身就是哲学训练。
          </p>
        </div>

        {fetchingDefaults && !defaults && (
          <div className="text-[12px] text-deep-200/70 py-6 text-center">载入 persona…</div>
        )}

        {defaults && defaults.length > 0 && (
          <div className="flex flex-1 min-h-0 gap-4">
            {/* Sidebar — persona list */}
            <div className="w-44 shrink-0 overflow-y-auto pr-1 space-y-0.5">
              {defaults.map((p) => {
                const edited = !!edits[p.id];
                const isActive = p.id === activeId;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActiveId(p.id)}
                    className={`w-full flex items-center gap-2 text-left px-2.5 py-2 rounded text-[12px] transition-colors ${
                      isActive
                        ? 'bg-amber-300/[0.08] border border-amber-300/45 text-amber-100'
                        : 'border border-transparent text-deep-100/75 hover:bg-deep-700/30 hover:text-deep-50'
                    }`}
                  >
                    <span className="font-mono text-amber-300/85 shrink-0 w-3.5">
                      {PERSONA_ICONS[p.id] ?? '◇'}
                    </span>
                    <span className="flex-1 truncate">{p.name}</span>
                    {edited && (
                      <span className="text-[8px] font-mono px-1 py-0.5 rounded border border-earth-green/40 text-earth-green/85 leading-none">
                        改
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="pt-2 mt-2 border-t border-deep-400/20">
                <button
                  onClick={() => { if (confirm('确定清空所有 persona 编辑？')) { clearAll(); if (active) setDraftText(active.system_prompt); } }}
                  className="w-full text-[10px] font-mono text-deep-200/65 hover:text-earth-rust px-2 py-1.5 rounded border border-deep-400/30 hover:border-earth-rust/40"
                >
                  ✕ 重置全部
                </button>
              </div>
            </div>

            {/* Editor pane */}
            {active ? (
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-baseline gap-3 mb-2">
                  <h3 className="text-[15px] font-medium text-deep-50">
                    {PERSONA_ICONS[active.id] ?? '◇'} {active.name}
                  </h3>
                  <span className="text-[11px] font-mono text-deep-300 tracking-wider">
                    {active.role}
                  </span>
                  {isEdited && (
                    <span className="ml-auto text-[10px] font-mono text-earth-green/85 px-1.5 py-0.5 rounded border border-earth-green/40">
                      ✓ 已自定义
                    </span>
                  )}
                </div>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={14}
                  className="flex-1 w-full bg-deep-800/40 border border-deep-400/45 rounded-lg px-4 py-3 text-[13px] text-deep-50 leading-relaxed font-mono resize-none focus:outline-none focus:border-amber-300/50"
                  placeholder="（空表示使用默认）"
                  maxLength={4000}
                />
                <div className="flex items-center justify-between mt-2.5 gap-2">
                  <div className="text-[10px] font-mono text-deep-300 tabular-nums">
                    {draftText.length} / 4000 字符
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReset}
                      className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45 transition-colors"
                      title="恢复为内置 prompt 并清除自定义"
                    >
                      ↺ 重置
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={!isDirty}
                      className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
                        isDirty
                          ? 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
                          : 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                      }`}
                    >
                      ✓ 保存
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-deep-200/55 text-[13px]">
                选一个 persona 开始编辑
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
