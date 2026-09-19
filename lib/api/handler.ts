import { ZodError, type ZodType } from "zod";
import { AppError, badRequest } from "@/lib/errors";
import { FinanceInputError } from "@/lib/finance/errors";
import { resolveContext } from "./auth";
import type { Store } from "@/lib/server/store";

export interface ApiContext {
  req: Request;
  url: URL;
  userId: string;
  store: Store;
  params: Record<string, string>;
}

type Handler = (ctx: ApiContext) => Promise<Response | unknown>;
type RouteContext = { params?: Promise<Record<string, string>> };

const NO_STORE = { "Cache-Control": "no-store" };

export const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: NO_STORE });

export const errorResponse = (status: number, message: string): Response => json({ error: message }, status);

function formatZod(err: ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input";
  const where = issue.path.join(".");
  return where ? `${where}: ${issue.message}` : issue.message;
}

/** Central error mapping: predictable `{ error }` bodies, no stack traces or internals leaked. */
export function toErrorResponse(err: unknown, req: Request): Response {
  if (err instanceof AppError) return errorResponse(err.status, err.message);
  if (err instanceof FinanceInputError) return errorResponse(400, err.message);
  if (err instanceof ZodError) return errorResponse(400, formatZod(err));
  // Log the error class/message only (never request bodies: they contain financial data).
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[api] ${req.method} ${new URL(req.url).pathname} unexpected ${e.name}: ${e.message}`);
  return errorResponse(500, "Internal server error");
}

/** Wraps a route: authenticates, builds the per-user store, maps every failure to `{ error }`. */
export function apiRoute(handler: Handler) {
  return async (req: Request, routeCtx?: RouteContext): Promise<Response> => {
    try {
      const { userId, store } = await resolveContext(req);
      const params = routeCtx?.params ? await routeCtx.params : {};
      const result = await handler({ req, url: new URL(req.url), userId, store, params });
      return result instanceof Response ? result : json(result);
    } catch (err) {
      return toErrorResponse(err, req);
    }
  };
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function readQuery<T>(url: URL, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}
