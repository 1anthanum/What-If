/**
 * Socratic follow-up — ask a specific persona a follow-up question
 * referencing its prior statement. Persona stays in character.
 *
 * Triggered from a per-PersonaCard "💬 追问" button. Returns one-shot
 * (non-streaming) for MVP simplicity.
 */
import { useState } from 'react';
import { autoLoopApi } from '../../services/api';
import { useAutoLoopStore } from '../../store/autoLoopStore';

interface Props {
  personaId: string;
  personaName: string;
  cycleNum: number;
  cycleHypothesis: string;
  personaStatement: string;
  onClose: () => void;
}

export function PersonaFollowupModal({
  personaId, personaName, cycleNum, cycleHypothesis, personaStatement, onClose,
}: Props) {
  const [followup, setFollowup] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<string | null>(null);
  const appendFollowup = useAutoLoopStore((s) => s.appendPersonaFollowup);

  const submit = async () => {
    if (!followup.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await autoLoopApi.followupPersona({
        persona_id: personaId,
        question: cycleHypothesis,
        persona_statement: personaStatement,
        followup: followup.trim(),
      });
      // Persist in store so card shows it after modal closes
      appendFollowup(cycleNum, personaId, followup.trim(), r.response);
      setLastResponse(r.response);
      setFollowup('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-2xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-deep-200/55 hover:text-amber-300 text-lg font-mono px-2"
        >
          ✕
        </button>

        <div className="mb-4">
          <div className="inline-flex items-center gap-2 text-[10px] font-mono text-amber-300/95 tracking-[0.22em] uppercase mb-2 px-3 py-1.5 border border-amber-300/40 rounded-full">
            <span>💬</span>
            苏格拉底追问
          </div>
          <h2 className="text-lg font-light text-white">
            向 <span className="text-amber-300">{personaName}</span> 追问
          </h2>
        </div>

        <div className="bg-deep-700/30 border border-deep-400/30 rounded p-3 mb-3">
          <p className="text-[10px] font-mono text-deep-300/85 uppercase tracking-wider mb-1.5">原议题</p>
          <p className="text-[12px] text-deep-50 leading-snug mb-2 line-clamp-2">{cycleHypothesis}</p>
          <p className="text-[10px] font-mono text-deep-300/85 uppercase tracking-wider mb-1.5">该 persona 已说过</p>
          <p className="text-[11px] text-deep-100/80 leading-snug whitespace-pre-wrap line-clamp-4">{personaStatement}</p>
        </div>

        <div className="mb-3">
          <label className="block text-[11px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
            你的追问
          </label>
          <textarea
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
            placeholder="例如：『但你的立场依赖于一个未声明的前提 — 即理性可以被普遍化。如果某种文化的理性概念与你不同呢？』"
            rows={3}
            className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[12px] text-deep-50 placeholder-deep-300/45 resize-none focus:border-amber-300/55"
            maxLength={500}
          />
        </div>

        {error && (
          <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {lastResponse && (
          <div className="bg-amber-300/[0.04] border border-amber-300/30 rounded p-3 mb-3 overflow-y-auto max-h-[40vh]">
            <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
              {personaName} 的回应
            </p>
            <p className="text-[13px] text-deep-50 leading-relaxed whitespace-pre-wrap">{lastResponse}</p>
            <p className="text-[10px] font-mono text-deep-200/55 italic mt-2">
              已保存到该 persona 的发言卡片，可继续追问。
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-auto">
          <span className="text-[10px] font-mono text-deep-300/65 tabular-nums mr-auto">
            {followup.length} / 500
          </span>
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45"
          >
            关闭
          </button>
          <button
            onClick={submit}
            disabled={!followup.trim() || loading}
            className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              !followup.trim() || loading
                ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
            }`}
          >
            {loading ? '思考中…' : '▶ 发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
