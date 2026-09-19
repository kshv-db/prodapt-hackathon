import { FinanceInputError } from "./errors";
import { round2 } from "./money";

/** Assumed annual return. Shown to users as an assumption, never a promise. */
export const ASSUMED_ANNUAL_RETURN = 0.07;
export const MAX_MONTHLY_SAVING = 20_000;
export const MAX_PROJECTION_YEARS = 30;

export interface ProjectionPoint {
  month: number;
  balance: number;
}

export interface ProjectionInput {
  monthlySaving: number;
  years: number;
  annualReturn?: number;
  startingBalance?: number;
}

/**
 * balance[m] = balance[m-1] * (1 + r/12) + monthlySaving, balance[0] = startingBalance (default 0).
 * Full precision inside the loop; only the exposed value is rounded to 2 decimals.
 * Returns years*12 + 1 points (month 0 .. years*12).
 */
export function calculateProjection({
  monthlySaving,
  years,
  annualReturn = ASSUMED_ANNUAL_RETURN,
  startingBalance = 0,
}: ProjectionInput): ProjectionPoint[] {
  if (!Number.isFinite(monthlySaving) || monthlySaving < 0) throw new FinanceInputError("monthlySaving must be >= 0");
  if (!Number.isInteger(years) || years < 1) throw new FinanceInputError("years must be a positive integer");
  const monthlyRate = annualReturn / 12;
  const totalMonths = years * 12;
  const series: ProjectionPoint[] = [{ month: 0, balance: round2(startingBalance) }];
  let balance = startingBalance;
  for (let m = 1; m <= totalMonths; m++) {
    balance = balance * (1 + monthlyRate) + monthlySaving;
    series.push({ month: m, balance: round2(balance) });
  }
  return series;
}

export const finalBalance = (series: readonly ProjectionPoint[]): number => series[series.length - 1]?.balance ?? 0;
