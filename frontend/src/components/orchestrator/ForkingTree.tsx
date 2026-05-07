/**
 * ForkingTree — Decision Forking Tree visualization (决策树可视化)
 *
 * When branching mode is enabled, each cycle presents top-3 candidate
 * sub-questions. The tree shows the exploration path with unexplored
 * branches as faded alternatives.
 *
 * Layout:  Root → Cycle 1 → [Branch A (chosen), Branch B, Branch C] → Cycle 2 → ...
 */

import { useState } from 'react';
import type { CycleState } from '../../store/autoLoopStore';

interface TreeNode {
  cycle: number;
  question: string;
  chosen: boolean;
  children: TreeNode[];
  candidates: string[];
}

function buildTree(cycles: CycleState[], evolutionChain: string[]): TreeNode {
  const root: TreeNode = {
    cycle: 0,
    question: evolutionChain[0] ?? '',
    chosen: true,
    children: [],
    candidates: [],
  };

  let current = root;
  for (const c of cycles) {
    const chosenQ = c.nextHypothesis || evolutionChain[c.cycle] || '';
    const candidates = c.candidateQuestions.length > 0 ? c.candidateQuestions : [];

    const chosenNode: TreeNode = {
      cycle: c.cycle,
      question: chosenQ,
      chosen: true,
      children: [],
      candidates,
    };

    // Add unchosen branches
    const alternates: TreeNode[] = candidates
      .filter((cand) => cand !== chosenQ)
      .map((cand, i) => ({
        cycle: c.cycle,
        question: cand,
        chosen: false,
        children: [],
        candidates: [],
      }));

    current.children = [chosenNode, ...alternates];
    current = chosenNode;
  }

  return root;
}

interface ForkingTreeProps {
  cycles: CycleState[];
  evolutionChain: string[];
}

export function ForkingTree({ cycles, evolutionChain }: ForkingTreeProps) {
  const cyclesWithCandidates = cycles.filter((c) => c.candidateQuestions.length > 0);

  if (cyclesWithCandidates.length === 0) {
    return null;
  }

  return (
    <div className="glass border border-amber-300/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-300/85 text-sm">⑃</span>
        <span className="text-[14px] font-mono text-amber-300/90 uppercase tracking-wider">
          决策分支树
        </span>
        <span className="text-[14px] font-mono text-deep-200/70">
          {cyclesWithCandidates.length} 个分支点
        </span>
      </div>

      {/* Render as vertical tree */}
      <div className="space-y-1 pl-2">
        {/* Root */}
        <div className="flex items-start gap-2">
          <span className="text-[15px] font-mono text-purple-400/50 mt-0.5 shrink-0 w-4">◈</span>
          <p className="text-[14px] text-white/60 leading-relaxed">
            {evolutionChain[0]}
          </p>
        </div>

        {cycles.map((cycle, idx) => (
          <CycleBranch
            key={cycle.cycle}
            cycle={cycle}
            chosenQuestion={evolutionChain[cycle.cycle] ?? cycle.nextHypothesis}
            isLast={idx === cycles.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function CycleBranch({
  cycle,
  chosenQuestion,
  isLast,
}: {
  cycle: CycleState;
  chosenQuestion: string;
  isLast: boolean;
}) {
  const [showAlternates, setShowAlternates] = useState(false);
  const candidates = cycle.candidateQuestions;
  const alternates = candidates.filter((c) => c !== chosenQuestion);
  const hasBranch = alternates.length > 0;

  return (
    <div className="ml-4 border-l border-deep-400/40 pl-3 space-y-1">
      {/* Chosen path */}
      <div className="flex items-start gap-2">
        <span className="text-[15px] font-mono text-amber-300/85 mt-0.5 shrink-0 w-4">{cycle.cycle}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-white/55 leading-relaxed truncate">
            {chosenQuestion || '(收敛)'}
          </p>
        </div>
        {hasBranch && (
          <button
            onClick={() => setShowAlternates(!showAlternates)}
            className="text-[14px] font-mono text-deep-200/75 hover:text-amber-300/90 transition-colors shrink-0 px-1.5 py-0.5 border border-deep-400/40 rounded"
          >
            {showAlternates ? '收起' : `+${alternates.length} 分支`}
          </button>
        )}
      </div>

      {/* Alternate branches (unchosen) */}
      {showAlternates && alternates.map((alt, i) => (
        <div key={i} className="ml-4 flex items-start gap-2 opacity-40">
          <span className="text-[15px] font-mono text-deep-200/75 mt-0.5 shrink-0 w-4">↳</span>
          <p className="text-[14px] text-deep-200/85 leading-relaxed italic">
            {alt}
          </p>
          <span className="text-[7px] font-mono text-deep-200/65 shrink-0 mt-0.5 border border-deep-400/35 rounded px-1">
            未探索
          </span>
        </div>
      ))}
    </div>
  );
}
