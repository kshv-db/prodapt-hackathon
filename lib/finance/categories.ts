/** Single source of truth for expense categories (PRD section 7). */
export const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Shopping",
  "Bills & Utilities",
  "Rent & EMI",
  "Entertainment",
  "Health",
  "Education",
  "Travel",
  "Subscriptions",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

/** Categories treated as discretionary for impulse-control and goal cuts. */
export const DISCRETIONARY_CATEGORIES: readonly Category[] = [
  "Food & Dining",
  "Shopping",
  "Entertainment",
  "Travel",
  "Subscriptions",
];

export const isDiscretionary = (c: string): boolean => (DISCRETIONARY_CATEGORIES as readonly string[]).includes(c);

/** "Late night" window used by the impulse-control component: 23:00 up to (excluding) 04:00. */
export const LATE_NIGHT_FROM = "23:00";
export const LATE_NIGHT_UNTIL = "04:00";

export const isLateNight = (time: string | null | undefined): boolean => {
  if (!time) return false;
  const hhmm = time.slice(0, 5);
  return hhmm >= LATE_NIGHT_FROM || hhmm < LATE_NIGHT_UNTIL;
};

export const EXPENSE_SOURCES = ["manual", "nl", "csv", "seed"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const PERSONA_IDS = ["friendly", "roast", "coach"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
