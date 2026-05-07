import { useEffect } from 'react';
import { useCounterfactualStore } from '../../store/counterfactualStore';

/**
 * PersonaSelector — 历史人物选择器
 *
 * 展示当前事件可用的历史人物，用户可多选。
 * 选中的人物将作为具身视角探索的 Stage 1 代理。
 */
export function PersonaSelector() {
  const store = useCounterfactualStore();
  const {
    selectedEvent,
    personas,
    selectedPersonaIds,
  } = store;

  // Load personas when event changes
  useEffect(() => {
    if (selectedEvent?.id && personas.length === 0) {
      store.loadPersonas(selectedEvent.id);
    }
  }, [selectedEvent?.id]);

  if (personas.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-[14px] text-deep-200/75 font-mono">
          加载历史人物...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[14px] font-mono text-amber-300/90 uppercase tracking-wider">
          选择历史人物
        </h4>
        <span className="text-[15px] font-mono text-deep-200/75">
          已选 {selectedPersonaIds.length}/{personas.length}
        </span>
      </div>

      <p className="text-[14px] text-deep-200/35 leading-relaxed">
        每个人物将从自身立场出发探索反事实分歧，最终按利益联盟聚类而非叙事主题。
        至少选择 2 人。
      </p>

      <div className="grid grid-cols-1 gap-2">
        {personas.map((persona) => {
          const isSelected = selectedPersonaIds.includes(persona.id);
          return (
            <button
              key={persona.id}
              onClick={() => store.togglePersona(persona.id)}
              className={`text-left rounded-lg p-3 transition-all duration-300 border ${
                isSelected
                  ? 'border-amber-300/25 bg-amber-300/[0.04] shadow-glow-sm'
                  : 'border-deep-400/35 bg-deep-700/20 hover:border-deep-400/45 hover:bg-deep-700/30'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Avatar placeholder */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[14px] font-mono font-bold border shrink-0 ${
                  isSelected
                    ? 'border-amber-300/70 bg-amber-300/15 text-amber-300/80'
                    : 'border-deep-400/45 bg-deep-600/30 text-deep-200/85'
                }`}>
                  {persona.name.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h5 className={`text-[15px] font-medium truncate ${
                      isSelected ? 'text-amber-300/90' : 'text-white/70'
                    }`}>
                      {persona.name}
                    </h5>
                    {persona.era && (
                      <span className="text-[14px] font-mono text-deep-200/70 shrink-0 ml-2">
                        {persona.era}
                      </span>
                    )}
                  </div>
                  <p className={`text-[14px] mt-0.5 ${
                    isSelected ? 'text-deep-200/50' : 'text-deep-200/35'
                  }`}>
                    {persona.role}
                  </p>

                  {/* Expanded info for selected personas */}
                  {isSelected && persona.worldview && (
                    <div className="mt-2 pt-2 border-t border-deep-400/35 space-y-1">
                      <p className="text-[15px] text-deep-200/75 leading-relaxed italic">
                        "{persona.worldview}"
                      </p>
                      {persona.known_positions && persona.known_positions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {persona.known_positions.slice(0, 3).map((pos, idx) => (
                            <span
                              key={idx}
                              className="text-[14px] bg-deep-600/30 text-deep-200/35 rounded-full px-2 py-0.5 border border-deep-400/35"
                            >
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Selection indicator */}
                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                  isSelected
                    ? 'border-amber-300/40 bg-amber-300/20'
                    : 'border-deep-400/45 bg-deep-700/30'
                }`}>
                  {isSelected && (
                    <span className="text-[14px] text-amber-300/80">✓</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
