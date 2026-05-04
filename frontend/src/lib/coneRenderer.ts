/**
 * coneRenderer.ts — Probability Cone Visualization utilities.
 *
 * Converts PossibilityBranch data into smooth cone-shaped SVG path geometry.
 * Each branch becomes a semi-transparent band whose width ∝ confidence
 * and opacity ∝ consensus strength.
 *
 * X-axis = time (years), Y-axis = divergence_level from actual history.
 */

import type { PossibilityBranch, TimelinePoint } from '../services/api';

// ─── Types ─────────────────────────────────────────────────

export interface ConePoint {
  year: number;
  divergence: number;   // 0-1, center line
  confidence: number;   // 0-1, half-width of band
  category: string;
}

export interface ConeBand {
  branchIndex: number;
  clusterId: string;
  narrativeDirection: string;
  consensusStrength: number;
  upperPath: string;    // SVG path d attribute (upper edge)
  lowerPath: string;    // SVG path d attribute (lower edge)
  areaPath: string;     // SVG path d attribute (closed area)
  color: string;
  opacity: number;
  points: ConePoint[];  // raw interpolated points
}

export interface ConeGeometry {
  bands: ConeBand[];
  yearRange: [number, number];
  maxDivergence: number;
  svgWidth: number;
  svgHeight: number;
}

export interface YearSlice {
  year: number;
  branches: Array<{
    branchIndex: number;
    narrativeDirection: string;
    consensusStrength: number;
    divergence: number;
    confidence: number;
    actual: string;
    counterfactual: string;
    category: string;
    color: string;
  }>;
}

// ─── Color ─────────────────────────────────────────────────

/**
 * Map consensus strength to a color on the amber → deep-blue gradient.
 */
export function colorByConsensus(strength: number): string {
  // High consensus → warm amber, low → cool slate-blue
  if (strength > 0.6) {
    const t = (strength - 0.6) / 0.4;
    const r = Math.round(196 + t * 30);
    const g = Math.round(144 + t * 20);
    const b = Math.round(88 - t * 20);
    return `rgb(${r},${g},${b})`;
  } else if (strength > 0.3) {
    const t = (strength - 0.3) / 0.3;
    const r = Math.round(139 + t * 57);
    const g = Math.round(159 - t * 15);
    const b = Math.round(191 - t * 103);
    return `rgb(${r},${g},${b})`;
  } else {
    const r = Math.round(80 + strength / 0.3 * 59);
    const g = Math.round(100 + strength / 0.3 * 59);
    const b = Math.round(160 + strength / 0.3 * 31);
    return `rgb(${r},${g},${b})`;
  }
}

// ─── Interpolation ────────────────────────────────────────

/**
 * Interpolate timeline points to create smooth curves.
 * Adds intermediate points between each pair of timeline points.
 */
export function interpolatePoints(
  points: TimelinePoint[],
  stepsPerSegment: number = 4,
): ConePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [{
      year: points[0].year,
      divergence: points[0].divergence_level,
      confidence: points[0].confidence,
      category: points[0].category,
    }];
  }

  const result: ConePoint[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    for (let s = 0; s < stepsPerSegment; s++) {
      const t = s / stepsPerSegment;
      result.push({
        year: catmullRom(p0.year, p1.year, p2.year, p3.year, t),
        divergence: clamp(catmullRom(
          p0.divergence_level, p1.divergence_level,
          p2.divergence_level, p3.divergence_level, t,
        ), 0, 1),
        confidence: clamp(catmullRom(
          p0.confidence, p1.confidence,
          p2.confidence, p3.confidence, t,
        ), 0.05, 1),
        category: p1.category,
      });
    }
  }

  // Add the last point
  const last = points[points.length - 1];
  result.push({
    year: last.year,
    divergence: last.divergence_level,
    confidence: last.confidence,
    category: last.category,
  });

  return result;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─── Geometry Computation ─────────────────────────────────

/**
 * Convert PossibilityBranch array into renderable cone geometry.
 */
export function computeConeGeometry(
  branches: PossibilityBranch[],
  width: number = 800,
  height: number = 400,
  padding: number = 40,
): ConeGeometry {
  if (!branches.length) {
    return { bands: [], yearRange: [0, 0], maxDivergence: 0, svgWidth: width, svgHeight: height };
  }

  // Find year range across all branches
  let minYear = Infinity;
  let maxYear = -Infinity;
  let maxDiv = 0;

  for (const branch of branches) {
    for (const pt of branch.timeline_points) {
      if (pt.year < minYear) minYear = pt.year;
      if (pt.year > maxYear) maxYear = pt.year;
      if (pt.divergence_level > maxDiv) maxDiv = pt.divergence_level;
    }
  }

  if (maxDiv < 0.1) maxDiv = 1;

  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const yearSpan = maxYear - minYear || 1;

  const xScale = (year: number) => padding + ((year - minYear) / yearSpan) * plotWidth;
  // Y: center at middle, divergence goes both up and down
  const yCenter = height / 2;
  const yScale = (divergence: number, bandWidth: number, isUpper: boolean) => {
    const offset = divergence * (plotHeight / 2) / maxDiv;
    const halfBand = bandWidth * (plotHeight / 8); // band thickness
    return isUpper ? yCenter - offset - halfBand : yCenter - offset + halfBand;
  };

  // Compute bands
  const bands: ConeBand[] = branches.map((branch, idx) => {
    const interpolated = interpolatePoints(branch.timeline_points);
    const color = colorByConsensus(branch.consensus_strength);
    const opacity = 0.15 + branch.consensus_strength * 0.45;

    // Build path points
    const upperPoints: string[] = [];
    const lowerPoints: string[] = [];

    for (const pt of interpolated) {
      const x = xScale(pt.year);
      const yUp = yScale(pt.divergence, pt.confidence, true);
      const yLow = yScale(pt.divergence, pt.confidence, false);
      upperPoints.push(`${x.toFixed(1)},${yUp.toFixed(1)}`);
      lowerPoints.push(`${x.toFixed(1)},${yLow.toFixed(1)}`);
    }

    const upperPath = `M ${upperPoints.join(' L ')}`;
    const lowerPath = `M ${lowerPoints.join(' L ')}`;

    // Closed area path: upper forward → lower reversed
    const areaPath = `M ${upperPoints.join(' L ')} L ${lowerPoints.reverse().join(' L ')} Z`;

    return {
      branchIndex: idx,
      clusterId: branch.cluster_id,
      narrativeDirection: branch.narrative_direction,
      consensusStrength: branch.consensus_strength,
      upperPath,
      lowerPath,
      areaPath,
      color,
      opacity,
      points: interpolated,
    };
  });

  // Sort by consensus (low first so high-consensus bands render on top)
  bands.sort((a, b) => a.consensusStrength - b.consensusStrength);

  return {
    bands,
    yearRange: [minYear, maxYear],
    maxDivergence: maxDiv,
    svgWidth: width,
    svgHeight: height,
  };
}

// ─── Year Slice ──────────────────────────────────────────

/**
 * Get data for all branches at a specific year (for hover tooltip).
 */
export function getYearSlice(
  branches: PossibilityBranch[],
  year: number,
): YearSlice {
  const sliceBranches = branches.map((branch, idx) => {
    // Find closest timeline point
    let closest = branch.timeline_points[0];
    let minDist = Math.abs(closest?.year - year);

    for (const pt of branch.timeline_points) {
      const dist = Math.abs(pt.year - year);
      if (dist < minDist) {
        minDist = dist;
        closest = pt;
      }
    }

    return {
      branchIndex: idx,
      narrativeDirection: branch.narrative_direction,
      consensusStrength: branch.consensus_strength,
      divergence: closest?.divergence_level ?? 0,
      confidence: closest?.confidence ?? 0,
      actual: closest?.actual ?? '',
      counterfactual: closest?.counterfactual ?? '',
      category: closest?.category ?? '',
      color: colorByConsensus(branch.consensus_strength),
    };
  });

  return { year, branches: sliceBranches };
}
