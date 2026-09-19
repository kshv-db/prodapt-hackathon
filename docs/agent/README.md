# FutureWallet agent: `feature/ai`

The AI layer (tool-calling advisor agent, guardrails, structured tasks) and its documentation.
**Not for merge yet.** It waits for the integration review with the backend PR and frontend work.
Nothing here changes the PRD API contract, the backend architecture, or `feature/db`.

## What is on this branch

| Path | Contents |
|---|---|
| `src/lib/ai/` | The agent module: `agent.ts` (tool loop, events), `guardrails.ts`, `grounding.ts`, `validate.ts`, `tasks.ts` (parse, budget, insight, narrative, nudge), `personas.ts`, `mock.ts`, `types.ts`, `index.ts`, plus its unit tests and the 20-phrase parser eval set |
| `docs/agent/AI-Contract.md` | Types, function signatures, tool schemas, event format, guardrails |
| `docs/agent/Agent-Integration-Guide.md` | Features and step-by-step guide for the frontend and backend teams |
| `docs/agent/Agent-API-Mapping.md` | Exactly how the agent maps onto the existing PRD `/api` endpoints, what needs confirmation, how undo works, and open points for the review |

## What is deliberately not on this branch

The glue that lives in shared files, so it can be reviewed with the backend and frontend work:
tool executors (`src/lib/services/tools.ts`), nudge detection (`services/nudges.ts`) and its route,
`GET /api/agent/status`, the dev console (`/agent-lab`), and the `/api/agent/chat` and `/api/agent/confirm` routes.

## What the module needs from the rest of the app

- `@/lib/finance/constants` (categories) and `@/lib/finance/budget` (budget line types). Imported by `tasks.ts`, `mock.ts`, `agent.ts`.
- npm packages: `openai`, `zod`, and `vitest` for the tests. Path alias `@` = `src`.
- Environment (server only): `OPENAI_API_KEY`, `OPENAI_MODEL_MID`, `OPENAI_MODEL_FAST`, optional `AI_TIMEOUT_MS`.
  `AI_MOCK=1` returns scripted replies and is for development without a key only.

The tests in `src/lib/ai/*.test.ts` run inside the full app (they need the finance constants above).
They do not run from this branch alone.

## Verification so far (in the full local app, not on this branch)

- Unit tests: passing. Type check and lint on the module: clean.
- Real model (`gpt-5.4-mini`): parser eval 19 of 20; live agent tests 11 of 11 passed.
- Not yet tested with the real model: insight card, `/api/future` narrative, `/api/whatif` explanation, nudge phrasing, CSV categorizing.

## Known open points

See section 6 to 9 of `Agent-API-Mapping.md` (pending-actions storage, `fixed_costs` shape,
`spent_at` on agent-saved expenses, single confirm/undo per message in the chat component).
