# FutureWallet Agent: Features and Integration Guide

For the frontend and backend teams. Companion docs: `FutureWallet-PRD-v1.1.md`, `AI-Contract.md`.
Reference implementation of a client: `src/app/agent-lab/page.tsx`. Agent code: `src/lib/ai/`.

---

## 1. What the agent is

A tool-calling money advisor. **The LLM reasons**: it reads the user's message and computed facts, decides which tools to call, and writes the reply in the user's language and chosen persona. **Code enforces**: every number comes from code, every write is validated, and risky writes need the user's confirmation.

| The LLM decides | Code decides |
|---|---|
| Which tool to call and in what order | All figures (spend, budgets, projections, what-if, savings amounts) |
| What to say, in which language and persona | Whether a write runs (validation, confirm, undo, caps) |
| How to phrase advice and nudges | Which nudges are worth sending (triggers) |
| Reading messy input ("kal Zomato pe 450") | Rejecting invented figures, insults, prompt leaks, injection, crisis handling |

Model: OpenAI API, configured by env vars (currently `gpt-5.4-mini`; `gpt-4.1-mini` is the fallback).

---

## 2. Features

| Capability | Example the user types | What happens |
|---|---|---|
| Log expenses (Hinglish ok) | "kal Zomato pe 450 aur aaj chai pe 40 diye" | One `add_expense` per item, saved immediately, **Undo** button per expense |
| Change a budget limit | "Food ka budget 6000 kar do" | **Confirm card** (shows old to new), applies only after Confirm |
| Generate a budget | "mera is mahine ka budget banao" | Confirm card with the proposed budget; code enforces income, fixed costs and a savings line |
| Create a goal / add money | "Laptop ka goal bana, 60k, March tak" | Confirm card |
| Delete an expense | "mera last Zomato wala expense delete kar do" | Agent looks up the id first, then a Confirm card |
| What-if / pre-spend check | "agar main 2500 ki EMI 12 mahine ke liye lu to?" | Computed impact on monthly saving and goal dates |
| Where can I save | "Where can I save?" | Up to 3 computed cuts with the saving each gives |
| Future You | "agar main 5000 bachaun to 5 saal baad?" | Projection chart plus a first-person message from the future self; states the return rate is an assumption |
| Spending questions | "mera Food ka kharcha kaisa chal raha hai?" | Reads computed summary, budget status, goals |
| Recent expenses | "show my recent expenses" | Newest first |
| Switch personality | "roast mode on kar do" | Friendly / Roast / Coach |
| Proactive nudges | (none: the agent speaks first) | `GET /api/nudges`: budget at 80%, late-night orders, goal off track, Monday recap |
| Trust panel | (under answers) | "Where these numbers came from" list |
| Mascot moods | (automatic) | thinking, happy, worried, smirk |

Personas: **Friendly** (warm), **Roast** (teases spending behaviour only, always ends with an action; switches to friendly if spending exceeds income), **Coach** (direct, no jokes).

Not covered by the agent: CSV file upload (use `POST /api/expenses/import`), voice (frontend: browser speech-to-text, then send the text to the same endpoint), sign-in.

---

## 3. Endpoints

| Method and path | Purpose | Body | Response |
|---|---|---|---|
| `POST /api/agent/chat` | Talk to the agent | `{ "message": string (1-1000 chars) }` | Server-sent events (section 4) |
| `POST /api/agent/confirm` | Apply or cancel a proposed action | `{ "actionId": string, "decision": "confirm" \| "cancel" }` | `{ ok, message }` |
| `DELETE /api/expenses/:id` | Undo an agent-saved expense | none | `{ ok: true }` |
| `GET /api/nudges` | Proactive messages | none | `{ nudges: [{ id, kind, text, facts: [{label, value}] }] }` |
| `PUT /api/profile` | Change persona (or use the `set_persona` tool) | `{ "persona": "friendly" \| "roast" \| "coach" }` | `{ profile }` |
| `POST /api/demo/seed` | Load demo data (6 months, budget, goals) | none | `{ ok, expenses, months }` |

Errors are always `{ "error": "message" }` with a status code. `409 Complete onboarding first.` means no profile exists yet.

---

## 4. Event stream (`POST /api/agent/chat`)

Each event is one JSON object on a `data:` line, separated by a blank line.

```ts
type AgentEvent =
  | { type: "step";    id: string; tool: string; label: string; status: "running" | "done" | "error" }
  | { type: "token";   text: string }
  | { type: "confirm"; actionId: string; tool: string; summary: string; args: Record<string, unknown> }
  | { type: "undo";    expenseId: string; label: string }
  | { type: "ui";      component: "future_chart" | "spending_chart"; props: Record<string, unknown> }
  | { type: "sources"; facts: { label: string; value: string }[] }
  | { type: "mood";    mood: "idle" | "thinking" | "happy" | "worried" | "smirk" | "celebrating" }
  | { type: "done" }
  | { type: "error";   message: string };
```

| Event | UI to build |
|---|---|
| `step` | Step chip. Show a spinner while `running`, a tick on `done`, a cross on `error`. The same `id` arrives twice (running then done): update in place |
| `token` | Append to the assistant bubble |
| `confirm` | Confirm card with `summary` and two buttons. Buttons call `/api/agent/confirm` |
| `undo` | Small "Saved X · Undo" row. Undo calls `DELETE /api/expenses/:id` |
| `ui` (`future_chart`) | Render the chart inline. `props` is `{ years, annualReturnPct, current: {monthlySaving, endBalance}, chosen: {...}, difference, goal? }` |
| `sources` | Collapsible "Where these numbers came from" |
| `mood` | Mascot state |
| `error` | Inline error under the bubble; then `done` |
| `done` | Stop the loading state |

Behaviour to design for:
- **Steps stream live** as tools run. **Tokens arrive after the tool work is finished**, in a burst of small chunks (the reply is checked before it is shown), so use a typewriter effect rather than expecting word-by-word streaming.
- Measured latency with the real model: about 2 to 4 seconds per turn, up to about 5 seconds when a budget is generated.
- `sources` is only sent when a tool ran. A reply written purely from the fact sheet has no `sources` event.
- `future_chart` props carry end balances only, not a monthly series. For a line chart, call `POST /api/future` for the series, or compute it: `balance[m] = balance[m-1] * (1 + 0.07/12) + monthlySaving`.
- Canned replies (injection or crisis) also arrive as `mood`, `token`, `done`, with no steps.

---

## 5. Frontend: step by step

1. **Read the reference client.** `src/app/agent-lab/page.tsx` already handles every event. Copy its patterns rather than starting cold.
2. **Import types only.** Use `import type { AgentEvent, ProjectionFacts } from "@/lib/ai/types"`. Never import runtime code from `@/lib/ai` in a client component (it would pull the OpenAI client into the browser bundle).
3. **Add one SSE helper** and reuse it for every chat window:

   ```ts
   import type { AgentEvent } from "@/lib/ai/types";

   export async function streamAgent(message: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal) {
     const res = await fetch("/api/agent/chat", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ message }),
       signal,
     });
     if (!res.ok || !res.body) {
       const j = (await res.json().catch(() => ({}))) as { error?: string };
       throw new Error(j.error ?? `HTTP ${res.status}`);
     }
     const reader = res.body.getReader();
     const decoder = new TextDecoder();
     let buffer = "";
     for (;;) {
       const { value, done } = await reader.read();
       if (done) break;
       buffer += decoder.decode(value, { stream: true });
       let end: number;
       while ((end = buffer.indexOf("\n\n")) >= 0) {
         const line = buffer.slice(0, end).split("\n").find((l) => l.startsWith("data: "));
         buffer = buffer.slice(end + 2);
         if (line) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
       }
     }
   }
   ```

   Note: use `fetch` with a stream reader, not `EventSource`, because the endpoint is a `POST`.
4. **Model one assistant turn** as an object that collects `steps`, `confirms`, `undos`, `charts`, `sources`, `mood`, `text` and `error`, and update it as events arrive (see `apply()` in agent-lab).
5. **Confirm card.** On Confirm or Cancel call `POST /api/agent/confirm { actionId, decision }`. Show the returned `message`. An action can be handled once; a second call returns `404` ("already handled or expired"), so disable the buttons after the first click.
6. **Undo.** `DELETE /api/expenses/:id`. Disable the row after success.
7. **Nudges.** Call `GET /api/nudges` when the dashboard or agent opens and after each chat turn. Show them as cards; dismissal can be client-side for now.
8. **Persona switch.** `PUT /api/profile { persona }`, or let the user say it in chat.
9. **Mascot.** Map `mood` to the orb states from the Stitch prompts. `thinking` while a request is open.
10. **Empty and error states.** No profile (`409`): show a "Load demo data" or onboarding prompt. Network or `error` event: show a retry. Keep the input disabled while a turn is running.
11. **Reuse the same component** in any place that needs a chat window (full Agent screen, floating orb, voice button). Only the wrapper changes; the endpoint and events are identical.
12. **Voice (optional).** Use the browser Web Speech API for speech-to-text (en-IN / hi-IN), then call the same `streamAgent` with the transcript.

Quick prompts to put on the empty state: "Where can I save?", "Summarize this month", "kal Zomato pe 450 diye", "Food ka budget 6000 kar do", "Agar main 5000 bachaun to 5 saal baad?".

---

## 6. Backend: step by step

Most of this already exists. This is what to check and what is still open.

**Already in the repo**
- `src/app/api/agent/chat/route.ts`: session, fact sheet, history, runs the agent, streams events, saves chat history.
- `src/app/api/agent/confirm/route.ts`: applies a pending action once, only for its owner.
- `src/lib/services/context.ts`: `loadContext` and `buildFactSheet` (the computed facts the LLM reads).
- `src/lib/services/tools.ts`: `createToolExecutors(repo, today)` (all reads and writes) and `applyPendingAction`.
- `src/lib/services/nudges.ts` and `src/app/api/nudges/route.ts`.

**Steps**
1. **Environment.** Set `OPENAI_API_KEY`, `OPENAI_MODEL_MID`, `OPENAI_MODEL_FAST` in `.env.local` (server only). **Remove `AI_MOCK=1`** so the real LLM is used. Restart the dev server after changing env. Never commit `.env*` and never put the key in chat.
2. **Session.** `requireUser()` gives `{ userId, repo }`. The user id must always come from the session, never from the request body or the model. Keep it that way when auth is added.
3. **Fact sheet.** `buildFactSheet` is the single source of figures for the LLM. If you add a data source (for example a new category or a goal field), add it to the fact sheet and to `FactSheet` in `src/lib/ai/types.ts`, or the agent will say the data is missing.
4. **Tool executors.** Each method in `ToolExecutors` (`src/lib/ai/types.ts`) must return computed numbers, not free text. Writes go through the same validation as the normal routes.
5. **Pending actions.** Budget, goal and delete changes are stored with `repo.savePendingAction` and applied by `applyPendingAction` after Confirm. `generate_budget` stores server-built lines (never model-supplied ones). Make sure the pending table exists and is scoped to the user.
6. **Persistence of chat.** History (last 10 turns) is read with `repo.listChat` and saved after each turn. Keep it.
7. **Repo interface.** The agent only talks to `Repo` (`src/lib/db/types.ts`). Any database (in-memory now, Supabase later) works as long as it implements that interface.
8. **Rate limiting (open).** `createRateLimiter` exists in `src/lib/ai/guardrails.ts` but is **not wired into the route yet**. Add it at the top of `/api/agent/chat`, keyed by user id, for example 20 requests per minute. It is in-memory per server instance.
9. **Pending action expiry (open).** The contract says 10 minutes; the in-memory repo does not enforce it yet.
10. **Language (open).** `buildFactSheet` sets `profile.language` to `"en"`. The agent already replies in the language the user writes, but store a real preference if you want it consistent.
11. **Nudge phrasing.** `/api/nudges` asks the LLM to phrase each nudge, and falls back to the code-built sentence if the model is unavailable.

---

## 7. Configuration

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI access. Server only. Never logged. |
| `OPENAI_MODEL_MID` | Agent, budget, insight, Future You narrative |
| `OPENAI_MODEL_FAST` | Expense parsing, CSV categorising |
| `AI_TIMEOUT_MS` | Per-request timeout (default 15000) |
| `AI_MOCK` | `1` returns scripted canned replies. **For development without a key only; leave it unset in real use** |

---

## 8. How to test

| What | Command | Needs key |
|---|---|---|
| All unit tests (mock, no network) | `npm test` | No |
| Type check | `npx tsc --noEmit` | No |
| Parser eval, 20 phrases, real model | `AI_MOCK=0 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/ai/parser.eval.test.ts --silent=false` | Yes |
| Live agent tests, real model | `AI_MOCK=0 node --env-file=.env.local node_modules/vitest/vitest.mjs run src/lib/services/agent.live.test.ts --silent=false` | Yes |
| Manual | Open `/agent-lab`, click "Load demo data", use the quick prompts | Real model if `AI_MOCK` is unset |

Results so far with `gpt-5.4-mini`:
- Parser eval: **19 of 20** (target 18). The miss classified "train ticket" as Transport instead of Travel.
- Live agent tests: 11 of 11 passed (expenses, confirm-before-write, what-if, savings, Future You, delete via confirm, generated budget, persona switch, injection refusal, "data is missing" answer). A 12th test (Future You as first-person, 45 to 110 words) passed on its own after a prompt change. The full live file was not re-run afterwards.
- Not yet tested with the real model: insight card, `/api/future` narrative, `/api/whatif` explanation, nudge phrasing, CSV categorising. They fall back to safe text if the model fails.
- `/agent-lab` compiles and its API calls were verified with curl, but the page itself was not clicked through in a browser.

---

## 9. Guardrails (already on)

- User text is data. Prompt-injection phrases and crisis language get a canned reply with no model or tool call (Tele-MANAS 14416: verify the number before the demo).
- Card, Aadhaar, PAN, email and OTP/PIN values are redacted before reaching OpenAI.
- Every significant number in a reply must appear in the fact sheet or a tool result of that turn; otherwise one rewrite, then a safe fallback.
- Insults, guaranteed-return claims and prompt or key leaks in a reply are blocked.
- Tool arguments are validated; the user id is never a tool argument; at most 5 expenses are saved per message; budget, goal and delete changes are only proposed until the user confirms.

Limits: injection detection is pattern-based, so treat the structural guards (validation, confirm, session user id) as the real protection. This is general budgeting guidance, not regulated financial advice.

---

## 10. Handoff checklist

**Frontend**
- [ ] `streamAgent` helper and one reusable chat component
- [ ] Step chips, confirm cards, undo rows, inline Future You chart, sources panel, mascot
- [ ] Nudge cards on dashboard and agent screen
- [ ] Empty (no profile) and error states
- [ ] Quick prompts; persona switch; optional voice

**Backend**
- [ ] `.env.local` set, `AI_MOCK` removed, server restarted
- [ ] Rate limiter wired into `/api/agent/chat`
- [ ] Pending action table and expiry
- [ ] Fact sheet includes any new data; `language` handled
- [ ] Session user id enforced on every route

**Both**
- [ ] Run the live tests once on the shared environment
- [ ] Rotate any key or password that was pasted in chat
