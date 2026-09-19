import { tooManyRequests } from "@/lib/errors";

/**
 * Small in-memory sliding-window limiter to protect the OpenAI bill. Per server instance only
 * (best effort on serverless); the real quota guard is the OpenAI account limit.
 */
const hits = new Map<string, number[]>();

export const AI_RATE_LIMIT = { limit: 40, windowMs: 60_000 } as const;

export function enforceRateLimit(
  userId: string,
  bucket: string,
  { limit, windowMs }: { limit: number; windowMs: number } = AI_RATE_LIMIT,
  now = Date.now(),
): void {
  const key = `${bucket}:${userId}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    throw tooManyRequests();
  }
  recent.push(now);
  hits.set(key, recent);
}

export const resetRateLimits = () => hits.clear();
