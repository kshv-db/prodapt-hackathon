import { isValidISODate } from "@/lib/finance/dates";
import { round2 } from "@/lib/finance/money";

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF/LF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // always positive (spend)
}

export interface StatementParseResult {
  rows: StatementRow[];
  skipped: { line: number; reason: string }[];
}

export const MAX_STATEMENT_ROWS = 500;

/** Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day first, as used in India). */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (isValidISODate(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/[()₹\s,-]|rs\.?|inr/gi, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  // Debits may be signed either way in statements; we always keep the magnitude as spend.
  return round2(Math.abs(Number(s)));
}

const ALIASES = {
  date: ["date", "txn date", "transaction date", "value date"],
  description: ["description", "narration", "details", "particulars", "merchant"],
  amount: ["amount", "debit", "withdrawal", "withdrawal amt."],
} as const;

/** Parses a bank-statement CSV with columns date, description, amount (header row required). */
export function parseStatementCsv(text: string): StatementParseResult {
  const table = parseCsv(text);
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const idx = { date: col(ALIASES.date), description: col(ALIASES.description), amount: col(ALIASES.amount) };
  if (idx.date < 0 || idx.description < 0 || idx.amount < 0) {
    throw new Error("CSV must have columns: date, description, amount");
  }
  const rows: StatementRow[] = [];
  const skipped: StatementParseResult["skipped"] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const date = normalizeDate(cells[idx.date] ?? "");
    const amount = parseAmount(cells[idx.amount] ?? "");
    const description = (cells[idx.description] ?? "").trim();
    if (!date) return void skipped.push({ line, reason: "invalid date" });
    if (amount === null || amount <= 0) return void skipped.push({ line, reason: "invalid or zero amount" });
    if (!description) return void skipped.push({ line, reason: "missing description" });
    rows.push({ date, description, amount });
  });
  return { rows, skipped };
}
