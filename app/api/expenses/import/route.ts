import { categorizeRows } from "@/lib/ai/categorizer";
import { apiRoute } from "@/lib/api/handler";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { MAX_STATEMENT_ROWS, parseStatementCsv } from "@/lib/csv";
import { badRequest } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000_000;
/** Below this the row is flagged for the user's review before import. */
export const REVIEW_CONFIDENCE = 0.7;

/**
 * multipart/form-data with a CSV in field `file` (columns: date, description, amount).
 * Returns categorized rows for REVIEW; nothing is saved here. The client saves confirmed rows
 * through POST /api/expenses with source "csv".
 */
export const POST = apiRoute(async ({ req, userId }) => {
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    throw badRequest("Send the CSV as multipart/form-data in the 'file' field");
  }
  if (!(file instanceof File)) throw badRequest("Missing CSV file in the 'file' field");
  if (file.size > MAX_BYTES) throw badRequest("CSV file is too large (max 1 MB)");

  let parsed;
  try {
    parsed = parseStatementCsv(await file.text());
  } catch (e) {
    throw badRequest((e as Error).message);
  }
  if (parsed.rows.length === 0) throw badRequest("No valid rows found in the CSV");
  if (parsed.rows.length > MAX_STATEMENT_ROWS) throw badRequest(`Too many rows (max ${MAX_STATEMENT_ROWS} per import)`);

  enforceRateLimit(userId, "ai");
  const categorized = await categorizeRows(parsed.rows.map((r) => ({ description: r.description, amount: r.amount })));
  return {
    rows: parsed.rows.map((row, i) => {
      const c = categorized[i] ?? { category: "Other" as const, confidence: 0 };
      return { ...row, category: c.category, confidence: c.confidence, needs_review: c.confidence < REVIEW_CONFIDENCE };
    }),
    skipped: parsed.skipped,
  };
});
