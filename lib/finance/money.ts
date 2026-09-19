/**
 * Money handling policy
 * - DB stores numeric(12,2). Internally we compute in floating point at full precision.
 * - Sums of recorded amounts go through integer paise (`sumMoney`) to avoid 0.1+0.2 drift.
 * - Values are rounded to 2 decimals ONLY when exposed (`round2`); projections are never
 *   rounded step by step.
 */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Floor to a multiple of `step` (so generated limits never overshoot the pool). */
export const floorTo = (n: number, step: number): number => Math.floor(n / step + 1e-9) * step;

export const sumMoney = (values: readonly number[]): number =>
  values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;

export const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** e.g. 452300 -> "₹4,52,300". For prose fallbacks and prompts. */
export const formatINR = (n: number): string => `₹${inr.format(Math.round(n))}`;
