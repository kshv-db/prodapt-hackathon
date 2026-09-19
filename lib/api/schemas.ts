import { z } from "zod";
import { CATEGORIES, EXPENSE_SOURCES, PERSONA_IDS } from "@/lib/finance/categories";
import { isValidISODate, isValidMonth } from "@/lib/finance/dates";
import { round2 } from "@/lib/finance/money";
import { MAX_MONTHLY_SAVING, MAX_PROJECTION_YEARS } from "@/lib/finance/projection";

/** Upper bound (INR) on any single money input: sanity guard, not a business rule. */
export const MAX_MONEY = 100_000_000;

export const isoDate = z.string().refine(isValidISODate, "must be a valid date (YYYY-MM-DD)");
export const monthString = z.string().refine(isValidMonth, "must be a valid month (YYYY-MM)");
export const category = z.enum(CATEGORIES, { error: "must be one of the supported categories" });
export const persona = z.enum(PERSONA_IDS, { error: "must be one of: friendly, roast, coach" });

const money = z.number().finite().max(MAX_MONEY).transform(round2);
export const positiveMoney = money.refine((v) => v > 0, "must be greater than 0");
export const nonNegativeMoney = money.refine((v) => v >= 0, "must be 0 or more");

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "must be HH:MM");

export const parseExpenseBody = z.object({
  text: z.string().trim().min(1).max(300),
  today: isoDate,
});

export const createExpenseBody = z.object({
  amount: positiveMoney,
  category,
  merchant: z.string().trim().max(80),
  spent_on: isoDate,
  note: z.string().trim().max(200).optional(),
  /** Optional additive field (HH:MM); powers late-night impulse detection. */
  spent_at: timeOfDay.optional(),
  source: z.enum(EXPENSE_SOURCES, { error: "must be one of: manual, nl, csv, seed" }),
});

export const monthQuery = z.object({ month: monthString.optional() });

export const fixedCost = z.object({
  name: z.string().trim().min(1).max(60),
  amount: nonNegativeMoney,
  category: category.optional(),
});

export const generateBudgetBody = z.object({
  income: nonNegativeMoney,
  fixedCosts: z.array(fixedCost).max(30),
});

export const putBudgetsBody = z.object({
  month: monthString.optional(),
  budgets: z
    .array(
      z.object({
        category,
        limit: nonNegativeMoney,
        reason: z.string().trim().max(300).nullish(),
      }),
    )
    .max(CATEGORIES.length),
});

export const createGoalBody = z.object({
  title: z.string().trim().min(1).max(100),
  target: positiveMoney,
  deadline: isoDate,
});

export const contributeBody = z.object({ amount: positiveMoney });

export const futureBody = z.object({
  monthlySaving: z.number().finite().min(0).max(MAX_MONTHLY_SAVING),
  years: z.number().int().min(1).max(MAX_PROJECTION_YEARS),
});

export const whatIfBody = z.object({
  description: z.string().trim().min(1).max(200),
  monthlyCost: positiveMoney,
  months: z.number().int().min(1).max(120),
});

export const chatBody = z.object({ message: z.string().trim().min(1).max(1000) });

export const profileBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    income: nonNegativeMoney.optional(),
    fixedCosts: z.array(fixedCost).max(30).optional(),
    persona: persona.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "provide at least one field to update");

export const uuid = z.string().uuid("invalid id");
