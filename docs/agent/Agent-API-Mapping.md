# FutureWallet Agent: API Mapping for Integration Review

Purpose: show exactly how the agent interaction layer sits on top of the existing PRD `/api` contract, before the backend PR and frontend work are integrated.

**Scope statement**
- The PRD API contract, the backend architecture and the canonical `feature/db` database implementation are **not redesigned, replaced, merged or modified** by this work.
- The current implementation is left intact. This document only describes it and lists open points for the review.
- Nothing has been pushed or committed anywhere. All work is local.
- Companion docs: `Agent-Integration-Guide.md` (how to use), `AI-Contract.md` (types and schemas), `FutureWallet-PRD-v1.1.md`.

Where things live (local app `budget-advisor`):
- Agent module (modular, no DB access of its own): `src/lib/ai/` (`agent.ts`, `guardrails.ts`, `tasks.ts`, `types.ts`, and others)
- Glue that gives the agent its data: `src/lib/services/tools.ts`, `src/lib/services/context.ts`
- HTTP entry points: `src/app/api/agent/chat`, `src/app/api/agent/confirm`, `src/app/api/nudges`, `src/app/api/agent/status`

---

## 1. What `streamAgent()` sends to the backend

`streamAgent()` is the client helper specified in the integration guide. It is **not yet a shared file**: the same logic exists inline in `src/components/AdvisorChat.tsx` (frontend team) and `src/app/agent-lab/page.tsx` (dev console). Both send the same request.

```
POST /api/agent/chat
Content-Type: application/json
Cookie: <Supabase session cookie, when Supabase auth is on>

{ "message": "kal Zomato pe 450 diye" }
```

| Field | Rule |
|---|---|
| `message` | string, trimmed, 1 to 1000 characters (route validation). Empty gives `400 { error }` |

Nothing else is sent. In particular:
- **No user id.** The server takes it from the session (`requireUser()`).
- **No history.** The server loads the last 10 turns from `chat_messages` and saves the new turn.
- **No facts or figures.** The server builds the fact sheet from the database and computed finance code.

Response: `200`, `Content-Type: text/event-stream`, a stream of `data: <json>\n\n` events (section 2). Failures before the stream starts return JSON `{ "error": string }` with status `400` (bad body), `401` (`Sign in required.`), `409` (`Complete onboarding first.`) or `500`.

Related client calls made by the same UI:

| Call | When |
|---|---|
| `POST /api/agent/confirm` `{ actionId, decision: "confirm" \| "cancel" }` | User taps a confirm card |
| `DELETE /api/expenses/:id` | User taps Undo on an agent-saved expense |
| `GET /api/nudges` | Dashboard or agent screen opens |
| `GET /api/agent/status` | Dev console only: shows real or mock mode |

---

## 2. Event types and payloads

Defined in `src/lib/ai/types.ts` (import as a **type only** in client code).

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

| Event | Meaning | Notes |
|---|---|---|
| `step` | A tool started, finished or failed | Same `id` twice (running, then done or error) |
| `token` | A chunk of the reply text | Chunks arrive **after** tool work and after the reply has passed the number and safety checks, so expect a burst, not word-by-word streaming |
| `confirm` | A change was **proposed**, nothing has been written | `actionId` is used with `/api/agent/confirm`. `args` is `{}` for `generate_budget` (the lines are stored server-side) |
| `undo` | An expense was saved | `expenseId` is used with `DELETE /api/expenses/:id` |
| `ui` | Inline component data | Only `future_chart` is emitted today. `props` is the projection facts: `{ years, annualReturnPct, current: { monthlySaving, endBalance }, chosen: { ... }, difference, goal? }` (end balances only, no monthly series) |
| `sources` | Figures used, for the trust panel | Only sent when at least one tool ran |
| `mood` | Mascot state | `thinking` first, then a final mood |
| `error` | The turn failed | Followed by `done` |
| `done` | Stream finished | Always the last event |

Canned replies (prompt-injection or crisis messages) are `mood`, `token`, `done` only, with no model call and no tools.

---

## 3. Which existing PRD endpoint each action ultimately uses

The agent has **no database access of its own**. The tool executors in `src/lib/services/tools.ts` use the same `Repo` interface and the same service functions (`context.ts`, `budget.ts`, `future.ts`, `finance/*`) that the PRD routes use. They call these **in-process**, not over HTTP.

| Agent tool | Kind | Data operation today | Equivalent PRD endpoint |
|---|---|---|---|
| `add_expense` | write, immediate | `repo.addExpenses` | `POST /api/expenses` |
| `update_budget` | write, confirm | `writeBudget` (same as the route) | `PUT /api/budgets` |
| `generate_budget` | write, confirm | `proposeBudget` + `normalizeBudget`, applied with `writeBudget` | `POST /api/budget/generate` then `PUT /api/budgets` |
| `create_goal` | write, confirm | `repo.createGoal` | `POST /api/goals` |
| `contribute_to_goal` | write, confirm | `repo.contribute` | `POST /api/goals/:id/contribute` |
| `delete_expense` | write, confirm | `repo.deleteExpense` | `DELETE /api/expenses/:id` |
| `set_persona` | write, immediate | `repo.upsertProfile` | `PUT /api/profile` |
| `get_spending_summary` | read | `buildSummary` | `GET /api/summary` |
| `get_budget_status` | read | `budgetUsage` | `GET /api/budgets` |
| `get_goals` | read | `goalPlans` | `GET /api/goals` (and `/goals/:id/plan`) |
| `list_recent_expenses` | read | `repo.listExpenses` | `GET /api/expenses` |
| `run_projection` | read | `computeFuture` | `POST /api/future` |
| `run_what_if` | read | `whatIf` (finance) | `POST /api/whatif` |
| `suggest_savings` | read | computed in `tools.ts` from the month's spending | **No PRD endpoint** (derived capability) |

Other agent-related endpoints and what they use:

| Endpoint | Data operation |
|---|---|
| `POST /api/agent/chat` | reads `profiles`, `expenses`, `budgets`, `goals` and last 10 `chat_messages`; inserts the user and assistant turns into `chat_messages` |
| `POST /api/agent/confirm` | takes one row from pending actions, then applies it through the same functions as the table above |
| `GET /api/nudges` | read only; persists nothing |

---

## 4. Which actions require confirmation before a database change

| Requires confirmation (proposed only, applied by `/api/agent/confirm`) | Runs immediately | Read only |
|---|---|---|
| `update_budget` | `add_expense` (with Undo) | `get_spending_summary` |
| `generate_budget` | `set_persona` (no undo, no data at risk) | `get_budget_status` |
| `create_goal` | | `get_goals` |
| `contribute_to_goal` | | `list_recent_expenses` |
| `delete_expense` | | `run_projection`, `run_what_if`, `suggest_savings` |

How confirmation works:
1. The model calls a proposal tool. The executor validates the arguments and **stores a pending action** (`tool`, `args`, `summary`, owner). No business table is changed.
2. The stream emits a `confirm` event carrying `actionId` and a plain-language `summary`.
3. The user taps Confirm or Cancel. The client calls `POST /api/agent/confirm { actionId, decision }`.
4. The server takes the pending row once, only for the session user (a second call returns `404`), **validates again** and applies it. Cancel just discards it.
5. `generate_budget` lines are built and stored by the server. The model never supplies them.

Other guards: tool arguments are Zod-validated, `userId` is never a tool argument, unknown tools are rejected, and at most 5 expenses can be saved per message.

---

## 5. How undo works

- Only `add_expense` is undoable. Each saved expense emits an `undo` event with its `expenseId`.
- **Undo = `DELETE /api/expenses/:id`**, the existing PRD endpoint. It removes exactly that row (`404` if already gone). The canonical RLS on `expenses` already allows delete.
- Confirmed actions (budget, goal, delete) have **no undo**: the confirm card is the safeguard.
- `set_persona` has no undo; the user just switches back.

---

## 6. New endpoints and database changes introduced

**New endpoints from the AI-layer work**

| Endpoint | Status |
|---|---|
| `GET /api/nudges` | Listed in PRD v1.1. Implemented here. `POST /api/nudges/:id/dismiss` from the PRD is **not** implemented (dismissal is client-side) |
| `GET /api/agent/status` | **Not in the PRD.** Diagnostic only: `{ mock, keyConfigured, model }`. No secrets. Can be removed without side effects |

`POST /api/agent/chat` and `POST /api/agent/confirm` are listed in PRD v1.1. Their routes pre-date this AI-layer work and were not changed by it.

**Database changes introduced by the AI-layer work: none.** No migrations, no schema edits, nothing in `feature/db` touched.

**Database points the review must resolve (found while mapping, not caused by the agent code)**

| # | Finding | Why it matters |
|---|---|---|
| D1 | The confirm flow needs somewhere to store pending actions. The local app's `supabase/migrations/0001_init.sql` and `src/lib/db/supabase.ts` use a `pending_actions` table. **The canonical `feature/db` migrations have no `pending_actions` table** (six tables only) | With the canonical schema, confirm cannot persist. Options in section 9 |
| D2 | `profiles.fixed_costs`: canonical docs describe `[{ "label", "amount" }]`. The app stores `[{ "name", "category", "amount" }]` | The budget generator and the FactSheet read fixed costs. Shapes must agree |
| D3 | PRD v1.1 mentions `expenses.source = 'agent'`. Canonical DB allows `manual, nl, csv, seed` only | The agent uses `nl`, which is valid. The PRD text should be corrected |
| D4 | The canonical `feature/db` Python folders are empty stubs and `docs/database.md` itself flags the Next.js vs Python mismatch | The agent is written for the Next.js route handlers the PRD specifies |

---

## 7. Frontend files and components that consume this

| File | Role | State today |
|---|---|---|
| `src/components/AdvisorChat.tsx` (frontend team) | The product chat window | Already calls `POST /api/agent/chat`, `POST /api/agent/confirm`, `DELETE /api/expenses/:id`. Handles `token`, `step`, `confirm`, `undo`, `sources`, `error`. **Ignores `ui` and `mood`** |
| `src/app/agent-lab/page.tsx` (dev console) | Reference client that renders every event | Complete for testing. Delete when the designed screens replace it |
| Dashboard and Advisor screens | Should show nudges | **Nobody consumes `GET /api/nudges` yet** except the dev console |
| Future You chart component | Should render `ui: future_chart` | Not wired: the event is currently ignored |
| `src/lib/ai/types.ts` | Shared event and fact types | Import **type-only** from client code (never runtime code from `@/lib/ai`) |

Gaps in `AdvisorChat.tsx` against the event contract:
- It stores **one** `confirm` and **one** `undo` per assistant message. The agent can emit several (for example two `undo` events for "Zomato aur chai"), so earlier ones are overwritten and cannot be undone from the UI.
- Its local `confirm` type omits `tool` and `args` (not needed to render, but useful for labels).
- `ui` (`future_chart`) and `mood` are not rendered.

---

## 8. Other discrepancies found between the agent path and the PRD routes

| # | Discrepancy | Impact |
|---|---|---|
| R1 | `POST /api/expenses` sets `spent_at` to the current time for today's expenses. The agent's `add_expense` saves `spent_at: null` | Expenses logged through the agent are invisible to late-night (impulse) detection and the health score component |
| R2 | Validation is duplicated: the routes and the agent executors each validate (date check, positive amount, future deadline). They match today | Drift risk if one side changes |
| R3 | `set_persona` does not require `income > 0`, while `PUT /api/profile` does | Edge case only |
| R4 | `FactSheet.profile.language` is hardcoded to `"en"` in `context.ts` | The agent still replies in the user's language; this only affects consistency |
| R5 | Pending actions have no expiry in the in-memory repo (the contract says 10 minutes) | Stale confirm cards stay valid |
| R6 | The rate limiter exists (`createRateLimiter`) but is not wired into `/api/agent/chat` | No per-user request cap yet |

---

## 9. Options for the integration review (nothing implemented)

These are decisions, not changes made.

**Making the agent call the existing endpoints' logic instead of duplicating it (R2, R1)**
- **Option A, keep in-process (current):** executors keep calling the shared `Repo` and services. Fix R1 by passing the same `spent_at` logic the route uses.
- **Option B, extract shared handlers:** move each route's core into a service function (for example `createExpense(repo, userId, input)`) that both the route and the agent executor call. One validation path, no HTTP loopback.
- **Option C, HTTP loopback:** the executor calls the real `/api/*` routes. Strictest "on top of the endpoints" but adds latency and cookie forwarding.

**Confirmation without a new table (D1)**
- **Option 1, add `pending_actions` to the canonical migrations:** the DB owner decides. Scoped by `user_id`, RLS like the other tables.
- **Option 2, stateless confirm:** the `confirm` event already carries `tool` and `args`. On Confirm, the client calls the **existing** endpoint directly (`PUT /api/budgets`, `POST /api/goals`, `POST /api/goals/:id/contribute`, `DELETE /api/expenses/:id`). No pending table and no `/api/agent/confirm`. The routes re-validate. For `generate_budget`, `args` would need to carry the proposed lines. Trade-off: the server no longer proves the action came from the agent.

Recommendation for the review: Option B plus Option 2 gives the smallest surface (no parallel data path, no new table), but it is a change to existing files, so it waits for the review.

---

## 10. Checklist for the review

- [ ] Decide Option A, B or C for reuse of route logic
- [ ] Decide Option 1 or 2 for confirmation storage (D1)
- [ ] Align `fixed_costs` shape (D2)
- [ ] Fix R1 (`spent_at`) in whichever option is chosen
- [ ] `AdvisorChat.tsx`: support multiple confirm/undo per message, render `ui` and `mood`
- [ ] Add a nudge component on the dashboard/agent screen
- [ ] Wire the rate limiter, pending-action expiry, and language
- [ ] Correct PRD v1.1 `source: 'agent'` to `nl`
