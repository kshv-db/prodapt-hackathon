/**
 * Guardrails around the model. Pure functions, no I/O.
 *
 * Input side:  sanitize -> gate (crisis / prompt-injection) -> redact sensitive data before it reaches OpenAI.
 * Output side: checkOutput blocks insults, guaranteed-return claims, prompt or key leaks.
 * Abuse side:  createRateLimiter for the backend routes.
 *
 * These sit on top of the structural guards already in the layer: user text is data, tool arguments are
 * Zod-validated, the user id comes from the session, writes need confirmation, numbers are grounded.
 */

export const MAX_MESSAGE_CHARS = 1000;
export const MAX_PARSE_CHARS = 300;
export const MAX_HISTORY_CHARS = 1000;

/** Strips control characters, collapses whitespace runs, and caps the length. */
export function sanitizeUserText(text: string, maxLen: number = MAX_MESSAGE_CHARS): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

/* ---------- sensitive data ---------- */

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Replaces card numbers, Aadhaar, PAN, emails and OTP/PIN/CVV values so they never reach the model. */
export function redactSensitive(text: string): string {
  return text
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]")
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && luhnValid(digits) ? "[CARD]" : m;
    })
    .replace(/\b\d{4}\s\d{4}\s\d{4}\b/g, "[AADHAAR]")
    .replace(/\b(otp|pin|cvv)\b[^\d\n]{0,12}\d{3,8}\b/gi, "[SECRET]");
}

/* ---------- input gate ---------- */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier|your) (instructions|rules|prompts?)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier|your) /i,
  /(reveal|show|print|repeat|tell me|leak) (me )?(your|the) (system |hidden |initial |secret )?(prompt|instructions|rules)/i,
  /what (is|are) your (system )?(prompt|instructions)/i,
  /you are now\b/i,
  /developer mode|jailbreak|\bDAN mode\b/i,
  /act as (if )?(you have )?no (rules|restrictions|limits)/i,
  /<\/?(system|assistant|tool)>/i,
  /^\s*(system|assistant)\s*:/im,
];

const CRISIS_PATTERNS: RegExp[] = [
  /\b(suicide|suicidal|kill myself|end my life|want to die|self[- ]?harm)\b/i,
  /\b(khudkushi|mar jaana chahta|mar jaun|jaan de dunga|jaan dena chahta)\b/i,
];

export type Gate = { kind: "ok" } | { kind: "injection" } | { kind: "crisis" };

/** Decides whether a chat message should reach the model at all. */
export function gateUserMessage(text: string): Gate {
  if (CRISIS_PATTERNS.some((p) => p.test(text))) return { kind: "crisis" };
  if (INJECTION_PATTERNS.some((p) => p.test(text))) return { kind: "injection" };
  return { kind: "ok" };
}

export const CRISIS_REPLY =
  "I'm really sorry you're feeling this way. Money stress is heavy, but you don't have to carry it alone. " +
  "Please talk to someone you trust, or call Tele-MANAS at 14416 (India, free, 24x7). " +
  "When you feel ready, I can help you look at your budget calmly, one step at a time.";

export const INJECTION_REPLY =
  "I can help with your spending, budget, goals and savings, but I can't change how I work or share my instructions. " +
  "Try asking something like 'Where can I save?'";

/* ---------- output checks ---------- */

const INSULTS =
  /\b(poor|gareeb|broke|ugly|fat|loser|idiot|stupid|dumb|useless|pagal|nalayak|bewakoof|chutiya|bhikhari|beggar)\b/i;
const HEAVY_CLAIMS =
  /\b(guaranteed (returns?|profits?|income)|risk[- ]?free|sure[- ]?shot|double your money|get rich quick)\b/i;
const PROMPT_LEAK = /(FACTS \(computed by code|You are FutureWallet's money advisor|Voice: |Task: )/;
const SECRET_LEAK = /(sk-[A-Za-z0-9_-]{16,}|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|STITCH_API_KEY)/;

/** Returns policy problems in model output. Empty array means it may be shown. */
export function checkOutput(text: string): string[] {
  const problems: string[] = [];
  if (INSULTS.test(text)) problems.push("contains an insult or demeaning word; tease spending behaviour only");
  if (HEAVY_CLAIMS.test(text)) problems.push("makes a guaranteed-return or risk-free claim; give general guidance only");
  if (PROMPT_LEAK.test(text)) problems.push("repeats internal instructions");
  if (SECRET_LEAK.test(text)) problems.push("contains something that looks like a secret");
  return problems;
}

/* ---------- rate limiting (per process) ---------- */

/**
 * Sliding-window limiter. In-memory, so on serverless hosts each instance keeps its own count:
 * fine as a demo-time cost and abuse guard, not a hard quota. Key by user id.
 */
export function createRateLimiter(opts: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now: number = Date.now()): { ok: boolean; retryAfterMs: number } {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: opts.windowMs - (now - recent[0]) };
      }
      recent.push(now);
      hits.set(key, recent);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}
