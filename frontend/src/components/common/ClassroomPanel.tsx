/**
 * Classroom debate mode — student writes their own argument from a
 * persona's perspective; LLM produces its version; a grader LLM compares
 * and gives constructive feedback.
 *
 * Triggered from header "🎓 课堂" button. Standalone workflow — doesn't
 * touch the auto-loop pipeline.
 */
import { useState } from 'react';
import { autoLoopApi, type ClassroomGradeResponse } from '../../services/api';
import { PHILOSOPHICAL_PRESETS, CATEGORY_META } from '../orchestrator/PhilosophicalPresets';

interface Props {
  onClose: () => void;
}

const PERSONA_CHOICES = [
  { id: 'rationalist',         name: '理性主义', short: '逻辑、可证伪、分析' },
  { id: 'existentialist',      name: '存在主义', short: '自由选择、焦虑、本真' },
  { id: 'pragmatist',          name: '实用主义', short: '后果、有效、实践' },
  { id: 'eastern_philosopher', name: '东方哲学', short: '中道、缘起、无为' },
  { id: 'critical_theorist',   name: '批判理论', short: '权力、意识形态、揭蔽' },
  { id: 'virtue_ethicist',     name: '美德伦理', short: '品格、目的、中庸' },
  { id: 'utilitarian',         name: '功利主义', short: '后果、福祉、取舍' },
];

export function ClassroomPanel({ onClose }: Props) {
  const [persona, setPersona] = useState('rationalist');
  const [question, setQuestion] = useState('');
  const [argument, setArgument] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassroomGradeResponse | null>(null);

  const submit = async () => {
    if (!question.trim() || argument.trim().length < 40) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await autoLoopApi.classroomGrade({
        persona_id: persona,
        question: question.trim(),
        student_argument: argument.trim(),
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const scoreColor = (score: number) =>
    score >= 8 ? 'text-earth-green/95'
    : score >= 5 ? 'text-amber-300/95'
    : 'text-earth-rust/95';

  return (
    <div
      className="fixed inset-0 z-50 bg-deep-950/85 backdrop-blur-sm flex items-center justify-center px-6 py-8 animate-fade-in"
      role="dialog" aria-modal="true" onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full glass border border-amber-300/[0.15] rounded-xl p-6 shadow-glow-lg max-h-[88vh] flex flex-col"
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
            <span>🎓</span>
            课堂辩论模式
          </div>
          <h2 className="text-lg font-light text-white">
            自己<span className="text-amber-300">先论证</span>，再让 AI 评点
          </h2>
          <p className="text-[12px] text-deep-100/65 mt-1.5 leading-relaxed max-w-2xl">
            选一个哲学传统、一个议题，**先写**你自己的论证。提交后 LLM 会
            产出它的版本 + 一位 grader 给你具体反馈（你抓住了什么、漏了什么、逻辑哪里跳了）。
            适合哲学课作业前先自我检查，或备课时检查议题设计。
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
          {/* Persona pick */}
          <div>
            <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-2">
              1. 选哲学立场
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {PERSONA_CHOICES.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPersona(p.id)}
                  className={`text-left rounded p-2 transition-all ${
                    persona === p.id
                      ? 'border border-amber-300/65 bg-amber-300/[0.08]'
                      : 'border border-deep-400/30 hover:border-amber-300/40 hover:bg-deep-700/30'
                  }`}
                >
                  <div className="text-[12px] font-medium text-deep-50">{p.name}</div>
                  <div className="text-[10px] text-deep-200/70 mt-0.5">{p.short}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Question */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                2. 议题
              </p>
              <button
                onClick={() => setShowPresets((v) => !v)}
                className="text-[10px] font-mono text-amber-300/85 hover:text-amber-200 px-2 py-0.5 rounded border border-amber-300/35"
              >
                {showPresets ? '✕ 收起' : '📚 从教学包选'}
              </button>
            </div>
            {showPresets && (
              <div className="mb-2 max-h-[180px] overflow-y-auto rounded border border-deep-400/30 bg-deep-800/30 p-2 space-y-1">
                {PHILOSOPHICAL_PRESETS.filter((p) => p.difficulty !== 'advanced').slice(0, 30).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setQuestion(p.question); setShowPresets(false); }}
                    className="w-full text-left rounded p-1.5 hover:bg-amber-300/[0.05] transition-colors"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-[9px] font-mono text-deep-300">
                        {CATEGORY_META[p.category]?.icon}
                      </span>
                      <span className="text-[12px] text-deep-50">{p.title}</span>
                      {p.difficulty && (
                        <span className="text-[8px] font-mono text-deep-300/65 uppercase">
                          {p.difficulty === 'intro' ? '入门' : '中等'}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="输入你要讨论的哲学议题…（或从上方教学包选一个）"
              rows={2}
              className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[12px] text-deep-50 placeholder-deep-300/50 resize-none focus:border-amber-300/55"
              maxLength={500}
            />
          </div>

          {/* Student argument */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                3. 你的论证（≥ 40 字）
              </p>
              <span className={`text-[10px] font-mono tabular-nums ${argument.length >= 40 ? 'text-earth-green/85' : 'text-deep-300/65'}`}>
                {argument.length} / 2000
              </span>
            </div>
            <textarea
              value={argument}
              onChange={(e) => setArgument(e.target.value)}
              placeholder={`从「${PERSONA_CHOICES.find((p) => p.id === persona)?.name}」的视角写下你的回答。grader 会评你是否真正运用了这个传统的思维方式。`}
              rows={7}
              className="w-full bg-deep-800/40 border border-deep-400/40 rounded px-3 py-2 text-[13px] text-deep-50 leading-relaxed placeholder-deep-300/50 resize-none focus:border-amber-300/55"
              maxLength={2000}
            />
          </div>

          {error && (
            <div className="text-[12px] text-earth-rust/90 bg-earth-rust/10 border border-earth-rust/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              {/* Score + summary */}
              <div className="rounded-lg border border-amber-300/35 bg-amber-300/[0.04] p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider">
                    Grader 评分
                  </span>
                  <span className={`text-2xl font-mono font-bold tabular-nums ${scoreColor(result.feedback.score)}`}>
                    {result.feedback.score}<span className="text-[12px] text-deep-200/55">/10</span>
                  </span>
                </div>
                <p className="text-[12px] text-deep-50 leading-relaxed">{result.feedback.summary}</p>
              </div>

              {/* Got right / Missed / Gaps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="rounded border border-earth-green/35 bg-earth-green/[0.04] p-2.5">
                  <p className="text-[10px] font-mono text-earth-green/85 uppercase tracking-wider mb-1.5">
                    ✓ 抓到了
                  </p>
                  {result.feedback.got_right.length === 0 ? (
                    <p className="text-[11px] text-deep-200/55 italic">grader 未指出具体优点</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-deep-50">
                      {result.feedback.got_right.map((g, i) => <li key={i}>· {g}</li>)}
                    </ul>
                  )}
                </div>
                <div className="rounded border border-earth-rust/35 bg-earth-rust/[0.04] p-2.5">
                  <p className="text-[10px] font-mono text-earth-rust/85 uppercase tracking-wider mb-1.5">
                    ⚠ 漏了
                  </p>
                  {result.feedback.missed.length === 0 ? (
                    <p className="text-[11px] text-deep-200/55 italic">无明显缺漏</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-deep-50">
                      {result.feedback.missed.map((m, i) => <li key={i}>· {m}</li>)}
                    </ul>
                  )}
                </div>
                <div className="rounded border border-amber-300/35 bg-amber-300/[0.04] p-2.5">
                  <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1.5">
                    ⤳ 逻辑断点
                  </p>
                  {result.feedback.gaps.length === 0 ? (
                    <p className="text-[11px] text-deep-200/55 italic">逻辑连贯</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-deep-50">
                      {result.feedback.gaps.map((g, i) => <li key={i}>· {g}</li>)}
                    </ul>
                  )}
                </div>
              </div>

              {/* Side-by-side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="rounded border border-deep-400/30 bg-deep-700/20 p-2.5">
                  <p className="text-[10px] font-mono text-deep-300/85 uppercase tracking-wider mb-1">
                    你的论证
                  </p>
                  <p className="text-[12px] text-deep-50 leading-snug whitespace-pre-wrap">{result.student_argument}</p>
                </div>
                <div className="rounded border border-amber-300/35 bg-amber-300/[0.03] p-2.5">
                  <p className="text-[10px] font-mono text-amber-300/85 uppercase tracking-wider mb-1">
                    LLM 范本（{result.persona_name}） · {Math.round(result.llm_latency_ms)}ms
                  </p>
                  <p className="text-[12px] text-deep-50 leading-snug whitespace-pre-wrap">{result.llm_argument}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onClose}
            className="text-[11px] font-mono text-deep-200/75 hover:text-amber-300 px-3 py-1.5 rounded border border-deep-400/40 hover:border-amber-300/45"
          >
            关闭
          </button>
          <button
            onClick={submit}
            disabled={!question.trim() || argument.length < 40 || running}
            className={`text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
              !question.trim() || argument.length < 40 || running
                ? 'border-deep-400/30 text-deep-200/40 cursor-not-allowed'
                : 'border-amber-300/55 bg-amber-300/[0.08] text-amber-200 hover:bg-amber-300/[0.14]'
            }`}
          >
            {running ? '评分中…' : (result ? '↻ 重交' : '▶ 提交评分')}
          </button>
        </div>
      </div>
    </div>
  );
}
