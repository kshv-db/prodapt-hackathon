import { formatINR } from "@/lib/finance/money";

export { formatINR };

/** Compact Indian format used by the design: ₹3.5L, ₹1.2Cr. */
export function formatCompactINR(n: number): string {
  if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  return formatINR(n);
}

export const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Category styling from the design system's category colour table. */
export const CATEGORY_STYLE: Record<string, { icon: string; fg: string; bg: string; dot: string }> = {
  "Food & Dining": { icon: "restaurant", fg: "text-brand-coral", bg: "bg-brand-coralLight", dot: "bg-brand-coral" },
  Groceries: { icon: "shopping_cart", fg: "text-brand-emerald", bg: "bg-brand-mintBg", dot: "bg-brand-emerald" },
  Transport: { icon: "directions_subway", fg: "text-brand-sky", bg: "bg-brand-skyLight", dot: "bg-brand-sky" },
  Shopping: { icon: "shopping_bag", fg: "text-brand-violet", bg: "bg-brand-violetLight", dot: "bg-brand-violet" },
  "Bills & Utilities": { icon: "receipt_long", fg: "text-brand-orange", bg: "bg-brand-orangeLight", dot: "bg-brand-orange" },
  "Rent & EMI": { icon: "home", fg: "text-brand-orange", bg: "bg-brand-orangeLight", dot: "bg-brand-orange" },
  Entertainment: { icon: "movie", fg: "text-brand-amber", bg: "bg-brand-amberLight", dot: "bg-brand-amber" },
  Health: { icon: "favorite", fg: "text-brand-coral", bg: "bg-brand-coralLight", dot: "bg-brand-coral" },
  Education: { icon: "school", fg: "text-brand-sky", bg: "bg-brand-skyLight", dot: "bg-brand-sky" },
  Travel: { icon: "flight", fg: "text-brand-sky", bg: "bg-brand-skyLight", dot: "bg-brand-sky" },
  Subscriptions: { icon: "subscriptions", fg: "text-brand-violet", bg: "bg-brand-violetLight", dot: "bg-brand-violet" },
  Other: { icon: "category", fg: "text-[#6B7280]", bg: "bg-[#EEF1F5]", dot: "bg-[#6B7280]" },
};
export const styleFor = (c: string) => CATEGORY_STYLE[c] ?? CATEGORY_STYLE.Other!;

export const BAR_COLOR: Record<string, string> = {
  "text-brand-coral": "bg-brand-coral",
  "text-brand-violet": "bg-brand-violet",
  "text-brand-sky": "bg-brand-sky",
  "text-brand-amber": "bg-brand-amber",
  "text-brand-emerald": "bg-brand-emerald",
  "text-brand-orange": "bg-brand-orange",
  "text-[#6B7280]": "bg-[#6B7280]",
};
